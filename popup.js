document.addEventListener("DOMContentLoaded", () => {
    const toggleButton = document.getElementById("toggleAudio");
    const streamModeSelector = document.getElementById("streamMode");
    let isProcessing = false;
    let currentTabId = null;

    // Load saved state from storage
    chrome.storage.local.get(["isProcessing", "streamMode"], (data) => {
        isProcessing = data.isProcessing || false;
        updateButtonState(isProcessing);
        
        const savedMode = data.streamMode || "accompaniment";
        streamModeSelector.value = savedMode;
    });

    // Get current tab ID
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length > 0) {
            currentTabId = tabs[0].id;
        }
    });

    function updateButtonState(processing) {
        toggleButton.textContent = processing ? "Stop Audio Processing" : "Start Audio Processing";
        toggleButton.disabled = false;
        streamModeSelector.disabled = !processing;
        
        if (processing) {
            toggleButton.style.backgroundColor = "#f44336";
            toggleButton.style.color = "white";
        } else {
            toggleButton.style.backgroundColor = "#4CAF50";
            toggleButton.style.color = "white";
        }
    }

    function showStatus(message, isError = false) {
        // Create status element if it doesn't exist
        let status = document.getElementById("status");
        if (!status) {
            status = document.createElement("div");
            status.id = "status";
            status.style.cssText = `
                margin-top: 10px;
                padding: 5px;
                border-radius: 3px;
                font-size: 12px;
                text-align: center;
            `;
            document.body.appendChild(status);
        }
        
        status.textContent = message;
        status.style.backgroundColor = isError ? "#ffebee" : "#e8f5e8";
        status.style.color = isError ? "#c62828" : "#2e7d32";
        status.style.border = isError ? "1px solid #ffcdd2" : "1px solid #c8e6c9";
        
        // Clear status after 3 seconds
        setTimeout(() => {
            if (status.parentNode) {
                status.parentNode.removeChild(status);
            }
        }, 3000);
    }

    toggleButton.addEventListener("click", async () => {
        if (!currentTabId) {
            showStatus("No active tab found", true);
            return;
        }

        // Prevent multiple clicks
        toggleButton.disabled = true;
        const newState = !isProcessing;

        try {
            // Update UI immediately for responsiveness
            isProcessing = newState;
            updateButtonState(isProcessing);

            // Save state to storage
            chrome.storage.local.set({ isProcessing: isProcessing });

            // Send message to background script with timeout
            const response = await sendMessageWithTimeout({
                type: "toggleAudioProcessing",
                tabId: currentTabId,
                active: isProcessing
            }, 5000);

            if (response && response.status) {
                showStatus(response.status, response.status.includes("Error"));
                
                // If there was an error, revert the state
                if (response.status.includes("Error")) {
                    isProcessing = !newState;
                    updateButtonState(isProcessing);
                    chrome.storage.local.set({ isProcessing: isProcessing });
                }
            } else {
                showStatus("No response from background script", true);
            }

            // Clear tags when stopping
            if (!isProcessing) {
                clearTags();
            }

        } catch (error) {
            console.error("Toggle error:", error);
            showStatus("Failed to toggle audio processing", true);
            
            // Revert state on error
            isProcessing = !newState;
            updateButtonState(isProcessing);
            chrome.storage.local.set({ isProcessing: isProcessing });
        }
    });

    // Stream mode selector
    streamModeSelector.addEventListener("change", async (event) => {
        const selectedMode = event.target.value;
        
        if (!currentTabId || !isProcessing) {
            return;
        }

        try {
            // Save selection
            chrome.storage.local.set({ streamMode: selectedMode });

            const response = await sendMessageWithTimeout({
                type: "switchStream",
                tabId: currentTabId,
                target: selectedMode
            }, 2000);

            if (response && response.status) {
                showStatus(`Switched to ${selectedMode}`);
            }
        } catch (error) {
            console.error("Stream switch error:", error);
            showStatus("Failed to switch stream mode", true);
        }
    });

    // Helper function to send messages with timeout
    function sendMessageWithTimeout(message, timeoutMs = 3000) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error("Message timeout"));
            }, timeoutMs);

            chrome.runtime.sendMessage(message, (response) => {
                clearTimeout(timeout);
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response);
                }
            });
        });
    }

    // Function to clear tags
    function clearTags() {
        const tagContainer = document.getElementById("tag-list");
        if (tagContainer) {
            tagContainer.innerHTML = "";
        }
    }

    // Listen for tag updates from background
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === "updateTags") {
            displayTags(message.tags);
        } else if (message.type === "processingStatus") {
            showStatus(message.status, message.isError);
        }
    });

    function displayTags(tags) {
        const tagContainer = document.getElementById("tag-list");
        if (!tagContainer) return;
        
        tagContainer.innerHTML = "";

        if (!tags || tags.length === 0) {
            const noTags = document.createElement("div");
            noTags.textContent = "No sounds detected";
            noTags.style.color = "#666";
            noTags.style.fontStyle = "italic";
            tagContainer.appendChild(noTags);
            return;
        }

        tags.forEach((tag) => {
            const tagElement = document.createElement("div");
            tagElement.className = "tag";
            tagElement.textContent = tag;
            tagContainer.appendChild(tagElement);
        });
    }

    // Handle popup closing
    window.addEventListener("beforeunload", () => {
        // Save current state when popup closes
        chrome.storage.local.set({ 
            isProcessing: isProcessing,
            streamMode: streamModeSelector.value
        });
    });
});