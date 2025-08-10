const platform = chrome || browser;
const sampleRate = 44100;
const bufferSize = sampleRate * 1.4; // Increase to ~1.4 seconds for 3072 frames
const tabs = {};
let session = null;
let modelLoading = false;

// Preload ONNX Model with better error handling
(async function preloadModel() {
    if (modelLoading) return;
    modelLoading = true;
    
    try {
        console.log("Preloading ONNX model...");
        await ort.env.ready;

        // Use WebGL backend for better performance if available
        ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;
        ort.env.wasm.wasmPaths = {
            'ort-wasm-simd-threaded': chrome.runtime.getURL('scripts/ort-wasm-simd-threaded.jsep.mjs'),
        };

        const modelURL = chrome.runtime.getURL("models/UVR-MDX-NET-Inst_HQ_3.onnx");
        session = await ort.InferenceSession.create(modelURL, {
            executionProviders: ['wasm'], // Use WASM only since WebGL not available
            graphOptimizationLevel: 'all'
        });
        console.log("ONNX model successfully loaded");
        console.log("Available providers:", session.inputNames, session.outputNames);
        
        // Log model input/output info
        if (session.inputNames && session.inputNames.length > 0) {
            console.log("Model expects input:", session.inputNames[0]);
        }
        if (session.outputNames && session.outputNames.length > 0) {
            console.log("Model will output:", session.outputNames[0]);
        }
    } catch (err) {
        console.error("Failed to preload ONNX model:", err);
        session = null;
    } finally {
        modelLoading = false;
    }
})();

// Improved ONNX input processing for UVR-MDX-NET model
function buildONNXInputFromWaveform(waveform, frameSize = 2048, hopSize = 1024, numFrames = 3072, numBins = 256) {
    const frames = [];
    
    // Create proper stereo processing
    const leftChannel = new Float32Array(waveform.length / 2);
    const rightChannel = new Float32Array(waveform.length / 2);
    
    // Deinterleave stereo audio
    for (let i = 0; i < waveform.length; i += 2) {
        leftChannel[i / 2] = waveform[i] || 0;
        rightChannel[i / 2] = waveform[i + 1] || waveform[i] || 0;
    }
    
    // Process frames with proper windowing
    for (let i = 0; i + frameSize <= leftChannel.length && frames.length < numFrames; i += hopSize) {
        const leftFrame = leftChannel.slice(i, i + frameSize);
        const rightFrame = rightChannel.slice(i, i + frameSize);
        
        // Apply Hann window
        const windowedLeft = new Float32Array(frameSize);
        const windowedRight = new Float32Array(frameSize);
        
        for (let j = 0; j < frameSize; j++) {
            const window = 0.5 * (1 - Math.cos(2 * Math.PI * j / frameSize));
            windowedLeft[j] = leftFrame[j] * window;
            windowedRight[j] = rightFrame[j] * window;
        }
        
        // Get magnitude spectra - use only first 256 bins to match model
        const leftSpectrum = getMagnitudeSpectrum(windowedLeft);
        const rightSpectrum = getMagnitudeSpectrum(windowedRight);
        
        if (leftSpectrum && rightSpectrum && leftSpectrum.length >= numBins) {
            frames.push({
                left: leftSpectrum.slice(0, numBins),
                right: rightSpectrum.slice(0, numBins)
            });
        }
    }
    
    // Pad frames to exact count needed
    while (frames.length < numFrames) {
        const emptyFrame = {
            left: new Float32Array(numBins),
            right: new Float32Array(numBins)
        };
        frames.push(emptyFrame);
    }
    
    // Build tensor with 4 channels as expected by UVR-MDX-NET
    // Channels: [left_mag, right_mag, left_phase, right_phase] 
    const flat = new Float32Array(4 * numFrames * numBins);
    
    for (let t = 0; t < numFrames; t++) {
        for (let f = 0; f < numBins; f++) {
            const baseIdx = t * numBins + f;
            
            // Channel 0: Left magnitude
            flat[baseIdx] = frames[t]?.left[f] || 0;
            
            // Channel 1: Right magnitude  
            flat[numFrames * numBins + baseIdx] = frames[t]?.right[f] || 0;
            
            // Channel 2: Left phase (simplified - using magnitude for now)
            flat[2 * numFrames * numBins + baseIdx] = frames[t]?.left[f] || 0;
            
            // Channel 3: Right phase (simplified - using magnitude for now)
            flat[3 * numFrames * numBins + baseIdx] = frames[t]?.right[f] || 0;
        }
    }
    
    console.log(`Tensor shape: [1, 4, ${numFrames}, ${numBins}]`);
    return new ort.Tensor('float32', flat, [1, 4, numFrames, numBins]);
}

