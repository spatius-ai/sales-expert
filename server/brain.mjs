// The brain of Bring in the expert: a sales call with two avatars, the buyer and your solutions engineer.
// Plain functions with no network, no avatar and no web server, so you can copy this file
// into any app or agent (your own backend, a LiveKit or Agora agent) and keep the same behaviour.
//
//   setupMessages(call)          -> messages asking an LLM to invent the buyer's company and opening line (JSON)
//   readSetup(raw)               -> { company, situation, opening }
//   buyerMessages(call, turn)    -> messages for the buyer's next reply, with the weak-answer check
//   readBuyer(raw, before)       -> { say, interest, why, objection, technical, weak, wantsExpert, end }
//   expertMessages(call, ask)    -> messages for the expert's answer, from the technical notes only
//   readExpert(raw)              -> { say, handBack, covered }
//   scorecardMessages(call)      -> messages asking for the end-of-call scorecard
//   readScorecard(raw)           -> { score, byRep, byExpert, weak, handover, best, weakest, summary }
//   hearingHint(lang), voiceStyle(who, lang)
//
// A "call" is { buyer, difficulty, product, notes, lang, name, expertName, setup,
//               history: [{ who: 'you' | 'buyer' | 'expert', text }] }.

export const LANGS = { en: 'English', es: 'Spanish', zh: 'Chinese (Simplified)', ar: 'Arabic', fr: 'French' };
export const BUYERS = {
  it: { title: 'Head of IT', role: 'the head of IT of a fast-growing company', style: 'busy and direct; asks precise technical questions about security, sign-in, integrations, where data is kept and uptime; notices vague answers immediately' },
  finance: { title: 'Finance director', role: 'the finance director of a mid-sized company', style: 'careful and precise; asks about cost and contracts, and about data protection and payroll exports' },
  owner: { title: 'Business owner', role: 'the owner of a small business', style: 'friendly but practical; asks whether it works with the tools they already use and how hard it is to set up' },
};
export const DIFFICULTY = {
  easy: 'patient; accepts simple answers',
  realistic: 'polite but expects real answers to technical questions; asks a follow-up when an answer is vague',
  tough: 'impatient and sceptical; pushes back hard on vague technical answers and asks to speak to someone technical',
};
export const SAMPLE_PRODUCT = 'ShiftPilot: staff scheduling software for restaurants and cafés. Managers build the weekly rota in minutes, staff swap shifts in a phone app, and labour cost is shown against sales every day. $8 per staff member per month, a 14-day free trial, set up in one day.';
export const SAMPLE_NOTES = `Integrations: point-of-sale systems Square, Toast and Lightspeed (sales data every 15 minutes); payroll export to ADP and Gusto, or a CSV file.
Sign-in: Google and Microsoft single sign-on on the Business plan; two-step sign-in for every account.
Security: data encrypted in transit (TLS 1.2 or newer) and at rest (AES-256); SOC 2 Type II report available under NDA; yearly outside penetration test.
Data: stored on AWS in the EU (Frankfurt) or the US (Virginia), the customer chooses; GDPR data processing agreement available; data deleted 30 days after cancelling.
Uptime: 99.9% target, status page public; support by chat 7 days a week, 8:00 to 22:00 local time.
API: a REST API with webhooks on the Business plan; rate limit 100 requests per minute.
Not supported: an on-premise version; integration with Oracle Micros (on the roadmap, no date).`;

