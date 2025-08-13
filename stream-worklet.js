class StreamProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    this.sampleRate = options?.processorOptions?.sampleRate || 44100;
    this.bufferSize = options?.processorOptions?.bufferSize || (this.sampleRate * 1.4);
    this.audioBuffer = [];
    this.isRunning = false;
    this.lastProcessTime = 0;
    this.minInterval = 50; // Reduced to 50ms for more responsive processing
    this.silenceThreshold = 1e-4;
    this.processingCounter = 0; // Replace setTimeout with counter
    
    console.log(`StreamProcessor initialized: bufferSize=${this.bufferSize}, sampleRate=${this.sampleRate}`);

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (msg?.command === 'stop') {
        this.isRunning = false;
        this.audioBuffer = [];
        this.lastProcessTime = 0;
        this.processingCounter = 0;
        console.log("StreamProcessor stopped");
      }
    };
  }

  processBuffer() {
    if (this.isRunning || this.audioBuffer.length < this.bufferSize) {
      return;
    }

    // Calculate RMS to check for silence
    const rms = this.calculateRMS();
    if (rms < this.silenceThreshold) {
      this.audioBuffer = [];
      return;
    }

    this.isRunning = true;

    // Extract buffer data
    const bufferData = new Float32Array(this.bufferSize);
    for (let i = 0; i < this.bufferSize && i < this.audioBuffer.length; i++) {
      bufferData[i] = this.audioBuffer[i];
    }

    // Clear processed data from buffer
    this.audioBuffer.splice(0, this.bufferSize);

    // Send to background for processing
    this.port.postMessage({
      type: 'bufferReady',
      data: bufferData,
      timestamp: currentTime,
      rms: rms
    });

    // Use counter instead of setTimeout (setTimeout not available in AudioWorklet)
    this.processingCounter = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) {
      return true;
    }

    // Handle processing counter (replaces setTimeout)
    if (this.isRunning) {
      this.processingCounter++;
      if (this.processingCounter > 4096) { // ~100ms at 44.1kHz with 128 sample blocks
        this.isRunning = false;
        this.processingCounter = 0;
      }
    }

    // Handle stereo input properly
    const leftChannel = input[0];
    const rightChannel = input[1] || input[0]; // Fallback to mono if no right channel
    
    // Interleave stereo channels for processing
    for (let i = 0; i < leftChannel.length; i++) {
      this.audioBuffer.push(leftChannel[i]);
      this.audioBuffer.push(rightChannel[i]);
    }

    // Check if buffer is full and enough time has passed
    const now = currentTime * 1000; // Convert to milliseconds
    if (this.audioBuffer.length >= this.bufferSize && 
        !this.isRunning && 
        (now - this.lastProcessTime) >= this.minInterval) {
      
      this.processBuffer();
      this.lastProcessTime = now;
    }

    // Prevent buffer from growing too large
    if (this.audioBuffer.length > this.bufferSize * 2) {
      const excess = this.audioBuffer.length - this.bufferSize;
      this.audioBuffer.splice(0, excess);
    }

    return true;
  }

  calculateRMS() {
    if (this.audioBuffer.length === 0) return 0;
    
    let sum = 0;
    const samples = Math.min(this.audioBuffer.length, this.bufferSize);
    
    for (let i = 0; i < samples; i++) {
      const sample = this.audioBuffer[i] || 0;
      sum += sample * sample;
    }
    
    return Math.sqrt(sum / samples);
  }
}

registerProcessor('stream-processor', StreamProcessor);