// Simple magnitude spectrum calculation with proper FFT-like behavior
function getMagnitudeSpectrum(timeData) {
    try {
        if (window.Meyda) {
            const spectrum = window.Meyda.extract('amplitudeSpectrum', timeData, { 
                bufferSize: timeData.length,
                sampleRate: sampleRate 
            });
            if (spectrum && spectrum.length > 0) {
                return spectrum;
            }
        }
        
        // Simple fallback: create magnitude spectrum from time domain
        // This is not a proper FFT but will provide some frequency-like representation
        const spectrumSize = Math.floor(timeData.length / 2);
        const spectrum = new Float32Array(spectrumSize);
        
        for (let i = 0; i < spectrumSize; i++) {
            // Simple moving average to simulate frequency bands
            let sum = 0;
            const windowSize = Math.max(1, Math.floor(timeData.length / spectrumSize));
            const start = i * windowSize;
            const end = Math.min(start + windowSize, timeData.length);
            
            for (let j = start; j < end; j++) {
                sum += Math.abs(timeData[j]);
            }
            spectrum[i] = sum / windowSize;
        }
        
        return spectrum;
    } catch (error) {
        console.error("Spectrum calculation failed:", error);
        // Ultimate fallback: return truncated time domain data
        return timeData.slice(0, Math.floor(timeData.length / 2));
    }
}

// Improved streaming with better resource management
async function startStreaming(tabId, stream) {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: sampleRate,
            latencyHint: 'interactive'
        });
        
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        
        const gainOriginal = audioContext.createGain();
        const gainProcessed = audioContext.createGain();
        
        // Start with processed audio enabled (for testing)
        gainOriginal.gain.value = 0.0;  // Mute original
        gainProcessed.gain.value = 1.0; // Enable processed

        await audioContext.audioWorklet.addModule(chrome.runtime.getURL('stream-worklet.js'));
        const workletNode = new AudioWorkletNode(audioContext, 'stream-processor', {
            processorOptions: { 
                sampleRate,
                bufferSize: bufferSize
            }
        });

        tabs[tabId] = {
            audioContext,
            gainOriginal,
            gainProcessed,
            mediaStream: stream,
            workletNode,
            isProcessing: false,
            processingQueue: []
        };

        const source = audioContext.createMediaStreamSource(stream);
        source.connect(workletNode);
        
        // Create separate paths for original and processed audio
        workletNode.connect(gainOriginal);
        const processedGain = audioContext.createGain();
        processedGain.connect(gainProcessed);
        
        gainOriginal.connect(audioContext.destination);
        gainProcessed.connect(audioContext.destination);

        // Handle worklet messages with queue to prevent blocking
        workletNode.port.onmessage = async (event) => {
            const { type, data } = event.data;

            if (type === 'bufferReady') {
                // Add to processing queue instead of processing immediately
                if (tabs[tabId] && tabs[tabId].processingQueue.length < 3) { // Limit queue size
                    tabs[tabId].processingQueue.push(data);
                    processAudioQueue(tabId);
                }
            }
        };
        
        console.log("Audio streaming started for tab:", tabId);
        
        // Set initial mode to accompaniment (processed audio)
        setTimeout(() => {
            if (tabs[tabId]) {
                tabs[tabId].gainOriginal.gain.setTargetAtTime(0.0, audioContext.currentTime, 0.1);
                tabs[tabId].gainProcessed.gain.setTargetAtTime(1.0, audioContext.currentTime, 0.1);
                console.log("Initial mode set to accompaniment (processed audio enabled)");
            }
        }, 100);
        
    } catch (error) {
        console.error("Failed to start streaming:", error);
        if (tabs[tabId]) {
            stopStreaming(tabId);
        }
    }
}