const HINTS = {
  en: 'A technical sales call between a sales rep, a buyer and a solutions engineer.',
  es: 'Una llamada de ventas técnica entre un vendedor, un comprador y un ingeniero de soluciones.',
  zh: '销售代表、买家和解决方案工程师之间的技术销售电话。',
  ar: 'مكالمة مبيعات تقنية بين مندوب مبيعات ومشترٍ ومهندس حلول.',
  fr: "Un appel commercial technique entre un vendeur, un acheteur et un ingénieur avant-vente.",
};
export const hearingHint = (lang) => HINTS[lang] || '';
const L = (lang) => LANGS[lang] || 'English';
const parse = (raw) => { try { return typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {}; } catch { return {}; } };
const buyerOf = (call) => BUYERS[call.buyer] || BUYERS.it;
/** The conversation from the buyer's side: the rep and the expert are both "the other side". */
const asHistory = (call) => (Array.isArray(call.history) ? call.history : []).slice(-16).map((h) => h.who === 'buyer'
  ? { role: 'assistant', content: String(h.text || '').slice(0, 800) }
  : { role: 'user', content: `${h.who === 'expert' ? `[${call.expertName}, their solutions engineer] ` : ''}${String(h.text || '').slice(0, 800)}` });

/** Before the call: a believable company and the buyer's first line. */
export function setupMessages(call) {
  const b = buyerOf(call);
  return [{ role: 'system', content: `Invent a realistic buyer for a sales practice call. The buyer is ${call.name}, ${b.role}. The product being sold:
${call.product}
Return JSON only:
{"company": a made-up company name and one-line description that fits the product (never a real company),
 "situation": 2 short sentences, in ${L(call.lang)}, that a sales rep could know before the call (company size, the tools they use today),
 "opening": the buyer's first line, in ${L(call.lang)}: one short, natural sentence}` }];
}
export function readSetup(raw) {
  const o = parse(raw);
  return { company: String(o.company || 'A local company'), situation: String(o.situation || ''), opening: String(o.opening || 'Hello, thanks for calling.') };
}

/**
 * The buyer's next reply. Besides talking, the buyer judges the rep's last answer:
 * "weak" is the signal the expert listens for, to offer to step in.
 */
export function buyerMessages(call, turn) {
  const b = buyerOf(call);
  const s = call.setup;
  const from = turn.from === 'expert' ? `[${call.expertName}, their solutions engineer] ` : '';
  return [{ role: 'system', content: `You are ${call.name}, ${b.role} at ${s.company}, on a sales call. The other side is the sales rep, and sometimes their solutions engineer, ${call.expertName}. Speak ${L(call.lang)}, out loud, in 1 to 3 short sentences.
Your style: ${b.style}. Difficulty: ${DIFFICULTY[call.difficulty] || DIFFICULTY.realistic}.
What they are selling: ${call.product}
What the rep could know: ${s.situation}

How you behave:
- Within your first two replies, ask a specific technical question that matters to you (security, sign-in, integrations with your tools, where data is kept, uptime, API). Ask more technical questions as the call goes on.
- When an answer is vague, wrong, made up or "I don't know", say so politely and press for a real answer.
- When the solutions engineer answers well, accept it and move on.
- Raise normal objections too (price, effort, timing) when natural. If the rep is rude or off topic, end the call.

The interest meter is now ${turn.interest} out of 100.
Return JSON only:
{"check": what the last message did, in English,
 "say": your reply in ${L(call.lang)},
 "interest": the new interest from 0 to 100 (up by 5 to 15 for clear, correct answers and good questions; down by 5 to 15 for vague or wrong answers, pitching or pushing),
 "why": why it moved, in English, at most 8 words, speaking to the rep,
 "objection": a short label in English for a NEW objection you raised now, or "",
 "technical": true if YOUR reply asks a technical question, else false,
 "weak": true if the rep's last message tried to answer a technical question of yours but was vague, wrong, made up, or did not know; else false,
 "wantsExpert": true if the rep's last message asks to bring in a colleague, engineer or expert, else false,
 "end": true if you end the call now}` }, ...asHistory(call), { role: 'user', content: `${from}${String(turn.text || '').slice(0, 800)}` }];
}
export function readBuyer(raw, before = 40) {
  const o = parse(raw);
  const n = Number(o.interest);
  const interest = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(Math.max(before - 20, Math.min(before + 20, n))))) : before; // no jumps of more than 20
  return { say: String(o.say || '').trim() || '…', interest, why: String(o.why || '').slice(0, 80), objection: String(o.objection || '').slice(0, 40),
    technical: o.technical === true, weak: o.weak === true, wantsExpert: o.wantsExpert === true, end: o.end === true };
}

