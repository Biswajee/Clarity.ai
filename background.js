// Get platform specific interface object.
let platform = chrome ? chrome : browser;

// Per tab data.
const tabs = [];

// Flask Server URL
const SERVER_URL = "http://127.0.0.1:5000/tags";

// Function to send audio data to Flask backend
async function sendAudioToServer(audioBuffer) {
    try {
        const response = await fetch(SERVER_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ audio: audioBuffer }) // Modify based on actual audio data structure
        });

        const data = await response.json();
        console.log("Received tags:", data.tags);
        updateUIWithTags(data.tags);
    } catch (error) {
        console.error("Error communicating with Flask server:", error);
    }
}

function extractAudioData(stream) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);

    source.connect(processor);
    processor.connect(audioContext.destination);

    return new Promise((resolve) => {
        processor.onaudioprocess = (event) => {
            const audioBuffer = event.inputBuffer.getChannelData(0);  // Extract raw audio
            resolve(Array.from(audioBuffer));  // Convert to a plain array for JSON serialization
            processor.disconnect();  // Stop processing once we have data
        };
    });
}

function updateUIWithTags(tags) {
    // Send tags to popup.js for display in the UI
    chrome.runtime.sendMessage({ type: "updateTags", tags });
}

// On runtime message received.
platform.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (tabs[request.id] === undefined) { tabs[request.id] = {}; }

    if (tabs[request.id].audioContext !== undefined) {
        tabs[request.id].audioContext.close();
    }
    if (tabs[request.id].mediaStream !== undefined) {
        tabs[request.id].mediaStream.getAudioTracks()[0].stop();
    }

    tabs[request.id] = {};
});

// Handling audio processing toggle
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "toggleAudioProcessing") {
        const tabId = message.tabId;

        if (!tabId) {
            console.error("No tab ID found for audio processing.");
            sendResponse({ status: "Error: No tab ID" });
            return;
        }

        if (message.active) {
            console.log(`Starting audio processing for tab ${tabId}...`);

            if (!tabs[tabId]) {
                tabs[tabId] = {};
            }

            if (!tabs[tabId].audioContext) {
                tabs[tabId].audioContext = new (window.AudioContext || window.webkitAudioContext)();
                platform.tabCapture.capture({ audio: true, video: false }, (stream) => {
                    if (!stream) {
                        console.error("Stream capture failed.");
                        tabs[tabId].audioContext.close();
                        tabs[tabId].audioContext = undefined;
                        return;
                    }

                    tabs[tabId].mediaStream = stream;
                    let source = tabs[tabId].audioContext.createMediaStreamSource(stream);
                    tabs[tabId].gainFilter = tabs[tabId].audioContext.createGain();
                    source.connect(tabs[tabId].gainFilter);
                    tabs[tabId].gainFilter.connect(tabs[tabId].audioContext.destination);

                    if (message.volume !== undefined) {
                        tabs[tabId].gainFilter.gain.value = message.volume;
                    }

                    // Capture and send audio to Flask backend
                    sendAudioToServer(extractAudioData(stream)); // Ensure `extractAudioData()` is properly defined
                });
            }
        } else {
            console.log(`Stopping audio processing for tab ${tabId}...`);
            if (tabs[tabId]?.audioContext) {
                tabs[tabId].audioContext.close();
            }
            if (tabs[tabId]?.mediaStream) {
                tabs[tabId].mediaStream.getAudioTracks()[0].stop();
            }
            delete tabs[tabId]; // Remove tab data when processing stops
        }

        sendResponse({ status: `Audio processing ${message.active ? "started" : "stopped"}` });
    }
});

// UI interactions
const gainNodes = {};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'toggle-sound') {
        adjustSound(message.tag, message.selected);
        sendResponse({ status: 'Sound adjusted for ' + message.tag });
    }
});

function adjustSound(tag, isSelected) {
    if (gainNodes[tag]) {
        gainNodes[tag].gain.value = isSelected ? 2.0 : 0.0;
        console.log(`Adjusted gain for ${tag} to ${gainNodes[tag].gain.value}`);
    } else {
        console.log(`No gain node found for tag: ${tag}`);
    }
}