// Process audio queue asynchronously to prevent UI blocking
async function processAudioQueue(tabId) {
    const tabData = tabs[tabId];
    if (!tabData || tabData.isProcessing || tabData.processingQueue.length === 0) {
        return;
    }
    
    tabData.isProcessing = true;
    
    try {
        const waveform = tabData.processingQueue.shift();
        
        if (!waveform || !(waveform instanceof Float32Array) || !session) {
            return;
        }

        // Check if audio has sufficient energy
        const rms = Math.sqrt(waveform.reduce((sum, val) => sum + val * val, 0) / waveform.length);
        if (rms < 0.001) {
            console.log("Low energy audio, skipping processing");
            return;
        }

        const inputTensor = buildONNXInputFromWaveform(waveform);
        
        if (!inputTensor) {
            console.warn("Failed to build input tensor");
            return;
        }

        // Run inference with proper input name
        const inputName = session.inputNames ? session.inputNames[0] : 'input';
        const inputs = {};
        inputs[inputName] = inputTensor;
        
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Inference timeout')), 3000)
        );
        
        const inferencePromise = session.run(inputs);
        const results = await Promise.race([inferencePromise, timeoutPromise]);
        
        // Get output with proper name
        const outputName = session.outputNames ? session.outputNames[0] : 'output';
        const output = results[outputName];
        
        if (!output || !output.data) {
            console.warn("Invalid inference output");
            return;
        }

        console.log("Model inference completed successfully");
        console.log("Output shape:", output.dims);
        console.log("Output data length:", output.data.length);

        // The output is spectral data [1, 4, 3072, 256] - convert back to time domain
        const outputData = output.data;
        const numFrames = output.dims[2]; // 3072
        const numBins = output.dims[3];   // 256
        const channelSize = numFrames * numBins;
        
        console.log("Processing spectral output:", numFrames, "frames,", numBins, "bins");
        
        // Extract magnitude data from all 4 channels and combine them
        const combinedMagnitude = new Float32Array(channelSize);
        
        // Combine all channels for a richer output
        for (let i = 0; i < channelSize; i++) {
            const ch0 = outputData[i] || 0;                    // Channel 0
            const ch1 = outputData[channelSize + i] || 0;      // Channel 1
            const ch2 = outputData[2 * channelSize + i] || 0;  // Channel 2
            const ch3 = outputData[3 * channelSize + i] || 0;  // Channel 3
            
            // Combine channels (this is experimental - adjust as needed)
            combinedMagnitude[i] = (ch0 + ch1 + ch2 + ch3) * 0.25;
        }
        
        // Convert spectral magnitude back to time domain using simpler approach
        const hopSize = 512;  // Smaller hop size for better reconstruction
        const frameSize = 1024;
        const audioLength = waveform.length; // Match original length
        const leftAudio = new Float32Array(audioLength);
        const rightAudio = new Float32Array(audioLength);
        
        // Simple spectral to time conversion
        let writePos = 0;
        for (let frameIdx = 0; frameIdx < numFrames && writePos < audioLength - frameSize; frameIdx++) {
            const frameStart = frameIdx * numBins;
            
            // Create a simple time-domain frame from magnitude data
            for (let i = 0; i < Math.min(frameSize, audioLength - writePos); i++) {
                const binIdx = Math.floor(i * numBins / frameSize);
                const magnitude = combinedMagnitude[frameStart + binIdx];
                
                // Convert magnitude to audio sample with some phase variation
                const phase = (i * 0.1 + frameIdx * 0.01) % (Math.PI * 2);
                const sample = magnitude * Math.cos(phase) * 0.1; // Scale down significantly
                
                if (writePos + i < audioLength) {
                    leftAudio[writePos + i] += sample;
                    rightAudio[writePos + i] += sample * 0.8; // Slight difference for stereo
                }
            }
            
            writePos += hopSize;
        }
        
        // Normalize
        let maxAmp = 0;
        for (let i = 0; i < audioLength; i++) {
            maxAmp = Math.max(maxAmp, Math.abs(leftAudio[i]), Math.abs(rightAudio[i]));
        }
        
        if (maxAmp > 0) {
            const normalizeGain = 0.3 / maxAmp; // Increase gain
            for (let i = 0; i < audioLength; i++) {
                leftAudio[i] *= normalizeGain;
                rightAudio[i] *= normalizeGain;
            }
        }
        
        console.log("Reconstructed audio length:", audioLength, "samples");
        console.log("Max amplitude:", maxAmp);
        
        // Create audio buffer
        const audioContext = tabData.audioContext;
        const playbackBuffer = audioContext.createBuffer(2, audioLength, sampleRate);
        
        // Copy reconstructed audio
        playbackBuffer.copyToChannel(leftAudio, 0);
        playbackBuffer.copyToChannel(rightAudio, 1);

        // Play processed audio
        const player = audioContext.createBufferSource();
        player.buffer = playbackBuffer;
        
        // Debug: Check audio context state
        console.log("Audio context state:", audioContext.state);
        console.log("Gain values - Original:", tabData.gainOriginal.gain.value, "Processed:", tabData.gainProcessed.gain.value);
        
        // Ensure audio context is running
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        
        // Connect and play
        player.connect(tabData.gainProcessed);
        player.start();
        
        // Add volume debugging
        const testOscillator = audioContext.createOscillator();
        const testGain = audioContext.createGain();
        testOscillator.frequency.value = 440; // A4 note
        testGain.gain.value = 0.1;
        testOscillator.connect(testGain);
        testGain.connect(audioContext.destination);
        testOscillator.start(audioContext.currentTime + 0.1);
        testOscillator.stop(audioContext.currentTime + 0.3);
        console.log("Test tone should play to verify audio output");
        
        // Clean up player after playback
        player.onended = () => {
            try {
                player.disconnect();
                console.log("Player disconnected after playback");
            } catch (e) {
                // Already disconnected
            }
        };
        
        console.log("Processed audio playback started");
        console.log("Expected duration:", playbackBuffer.duration, "seconds");
        
    } catch (error) {
        console.error("Audio processing error:", error);
    } finally {
        if (tabs[tabId]) {
            tabs[tabId].isProcessing = false;
            // Process next item in queue
            setTimeout(() => processAudioQueue(tabId), 10);
        }
    }
}

