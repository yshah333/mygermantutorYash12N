// Runs on the audio thread: turns microphone audio into 16 kHz, 16-bit PCM frames of 20 ms
// and posts them to the page together with their loudness.
class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;   // e.g. 48000 / 16000 = 3
    this.acc = 0;                      // running sum for the current output sample
    this.accN = 0;                     // input samples in it
    this.pos = 0;                      // fractional position
    this.frame = new Int16Array(320);  // 20 ms at 16 kHz
    this.fi = 0;
    this.energy = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i]; this.accN++; this.pos += 1;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        let v = this.acc / this.accN; this.acc = 0; this.accN = 0;
        if (v > 1) v = 1; else if (v < -1) v = -1;
        this.energy += v * v;
        this.frame[this.fi++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        if (this.fi === this.frame.length) {
          const rms = Math.sqrt(this.energy / this.frame.length);
          this.port.postMessage({ pcm: this.frame.buffer, rms }, [this.frame.buffer]);
          this.frame = new Int16Array(320); this.fi = 0; this.energy = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("mic-processor", MicProcessor);
