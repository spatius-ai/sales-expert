# Bring in the expert

## Overview

Bring in the expert is a sales call with two live avatars. The rep talks to a buyer (by default a busy head of IT) about a product. The buyer asks technical questions: security, sign-in, integrations, where the data is kept. When the rep says "let me bring in our engineer", or presses "Bring in", a second Spatius avatar, Grace the solutions engineer, joins the same screen as a two-person call. She answers the buyer's latest technical question from the product's technical notes only, hands back to the rep, and the buyer reacts.

Its standout feature is that **the expert offers to step in**. When the rep gives a vague or wrong answer to a technical question, Grace joins and asks "Want me to take that one?". The rep chooses "Yes, take it" or "I have got it". The two avatars hand over to each other like real colleagues, and the interest meter shows the difference a clear answer makes.

This repository is a small, complete template. It runs on your computer in a few minutes with only your Spatius API key and App ID. It is for technical sales teams and sales engineers, for companies that want to show customers an AI colleague who joins when needed, and for developers who want to see two avatars in one call.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/spatius-ai/sales-expert)

## Why this matters

Reps lose trust when they guess at technical answers, and sales engineers are scarce. Practising the handover, and seeing an expert who knows exactly when to step in and who never invents an answer, teaches what a good technical sales call looks like.

## User flow

1. The rep picks a buyer (head of IT, finance director or business owner), a difficulty and a language, and keeps the sample product and technical notes or pastes their own.
2. They press "Start the call". The buyer joins and the 3-minute call clock starts. The expert's avatar loads in the background, so she can join in a moment.
3. They talk or type. The buyer asks technical questions; each one is listed in the panel with who answered it.
4. When the rep's answer is vague or wrong, the buyer says so, and Grace joins and asks "Want me to take that one?".
5. "Yes, take it" (or "Bring in", or saying "let me bring in Grace") lets her answer from the notes. If the notes do not cover the question, she says so and offers to follow up in writing. Then she hands back, and the buyer reacts.
6. "End the call" (or the clock) opens the scorecard: technical answers by the rep and by the expert, vague answers, how well the rep used the expert, and the strongest and weakest lines.

## Architecture

```text
sales-expert/
  README.md
  LICENSE
  package.json
  vite.config.mjs           builds the web page and copies the avatar engine files
  wrangler.jsonc            Cloudflare Workers settings
  .env.example              settings for running on your computer
  .dev.vars.example         secrets for Cloudflare
  server/
    brain.mjs               the buyer, the weak-answer check, the expert's notes-only answers and hand-back, the scorecard
    voices.mjs              optional ElevenLabs voices, one per person (used when ELEVENLABS_API_KEY is set)
    app.mjs                 the API: session token, hearing, setup, turns, the expert, scorecard, voices (uses brain.mjs)
    node.mjs                runs the app on your computer
    worker.mjs              runs the app on Cloudflare Workers
  web/
    index.html              the page: choices, the two-person call, the panel and the scorecard
    src/main.ts             the call: two avatars, turns, the offer, the handover, the scorecard, the microphone
    src/expert.css          the look of the call, the offer, the panel and the scorecard
    src/seat.ts             the Spatius avatar: load, connect, speak (used once per avatar)
    public/embed.js         puts the call on any page with one line
    public/assets/          fonts, faces, the office and the expert's room
```

The code has three parts, so you can keep the part you need. `server/brain.mjs` is what makes it a technical sales call; `server/app.mjs` connects it to OpenAI and the browser; `web/src/seat.ts` connects each avatar. The same `server/app.mjs` runs in both places.

**Two avatars on one page.** `web/src/main.ts` keeps one seat per avatar (`seats.buyer` and `seats.expert`). The SDK starts once; each avatar gets its own view and its own voice, and only one speaks at a time. The expert's avatar loads at the start of the call, so she can join quickly. When she hands back, her avatar disconnects (`seat.disconnect()`) so it stops using Spatius minutes; it reconnects by itself the next time she speaks.

**How the expert knows when to step in.** Every buyer reply also judges the rep's last message (`buyerMessages()` in `brain.mjs`): `weak` is true when the rep tried to answer a technical question but was vague, wrong or did not know, and `wantsExpert` is true when the rep asked for a colleague. The page reacts: `weak` brings the offer, `wantsExpert` brings the answer.

**Answers only from the notes.** `expertMessages()` tells the expert to use only the technical notes, and when the notes do not mention the exact thing asked, not to answer yes or no and not to guess from what is missing, but to say she will check and follow up in writing. In our tests she answered 8 of 8 questions correctly: from the notes when they covered it, and with a follow-up promise for ISO 27001, Okta SAML and HIPAA, which the sample notes do not mention.

## Runtime modes

