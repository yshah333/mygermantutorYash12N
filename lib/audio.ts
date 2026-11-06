/** Microphone → 20 ms frames of 16 kHz PCM16 (via an AudioWorklet), with loudness. */
export class MicCapture {
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  private src?: MediaStreamAudioSourceNode;
  private sink?: GainNode;

  constructor(private ctx: AudioContext, private onFrame: (pcm: Int16Array, rms: number) => void) {}

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    await this.ctx.audioWorklet.addModule("/worklets/mic-processor.js");
    this.node = new AudioWorkletNode(this.ctx, "mic-processor");
    this.node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) =>
      this.onFrame(new Int16Array(e.data.pcm), e.data.rms);
    this.src = this.ctx.createMediaStreamSource(this.stream);
    // a silent sink keeps the worklet running in every browser
    this.sink = this.ctx.createGain();
    this.sink.gain.value = 0;
    this.src.connect(this.node);
    this.node.connect(this.sink);
    this.sink.connect(this.ctx.destination);
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    try { this.src?.disconnect(); this.node?.disconnect(); this.sink?.disconnect(); } catch { /* already gone */ }
  }
}

/** Plays her streamed 24 kHz PCM16 voice gap-free and measures its loudness for lip sync. */
export class PcmPlayer {
  private gain: GainNode;
  private analyser: AnalyserNode;
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private buf: Float32Array<ArrayBuffer>;

  constructor(private ctx: AudioContext) {
    this.gain = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.buf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
    this.gain.connect(this.analyser);
    this.analyser.connect(ctx.destination);
  }

  enqueueBase64(b64: string) {
    const bytes = base64ToBytes(b64);
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
    if (!pcm.length) return;
    const audio = this.ctx.createBuffer(1, pcm.length, 24000);
    const ch = audio.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = this.ctx.createBufferSource();
    src.buffer = audio;
    src.connect(this.gain);
    const at = Math.max(this.ctx.currentTime + 0.04, this.nextTime);
    src.start(at);
    this.nextTime = at + audio.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  /** true while queued audio is still playing */
  get playing() {
    return this.ctx.currentTime < this.nextTime - 0.02;
  }

  stopAll() {
    for (const s of this.sources) { try { s.stop(); } catch { /* not started */ } }
    this.sources.clear();
    this.nextTime = this.ctx.currentTime;
  }

  /** 0..1 loudness of what is playing right now */
  level() {
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sum / this.buf.length);
    return Math.max(0, Math.min(1, (rms - 0.008) * 6));
  }
}

export function base64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function pcmToBase64(frames: Int16Array[]) {
  let total = 0;
  for (const f of frames) total += f.length;
  const all = new Int16Array(total);
  let o = 0;
  for (const f of frames) { all.set(f, o); o += f.length; }
  const bytes = new Uint8Array(all.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
