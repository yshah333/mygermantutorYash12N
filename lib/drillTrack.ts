import DRILL from "./drill-basics.json";

/**
 * Follows the A0 drill from Maria's own words ("How do you say: …?", "Not quite.")
 * to learn which sentences the learner found hard, so the next session can review them.
 */
export const REVIEW_MAX = 8;          // about 5 minutes of review
export const SLOW_START_MS = 8000;    // starting to answer later than this counts as "not prompt"

const norm = (s: string) =>
  s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();

/** Which drill sentence does Maria's English prompt refer to? */
export function matchPrompt(fragment: string): number | null {
  const words = norm(fragment).split(" ").filter(Boolean);
  if (!words.length) return null;
  let best = -1, bestScore = 0;
  DRILL.forEach((d, i) => {
    const target = norm(d.en).split(" ");
    const set = new Set(words);
    const hit = target.filter((w) => set.has(w)).length;
    // share of the sentence's words she said, penalising extra words a little
    const score = hit / target.length - Math.max(0, words.length - target.length) * 0.03;
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return bestScore >= 0.75 ? best : null;
}

export class DrillTracker {
  current: number | null = null;
  asked = new Set<number>();
  missed = new Set<number>();

  /** Read one complete Maria turn, in order: a "Not quite" marks the sentence being asked, a new prompt moves on. */
  onMariaTurn(text: string) {
    const re = /(not quite)|how do you say:?\s*([^?]*)\?/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m[1]) {
        if (this.current !== null) this.missed.add(this.current);
      } else {
        const i = matchPrompt(m[2] ?? "");
        if (i !== null) { this.current = i; this.asked.add(i); }
      }
    }
  }

  /** She had to help because he stayed silent. */
  onHelp() {
    if (this.current !== null) this.missed.add(this.current);
  }

  /** He started answering this long after her prompt. */
  onStart(delayMs: number) {
    if (this.current !== null && delayMs > SLOW_START_MS) this.missed.add(this.current);
  }
}

/** Review list for next time: keep old misses he didn't fix today, add today's misses (most recent first). */
export function nextReview(prev: string[], t: DrillTracker): string[] {
  const key = (i: number) => DRILL[i].de;
  const fixed = new Set([...t.asked].filter((i) => !t.missed.has(i)).map(key));
  const today = [...t.missed].map(key);
  const keep = prev.filter((k) => !fixed.has(k) && !today.includes(k) && DRILL.some((d) => d.de === k));
  return [...today, ...keep].slice(0, 20);
}
