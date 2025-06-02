from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app, origins="chrome-extension://hkahdmaojpojahaialjnjjhfbddfniai")  # Allow your extension

@app.route("/tags", methods=["POST"])
def get_tags():
    data = request.json  # Received audio metadata
    tags = ["speech", "background noise", "music"]  # Example tags
    return jsonify({"tags": tags})

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000)