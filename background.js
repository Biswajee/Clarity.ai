const platform = chrome || browser;
const sampleRate = 44100;
const bufferSize = sampleRate * 2;
const tabs = {};
let session = null;

// Preload ONNX Model
(async function preloadModel() {
    try {
        console.log("Preloading ONNX model...");
        await ort.env.ready;

        ort.env.wasm.numThreads = 1;
        ort.env.wasm.wasmPaths = {
            'ort-wasm-simd-threaded': chrome.runtime.getURL('scripts/ort-wasm-simd-threaded.jsep.mjs'),
        };

        const modelURL = chrome.runtime.getURL("models/UVR-MDX-NET-Inst_HQ_3.onnx");
        session = await ort.InferenceSession.create(modelURL);
        console.log("ONNX model successfully loaded.");
    } catch (err) {
        console.error("Failed to preload ONNX model:", err);
    }
})();

function buildONNXInputFromWaveform(waveform, frameSize = 512, hopSize = 256, numFrames = 3072, numBins = 256) {
    const frames = [];
    const Meyda = window.Meyda;

    for (let i = 0; i + frameSize <= waveform.length && frames.length < numFrames; i += hopSize) {
        const frame = waveform.slice(i, i + frameSize);
        const normalized = new Float32Array(frameSize);
        const peak = Math.max(...frame.map(Math.abs)) || 1;

        for (let j = 0; j < frameSize; j++) normalized[j] = frame[j] / peak;
        const spectrum = Meyda.extract('amplitudeSpectrum', normalized, { bufferSize: frameSize });

        if (!spectrum || spectrum.length < numBins) {
            console.warn(`Meyda returned insufficient spectrum at frame ${frames.length}`);
            continue;
        }

        frames.push(spectrum.slice(0, numBins));
    }

    const channels = [frames, frames, frames, frames];
    const flat = new Float32Array(4 * numFrames * numBins);

    for (let ch = 0; ch < 4; ch++) {
        for (let t = 0; t < numFrames; t++) {
            for (let f = 0; f < numBins; f++) {
                const idx = ch * numFrames * numBins + t * numBins + f;
                const value = channels[ch]?.[t]?.[f] ?? 0;
                flat[idx] = isNaN(value) ? 0 : value;
            }
        }
    }

    console.log(`Tensor shape: [1, 4, ${numFrames}, ${numBins}]`);
    return new ort.Tensor('float32', flat, [1, 4, numFrames, numBins]);
}

async function startStreaming(tabId, stream) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const gainOriginal = audioContext.createGain();
    const gainProcessed = audioContext.createGain();

    await audioContext.audioWorklet.addModule(chrome.runtime.getURL('stream-worklet.js'));
    const workletNode = new AudioWorkletNode(audioContext, 'stream-processor', {
        processorOptions: { sampleRate }
    });

    tabs[tabId] = {
        audioContext,
        gainOriginal,
        gainProcessed,
        mediaStream: stream,
        workletNode
    };

    const source = audioContext.createMediaStreamSource(stream);
    source.connect(workletNode);
    workletNode.connect(gainOriginal);
    workletNode.connect(gainProcessed);
    gainOriginal.connect(audioContext.destination);
    gainProcessed.connect(audioContext.destination);

    workletNode.port.onmessage = async (event) => {
        const { type, data } = event.data;

        if (type === 'debug') {
            console.log("Worklet RMS:", event.data.rms);
            return;
        }

        if (type === 'bufferReady') {
            console.log("Audio Buffer:", event.data.data);

            const waveform = event.data.data;

            if (!waveform || !(waveform instanceof Float32Array)) return;
            if (!session) return console.error("ONNX session is not available.");

            const inputTensor = buildONNXInputFromWaveform(waveform);
            console.log("Input tensor:", inputTensor);

            if (!inputTensor || inputTensor.dims?.[2] < 3072) return;

            try {
                const results = await session.run({ input: inputTensor });
                const output = results["output"];
                if (!output || !output.data || !output.data.length) {
                    console.warn("ONNX output is invalid or empty.");
                    return;
                }

                console.log("Model inference completed.");
                console.log("Output dims:", output.dims);
                console.log("Output length:", output.data.length);

                const sum = output.data.reduce((a, b) => a + Math.abs(b), 0);
                const rms = Math.sqrt(sum / output.data.length);
                console.log("Output RMS:", rms);
                if (rms < 0.01) {
                    console.warn("Low-energy buffer — skipping playback.");
                    return;
                }

                const playbackBuffer = audioContext.createBuffer(1, output.data.length, sampleRate);
                playbackBuffer.copyToChannel(output.data, 0);

                const player = audioContext.createBufferSource();
                player.buffer = playbackBuffer;
                gainProcessed.gain.value = 1.0;
                player.connect(gainProcessed);
                player.start();
                player.onended = () => console.log("Playback ended");
                console.log("Playback triggered");
            } catch (err) {
                console.error("Inference or playback error:", err);
            }
        }
    };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const tabId = message.tabId;

    if (message.type === "toggleAudioProcessing") {
        if (!tabId) return sendResponse({ status: "Error: No tab ID" });

        if (message.active) {
            platform.tabCapture.capture({ audio: true, video: false }, (stream) => {
                if (!stream) return sendResponse({ status: "Stream error" });
                startStreaming(tabId, stream);
                sendResponse({ status: "Audio processing started" });
            });
        } else {
            if (tabs[tabId]?.workletNode) {
                tabs[tabId].workletNode.port.postMessage({ command: 'stop' });
                tabs[tabId].workletNode.disconnect();
            }
            if (tabs[tabId]?.audioContext) tabs[tabId].audioContext.close();
            if (tabs[tabId]?.mediaStream) {
                tabs[tabId].mediaStream.getTracks().forEach(track => track.stop());
            }
            delete tabs[tabId];
            sendResponse({ status: "Audio processing stopped" });
        }

        return true; // Keeps message port alive for async response
    }

    if (message.type === "switchStream" && tabs[tabId]) {
        const ctx = tabs[tabId].audioContext;
        if (message.target === "vocals") {
            tabs[tabId].gainOriginal.gain.setTargetAtTime(1.0, ctx.currentTime, 0.05);
            tabs[tabId].gainProcessed.gain.setTargetAtTime(0.0, ctx.currentTime, 0.05);
        } else {
            tabs[tabId].gainOriginal.gain.setTargetAtTime(0.0, ctx.currentTime, 0.05);
            tabs[tabId].gainProcessed.gain.setTargetAtTime(1.0, ctx.currentTime, 0.05);
        }
    }
});

setInterval(() => console.log("Keeping background page alive..."), 5000);