# Deutsch sprechen · My German Tutor

Live German speaking practice with an animated tutor, Goethe-style (A1, A2, B1).
She talks with you by voice through Google's **Gemini 3.8 Live** model, corrects you the way
we designed ("Small correction: … Say it again?"), and waits patiently when you tap
**Moment, bitte (+10 s)**.

## Deploy (one time, about 5 minutes)

1. **Gemini API key**: in [Google AI Studio](https://aistudio.google.com) open *Get API key*, create a key,
   set up billing and add prepaid credit (e.g. $10). The prepaid balance is your hard spending cap.
2. **Vercel**: on [vercel.com](https://vercel.com) choose *Add New → Project*, import this repository,
   and before clicking *Deploy* add these **Environment Variables**:

   | Name | Value |
   |---|---|
   | `GEMINI_API_KEY` | your key from step 1 |
   | `APP_PASSCODE` | any passcode you like, so only you can start sessions |
   | `TUTOR_VOICE` | optional, a voice you liked in AI Studio (default `Kore`) |

3. Click **Deploy**. Open the URL on your iPhone in Safari → Share → **Add to Home Screen**.

Changing a variable later: Vercel → Project → Settings → Environment Variables, then *Redeploy*.

## How it works

- `app/api/token` creates a short-lived token on the server, so your API key never reaches the browser.
- The browser connects straight to Gemini Live: your mic is streamed as 16 kHz audio, her voice comes back at 24 kHz.
- Turn-taking is our own (Gemini's automatic detection is off) so the app controls:
  - **pause tolerance**: A1 2.5 s, A2 2.0 s, B1 1.6 s of silence ends your answer
  - **thinking button**: +10 s, before or during your answer, stackable
  - **help**: if you stay silent 5 s after her question, she repeats it more slowly or offers a choice (max twice in a row)
- Each session picks a random everyday role and a Goethe topic for your level (`lib/prompts.ts`).
- Sessions run 15 minutes; Google's ~10-minute connection limit is handled by automatic resumption.
- The tutor's mouth follows the loudness of her real voice; the artwork lives in `public/tutor/`.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in GEMINI_API_KEY
npm run dev
```

## Tips

- Use headphones: the app interrupts her when you talk, and speakers can echo into the mic.
- If the mic is blocked: iPhone Settings → Safari → Microphone → Allow (or the aA menu → Website Settings).
