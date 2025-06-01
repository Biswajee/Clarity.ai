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

    // ✅ Handling Sound Tags
    const tags = ['music', 'speech', 'noise'];
    const container = document.getElementById('tagsContainer');

    tags.forEach(tag => {
        const button = document.createElement('button');
        button.textContent = tag;
        button.className = 'tag';
        button.dataset.selected = 'false';

        button.addEventListener('click', function () {
            this.classList.toggle("selected");
            const selected = this.classList.contains("selected");

            // ✅ Pass Tab ID When Sending Message
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs.length === 0) {
                    console.error("No active tab found.");
                    return;
                }

                chrome.runtime.sendMessage({ type: 'toggle-sound', tabId: tabs[0].id, tag: tag, selected: selected }, response => {
                    console.log(response?.status || "No response from background script.");
                });
            });
        });

        container.appendChild(button);
    });
});