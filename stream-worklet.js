class StreamProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    this.sampleRate = options?.processorOptions?.sampleRate || 44100;
    this.bufferSize = this.sampleRate * 2;
    this.audioChunk = new Float32Array(this.bufferSize);
    this.bufferOffset = 0;
    this.isRunning = false;
    this.lastTriggerTime = 0; // timestamp in ms
    this.throttleInterval = 500; // min interval in ms between bufferReady posts

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (msg?.command === 'stop') {
        this.isRunning = false;
        this.bufferOffset = 0;
        this.lastTriggerTime = 0;
      }
    };
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input || input.length === 0) return true;

    if (this.isRunning) return true;

    for (let i = 0; i < input.length && this.bufferOffset < this.bufferSize; i++) {
      this.audioChunk[this.bufferOffset++] = input[i];
    }

    if (this.bufferOffset < this.bufferSize) return true;

    const rmsChunk = Math.sqrt(
      this.audioChunk.reduce((acc, val) => acc + val * val, 0) / this.bufferSize
    );
    if (rmsChunk < 1e-4) {
      this.bufferOffset = 0;
      return true;
    }

    const now = currentTime * 1000; // convert AudioWorklet time to ms
    if (now - this.lastTriggerTime < this.throttleInterval) {
      this.bufferOffset = 0;
      return true;
    }
    this.lastTriggerTime = now;

    const cloned = new Float32Array(this.bufferSize);
    cloned.set(this.audioChunk);

    this.isRunning = true;
    this.port.postMessage({ type: 'bufferReady', data: cloned });
    this.bufferOffset = 0;
    this.isRunning = false;

    return true;
  }
}

registerProcessor('stream-processor', StreamProcessor);