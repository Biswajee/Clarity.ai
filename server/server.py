from flask import Flask
from flask_socketio import SocketIO
import logging

logging.basicConfig(level=logging.DEBUG)
app = Flask(__name__)
# Allow cross-origin WebSocket connections
socketio = SocketIO(app, cors_allowed_origins="*")

logging.basicConfig(level=logging.DEBUG)
app.logger.setLevel(logging.DEBUG)

# WebSocket event handler
@socketio.on("audio_stream")
def handle_audio_stream(data):
    print("Received audio data:", len(data["audio"]))
    socketio.emit("classified_tags", {"tags": ["speech", "background noise", "music"]})  # Dummy tags for now

if __name__ == "__main__":
    socketio.run(app, host="127.0.0.1", port=5000,  debug=True, use_reloader=True)
