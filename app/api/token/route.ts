import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { buildSession } from "@/lib/prompts";
import type { Level } from "@/lib/levels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.8-live";
const VOICE = process.env.TUTOR_VOICE || "Kore";

/**
 * Hands the browser a short-lived token for one Live session, so the real API key
 * never leaves the server. With `resume: true` no new lesson plan is made: the
 * browser reconnects the same conversation.
 */
export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "The server has no GEMINI_API_KEY yet. Add it in Vercel → Settings → Environment Variables." }, { status: 500 });
  }
  const passcode = process.env.APP_PASSCODE;
  if (passcode && req.headers.get("x-passcode") !== passcode) {
    return NextResponse.json({ error: "Wrong passcode." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { level?: string; resume?: boolean };
  const level: Level = body.level === "A2" || body.level === "B1" ? body.level : "A1";

  try {
    const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });
    const now = Date.now();
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
      },
    });
    return NextResponse.json({
      token: token.name,
      model: MODEL,
      voice: VOICE,
      plan: body.resume ? null : buildSession(level),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Could not create a session token: ${message}` }, { status: 502 });
  }
}
