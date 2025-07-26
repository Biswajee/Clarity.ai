// Get platform-specific interface object
const platform = chrome ? chrome : browser;

// 🔹 Configuration
const SERVER_URL = "http://127.0.0.1:5000";  // WebSocket Server URL
const tabs = {};

ort.env.wasm.numThreads = 1;  // Try with single-threaded if SIMD/threaded fails
ort.env.wasm.wasmPaths = {
  'ort-wasm-simd-threaded': chrome.runtime.getURL('scripts/ort-wasm-simd-threaded.jsep.mjs'),
};

async function loadModel() {
    await ort.env.ready;  // Ensure WASM backends are ready
    const modelURL = chrome.runtime.getURL("models/UVR-MDX-NET-Inst_HQ_3.onnx");
    const session = await ort.InferenceSession.create(modelURL);
    console.log('Model loaded:', session);
    return session;
}

// ✅ Initialize WebSocket Connection
function connectSocket(tabId) {
    if (!tabs[tabId]) {
        tabs[tabId] = {};  // ✅ Ensure tab object exists
    }
    tabs[tabId].socket = io(SERVER_URL);
    setupWebSocketListeners(tabs[tabId].socket);
}

// ✅ Start Streaming Audio to Flask via WebSockets
function startStreaming(tabId, stream) {
    if (!tabs[tabId]) {
        tabs[tabId] = {};  // ✅ Ensure tab object exists
    }

    const audioContext = tabs[tabId].audioContext || new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);

    tabs[tabId].audioContext = audioContext;
    tabs[tabId].gainFilter = audioContext.createGain();
    source.connect(tabs[tabId].gainFilter);
    tabs[tabId].gainFilter.connect(audioContext.destination);

    processor.onaudioprocess = (event) => {
        const now = Date.now();
        if (!tabs[tabId].lastSentTime || now - tabs[tabId].lastSentTime > 100) {  // ✅ Throttle WebSocket streaming
            const audioBuffer = Array.from(event.inputBuffer.getChannelData(0));
            if (tabs[tabId].socket) {  // ✅ Ensure WebSocket exists before emitting
                tabs[tabId].socket.emit("audio_stream", { audio: audioBuffer });
            }
            tabs[tabId].lastSentTime = now;
        }
    };

    source.connect(processor);
    processor.connect(audioContext.destination);
}

// ✅ Handle UI Updates
function updateUIWithTags(tags) {
    chrome.runtime.sendMessage({ type: "updateTags", tags });
}

// ✅ WebSocket Event Listener: Receiving Tags
function setupWebSocketListeners(socket) {
    socket.on("classified_tags", (data) => {
        updateUIWithTags(data.tags);
    });
}

// ✅ Start/Stop Audio Processing
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const tabId = message.tabId;

    if (message.type === "toggleAudioProcessing") {
        if (!tabId) {
            console.error("No tab ID found.");
            sendResponse({ status: "Error: No tab ID" });
            return;
        }

        if (message.active) {
            console.log(`Starting audio processing for tab ${tabId}...`);

            if (!tabs[tabId]) {
                tabs[tabId] = {};
            }

            platform.tabCapture.capture({ audio: true, video: false }, (stream) => {
                if (!stream) {
                    console.error("Stream capture failed.");
                    return;
                }

                tabs[tabId].mediaStream = stream;
                connectSocket(tabId);  // ✅ Ensure WebSocket reconnects properly
                startStreaming(tabId, stream);
            });
        } else {
            console.log(`Stopping audio processing for tab ${tabId}...`);

            if (tabs[tabId]?.audioContext) {
                tabs[tabId].audioContext.close();
            }
            if (tabs[tabId]?.mediaStream) {
                tabs[tabId].mediaStream.getAudioTracks()[0].stop();
            }

            if (tabs[tabId]?.socket) {
                tabs[tabId].socket.disconnect();
            }

            delete tabs[tabId];
        }

        sendResponse({ status: `Audio processing ${message.active ? "started" : "stopped"}` });
    }
});

// ✅ Keep Background Page Alive (For Manifest V2)
setInterval(() => console.log("Keeping background page alive..."), 5000);