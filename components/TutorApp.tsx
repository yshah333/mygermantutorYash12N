"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Avatar from "./Avatar";
import { LEVELS, SESSION_MINUTES, type Level } from "@/lib/levels";
import { TutorSession, type AvatarBus, type Line } from "@/lib/tutorSession";
import type { TurnState } from "@/lib/turns";
import type { SessionPlan } from "@/lib/prompts";
import { UNITS } from "@/lib/curriculum";
import { NEW_PROGRESS, daysNeeded, recordSession, type Progress } from "@/lib/progress";

type Screen = "home" | "session" | "summary";
const PASS_KEY = "tutor-passcode";
const LEVEL_KEY = "tutor-level";
const PROG_KEY = "tutor-progress-a1";
const INTRO_WORDS = ["Name", "Alter", "Land", "Wohnort", "Sprachen", "Beruf", "Hobby"];
const today = () => new Date().toLocaleDateString("en-CA");   // YYYY-MM-DD, local time

function store(key: string, value?: string) {
  try {
    if (value === undefined) return localStorage.getItem(key) ?? "";
    localStorage.setItem(key, value);
  } catch { /* private mode */ }
  return "";
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function TutorApp() {
  const [screen, setScreen] = useState<Screen>("home");
  const [level, setLevel] = useState<Level>("A1");
  const [passcode, setPasscode] = useState("");
  const [needPass, setNeedPass] = useState(false);
  const [savedPass, setSavedPass] = useState(false);   // a passcode that worked before is stored on this device
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [plan, setPlan] = useState<SessionPlan | null>(null);
  const [turn, setTurn] = useState<TurnState>("awaitingBot");
  const [lines, setLines] = useState<Line[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [timeLeft, setTimeLeft] = useState(SESSION_MINUTES * 60_000);
  const [thinkLeft, setThinkLeft] = useState(0);
  const [practisedMs, setPractisedMs] = useState(0);
  const [showLog, setShowLog] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [progress, setProgress] = useState<Progress>(NEW_PROGRESS);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [avgStart, setAvgStart] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const sessionRef = useRef<TutorSession | null>(null);
  const startedAt = useRef(0);
  const bus = useMemo<AvatarBus>(() => ({ mode: "idle", level: 0, praiseUntil: 0, ahaUntil: 0 }), []);

  useEffect(() => {
    const p = store(PASS_KEY) as string, l = store(LEVEL_KEY) as string;
    if (p) { setPasscode(p); setSavedPass(true); }
    if (l === "A0" || l === "A1" || l === "A2" || l === "B1") setLevel(l);
    try {
      const saved = JSON.parse((store(PROG_KEY) as string) || "null");
      if (saved && typeof saved.unit === "number") setProgress({ ...NEW_PROGRESS, ...saved, unit: Math.min(saved.unit, UNITS.length - 1) });
    } catch { /* ignore */ }
  }, []);

  function saveProgress(p: Progress) {
    setProgress(p);
    store(PROG_KEY, JSON.stringify(p));
  }

  // clocks for the timer and the thinking countdown
  useEffect(() => {
    if (screen !== "session") return;
    const id = setInterval(() => {
      const s = sessionRef.current;
      if (!s || !s.endsAt) return;
      const now = performance.now();
      setTimeLeft(s.endsAt - now);
      setThinkLeft(s.turns ? s.turns.thinkingLeft(now) : 0);
      if (showLog) setLogLines(s.log.slice());
    }, 200);
    return () => clearInterval(id);
  }, [screen, showLog]);

  function copyLog() {
    navigator.clipboard?.writeText(logLines.join("\n")).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => undefined);
  }

  async function start() {
    setError(null);
    setStarting(true);
    setLines([]);
    setPlan(null);
    setConnected(false);
    setTurn("awaitingBot");
    setTimeLeft(SESSION_MINUTES * 60_000);
    store(LEVEL_KEY, level);
    setOutcome(null);
    setAvgStart(null);
    const p0 = progress;
    const choice = level === "A1" ? { unit: p0.unit, session: p0.session } : undefined;
    const s = new TutorSession(level, passcode, {
      onPlan: (p) => setPlan(p),
      onTurn: (t) => { setTurn(t); setConnected(true); },
      onLines: (l) => setLines(l),
      onNotice: (n) => setNotice(n),
      onError: (m) => setError(m),
      onEnded: () => {
        setLogLines(s.log.slice());
        const practised = performance.now() - startedAt.current;
        setPractisedMs(practised);
        const result = { practisedMs: practised, startDelays: s.turns?.startDelays ?? [], helps: s.turns?.helps ?? 0, today: today() };
        const o = recordSession(p0, result);
        setAvgStart(o.avgStartMs);
        if (level === "A1") { saveProgress(o.progress); setOutcome(o.message); }
        sessionRef.current = null;
        setScreen("summary");
      },
    }, choice);
    s.bus = bus;
    bus.mode = "idle"; bus.level = 0; bus.praiseUntil = 0; bus.ahaUntil = 0;
    sessionRef.current = s;
    setScreen("session");
    startedAt.current = performance.now();
    try {
      await s.start();
      store(PASS_KEY, passcode);
      setSavedPass(true);
      setNeedPass(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      s.dbg(`start failed: ${msg}`);
      await s.end().catch(() => undefined);
      setLogLines(s.log.slice());
      sessionRef.current = null;
      setScreen("home");
      if (/wrong passcode/i.test(msg)) { store(PASS_KEY, ""); setSavedPass(false); setNeedPass(true); }
      setError(/Permission|NotAllowed/i.test(msg) ? "Microphone access was blocked. Allow the microphone for this site and try again." : msg);
    } finally {
      setStarting(false);
    }
  }

  const status = !connected ? "Connecting…"
    : notice ? notice
    : thinkLeft > 0 && turn !== "youSpeaking" ? `Take your time · ${Math.ceil(thinkLeft / 1000)} s`
    : turn === "botSpeaking" ? "Maria is speaking"
    : turn === "youSpeaking" ? "Listening…"
    : turn === "yourTurn" ? "Your turn"
    : "…";

  const shown = lines.filter((l) => l.text.trim());
  const lastYou = [...shown].reverse().find((l) => l.who === "you");

  if (screen === "session") {
    return (
      <main className="session">
        <header className="bar">
          <span className="chip">{level}</span>
          <span className="role">{!plan ? "Setting up your session…" : plan.unit ? `${plan.unit.split(" · ")[0]} · ${plan.role}` : `Maria · ${plan.role.replace(/^an? /, "")}`}</span>
          <span className="clock">{fmt(timeLeft)}</span>
          <button className="end" onClick={() => sessionRef.current?.end()}>End</button>
        </header>

        <div className="stage-wrap">
          <Avatar bus={bus} />
          <button className={`status ${turn === "youSpeaking" ? "live" : ""}`} onClick={() => setShowLog((v) => !v)} title="Tap for diagnostics">{status}</button>
        </div>
        {showLog && (
          <section className="log">
            <div className="log-head"><b>Diagnostics</b><button onClick={copyLog}>{copied ? "Copied" : "Copy"}</button></div>
            <pre>{logLines.slice(-30).join("\n") || "…"}</pre>
          </section>
        )}

        <section className="captions" aria-live="polite">
          {/* no captions while talking: listening practice. The full transcript is on the summary screen. */}
          {!connected && <p className="tutor muted">{starting ? "Allow the microphone, then Maria will greet you." : "…"}</p>}
          {connected && !lastYou && level !== "A0" && (
            <div className="intro-hint">
              <span className="intro-title">Introduce yourself</span>
              <span className="chips">{INTRO_WORDS.map((w) => <span key={w} className="chip-word">{w}</span>)}</span>
              <span className="intro-note">5–7 sentences. Take your time, then tap Fertig.</span>
            </div>
          )}
        </section>

        <div className="controls">
          <button className={`think ${thinkLeft > 0 ? "on" : ""}`} onClick={() => sessionRef.current?.think()} disabled={!connected}>
            <span className="think-label">{thinkLeft > 0 ? `Moment… ${Math.ceil(thinkLeft / 1000)} s` : "Moment, bitte · +10 s"}</span>
            <span className="think-bar" style={{ transform: `scaleX(${Math.min(1, thinkLeft / 10000)})` }} />
          </button>
          <button className="done" onClick={() => sessionRef.current?.done()} disabled={turn !== "youSpeaking"}>
            Fertig ✓
          </button>
        </div>
        <p className="hint">Didn’t understand? Say “Wie bitte?” or “Was bedeutet …?” “Moment” gives you more time, “Fertig” hands over to Maria.</p>
      </main>
    );
  }

  if (screen === "summary") {
    return (
      <main className="home">
        <h1>Gut gemacht!</h1>
        <p className="sub">You practised for {Math.max(1, Math.round(practisedMs / 60000))} min{" with Maria"}.</p>
        {(outcome || avgStart !== null) && (
          <section className="outcome">
            {outcome && <p>{outcome}</p>}
            {avgStart !== null && <p className="muted">Average time to start answering: {(avgStart / 1000).toFixed(1)} s</p>}
          </section>
        )}
        {error && <p className="error">{error}</p>}
        <section className="transcript">
          {shown.length === 0 && <p className="muted">No conversation recorded.</p>}
          {shown.map((l, i) => (
            <p key={i} className={`${l.who} ${l.correction ? "correction" : ""}`}>
              <b>{l.who === "tutor" ? "Maria" : "You"}</b>
              {l.correction && <span className="tag">Correction</span>}
              {l.text}
            </p>
          ))}
        </section>
        {logLines.length > 0 && (
          <details className="log">
            <summary>Diagnostics</summary>
            <div className="log-head"><span /><button onClick={copyLog}>{copied ? "Copied" : "Copy"}</button></div>
            <pre>{logLines.join("\n")}</pre>
          </details>
        )}
        <div className="row">
          <button className="primary" onClick={start}>Practise again ({level})</button>
          <button onClick={() => { setError(null); setScreen("home"); }}>Change level</button>
        </div>
      </main>
    );
  }

  return (
    <main className="home">
      <div className="hero">
        <img src="/tutor/hero.webp" alt="" className="hero-img" />
        <div>
          <h1>Sprich mit Maria</h1>
          <p className="sub">15 minutes of real German conversation, Goethe-style. Pick your level.</p>
        </div>
      </div>

      <div className="levels">
        {(Object.keys(LEVELS) as Level[]).map((l) => (
          <button key={l} className={`level ${level === l ? "sel" : ""}`} onClick={() => setLevel(l)}>
            <span className="level-title">{LEVELS[l].title}</span>
            <span className="level-blurb">{LEVELS[l].blurb}</span>
          </button>
        ))}
      </div>

      {level === "A1" && (
        <section className="unit-pick">
          <select
            value={progress.unit}
            onChange={(e) => saveProgress({ ...NEW_PROGRESS, unit: Number(e.target.value) })}
            aria-label="Unit"
          >
            {UNITS.map((u, i) => <option key={u.title} value={i}>Unit {i + 1} · {u.title}</option>)}
          </select>
          <span className="unit-day">Day {Math.min(progress.days + 1, daysNeeded(progress))} of {daysNeeded(progress)} · {UNITS[progress.unit].en}</span>
        </section>
      )}

      <label className="pass">
        {savedPass && !needPass ? "Passcode · saved on this phone" : "Passcode"}
        <input
          type="text"
          className="masked"
          name="tutor-passcode"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && passcode && !starting) start(); }}
          placeholder="Your app passcode"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
        />
      </label>

      {error && <p className="error">{error}</p>}

      <button className="primary big" onClick={start} disabled={starting || !passcode}>
        {starting ? "Starting…" : `Start ${level} conversation`}
      </button>
      <p className="hint">Maria speaks first and waits for you. Tap “Fertig” when you finish your answer.</p>
    </main>
  );
}
