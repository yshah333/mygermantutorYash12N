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

const ANSWER_NUDGE = "[Please continue the conversation out loud now, briefly and simply.]";
const withTimeout = <T,>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what} took too long. Check your internet and try again.`)), ms))]);

const PRAISE = /^\s*(super|genau|sehr gut|perfekt|toll|prima|klasse|richtig|wunderbar)\b/i;
const CORRECTION = /small correction|not quite/i;

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
  private greeted = false;          // she has started speaking at least once
  private kickoffRetries = 0;
  private turnAudio = 0;            // audio chunks in her current reply
  private nudgedEmpty = false;
  private t0 = 0;
  private lastStats = 0;
  /** recent events, shown in the diagnostic panel (tap the status pill) */
  log: string[] = [];
  private reconnectDueBy = 0;   // set by goAway: reconnect at the next quiet moment
  private wakeLock: { release(): Promise<void> } | null = null;
  // ---- watchdogs: nothing may hang forever ----
  private lastAudioAt = 0;        // last chunk of her voice received (arrives faster than it plays)
  private lastPlayingAt = 0;      // last moment her voice was actually playing
  private forcedTurnEnd = false;  // we moved on before her "turn complete" arrived
  private lastFrameAt = 0;        // last microphone frame
  private stateSince = 0;         // when the turn state last changed
  private waitStage = 0;          // recovery steps taken while waiting for her reply
  private nudgeAfterSetup = false;
  private connectedAt = 0;
  private timeUpAt = 0;
  private audioPausedSince = 0;
  private lastResumeTry = 0;
  private tapToResume = false;
  private restartingMic = false;
  private clockMark = { wall: 0, audio: 0 };   // to spot a frozen audio clock
  private rebuilding = false;

  constructor(private levelName: Level, private passcode: string, private cb: SessionCallbacks, private choice?: { unit: number; session: number }) {}

  /** Call from a tap: browsers only allow audio to start after a user gesture. */
  async start() {
    this.t0 = performance.now();
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    await this.ctx.resume();
    this.player = new PcmPlayer(this.ctx);
    this.turns = new TurnController(LEVELS[this.levelName].timing, {
      startActivity: (pre) => {
        this.dbg(`you started speaking (mic ${this.turns.lastRms.toFixed(3)}, noise ${this.turns.floor.toFixed(3)})`);
        this.send({ activityStart: {} });
        if (pre.length) this.sendAudio(pre);
        this.youLine = this.addLine({ who: "you", text: "" });
      },
      audio: (frames) => this.sendAudio(frames),
      endActivity: () => { this.dbg("your turn ended"); this.nudgedEmpty = false; this.send({ activityEnd: {} }); },
      askForHelp: () => { this.dbg("silence: asking Maria to help"); this.sendText(HELP_NUDGE); },
      interruptPlayback: () => { this.player.stopAll(); this.botTurnOpen = false; this.turnDone = false; },
      stateChanged: (s) => { this.stateSince = performance.now(); this.waitStage = 0; this.cb.onTurn(s); },
    });
    this.turns.setPaused(true);
    this.dbg("audio ready, asking for microphone");
    this.mic = new MicCapture(this.ctx, this.onMicFrame);
    await this.mic.start();
    this.lastFrameAt = performance.now();
    this.dbg(`microphone on (${this.ctx.sampleRate} Hz)`);
    await this.connect(false);
    this.endsAt = performance.now() + SESSION_MINUTES * 60_000;
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock;
      this.wakeLock = wl ? await wl.request("screen") : null;
    } catch { /* screen may still dim; not critical */ }
    this.loop();
  }

  private onMicFrame = (pcm: Int16Array, rms: number) => {
    this.lastFrameAt = performance.now();
    this.turns.frame(pcm, rms, this.lastFrameAt);
  };

  dbg(msg: string) {
    const t = ((performance.now() - this.t0) / 1000).toFixed(1).padStart(6);
    this.log.push(`${t}s  ${msg}`);
    if (this.log.length > 80) this.log.shift();
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
    document.removeEventListener("pointerdown", this.resumeOnTap);
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
    const res = await withTimeout(fetch("/api/token", {
      method: "POST",
      headers: { "content-type": "application/json", "x-passcode": this.passcode },
      body: JSON.stringify({ level: this.levelName, resume, ...(this.choice ?? {}) }),
    }), 15000, "Starting the session");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { this.dbg(`token request failed: ${res.status} ${data.error ?? ""}`); throw new Error(data.error || `Could not start a session (${res.status}).`); }
    this.dbg(`token ok${resume ? " (resume)" : ""}: model ${data.model}, voice ${data.voice}`);
    if (!resume) {
      this.plan = data.plan;
      this.model = data.model;
      this.voice = data.voice;
      this.cb.onPlan(data.plan);
    }
    const ai = new GoogleGenAI({ apiKey: data.token, httpOptions: { apiVersion: "v1alpha" } });
    this.setupDone = false;
    const id = ++this.connId;   // events from an older, replaced connection are ignored
    const opening = ai.live.connect({
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
        onerror: (e) => { if (id === this.connId) this.dbg(`connection error: ${(e as ErrorEvent).message ?? "unknown"}`); },
        onclose: (e) => { if (id === this.connId) { this.dbg(`connection closed: code ${e.code} ${e.reason ?? ""}`); this.onClose(e); } },
      },
    });
    try {
      this.session = await withTimeout(opening, 15000, "Connecting to Maria");
    } catch (e) {
      opening.then((s) => s.close()).catch(() => {});   // close it if it opens late
      throw e;
    }
    this.connectedAt = performance.now();
    this.afterSetup();
  }

  private afterSetup() {
    if (!this.session || !this.setupDone) return;
    this.reconnectTries = 0;
    this.cb.onNotice(null);
    this.dbg("connected (setup complete)");
    if (!this.kickedOff) {
      this.kickedOff = true;
      this.stateSince = performance.now();
      this.sendText(KICKOFF);
      this.dbg("asked Maria to greet you");
      // keep the mic out of it until her greeting starts, so noise can't cancel it
      setTimeout(() => { if (!this.ended && !this.reconnecting && this.turns) { if (!this.greeted) this.dbg("no greeting after 8 s, opening the mic anyway"); this.turns.setPaused(false); } }, 8000);
      return;
    }
    this.turns.setPaused(false);
    if (this.nudgeAfterSetup) { this.nudgeAfterSetup = false; this.sendText(ANSWER_NUDGE); this.dbg("asked Maria to answer again"); }
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
    if (e.code === 1008 || e.code === 1007) {   // rejected config or key: retrying won't help
      this.cb.onError(e.reason ? `Session closed: ${e.reason}` : "The session closed unexpectedly.");
      this.end();
      return;
    }
    this.reconnect();
  }

  private onMessage(m: LiveServerMessage) {
    if (m.setupComplete) { this.setupDone = true; this.afterSetup(); }
    const upd = m.sessionResumptionUpdate;
    if (upd?.resumable && upd.newHandle) this.handle = upd.newHandle;
    if (m.goAway && !this.reconnectDueBy) { this.dbg("server: connection ends soon, will reconnect"); this.reconnectDueBy = performance.now() + 5000; }

    const sc = m.serverContent;
    if (!sc) return;
    if (sc.interrupted) { this.dbg("Maria was interrupted"); this.player.stopAll(); this.botTurnOpen = false; this.tutorLine = null; }
    for (const part of sc.modelTurn?.parts ?? []) {
      const d = part.inlineData;
      if (d?.data && (d.mimeType ?? "").startsWith("audio/")) {
        if (!this.botTurnOpen) {
          this.botTurnOpen = true;
          this.forcedTurnEnd = false;
          this.turnDone = false;
          this.turns.botAudioStarted();
          this.dbg("Maria started speaking");
          if (!this.greeted) { this.greeted = true; this.turns.setPaused(false); }
        }
        this.turnAudio++;
        this.lastAudioAt = performance.now();
        this.player.enqueueBase64(d.data);
      }
    }
    if (sc.outputTranscription?.text) this.tutorSaid(sc.outputTranscription.text);
    if (sc.inputTranscription?.text) this.youSaid(sc.inputTranscription.text);
    if (sc.turnComplete) {
      const chunks = this.turnAudio;
      this.dbg(`Maria's turn complete (${chunks} audio chunks)`);
      this.botTurnOpen = false; this.turnDone = true; this.tutorLine = null; this.turnAudio = 0;
      if (chunks === 0 && this.forcedTurnEnd) {
        // the late end of a reply we already moved on from: not an empty reply, and don't hand over twice
        this.forcedTurnEnd = false;
        this.turnDone = false;
        this.dbg("late end of her reply (already moved on)");
      } else if (chunks === 0) this.emptyReply();
    }
  }

  /** she answered without any audio: retry once or twice instead of leaving you in silence */
  private emptyReply() {
    if (!this.greeted && this.kickoffRetries < 2) {
      this.kickoffRetries++;
      this.dbg(`empty reply to the greeting, retry ${this.kickoffRetries}`);
      setTimeout(() => this.sendText(KICKOFF), 400);
    } else if (this.greeted && !this.nudgedEmpty) {
      this.nudgedEmpty = true;
      this.dbg("empty reply, asking her to answer out loud");
      setTimeout(() => this.sendText(ANSWER_NUDGE), 400);
    }
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

  private resumeOnTap = () => {
    this.ctx?.resume().catch(() => {});
  };

  private async restartMic() {
    this.restartingMic = true;
    this.dbg("microphone stopped, restarting it");
    try { this.mic.stop(); } catch { /* already stopped */ }
    try {
      this.mic = new MicCapture(this.ctx, this.onMicFrame);
      await this.mic.start();
      this.dbg("microphone back on");
    } catch {
      this.cb.onNotice("Microphone stopped. Tap End and start again.");
    }
    this.lastFrameAt = performance.now();
    this.restartingMic = false;
  }

  /** iPhone bug: audio says "running" but its clock is frozen, so playback never "ends" and the mic is dead.
   *  Rebuild the whole audio chain; her interrupted reply is dropped and it's your turn (say "Wie bitte?"). */
  private async rebuildAudio() {
    if (this.rebuilding || this.ended) return;
    this.rebuilding = true;
    this.dbg("audio clock frozen, restarting the audio");
    const wasHers = this.turns.state === "botSpeaking";
    try { this.mic.stop(); } catch { /* gone */ }
    try { await this.ctx.close(); } catch { /* closed */ }
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    try { await this.ctx.resume(); } catch { /* may need a tap: the paused-audio check handles it */ }
    this.player = new PcmPlayer(this.ctx);
    try {
      this.mic = new MicCapture(this.ctx, this.onMicFrame);
      await this.mic.start();
    } catch {
      this.cb.onNotice("Microphone stopped. Tap End and start again.");
    }
    this.lastFrameAt = performance.now();
    this.clockMark = { wall: 0, audio: 0 };
    if (wasHers || this.botTurnOpen) { this.botTurnOpen = false; this.turnDone = true; this.tutorLine = null; this.turnAudio = 0; }
    this.dbg(`audio restarted (${this.ctx.state})`);
    this.rebuilding = false;
  }

  /** Recover from every state that could otherwise hang forever. Returns false if the session ended. */
  private watchdogs(now: number, playing: boolean): boolean {
    // 1) iPhone paused the audio (a call, a WhatsApp sound, switching apps, screen lock).
    //    Its clock stops too, so she would look like she's speaking forever.
    if (this.ctx.state !== "running") {
      if (!this.audioPausedSince) { this.audioPausedSince = now; this.dbg(`audio paused by the phone (${this.ctx.state})`); }
      if (now - this.lastResumeTry > 1000) { this.lastResumeTry = now; this.ctx.resume().catch(() => {}); }
      this.clockMark = { wall: 0, audio: 0 };
      if (now - this.audioPausedSince > 1500 && !this.tapToResume) {
        this.tapToResume = true;
        this.cb.onNotice("Audio paused. Tap anywhere to continue.");
        document.addEventListener("pointerdown", this.resumeOnTap);
      }
      return true;   // the other checks wait until audio runs again
    }
    if (this.audioPausedSince) {
      this.audioPausedSince = 0;
      this.lastFrameAt = now;
      this.stateSince = Math.max(this.stateSince, now - 1000);   // don't count the pause as her being silent
      this.dbg("audio running again");
      if (this.tapToResume) { this.tapToResume = false; document.removeEventListener("pointerdown", this.resumeOnTap); this.cb.onNotice(null); }
    }
    if (this.rebuilding) return true;

    // 1b) the audio clock is frozen although the phone says audio is running
    const wallGap = now - this.clockMark.wall;
    if (wallGap > 1500) {
      const audioGap = this.ctx.currentTime - this.clockMark.audio;
      // a gap over 3 s means this loop itself was paused (app in background): don't judge that
      if (this.clockMark.wall && wallGap < 3000 && audioGap < (wallGap / 1000) * 0.2) { this.rebuildAudio(); return true; }
      this.clockMark = { wall: now, audio: this.ctx.currentTime };
    }
    if (this.reconnecting) return true;

    // 2) the microphone stopped sending sound (iPhone can end it after an interruption)
    if (!this.restartingMic && (now - this.lastFrameAt > 3000 || this.mic.ended)) this.restartMic();

    // 3) connected, but the server never finished setting up
    if (this.session && !this.setupDone && this.connectedAt && now - this.connectedAt > 10000) {
      this.dbg("no answer from the server after connecting, reconnecting");
      this.reconnect();
      return true;
    }

    const st = this.turns.state;
    // 4) waiting for her reply, but nothing comes: ask again, then reconnect, then give you the turn back
    if (st === "awaitingBot" && !playing && !this.botTurnOpen && !this.closingAfterTurn && this.setupDone) {
      const waited = now - this.stateSince;
      if (this.waitStage === 0 && waited > 8000) {
        this.waitStage = 1;
        this.dbg("no reply from Maria after 8 s, asking again");
        this.sendText(this.greeted ? ANSWER_NUDGE : KICKOFF);
      } else if (this.waitStage === 1 && waited > 18000) {
        this.waitStage = 2;
        this.dbg("still no reply, reconnecting");
        this.nudgeAfterSetup = true;
        this.reconnect();
      } else if (this.waitStage === 2 && waited > 32000) {
        this.waitStage = 3;
        this.dbg("no reply, giving the turn back to you");
        this.turns.botFinished(now);
      }
    }

    // 5) her reply started but its end never arrived: move on once her audio has stopped for 6 s
    if (playing) this.lastPlayingAt = now;
    if (st === "botSpeaking" && !playing && !this.turnDone && now - Math.max(this.lastAudioAt, this.lastPlayingAt) > 6000) {
      this.dbg("her reply never finished, moving on");
      this.forcedTurnEnd = true;
      this.botTurnOpen = false; this.turnDone = true; this.tutorLine = null; this.turnAudio = 0;
    }

    // 6) time is up but her goodbye never came
    if (this.closingAfterTurn && this.timeUpAt && now - this.timeUpAt > 25000) {
      this.dbg("no goodbye after 25 s, ending");
      this.end();
      return false;
    }
    return true;
  }

  private loop = () => {
    if (this.ended) return;
    const now = performance.now();
    const playing = this.player.playing;
    if (!this.watchdogs(now, playing)) return;

    if (this.turnDone && !playing) {
      this.turnDone = false;
      if (this.closingAfterTurn) { this.end(); return; }
      this.turns.botFinished(now);
    }
    if (!this.timeUpSent && now >= this.endsAt && this.turns.state === "yourTurn") {
      this.timeUpSent = true;
      this.timeUpAt = now;
      this.closingAfterTurn = true;
      this.turns.setPaused(true);
      this.sendText(TIME_UP);
    }

    const st = this.turns.state;
    if (now - this.lastStats > 3000) { this.lastStats = now; this.dbg(`mic ${this.turns.lastRms.toFixed(3)} · noise ${this.turns.floor.toFixed(3)} · ${st}${st === "youSpeaking" ? ` · quiet ${(this.turns.quietMs() / 1000).toFixed(1)}s` : ""}${playing ? " · playing" : ""}`); }
    if (this.reconnectDueBy && ((!playing && st !== "youSpeaking") || now > this.reconnectDueBy)) this.reconnect();
    this.bus.level = this.player.level();
    this.bus.mode = playing ? "speaking"
      : this.turns.thinkingLeft(now) > 0 && st !== "youSpeaking" ? "thinking"
      : st === "youSpeaking" || st === "yourTurn" ? "listening"
      : "idle";
    this.raf = requestAnimationFrame(this.loop);
  };
}
