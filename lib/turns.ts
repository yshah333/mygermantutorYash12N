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

/**
 * Our own turn-taking (Gemini's automatic detection is switched off), so we control:
 * - pause tolerance: how long you can pause mid-sentence
 * - the thinking button: +10 s before she steps in, both before and during your answer
 * - help: if you stay silent after her question, she rephrases
 */
export class TurnController {
  state: TurnState = "awaitingBot";
  thinkingUntil = 0;

  private floor = 0.004;
  private loudRun = 0;
  private preroll: Int16Array[] = [];
  private batch: Int16Array[] = [];
  private silenceMs = 0;
  private turnStart = 0;
  private helpAt = 0;
  private helpsThisWait = 0;   // help nudges since you last spoke (max 2)
  private paused = false;

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
  }

  /** the thinking button: +10 s, stackable */
  thinking(now: number) {
    this.thinkingUntil = Math.max(now, this.thinkingUntil) + this.timing.thinkingBonusMs;
    if (this.state === "yourTurn") this.helpAt = Math.max(this.helpAt, this.thinkingUntil);
  }

  thinkingLeft(now: number) {
    return Math.max(0, this.thinkingUntil - now);
  }

  /** one 20 ms microphone frame */
  frame(pcm: Int16Array, rms: number, now: number) {
    if (this.paused) return;
    const speakingThreshold = Math.max(0.012, this.floor * 3);
    const bargeThreshold = Math.max(0.04, this.floor * 6);   // stricter while she talks (echo guard)
    const keepThreshold = Math.max(0.008, this.floor * 2);

    if (this.state !== "youSpeaking") {
      this.preroll.push(pcm);
      if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift();
      const herTurn = this.state === "botSpeaking";
      const thr = herTurn ? bargeThreshold : speakingThreshold;
      this.loudRun = rms > thr ? this.loudRun + 1 : 0;
      if (rms < speakingThreshold) this.floor = this.floor * 0.97 + Math.max(0.0015, rms) * 0.03;
      const needed = herTurn ? 12 : 3;   // 240 ms to interrupt her, 60 ms otherwise
      if (this.loudRun >= needed) {
        if (herTurn) this.ev.interruptPlayback();
        this.ev.startActivity(this.preroll.splice(0));
        this.helpsThisWait = 0;   // you spoke, so she may help again later
        this.set("youSpeaking");
        this.silenceMs = 0;
        this.turnStart = now;
        this.loudRun = 0;
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
    this.silenceMs = rms > keepThreshold ? 0 : this.silenceMs + FRAME_MS;
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