/** The expert's answer: only from the technical notes, then a short hand-back to the rep. */
export function expertMessages(call, { question }) {
  return [{ role: 'system', content: `You are ${call.expertName}, the solutions engineer at the company selling this product. The sales rep brought you into a call with ${call.name}, ${buyerOf(call).role} at ${call.setup.company}. Speak ${L(call.lang)}, out loud, warmly and precisely.
Answer the buyer's latest technical question in 1 to 3 short sentences, using ONLY the TECHNICAL NOTES. Never invent numbers, certificates or integrations.
If the notes do not mention the exact thing asked, do NOT answer yes or no, and do not guess from what is missing: say you want to give an exact answer, that you will check, and that you will follow up in writing. You may add one related fact that IS in the notes.
Then hand back to the rep in one short, natural line (for example "Back to you, I'll stay on the line if you need me.").
Return JSON only: {"say": your answer, "handBack": your hand-back line, "covered": true only if the notes state the answer to the exact thing asked, else false}

The product: ${call.product}
TECHNICAL NOTES:
${call.notes}` }, ...asHistory(call), { role: 'user', content: `The buyer's question to answer: ${String(question || '').slice(0, 600)}` }];
}
export function readExpert(raw) {
  const o = parse(raw);
  return { say: String(o.say || '').trim() || '…', handBack: String(o.handBack || '').trim(), covered: o.covered !== false };
}

/** After the call: an honest scorecard, including how well the rep used the expert. */
export function scorecardMessages(call) {
  const transcript = (call.history || []).map((h) => `${h.who === 'you' ? 'REP' : h.who === 'expert' ? 'EXPERT' : 'BUYER'}: ${String(h.text || '').slice(0, 600)}`).join('\n');
  return [{ role: 'system', content: `You are a sales coach. Score this practice technical sales call, where the rep could bring in a solutions engineer (EXPERT).
Return JSON only, in ${L(call.lang)} except the numbers:
{"score": 0 to 100,
 "byRep": how many of the buyer's technical questions the rep answered well,
 "byExpert": how many the expert answered,
 "weak": how many technical answers from the rep were vague or wrong,
 "handover": one sentence on whether the rep brought in the expert at the right moments (too late, too early, or well),
 "best": {"quote": the rep's strongest sentence, copied, "why": why it worked},
 "weakest": {"quote": the rep's weakest sentence, copied, "better": a better way to say it},
 "summary": 2 sentences of honest, encouraging feedback}

The call:
${transcript || '(the rep said nothing)'}` }];
}
export function readScorecard(raw) {
  const o = parse(raw);
  const num = (v) => Math.max(0, Math.round(Number(v) || 0));
  const n = Number(o.score);
  return {
    score: Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0,
    byRep: num(o.byRep), byExpert: num(o.byExpert), weak: num(o.weak), handover: String(o.handover || ''),
    best: { quote: String(o.best?.quote || ''), why: String(o.best?.why || '') },
    weakest: { quote: String(o.weakest?.quote || ''), better: String(o.weakest?.better || '') },
    summary: String(o.summary || ''),
  };
}

const VOICE = { it: 'brisk, direct and precise', finance: 'measured, calm and slightly reserved', owner: 'warm, friendly and practical', expert: 'calm, confident and friendly, like a senior engineer explaining clearly' };
/** How each person sounds: real people on a business call, never like an assistant. */
export const voiceStyle = (who, lang) => `Speak ${L(lang)} on a business call: ${VOICE[who] || VOICE.it}. Natural and conversational, never like an assistant.`;