// Clean stop function
function stopStreaming(tabId) {
    const tabData = tabs[tabId];
    if (!tabData) return;
    
    try {
        if (tabData.workletNode) {
            tabData.workletNode.port.postMessage({ command: 'stop' });
            tabData.workletNode.disconnect();
        }
        
        if (tabData.audioContext && tabData.audioContext.state !== 'closed') {
            tabData.audioContext.close();
        }
        
        if (tabData.mediaStream) {
            tabData.mediaStream.getTracks().forEach(track => track.stop());
        }
        
        // Clear processing queue
        tabData.processingQueue = [];
        
    } catch (error) {
        console.error("Error stopping stream:", error);
    } finally {
        delete tabs[tabId];
    }
}

// Message handler with better error handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const tabId = message.tabId;

    if (message.type === "toggleAudioProcessing") {
        if (!tabId) {
            sendResponse({ status: "Error: No tab ID" });
            return;
        }

        if (message.active) {
            if (!session && !modelLoading) {
                sendResponse({ status: "Error: Model not loaded" });
                return;
            }
            
            platform.tabCapture.capture({ audio: true, video: false }, async (stream) => {
                if (!stream) {
                    sendResponse({ status: "Stream capture failed" });
                    return;
                }
                
                try {
                    await startStreaming(tabId, stream);
                    sendResponse({ status: "Audio processing started" });
                } catch (error) {
                    console.error("Failed to start streaming:", error);
                    sendResponse({ status: "Error starting audio processing" });
                }
            });
        } else {
            stopStreaming(tabId);
            sendResponse({ status: "Audio processing stopped" });
        }

        return true; // Keep message port alive for async response
    }

    if (message.type === "switchStream" && tabs[tabId]) {
        const tabData = tabs[tabId];
        const ctx = tabData.audioContext;
        
        if (message.target === "vocals") {
            // Vocals = original audio (before separation)
            tabData.gainOriginal.gain.setTargetAtTime(1.0, ctx.currentTime, 0.1);
            tabData.gainProcessed.gain.setTargetAtTime(0.0, ctx.currentTime, 0.1);
        } else { // accompaniment
            // Accompaniment = processed audio (after separation)
            tabData.gainOriginal.gain.setTargetAtTime(0.0, ctx.currentTime, 0.1);
            tabData.gainProcessed.gain.setTargetAtTime(1.0, ctx.currentTime, 0.1);
        }
        console.log("Switched to", message.target, "- Original gain:", message.target === "vocals" ? 1.0 : 0.0, "Processed gain:", message.target === "vocals" ? 0.0 : 1.0);
        sendResponse({ status: `Switched to ${message.target}` });
    }
});

// Keep background alive with less frequent pings
setInterval(() => console.log("Background alive"), 30000);