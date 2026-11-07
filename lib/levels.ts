export type Level = "A1" | "A2" | "B1";

export interface LevelTiming {
  /** how long a pause can last mid-answer before your turn counts as finished */
  pauseToleranceMs: number;
  /** silence after her question before she helps you (the "natural" thinking time) */
  helpAfterMs: number;
  /** extra time one tap on the thinking button gives */
  thinkingBonusMs: number;
}

export const LEVELS: Record<Level, { title: string; blurb: string; timing: LevelTiming }> = {
  A1: {
    title: "A1",
    blurb: "Beginner · short, slow sentences",
    // you think while you speak: a long pause still counts as "still talking" (tap Fertig to hand over sooner)
    timing: { pauseToleranceMs: 3000, helpAfterMs: 12000, thinkingBonusMs: 10000 },
  },
  A2: {
    title: "A2",
    blurb: "Elementary · everyday topics",
    timing: { pauseToleranceMs: 3000, helpAfterMs: 6000, thinkingBonusMs: 10000 },
  },
  B1: {
    title: "B1",
    blurb: "Intermediate · opinions and plans",
    timing: { pauseToleranceMs: 3000, helpAfterMs: 5000, thinkingBonusMs: 10000 },
  },
};

export const SESSION_MINUTES = 15;
