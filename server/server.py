from flask import Flask
from flask_socketio import SocketIO
import logging
import numpy as np
from scipy.signal import spectrogram

logging.basicConfig(level=logging.DEBUG)

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

app.logger.setLevel(logging.DEBUG)

def get_frequencies(audio_samples, sample_rate=16000):
    frequencies, times, spectrogram_data = spectrogram(audio_samples, sample_rate)
    # ✅ Normalize spectrogram data
    norm_spectrum = spectrogram_data / np.max(spectrogram_data)
    # ✅ Adaptive threshold: Consider frequencies that exceed 10% of peak energy
    significant_freqs = np.sum(norm_spectrum > 0.1)  # Counts only meaningful frequencies

    return frequencies.tolist(), spectrogram_data.tolist(), int(significant_freqs)

# ✅ WebSocket Event Handler: Receive Audio & Send Frequency Count
@socketio.on("audio_stream")
def handle_audio_stream(data):
    app.logger.info(f"Received audio data: {len(data['audio'])} samples")

    audio_samples = np.array(data["audio"], dtype=np.float32)
    frequencies, spectrum, freq_count = get_frequencies(audio_samples)

    app.logger.info(f"Active frequencies detected: {freq_count}")

    socketio.emit("frequency_update", {"count": int(freq_count)})  # Send frequency count only
    socketio.emit("classified_tags", {"tags": ["speech", "background noise", "music"]})  # Dummy tags for now

if __name__ == "__main__":
    socketio.run(app, host="127.0.0.1", port=5000, debug=True, use_reloader=True)