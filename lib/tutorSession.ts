import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import { MicCapture, PcmPlayer, pcmToBase64 } from "./audio";
import { TurnController, type TurnState } from "./turns";
import { LEVELS, SESSION_MINUTES, type Level } from "./levels";
import { HELP_NUDGE, KICKOFF, TIME_UP, type SessionPlan } from "./prompts";

/** What the avatar reads every frame. */
export interface AvatarBus {
  mode: "idle" | "speaking" | "listening" | "thinking";
  level: number;        // 0..1 loudness of her voice right now
  praiseUntil: number;  // performance.now() timestamps
  ahaUntil: number;
}

export interface Line { who: "tutor" | "you"; text: string; correction?: boolean }

export interface SessionCallbacks {
  onPlan(plan: SessionPlan): void;
  onTurn(state: TurnState): void;
  onLines(lines: Line[]): void;
  onNotice(msg: string | null): void;
  onError(msg: string): void;
  onEnded(): void;
}

const PRAISE = /^\s*(super|genau|sehr gut|perfekt|toll|prima|klasse|richtig|wunderbar)\b/i;
const CORRECTION = /small correction/i;

export class TutorSession {
  bus: AvatarBus = { mode: "idle", level: 0, praiseUntil: 0, ahaUntil: 0 };
  lines: Line[] = [];
  plan: SessionPlan | null = null;
  endsAt = 0;
  turns!: TurnController;

  private ctx!: AudioContext;
  private mic!: MicCapture;
  private player!: PcmPlayer;
  private session: Session | null = null;
  private model = "";
  private voice = "";
  private handle: string | null = null;
  private setupDone = false;
  private kickedOff = false;
  private botTurnOpen = false;
  private turnDone = false;
  private tutorLine: Line | null = null;
  private youLine: Line | null = null;
  private timeUpSent = false;
  private closingAfterTurn = false;
  private ended = false;
  private reconnecting = false;
  private reconnectTries = 0;
  private raf = 0;
  private connId = 0;
  private reconnectDueBy = 0;   // set by goAway: reconnect at the next quiet moment
  private wakeLock: { release(): Promise<void> } | null = null;

  constructor(private levelName: Level, private passcode: string, private cb: SessionCallbacks) {}

