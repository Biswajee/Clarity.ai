document.addEventListener("DOMContentLoaded", () => {
    const toggleButton = document.getElementById("toggleAudio");

    // ✅ Load saved state from storage
    chrome.storage.local.get("isProcessing", (data) => {
        const savedState = data.isProcessing || false;
        toggleButton.textContent = savedState ? "Stop Audio Processing" : "Start Audio Processing";
    });

    toggleButton.addEventListener("click", () => {
        chrome.storage.local.get("isProcessing", (data) => {
            const currentState = !data.isProcessing;  // Toggle state

            // ✅ Update button text based on state
            toggleButton.textContent = currentState ? "Stop Audio Processing" : "Start Audio Processing";

            // ✅ Save state to storage
            chrome.storage.local.set({ isProcessing: currentState });

            // ✅ Send message to background script
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs.length === 0) {
                    console.error("No active tab found.");
                    return;
                }
                chrome.runtime.sendMessage({ type: "toggleAudioProcessing", tabId: tabs[0].id, active: currentState }, (response) => {
                    console.log(response?.status || "No response from background script.");
                });
            });

            // ✅ Clear tags when stopping recording
            if (!currentState) {
                clearTags();
            }
        });
    });

    // ✅ Function to clear tags
    function clearTags() {
        const tagContainer = document.getElementById("tag-list");
        tagContainer.innerHTML = "";
    }

    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === "updateTags") {
            displayTags(message.tags);
        }
    });

    function displayTags(tags) {
        const tagContainer = document.getElementById("tag-list");
        tagContainer.innerHTML = "";

        tags.forEach((tag) => {
            const tagElement = document.createElement("div");
            tagElement.className = "tag";
            tagElement.textContent = tag;
            tagContainer.appendChild(tagElement);
        });
    }
});