| Mode | Command |
| --- | --- |
| On your computer | `npm start` |
| Cloudflare Workers, local | `cp .dev.vars.example .dev.vars`, then `npm run dev:cf` |
| Cloudflare Workers, online | `npm run deploy` or the Deploy button |

**Starter minutes or your own OpenAI key.** Hearing, the buyer's and the expert's replies, the scorecard and both voices use OpenAI. Without `OPENAI_API_KEY`, the call uses free Spatius starter minutes (30 minutes per Spatius key), sent through `starter.spatius.app` with your Spatius key. When the minutes are used up, the page says so, and you add your own key. With `OPENAI_API_KEY` set, the call calls OpenAI directly and the starter service is not used.

## Protocols and contracts

The browser talks to the server through eight routes. A `call` is `{ buyer, difficulty, product, notes, lang, setup, history }`, and each history line is said by `you`, `buyer` or `expert`.

| Route | Request | Response |
| --- | --- | --- |
| `GET /api/config` | none | `appId`, `region`, `buyers`, `expert`, `choices`, `sampleProduct`, `sampleNotes`, `starter` |
| `POST /api/session` | none | `appId`, `region`, `sessionToken` |
| `POST /api/hear` | Recorded audio as the body, header `x-lang` | `{ text }` |
| `POST /api/setup` | JSON `{ buyer, difficulty, product, lang }` | `{ company, situation, opening }` |
| `POST /api/turn` | JSON `{ call, text, interest, from }` (`from` is `you` or `expert`) | `{ say, interest, why, objection, technical, weak, wantsExpert, end }` |
| `POST /api/expert` | JSON `{ call, question }` | `{ say, handBack, covered }` |
| `POST /api/scorecard` | JSON `{ call }` | `{ score, byRep, byExpert, weak, handover, best, weakest, summary }` |
| `POST /api/speak` | JSON `{ text, who, lang }` (`who` is the buyer or `expert`) | The voice as raw PCM16, mono, 24 kHz, streamed |

Errors come back as `{ "error": "..." }` with a matching HTTP status. When starter minutes are used up, the status is 402 and `starterUsed` is `true`.

## Make it yours

- **Your product and technical notes.** Set `EXPERT_PRODUCT` and `EXPERT_NOTES` in `.env`, or change `SAMPLE_PRODUCT` and `SAMPLE_NOTES` in `server/brain.mjs`. The expert only knows what the notes say, so write one clear fact per line.
- **Buyers.** Add or change buyers in `BUYERS` in `server/brain.mjs`, with a face and voice in `FACES` in `server/app.mjs` and a button on the page.
- **The expert.** Her name, face and voice are `EXPERT` in `server/app.mjs`; how she answers and hands back is in `expertMessages()`.
- **When she offers.** The weak-answer check is part of `buyerMessages()`; the offer line in each language is `LINES` in `web/src/main.ts`.
- **Call length.** Calls last 3 minutes (`CALL_SECONDS` in `web/src/main.ts`).

## Use it in your own app

Pick the row that matches what you have.

| You have | Do this |
| --- | --- |
| Any website or web app, and you want the call inside it | Deploy this template (Cloudflare button or your own server), then add one line where it should appear: `<script src="https://YOUR-ADDRESS/embed.js" data-buyer="finance" data-difficulty="tough" async></script>`. The `data-` choices are optional. Events arrive on your page as `window` event `spatius:event`. |
| Your own backend, in any language | Copy `server/brain.mjs` (or port it: plain functions, no network). Call `setupMessages()` / `readSetup()` before the call, `buyerMessages()` / `readBuyer()` each turn, `expertMessages()` / `readExpert()` when the expert answers, and `scorecardMessages()` / `readScorecard()` at the end. |
| Your own web page, and you want the avatars | Copy `web/src/seat.ts`, once per avatar: it loads a Spatius avatar into any element and plays 24 kHz PCM16 audio on it with lip sync. The two-seat pattern is in `web/src/main.ts`. |
| A LiveKit or Agora voice agent | Start from Spatius's official example, [livekit-demo](https://github.com/spatius-ai/spatius-integration-demo/tree/main/livekit-demo) or [agora-demo](https://github.com/spatius-ai/spatius-integration-demo/tree/main/agora-demo), then call the brain's functions from your agents' LLM steps (one agent for the buyer, one for the expert). The brain is plain functions, so the handover works the same over LiveKit or Agora. |
| Another LLM, or an OpenAI-compatible gateway | Set `OPENAI_BASE_URL` with your own `OPENAI_API_KEY`. The brain works with any chat model that can return JSON. |

