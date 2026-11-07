"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Avatar from "./Avatar";
import { LEVELS, SESSION_MINUTES, type Level } from "@/lib/levels";
import { TutorSession, type AvatarBus, type Line } from "@/lib/tutorSession";
import type { TurnState } from "@/lib/turns";
import type { SessionPlan } from "@/lib/prompts";

type Screen = "home" | "session" | "summary";
const PASS_KEY = "tutor-passcode";
const LEVEL_KEY = "tutor-level";

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
  const sessionRef = useRef<TutorSession | null>(null);
  const startedAt = useRef(0);
  const bus = useMemo<AvatarBus>(() => ({ mode: "idle", level: 0, praiseUntil: 0, ahaUntil: 0 }), []);

  useEffect(() => {
    const p = store(PASS_KEY) as string, l = store(LEVEL_KEY) as string;
    if (p) setPasscode(p);
    if (l === "A1" || l === "A2" || l === "B1") setLevel(l);
  }, []);

  // clocks for the timer and the thinking countdown
  useEffect(() => {
    if (screen !== "session") return;
    const id = setInterval(() => {
      const s = sessionRef.current;
      if (!s || !s.endsAt) return;
      const now = performance.now();
      setTimeLeft(s.endsAt - now);
      setThinkLeft(s.turns ? s.turns.thinkingLeft(now) : 0);
    }, 200);
    return () => clearInterval(id);
  }, [screen]);

  async function start() {
    setError(null);
    setStarting(true);
    setLines([]);
    setPlan(null);
    setConnected(false);
    setTurn("awaitingBot");
    setTimeLeft(SESSION_MINUTES * 60_000);
    store(LEVEL_KEY, level);
    const s = new TutorSession(level, passcode, {
      onPlan: (p) => setPlan(p),
      onTurn: (t) => { setTurn(t); setConnected(true); },
      onLines: (l) => setLines(l),
      onNotice: (n) => setNotice(n),
      onError: (m) => setError(m),
      onEnded: () => {
        setPractisedMs(performance.now() - startedAt.current);
        sessionRef.current = null;
        setScreen("summary");
      },
    });
    s.bus = bus;
    bus.mode = "idle"; bus.level = 0; bus.praiseUntil = 0; bus.ahaUntil = 0;
    sessionRef.current = s;
    setScreen("session");
    startedAt.current = performance.now();
    try {
      await s.start();
      if (passcode) store(PASS_KEY, passcode);
      setNeedPass(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await s.end().catch(() => undefined);
      sessionRef.current = null;
      setScreen("home");
      if (/passcode/i.test(msg)) setNeedPass(true);
      setError(/Permission|NotAllowed/i.test(msg) ? "Microphone access was blocked. Allow the microphone for this site and try again." : msg);
    } finally {
      setStarting(false);
    }
  }

  const status = !connected ? "Connecting…"
    : notice ? notice
    : thinkLeft > 0 && turn !== "youSpeaking" ? `Take your time · ${Math.ceil(thinkLeft / 1000)} s`
    : turn === "botSpeaking" ? "She's speaking"
    : turn === "youSpeaking" ? "Listening…"
    : turn === "yourTurn" ? "Your turn"
    : "…";

  const shown = lines.filter((l) => l.text.trim());
  const lastTutor = [...shown].reverse().find((l) => l.who === "tutor");
  const lastYou = [...shown].reverse().find((l) => l.who === "you");

  if (screen === "session") {
    return (
      <main className="session">
        <header className="bar">
          <span className="chip">{level}</span>
          <span className="role">{plan ? `She's ${plan.role}` : "Setting up your session…"}</span>
          <span className="clock">{fmt(timeLeft)}</span>
          <button className="end" onClick={() => sessionRef.current?.end()}>End</button>
        </header>

        <div className="stage-wrap">
          <Avatar bus={bus} />
          <div className={`status ${turn === "youSpeaking" ? "live" : ""}`}>{status}</div>
        </div>

        <section className="captions" aria-live="polite">
          {lastTutor ? (
            <p className={`tutor ${lastTutor.correction ? "correction" : ""}`}>
              {lastTutor.correction && <span className="tag">Correction</span>}
              {lastTutor.text}
            </p>
          ) : <p className="tutor muted">{starting ? "Allow the microphone, then she'll greet you." : "…"}</p>}
          {lastYou && <p className="you">You: {lastYou.text}</p>}
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
        <p className="hint">“Moment” gives you more time. “Fertig” tells her you’re done. Headphones work best.</p>
      </main>
    );
  }

  if (screen === "summary") {
    return (
      <main className="home">
        <h1>Gut gemacht!</h1>
        <p className="sub">You practised for {Math.max(1, Math.round(practisedMs / 60000))} min{plan ? ` with ${plan.role}` : ""}.</p>
        {error && <p className="error">{error}</p>}
        <section className="transcript">
          {shown.length === 0 && <p className="muted">No conversation recorded.</p>}
          {shown.map((l, i) => (
            <p key={i} className={`${l.who} ${l.correction ? "correction" : ""}`}>
              <b>{l.who === "tutor" ? "Tutor" : "You"}</b>
              {l.correction && <span className="tag">Correction</span>}
              {l.text}
            </p>
          ))}
        </section>
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
        <img src="/tutor/base.webp" alt="" className="hero-img" />
        <div>
          <h1>Deutsch sprechen</h1>
          <p className="sub">15 minutes of real conversation, Goethe-style. Pick your level.</p>
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

      {(needPass || !passcode) && (
        <label className="pass">
          Passcode
          <input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="Your app passcode" autoComplete="current-password" />
        </label>
      )}

      {error && <p className="error">{error}</p>}

      <button className="primary big" onClick={start} disabled={starting}>
        {starting ? "Starting…" : `Start ${level} conversation`}
      </button>
      <p className="hint">She speaks first and waits for you. Tap “Fertig” when you finish your answer.</p>
    </main>
  );
}
