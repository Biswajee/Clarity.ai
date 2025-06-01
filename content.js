chrome.runtime.sendMessage({ type: "captureAudio" }, (response) => {
    if (response.success) {
        navigator.mediaDevices.getUserMedia({
            audio: {
                mandatory: {
                    chromeMediaSource: "tab",
                    chromeMediaSourceId: response.streamId,
                },
            },
        }).then(stream => {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            const audioContext = new AudioContext();
            const source = audioContext.createMediaStreamSource(stream);
            source.connect(audioContext.destination); // ✅ Enables audio playback
            console.log("Tab audio captured successfully!");
        }).catch(error => console.error("Error capturing tab audio:", error));

    }
    else if (!response.success || !response.streamId) {
        console.error("Stream ID is missing or capture failed.");
        return;
    } else {
        console.error("Failed to start audio capture.");
    }
});