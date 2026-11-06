"use client";

import { useEffect, useRef } from "react";
import type { AvatarBus } from "@/lib/tutorSession";

/**
 * The tutor. Mouth, blink, smile, "aha", thumb and the thinking pose come from the
 * artwork; breathing, head tilt, nods and the blend into the thinking pose are code.
 * Reads `bus` every frame, so the session never has to re-render React.
 */

const PATCH = {
  "face-aha": { x: 289, y: 338, w: 674, h: 458 },
  "face-smile": { x: 415, y: 429, w: 443, h: 358 },
  "eyes-closed": { x: 419, y: 427, w: 414, h: 188 },
  "mouth-small": { x: 539, y: 663, w: 176, h: 74 },
  "mouth-mid": { x: 530, y: 630, w: 186, h: 128 },
  "mouth-wide": { x: 489, y: 593, w: 278, h: 223 },
  "mouth-o": { x: 503, y: 620, w: 260, h: 176 },
} as const;
type PatchKey = keyof typeof PATCH;
const KEYS = Object.keys(PATCH) as PatchKey[];
const MOUTHS: PatchKey[] = ["mouth-small", "mouth-mid", "mouth-wide", "mouth-o"];
const THUMB = { x: 179, y: 688, w: 303, h: 428 };
const THINK_BLINK = { x: 374, y: 357, w: 532, h: 268 };
// similarity transform that places the thinking pose's face exactly on the base face
const M: number[] = [0.9373837139873725, 0.19839920126465155, -0.19839920126465155, 0.9373837139873725, 125.07209268966935, -72.97685200827901];
const PX = 600, PY = 925, BEND0 = 860, BEND1 = 1110, SLICE = 2;

function mul(P: number[], Q: number[]) {
  return [P[0]*Q[0]+P[2]*Q[1], P[1]*Q[0]+P[3]*Q[1], P[0]*Q[2]+P[2]*Q[3], P[1]*Q[2]+P[3]*Q[3], P[0]*Q[4]+P[2]*Q[5]+P[4], P[1]*Q[4]+P[3]*Q[5]+P[5]];
}
function inv(P: number[]) {
  const d = P[0]*P[3]-P[1]*P[2];
  return [P[3]/d, -P[1]/d, -P[2]/d, P[0]/d, (P[2]*P[5]-P[3]*P[4])/d, (P[1]*P[4]-P[0]*P[5])/d];
}
const Mi = inv(M), mis = Math.hypot(Mi[0], Mi[1]), mith = Math.atan2(Mi[1], Mi[0]);
function towardInv(t: number) {
  const s = 1 + (mis - 1) * t, th = mith * t, c = Math.cos(th) * s, n = Math.sin(th) * s;
  return [c, n, -n, c, Mi[4] * t, Mi[5] * t];
}
const css = (P: number[]) => `matrix(${P.map((v) => v.toFixed(5)).join(",")})`;
const smooth = (x: number) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

function load(src: string) {
  const im = new Image();
  im.src = src;
  return im;
}

