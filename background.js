// Get platform specific interface object.
let platform = chrome ? chrome : browser;

// Per tab data.
const tabs = [];

// On runtime message received.
platform.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    // Setup empty object if not called previously.
    if (tabs[request.id] === undefined) { tabs[request.id] = {}; }
    // If volume is default disable everything.
    // TODO: Add support to stop inferencing

    if (tabs[request.id].audioContext !== undefined) {
        tabs[request.id].audioContext.close();
    }
    if (tabs[request.id].mediaStream !== undefined) {
        tabs[request.id].mediaStream.getAudioTracks()[0].stop();
    }
    tabs[request.id] = {};
});

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


const gainNodes = {};           // Mapping: tag -> GainNode
const soundTags = ['music', 'speech', 'noise'];  // Example tags

// Listen for messages from popup.js to adjust sound levels
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'toggle-sound') {
        // Adjust the gain for the sound tag based on UI selection
        adjustSound(message.tag, message.selected);
        sendResponse({ status: 'Sound adjusted for ' + message.tag });
    }
});

// Function to adjust gain based on tag selection
function adjustSound(tag, isSelected) {
    if (gainNodes[tag]) {
        // Amplify selected sound (e.g. gain = 2.0) or mute unselected (gain = 0.0)
        gainNodes[tag].gain.value = isSelected ? 2.0 : 0.0;
        console.log(`Adjusted gain for ${tag} to ${gainNodes[tag].gain.value}`);
    } else {
        console.log(`No gain node found for tag: ${tag}`);
    }
}