Spatius's official examples show how to connect an avatar (Direct, LiveKit, Agora, iOS, Android, Flutter): [spatius-integration-demo](https://github.com/spatius-ai/spatius-integration-demo), [livekit-plugins-spatius](https://github.com/spatius-ai/livekit-plugins-spatius) and [create-spatius-app](https://github.com/spatius-ai/create-spatius-app). This template shows what to build on top: the use case and its standout feature, in a brain you can plug into any of them.

## Technical stack

- Spatius avatar SDK (`@spatius/avatarkit`) in Direct mode, drawn in the browser
- OpenAI: `gpt-4o-mini-transcribe` (speech to text), `gpt-4.1-mini` (the buyer, the expert, the meter and the scorecard, JSON replies), `gpt-4o-mini-tts` (two voices); all can be changed in settings
- Vite for the web page, plain Node for the local server, Cloudflare Workers for hosting
- No database and no framework

## Setup and local development

You need Node 20.3 or newer and a Spatius account, for an API key and App ID from [app.spatius.ai](https://app.spatius.ai). You also need a browser with WebGPU or WebGL2, and a microphone if you want to speak.

```sh
git clone https://github.com/spatius-ai/sales-expert
cd sales-expert
cp .env.example .env      # paste SPATIUS_API_KEY and SPATIUS_APP_ID
npm install
npm start                 # open http://localhost:3000
```

The page calls `/api/...` and loads `/assets/...` on the same address as the page, so the page, the built files and the API must be served from one origin. `server/node.mjs` and Cloudflare both do this.

## Environment configuration

| Setting | Needed | What it does |
| --- | --- | --- |
| `SPATIUS_API_KEY` | Yes | Your Spatius API key |
| `SPATIUS_APP_ID` | Yes | Your Spatius App ID |
| `SPATIUS_REGION` | No | `us-west` (default) or your region |
| `OPENAI_API_KEY` | No | Your OpenAI key; without it, starter minutes are used |
| `ELEVENLABS_API_KEY` | No | ElevenLabs voices: each person has their own voice, and a native voice for Arabic. Without it, the OpenAI voice is used, and it is also used if ElevenLabs refuses a request. Model: `ELEVENLABS_MODEL` (default `eleven_v4_turbo`) |
| `OPENAI_BASE_URL` | No | Another OpenAI-compatible address for your own key. Your OpenAI key is never sent to the starter service. |
| `SPATIUS_STARTER_URL` | No | Another starter service address (for testing) |
| `EXPERT_BUYER` | No | Starting buyer: `it`, `finance` or `owner` |
| `EXPERT_DIFFICULTY` | No | `easy`, `realistic` or `tough` |
| `EXPERT_LANG` | No | `en`, `es`, `zh`, `ar` or `fr` |
| `EXPERT_PRODUCT` | No | Your product, instead of the sample; write `\n` for a new line |
| `EXPERT_NOTES` | No | Your technical notes for the expert, instead of the sample; write `\n` for a new line |
| `OPENAI_CHAT_MODEL`, `OPENAI_STT_MODEL`, `OPENAI_TTS_MODEL` | No | Models |
| `PORT` | No | Local port, 3000 by default |

The rep can still change the buyer, difficulty, language, product and notes on the page. On Cloudflare, put the keys in `.dev.vars` (local) or as secrets (online); the other settings are in `wrangler.jsonc` under `vars`.

## Security and deployment guidance

- Keys stay on the server. The browser only receives a short-lived Spatius session token.
- The `/api` routes are open to anyone who can reach your site, and each turn spends your OpenAI key or starter minutes and your Spatius minutes. Two avatars on screen may use Spatius minutes for each avatar; the expert disconnects when she hands back to keep this low. The server allows 40 API requests per minute per visitor; for a public site, also turn on your host's rate limiting (for example Cloudflare rate limiting rules) and set a monthly limit in your OpenAI account.
- Nothing is stored on the server; the call lives in the rep's browser tab. Recordings are turned into text and not kept.
- The buyers, companies, sample product and notes are made up. Whatever you put in the product text and notes is sent to your LLM provider.
- `.env` and `.dev.vars` are ignored by git. Never commit them.
- The avatar SDK sends basic performance data to Spatius so failures can be found. See the [Spatius Terms of Service](https://www.spatius.ai/terms-of-service/).

## License and use constraints

The code in this repository is under the MIT License (see `LICENSE`). The Spatius avatar SDK (`@spatius/avatarkit`) and the Spatius service are not part of this license; they are covered by the [Spatius Terms of Service](https://www.spatius.ai/terms-of-service/). The fonts in `web/public/assets/fonts/` (Inter, Geist Mono, Space Grotesk) are under the SIL Open Font License; their license texts are in `web/public/assets/licenses/`. The office and room pictures, the sample product and notes, and the face photos are examples for this template.