export default function Avatar({ bus }: { bus: AvatarBus }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<HTMLDivElement>(null);
  const breathRef = useRef<HTMLDivElement>(null);
  const rigRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const thumbRef = useRef<HTMLImageElement>(null);
  const thinkRef = useRef<HTMLDivElement>(null);
  const thinkBlinkRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const stage = stageRef.current!, fit = fitRef.current!, breath = breathRef.current!, rig = rigRef.current!;
    const cv = cvRef.current!, thumb = thumbRef.current!, think = thinkRef.current!, thinkBlink = thinkBlinkRef.current!;
    const ctx = cv.getContext("2d")!;
    const off = document.createElement("canvas");
    off.width = off.height = 1200;
    const octx = off.getContext("2d")!;
    const base = load("/tutor/base.webp");
    const img = Object.fromEntries(KEYS.map((k) => [k, load(`/tutor/${k}.webp`)])) as Record<PatchKey, HTMLImageElement>;
    const A = Object.fromEntries(KEYS.map((k) => [k, 0])) as Record<PatchKey, number>;

    const resize = () => { fit.style.transform = `scale(${stage.clientWidth / 1200})`; };
    const ro = new ResizeObserver(resize);
    ro.observe(stage);
    resize();

    let lastKey = "";
    const compose = () => {
      const key = KEYS.map((k) => A[k].toFixed(2)).join("|");
      if (key === lastKey) return;
      lastKey = key;
      octx.clearRect(0, 0, 1200, 1200);
      if (base.complete) octx.drawImage(base, 0, 0);
      for (const k of KEYS) {
        if (A[k] <= 0.001 || !img[k].complete) continue;
        const p = PATCH[k];
        octx.globalAlpha = A[k];
        octx.drawImage(img[k], p.x, p.y, p.w, p.h);
        octx.globalAlpha = 1;
      }
    };
    const band = (y0: number, h: number, deg: number, dy: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.translate(PX, PY + dy);
      ctx.rotate((deg * Math.PI) / 180);
      ctx.translate(-PX, -PY);
      ctx.drawImage(off, 0, y0, 1200, h, 0, y0, 1200, h);
    };
    const draw = (deg: number, dy: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, 1200, 1200);
      if (Math.abs(deg) < 0.01 && Math.abs(dy) < 0.01) { ctx.drawImage(off, 0, 0); return; }
      band(BEND1, 1200 - BEND1, 0, 0);
      for (let y = BEND1 - SLICE; y >= BEND0; y -= SLICE) {
        const f = 1 - smooth((y - BEND0) / (BEND1 - BEND0));
        band(y, SLICE + 1, deg * f, dy * f);
      }
      band(0, BEND0 + 1, deg, dy);
    };

    let last = performance.now(), raf = 0;
    let rot = 0, morph = 0, tiltSide = 1, prevMode = "", nodStart = -1e9, nextNod = 0;
    let nextBlink = 1400, blinkUntil = 0;
    let mouth: PatchKey | "" = "", mouthAt = 0, round = false;

    const frame = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const t = now / 1000;
      const mode = bus.mode, lvl = bus.level;
      if (mode !== prevMode) {
        if (mode === "listening") { tiltSide = -tiltSide; nextNod = now + 700; }
        prevMode = mode;
      }

      const praising = now < bus.praiseUntil, aha = now < bus.ahaUntil;
      const quiet = lvl < 0.12;
      let rotT = 0, nodY = 0, face: PatchKey | "" = "";

      if (mode === "idle") rotT = 0.9 * Math.sin((t * 2 * Math.PI) / 7);
      if (mode === "speaking") rotT = 0.9 * Math.sin((t * 2 * Math.PI) / 3.1) + (lvl - 0.4) * 1.1;
      if (mode === "listening") {
        rotT = 4 * tiltSide;
        if (now > nextNod) { nodStart = now; nextNod = now + 2200 + Math.random() * 1400; }
        const nt = (now - nodStart) / 1000;
        if (nt >= 0 && nt < 0.6) nodY = 6 * Math.sin((Math.PI * nt) / 0.6);
      }
      if (aha) { rotT -= 2.5; if (quiet) face = "face-aha"; }
      if (praising && quiet) face = "face-smile";

      // mouth follows the loudness of her real voice (with a short hold so it doesn't flicker)
      let target: PatchKey | "" = "";
      if (mode === "speaking" && !face) {
        if (lvl >= 0.12) target = lvl < 0.35 ? "mouth-small" : lvl < 0.78 ? (round ? "mouth-o" : "mouth-mid") : "mouth-wide";
      }
      if (target !== mouth && now - mouthAt > 70) {
        if ((target === "mouth-mid" || target === "mouth-o") && mouth !== "mouth-mid" && mouth !== "mouth-o") round = Math.random() < 0.18;
        if (target === "mouth-mid" && round) target = "mouth-o";
        mouth = target; mouthAt = now;
      }

      if (now > nextBlink) { blinkUntil = now + 130; nextBlink = now + (Math.random() < 0.15 ? 400 : 2800 + Math.random() * 3500); }
      const blinking = now < blinkUntil;

      for (const k of MOUTHS) A[k] = k === mouth ? 1 : 0;
      A["eyes-closed"] = blinking && !face && morph < 0.5 ? 1 : 0;
      for (const k of ["face-aha", "face-smile"] as PatchKey[]) {
        const goal = k === face ? 1 : 0, step = dt / 0.14;
        A[k] = goal > A[k] ? Math.min(goal, A[k] + step) : Math.max(goal, A[k] - step);
      }
      thinkBlink.style.opacity = blinking && morph >= 0.5 ? "1" : "0";
      thumb.classList.toggle("on", praising);

      rot += (rotT - rot) * Math.min(1, dt * 4.5);
      const mt = mode === "thinking" ? 1 : 0;
      morph += Math.sign(mt - morph) * Math.min(Math.abs(mt - morph), dt / 0.45);

      const br = Math.sin((t * 2 * Math.PI) / 4.2);
      breath.style.transform = `scale(1, ${(1 + 0.007 * br).toFixed(5)})`;
      const e = morph < 0.5 ? 2 * morph * morph : 1 - Math.pow(-2 * morph + 2, 2) / 2;
      const TA = towardInv(e);
      rig.style.transform = css(TA);
      think.style.transform = css(mul(TA, M));
      think.style.opacity = String(Math.min(1, e / 0.6));
      const rigOp = Math.min(1, (1 - e) / 0.4);
      rig.style.opacity = String(rigOp);
      if (rigOp > 0) { compose(); draw(rot, nodY - 2 * br); }
      raf = requestAnimationFrame(frame);
    };
    // start only once every layer has decoded, so the first frame is complete
    let stopped = false;
    Promise.all([base, ...KEYS.map((k) => img[k])].map((im) => im.decode().catch(() => undefined))).then(() => {
      if (!stopped) raf = requestAnimationFrame(frame);
    });
    return () => { stopped = true; cancelAnimationFrame(raf); ro.disconnect(); };
  }, [bus]);

  return (
    <div className="avatar" ref={stageRef}>
      <div className="avatar-fit" ref={fitRef}>
        <div className="avatar-layer" ref={breathRef} style={{ transformOrigin: "600px 1200px" }}>
          <div className="avatar-layer" ref={rigRef} style={{ transformOrigin: "0 0" }}>
            <canvas ref={cvRef} width={1200} height={1200} className="avatar-layer" />
          </div>
          <img ref={thumbRef} className="avatar-thumb" src="/tutor/thumb.webp" alt=""
            style={{ left: THUMB.x, top: THUMB.y, width: THUMB.w, height: THUMB.h }} />
          <div className="avatar-layer" ref={thinkRef} style={{ transformOrigin: "0 0", opacity: 0 }}>
            <img className="avatar-img" src="/tutor/thinking.webp" alt="" style={{ left: 0, top: 0, width: 1200, height: 1200 }} />
            <img ref={thinkBlinkRef} className="avatar-img" src="/tutor/thinking-blink.webp" alt=""
              style={{ left: THINK_BLINK.x, top: THINK_BLINK.y, width: THINK_BLINK.w, height: THINK_BLINK.h, opacity: 0 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
