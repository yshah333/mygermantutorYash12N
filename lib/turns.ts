import type { LevelTiming } from "./levels";

export type TurnState =
  | "botSpeaking"     // she is talking
  | "awaitingBot"     // you finished; her reply is on its way
  | "yourTurn"        // she finished; waiting for you to start
  | "youSpeaking";    // you are talking

export interface TurnEvents {
  startActivity(preroll: Int16Array[]): void;   // your turn begins (also interrupts her)
  audio(frames: Int16Array[]): void;           // ~100 ms of your speech
  endActivity(): void;                          // your turn is over
  askForHelp(): void;                           // you stayed silent too long
  interruptPlayback(): void;                    // stop her audio locally right away
  stateChanged(s: TurnState): void;
}

const FRAME_MS = 20;
const PREROLL_FRAMES = 15;      // keep 300 ms before speech starts
const BATCH_FRAMES = 5;         // send 100 ms per message
const MAX_TURN_MS = 45000;
const ECHO_TAIL_MS = 450;       // her voice still echoes in the room / speaker just after she stops
const SUSTAIN_FRAMES = 3;       // 60 ms of sound needed to count as speech again (clicks, bumps don't count)

/**
 * Our own turn-taking (Gemini's automatic detection is switched off), so we control:
 * - pause tolerance: how long you can pause mid-sentence
 * - the thinking button: +10 s before she steps in, both before and during your answer
 * - help: if you stay silent after her question, she rephrases
 */
export class TurnController {
  state: TurnState = "awaitingBot";
  thinkingUntil = 0;

  floor = 0.004;                // background noise level (adapts)
  lastRms = 0;
  private speechLevel = 0.05;   // how loud your speech is (adapts while you talk)
  private loudRun = 0;
  private preroll: Int16Array[] = [];
  private batch: Int16Array[] = [];
  private silenceMs = 0;
  private turnStart = 0;
  private helpAt = 0;
  private helpsThisWait = 0;   // help nudges since you last spoke (max 2)
  private paused = false;
  private echoUntil = 0;       // ignore the mic until then (her voice coming back through the speaker)
  private loudInTurn = 0;

  constructor(private timing: LevelTiming, private ev: TurnEvents) {}

  setPaused(p: boolean) { this.paused = p; }

  /** she started producing audio */
  botAudioStarted() {
    if (this.state !== "youSpeaking") this.set("botSpeaking");
  }

  /** her turn is over and her audio has finished playing */
  botFinished(now: number) {
    if (this.state === "youSpeaking") return;
    this.set("yourTurn");
    this.helpAt = now + this.timing.helpAfterMs;
    this.echoUntil = now + ECHO_TAIL_MS;
    this.preroll = [];
    this.loudRun = 0;
  }

  /** how long you have been quiet in your current turn (for the diagnostics log) */
  quietMs() {
    return this.state === "youSpeaking" ? this.silenceMs : 0;
  }

  /** the thinking button: +10 s, stackable */
  thinking(now: number) {
    this.thinkingUntil = Math.max(now, this.thinkingUntil) + this.timing.thinkingBonusMs;
    if (this.state === "yourTurn") this.helpAt = Math.max(this.helpAt, this.thinkingUntil);
  }

  /** the "Fertig" button: you're done, hand the turn to her now */
  finish() {
    if (this.state !== "youSpeaking") return;
    if (this.batch.length) this.ev.audio(this.batch.splice(0));
    this.ev.endActivity();
    this.thinkingUntil = 0;
    this.set("awaitingBot");
  }

  thinkingLeft(now: number) {
    return Math.max(0, this.thinkingUntil - now);
  }

  /** one 20 ms microphone frame */
  frame(pcm: Int16Array, rms: number, now: number) {
    this.lastRms = rms;
    // While she talks, the phone's mic hears her own voice from the speaker (iPhone echo cancellation
    // doesn't cover web audio). So her speech never counts as you, and it doesn't skew the noise estimate.
    if (this.state === "botSpeaking") {
      this.loudRun = 0;
      return;
    }
    if (now < this.echoUntil) {
      // just after she stops: keep recording (so a quick answer keeps its first syllable) but don't decide yet
      if (!this.paused) { this.preroll.push(pcm); if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift(); }
      this.loudRun = 0;
      return;
    }
    // background-noise estimate: drops fast, rises slowly, so steady noise (air-con, fan) is learned
    // within a few seconds. It keeps calibrating even while the mic is held during her greeting.
    if (this.state !== "youSpeaking") {
      this.floor = rms < this.floor ? this.floor * 0.9 + rms * 0.1 : this.floor * 0.995 + rms * 0.005;
      this.floor = Math.min(0.08, Math.max(0.0015, this.floor));
    }
    if (this.paused) return;
    const speakingThreshold = Math.max(0.012, this.floor * 2.5);
    const bargeThreshold = Math.max(0.04, this.floor * 5);   // stricter while she talks (echo guard)
    const keepThreshold = Math.max(0.008, this.floor * 1.8);

    if (this.state !== "youSpeaking") {
      this.preroll.push(pcm);
      if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift();
      // while her answer is on its way, only clear, sustained speech counts (noise must not cancel her)
      const guarded = this.state === "awaitingBot";
      const thr = guarded ? bargeThreshold : speakingThreshold;
      this.loudRun = rms > thr ? this.loudRun + 1 : 0;
      const needed = guarded ? 12 : 4;   // 240 ms when guarded, 80 ms on your turn
      if (this.loudRun >= needed) {
        this.ev.startActivity(this.preroll.splice(0));
        this.helpsThisWait = 0;   // you spoke, so she may help again later
        this.set("youSpeaking");
        this.silenceMs = 0;
        this.turnStart = now;
        this.loudRun = 0;
        this.loudInTurn = 0;
        this.speechLevel = Math.max(rms, speakingThreshold * 1.5);
      } else if (this.state === "yourTurn" && now >= this.helpAt && this.helpsThisWait < 2) {
        this.helpsThisWait++;
        this.helpAt = now + this.timing.helpAfterMs + 3000;
        this.ev.askForHelp();
        this.set("awaitingBot");
      }
      return;
    }

    // you are speaking: stream audio, watch for the end of your turn
    this.batch.push(pcm);
    if (this.batch.length >= BATCH_FRAMES) this.ev.audio(this.batch.splice(0));
    // "silence" is relative to how loud you speak, so steady background noise (air-con, fan) still counts as a pause
    const quietBelow = Math.max(keepThreshold, this.speechLevel * 0.3);
    this.loudInTurn = rms > quietBelow ? this.loudInTurn + 1 : 0;
    if (this.loudInTurn >= SUSTAIN_FRAMES) {
      this.silenceMs = 0;
      this.speechLevel = this.speechLevel * 0.95 + rms * 0.05;
    } else {
      this.silenceMs += FRAME_MS;
      this.floor = this.floor * 0.99 + Math.max(0.0015, rms) * 0.01;
    }
    const thinkingHeld = now < this.thinkingUntil;
    if ((this.silenceMs >= this.timing.pauseToleranceMs && !thinkingHeld) || now - this.turnStart > MAX_TURN_MS) {
      if (this.batch.length) this.ev.audio(this.batch.splice(0));
      this.ev.endActivity();
      this.thinkingUntil = 0;
      this.set("awaitingBot");
    }
  }

  private set(s: TurnState) {
    if (this.state === s) return;
    this.state = s;
    this.ev.stateChanged(s);
  }
}
