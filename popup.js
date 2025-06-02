document.addEventListener('DOMContentLoaded', () => {
    const toggleButton = document.getElementById("toggleAudio");
    let isProcessing = false;

    toggleButton.addEventListener("click", () => {
        isProcessing = !isProcessing;
        toggleButton.textContent = isProcessing ? "Stop Audio Processing" : "Start Audio Processing";

        // ✅ Explicitly Retrieve Tab ID Before Sending Message
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length === 0) {
                console.error("No active tab found.");
                return;
            }

            chrome.runtime.sendMessage({ type: "toggleAudioProcessing", tabId: tabs[0].id, active: isProcessing }, (response) => {
                console.log(response?.status || "No response from background script.");
            });
        });
    });

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