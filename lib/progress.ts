import { DAYS_PER_UNIT, MAX_EXTRA_DAYS, MAX_HELPS_TO_ADVANCE, TARGET_START_MS, UNITS } from "./curriculum";

/** A1 progress, stored on this phone only. */
export interface Progress {
  unit: number;      // current unit (index)
  session: number;   // sessions done in this unit (rotates the role-play scene)
  days: number;      // practice days done in this unit
  extra: number;     // extra days added because answers were still slow
  lastDay: string;   // YYYY-MM-DD of the last counted day
}

export const NEW_PROGRESS: Progress = { unit: 0, session: 0, days: 0, extra: 0, lastDay: "" };

export const MIN_SESSION_MS = 3 * 60_000;   // shorter sessions don't count at all
export const MIN_DAY_MS = 5 * 60_000;       // a practice day needs at least 5 minutes

export interface SessionResult {
  practisedMs: number;
  startDelays: number[];   // ms from her finishing to you starting, per answer
  helps: number;           // times she had to help because you were silent
  today: string;           // YYYY-MM-DD
}

export interface Outcome {
  progress: Progress;
  message: string;
  avgStartMs: number | null;
}

export function daysNeeded(p: Progress) {
  return DAYS_PER_UNIT + p.extra;
}

export function recordSession(p: Progress, r: SessionResult): Outcome {
  const avg = r.startDelays.length ? r.startDelays.reduce((a, b) => a + b, 0) / r.startDelays.length : null;
  const unitName = (i: number) => `Unit ${i + 1} · ${UNITS[i].title}`;
  if (r.practisedMs < MIN_SESSION_MS) {
    return { progress: p, avgStartMs: avg, message: "Practise at least 5 minutes for the day to count." };
  }
  const next: Progress = { ...p, session: p.session + 1 };
  if (r.practisedMs < MIN_DAY_MS) {
    return { progress: next, avgStartMs: avg, message: "Practise at least 5 minutes for the day to count." };
  }
  if (r.today === p.lastDay) {
    return { progress: next, avgStartMs: avg, message: `Today already counts for ${unitName(p.unit)}. Extra practice is always good.` };
  }
  next.days = p.days + 1;
  next.lastDay = r.today;
  if (next.days < daysNeeded(next)) {
    return { progress: next, avgStartMs: avg, message: `Day ${next.days} of ${daysNeeded(next)} done in ${unitName(p.unit)}.` };
  }
  // unit finished: move on if you answered quickly enough, otherwise one more day (at most two)
  const quick = avg !== null && avg <= TARGET_START_MS && r.helps <= MAX_HELPS_TO_ADVANCE;
  if (!quick && p.extra < MAX_EXTRA_DAYS) {
    next.extra = p.extra + 1;
    const why = avg === null ? "" : ` You took ${(avg / 1000).toFixed(1)} s on average to start answering (goal: under ${TARGET_START_MS / 1000} s).`;
    return { progress: next, avgStartMs: avg, message: `One more day of ${unitName(p.unit)}.${why}` };
  }
  const nextUnit = (p.unit + 1) % UNITS.length;
  const round = nextUnit === 0 ? " You finished all units, so round 2 starts." : "";
  return {
    progress: { unit: nextUnit, session: 0, days: 0, extra: 0, lastDay: r.today },
    avgStartMs: avg,
    message: `${unitName(p.unit)} complete!${round} Next time: ${unitName(nextUnit)}.`,
  };
}