  /** Call from a tap: browsers only allow audio to start after a user gesture. */
  async start() {
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    await this.ctx.resume();
    this.player = new PcmPlayer(this.ctx);
    this.turns = new TurnController(LEVELS[this.levelName].timing, {
      startActivity: (pre) => {
        this.send({ activityStart: {} });
        if (pre.length) this.sendAudio(pre);
        this.youLine = this.addLine({ who: "you", text: "" });
      },
      audio: (frames) => this.sendAudio(frames),
      endActivity: () => this.send({ activityEnd: {} }),
      askForHelp: () => this.sendText(HELP_NUDGE),
      interruptPlayback: () => { this.player.stopAll(); this.botTurnOpen = false; this.turnDone = false; },
      stateChanged: (s) => this.cb.onTurn(s),
    });
    this.turns.setPaused(true);
    this.mic = new MicCapture(this.ctx, (pcm, rms) => this.turns.frame(pcm, rms, performance.now()));
    await this.mic.start();
    await this.connect(false);
    this.endsAt = performance.now() + SESSION_MINUTES * 60_000;
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock;
      this.wakeLock = wl ? await wl.request("screen") : null;
    } catch { /* screen may still dim; not critical */ }
    this.loop();
  }

  /** the thinking button */
  think() {
    if (!this.ended) this.turns.thinking(performance.now());
  }

  /** the "Fertig" button */
  done() {
    if (!this.ended) this.turns.finish();
  }

  async end() {
    if (this.ended) return;
    this.ended = true;
    cancelAnimationFrame(this.raf);
    this.turns?.setPaused(true);
    try { this.session?.close(); } catch { /* closed */ }
    this.mic?.stop();
    this.player?.stopAll();
    try { await this.ctx?.close(); } catch { /* closed */ }
    try { await this.wakeLock?.release(); } catch { /* released */ }
    this.cb.onEnded();
  }

  // ---------- connection ----------

  private async connect(resume: boolean) {
    const res = await fetch("/api/token", {
      method: "POST",
      headers: { "content-type": "application/json", "x-passcode": this.passcode },
      body: JSON.stringify({ level: this.levelName, resume }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Could not start a session (${res.status}).`);
    if (!resume) {
      this.plan = data.plan;
      this.model = data.model;
      this.voice = data.voice;
      this.cb.onPlan(data.plan);
    }
    const ai = new GoogleGenAI({ apiKey: data.token, httpOptions: { apiVersion: "v1alpha" } });
    this.setupDone = false;
    const id = ++this.connId;   // events from an older, replaced connection are ignored
    this.session = await ai.live.connect({
      model: this.model,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: this.plan!.systemInstruction,
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voice } } },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
        contextWindowCompression: { slidingWindow: {} },
        sessionResumption: this.handle ? { handle: this.handle } : {},
      },
      callbacks: {
        onmessage: (m) => { if (id === this.connId) this.onMessage(m); },
        onerror: () => { /* onclose follows */ },
        onclose: (e) => { if (id === this.connId) this.onClose(e); },
      },
    });
    this.afterSetup();
  }

  private afterSetup() {
    if (!this.session || !this.setupDone) return;
    this.reconnectTries = 0;
    this.cb.onNotice(null);
    if (!this.kickedOff) {
      this.kickedOff = true;
      this.sendText(KICKOFF);
    }
    this.turns.setPaused(false);
  }

  private async reconnect() {
    if (this.ended || this.reconnecting) return;
    this.reconnecting = true;
    this.reconnectDueBy = 0;
    this.turns.setPaused(true);
    this.cb.onNotice("Reconnecting…");
    const old = this.session;
    this.session = null;
    this.connId++;   // silence the old connection's events
    try { old?.close(); } catch { /* closed */ }
    try {
      await this.connect(true);
    } catch (e) {
      this.reconnectTries++;
      if (this.reconnectTries < 3 && !this.ended) {
        this.reconnecting = false;
        setTimeout(() => this.reconnect(), 1000 * this.reconnectTries);
        return;
      }
      this.cb.onError(e instanceof Error ? e.message : "Connection lost.");
      this.end();
    }
    this.reconnecting = false;
  }

  private onClose(e: CloseEvent) {
    if (this.ended || this.reconnecting) return;
    if (this.handle) { this.reconnect(); return; }
    this.cb.onError(e.reason ? `Session closed: ${e.reason}` : "The session closed unexpectedly.");
    this.end();
  }

  private onMessage(m: LiveServerMessage) {
    if (m.setupComplete) { this.setupDone = true; this.afterSetup(); }
    const upd = m.sessionResumptionUpdate;
    if (upd?.resumable && upd.newHandle) this.handle = upd.newHandle;
    if (m.goAway && !this.reconnectDueBy) this.reconnectDueBy = performance.now() + 5000;

    const sc = m.serverContent;
    if (!sc) return;
    if (sc.interrupted) { this.player.stopAll(); this.botTurnOpen = false; this.tutorLine = null; }
    for (const part of sc.modelTurn?.parts ?? []) {
      const d = part.inlineData;
      if (d?.data && (d.mimeType ?? "").startsWith("audio/")) {
        if (!this.botTurnOpen) {
          this.botTurnOpen = true;
          this.turnDone = false;
          this.turns.botAudioStarted();
        }
        this.player.enqueueBase64(d.data);
      }
    }
    if (sc.outputTranscription?.text) this.tutorSaid(sc.outputTranscription.text);
    if (sc.inputTranscription?.text) this.youSaid(sc.inputTranscription.text);
    if (sc.turnComplete) { this.botTurnOpen = false; this.turnDone = true; this.tutorLine = null; }
  }

  // ---------- sending ----------

  private send(input: Parameters<Session["sendRealtimeInput"]>[0]) {
    try { this.session?.sendRealtimeInput(input); } catch { /* reconnecting */ }
  }
  private sendAudio(frames: Int16Array[]) {
    this.send({ audio: { data: pcmToBase64(frames), mimeType: "audio/pcm;rate=16000" } });
  }
  private sendText(text: string) {
    try { this.session?.sendClientContent({ turns: [{ role: "user", parts: [{ text }] }], turnComplete: true }); } catch { /* reconnecting */ }
  }

  // ---------- transcript ----------

  private addLine(l: Line) {
    this.lines.push(l);
    this.cb.onLines([...this.lines]);
    return l;
  }
  private tutorSaid(text: string) {
    const isNew = !this.tutorLine;
    if (!this.tutorLine) this.tutorLine = this.addLine({ who: "tutor", text: "" });
    const line = this.tutorLine;
    line.text += text;
    const now = performance.now();
    if (!line.correction && CORRECTION.test(line.text)) { line.correction = true; this.bus.ahaUntil = now + 1200; }
    if (isNew && PRAISE.test(line.text)) this.bus.praiseUntil = now + 2200;
    this.cb.onLines([...this.lines]);
  }
  private youSaid(text: string) {
    if (!this.youLine) this.youLine = this.addLine({ who: "you", text: "" });
    this.youLine.text += text;
    this.cb.onLines([...this.lines]);
  }

  // ---------- every frame ----------

  private loop = () => {
    if (this.ended) return;
    const now = performance.now();
    const playing = this.player.playing;

    if (this.turnDone && !playing) {
      this.turnDone = false;
      if (this.closingAfterTurn) { this.end(); return; }
      this.turns.botFinished(now);
    }
    if (!this.timeUpSent && now >= this.endsAt && this.turns.state === "yourTurn") {
      this.timeUpSent = true;
      this.closingAfterTurn = true;
      this.turns.setPaused(true);
      this.sendText(TIME_UP);
    }

    const st = this.turns.state;
    if (this.reconnectDueBy && ((!playing && st !== "youSpeaking") || now > this.reconnectDueBy)) this.reconnect();
    this.bus.level = this.player.level();
    this.bus.mode = playing ? "speaking"
      : this.turns.thinkingLeft(now) > 0 && st !== "youSpeaking" ? "thinking"
      : st === "youSpeaking" || st === "yourTurn" ? "listening"
      : "idle";
    this.raf = requestAnimationFrame(this.loop);
  };
}
