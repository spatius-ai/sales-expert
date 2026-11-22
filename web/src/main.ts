// Bring in the expert: a sales call with two Spatius avatars. The buyer asks technical questions;
// your solutions engineer joins, answers from your technical notes, and hands back to you.
import './expert.css';
import { canDraw, initSdk, loadSeat, type Seat } from './seat';

type Lang = 'en' | 'es' | 'zh' | 'ar' | 'fr';
type Who = 'buyer' | 'expert';
type Choices = { buyer: string; difficulty: string; lang: Lang; product?: string; notes?: string };
type Setup = { company: string; situation: string; opening: string };
type Turn = { say: string; interest: number; why: string; objection: string; technical: boolean; weak: boolean; wantsExpert: boolean; end: boolean; error?: string };
type Answer = { say: string; handBack: string; covered: boolean; error?: string };
type Card = { score: number; byRep: number; byExpert: number; weak: number; handover: string; best: { quote: string; why: string }; weakest: { quote: string; better: string }; summary: string; error?: string };
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const $$ = <T extends HTMLElement = HTMLElement>(s: string) => [...document.querySelectorAll(s)] as T[];
const esc = (t: string) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const track = (name: string, props: Record<string, unknown> = {}) => { if (parent !== window) parent.postMessage({ type: 'spatius-event', demo: 'sales-expert', name, props }, '*'); };
const CALL_SECONDS = 180;
// what the expert says when she offers, and when the rep declines, in the call's language
const LINES: Record<Lang, { offer: string; ok: string }> = {
  en: { offer: 'Want me to take that one?', ok: 'Sure, go ahead. I will stay on the line.' },
  es: { offer: '¿Quieres que responda yo a esa?', ok: 'Claro, adelante. Sigo en la llamada.' },
  zh: { offer: '这个问题要我来回答吗？', ok: '好的，你来吧。我会一直在线。' },
  ar: { offer: 'هل تريدني أن أجيب عن هذا السؤال؟', ok: 'بالتأكيد، تفضل. سأبقى معكم على الخط.' },
  fr: { offer: 'Tu veux que je prenne celle-là ?', ok: 'Bien sûr, vas-y. Je reste en ligne.' },
};

const st = {
  buyer: 'it', difficulty: 'realistic', lang: 'en' as Lang, product: '', notes: '',
  setup: null as Setup | null, history: [] as { who: 'you' | 'buyer' | 'expert'; text: string }[],
  interest: 40, objections: [] as string[], tq: [] as { q: string; by: '' | 'you' | 'weak' | 'expert' }[], pending: '',
  expertIn: false, busy: false, live: false, ends: 0, sessionSeconds: CALL_SECONDS,
};
const stage = $('#stage'), stateEl = $('#state');
let cfg: { appId: string; region: string; buyers: Record<string, { title: string; name: string; avatarId: string }>; expert: { name: string; title: string; avatarId: string }; choices?: Choices; sessionSeconds?: number } | null = null;
const buyerInfo = () => cfg?.buyers[st.buyer] || { title: 'Head of IT', name: 'Nadia', avatarId: '' };
const expertInfo = () => cfg?.expert || { name: 'Grace', title: 'Solutions engineer', avatarId: '' };
let drawable = true, clockT = 0, sdkReady: Promise<void> | null = null;

// ---------- two avatars, one seat each ----------
// The buyer sits behind the desk; the expert joins from her own room.
const FIT: Record<Who, { x: number; y: number; scale: number }> = { buyer: { x: 0, y: 0.13, scale: 0.78 }, expert: { x: 0, y: 0.05, scale: 0.88 } };
const seats: Record<Who, { seat: Seat | null; loading: Promise<Seat | null> | null; key: string; start: (() => Promise<Seat>) | null }> = {
  buyer: { seat: null, loading: null, key: '', start: null }, expert: { seat: null, loading: null, key: '', start: null },
};
function fitAvatar(view: any, fit: typeof FIT.buyer, tries = 40) { try { view.avatarTransform = fit; } catch { if (tries > 0) setTimeout(() => fitAvatar(view, fit, tries - 1), 150); } }
async function sdk() {
  sdkReady ??= (async () => { const r = await fetch('api/session', { method: 'POST' }); const s = await r.json(); if (!r.ok) throw new Error(s.error || 'No session.'); await initSdk(s); })();
  return sdkReady;
}
/** Loads (and draws) an avatar; its voice starts only when it is first needed. */
function seatFor(who: Who): Promise<Seat | null> {
  if (!cfg || !drawable) return Promise.resolve(null);
  const s = seats[who];
  const avatarId = who === 'buyer' ? buyerInfo().avatarId : expertInfo().avatarId;
  if (s.key !== avatarId) { s.seat?.dispose(); s.seat = null; s.loading = null; s.start = null; $(`#${who}Box`).classList.remove('live'); }
  s.key = avatarId;
  return (s.loading ??= (async () => {
    const load = $(`#${who}Load`); load.classList.add('on');
    try {
      await sdk();
      const { start, view } = await loadSeat($(`#${who}Avatar`), avatarId, (f) => (load.textContent = `${who === 'buyer' ? buyerInfo().name : expertInfo().name} is joining… ${Math.round(f * 100)}%`));
      if (s.key !== avatarId) return null;
      fitAvatar(view, FIT[who]); (window as any)[`__${who}`] = view;
      s.seat = await start();
      $(`#${who}Box`).classList.add('live');
      return s.seat;
    } catch (e) { console.warn('[expert] voice only', e); drawable = false; return null; }
    finally { load.classList.remove('on'); }
  })());
}

// ---------- voices ----------
async function voice(text: string, who: Who) {
  const r = await fetch('api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, lang: st.lang, who: who === 'expert' ? 'expert' : st.buyer }) });
  if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({}))).error || 'The voice did not come through.');
  const reader = r.body.getReader(); let held = new Uint8Array(0); let ended = false;
  return async (): Promise<Int16Array | null> => {
    for (;;) {
      if (held.length >= 9600 || (ended && held.length >= 2)) { const whole = held.length - (held.length % 2); const out = new Int16Array(held.slice(0, whole).buffer); held = held.slice(whole); return out; }
      if (ended) return null;
      const { value, done } = await reader.read();
      if (done) { ended = true; continue; }
      const n = new Uint8Array(held.length + value.length); n.set(held); n.set(value, held.length); held = n;
    }
  };
}
let plainCtx: AudioContext | null = null;
async function playPlain(next: () => Promise<Int16Array | null>) {
  const ctx = new AudioContext({ sampleRate: 24000 }); plainCtx = ctx; let at = ctx.currentTime + 0.05;
  for (let c = await next(); c && ctx.state !== 'closed'; c = await next()) { const buf = ctx.createBuffer(1, c.length, 24000); const ch = buf.getChannelData(0); for (let i = 0; i < c.length; i++) ch[i] = c[i] / 32768; const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start(at); at += buf.duration; }
  if (ctx.state !== 'closed') await new Promise((r) => setTimeout(r, Math.max(0, (at - ctx.currentTime) * 1000)));
}
function hush() { seats.buyer.seat?.interrupt(); seats.expert.seat?.interrupt(); if (plainCtx && plainCtx.state !== 'closed') void plainCtx.close(); plainCtx = null; }
const setState = (t: string) => { stateEl.textContent = t; };
/** One person speaks: their tile lights up and the subtitles show their line. */
async function say(who: Who, text: string) {
  if (!text) return;
  showSaid(who, text); setState('Speaking');
  $(`#${who}Tile`).classList.add('talking');
  try { const next = await voice(text, who); const s = await seatFor(who); if (s) await s.stream(next).done; else await playPlain(next); }
  catch (e) { console.warn(e); }
  finally { $(`#${who}Tile`).classList.remove('talking'); if (st.live && !st.busy) setState('Your turn'); } // mid-exchange, it is not the rep's turn yet
}
function showSaid(who: Who | 'you', text: string) {
  $('#who').textContent = who === 'you' ? 'You' : who === 'buyer' ? `${buyerInfo().name} · ${buyerInfo().title}` : `${expertInfo().name} · ${expertInfo().title}`;
  $('#said').textContent = text;
}

// ---------- the panel ----------
function showMeter(value: number, why = '', before = value) {
  $('#num').innerHTML = `${value}<small>/100</small>`; $('#dot').style.left = `${value}%`;
  const d = value - before;
  if (why) $('#why').innerHTML = `<span class="delta ${d > 0 ? 'up' : d < 0 ? 'down' : 'same'}">${d > 0 ? '+' : ''}${d}</span><span>${esc(why)}</span>`;
}
function showObjections() { $('#objs').innerHTML = st.objections.length ? st.objections.map((o) => `<span>${esc(o)}</span>`).join('') : '<span class="none hp-type-label">None yet</span>'; }
const BY: Record<string, string> = { '': 'Open', you: 'You', weak: 'You, vague', expert: 'Expert' };
function showTq() {
  $('#tq').innerHTML = st.tq.length ? st.tq.slice(-4).map((t) => `<div><span class="who-b ${t.by}">${BY[t.by]}</span><span dir="auto">${esc(t.q.length > 90 ? t.q.slice(0, 88) + '…' : t.q)}</span></div>`).join('') : '<span class="none hp-type-label">None yet</span>';
}
/** A new technical question from the buyer; if the last one is still open, this one replaces it (the buyer is asking again). */
function addQuestion(q: string) {
  const last = st.tq[st.tq.length - 1];
  if (last && !last.by) last.q = q; else st.tq.push({ q, by: '' });
  st.pending = q;
}
function expertState(t: string) { $('#expertState').textContent = `${expertInfo().title} · ${t}`; }

// ---------- a call ----------
const callBody = () => ({ buyer: st.buyer, difficulty: st.difficulty, lang: st.lang, product: st.product, notes: st.notes, setup: st.setup, history: st.history });
function clock(left: number) { $('#clock').textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`; }
function reset() {
  hush(); st.setup = null; st.history = []; st.interest = 40; st.objections = []; st.tq = []; st.pending = ''; st.live = false; window.clearInterval(clockT);
  st.expertIn = false; $('#tiles').classList.remove('two'); $('#offer').classList.remove('on'); expertState('on standby'); $<HTMLButtonElement>('#bring').disabled = true;
  stage.classList.remove('oncall'); $('#score').classList.remove('on');
  showMeter(40); $('#why').innerHTML = '<span class="delta same">Start</span><span>It moves with every answer.</span>';
  showObjections(); showTq(); clock(st.sessionSeconds || CALL_SECONDS); $('#know').textContent = 'Start the call to meet the buyer.';
}
async function startCall() {
  if (st.busy) return;
  reset(); st.busy = true; void seatFor('buyer').then(() => seatFor('expert')); // the expert is ready before she is needed
  setState('Calling'); showSaid('you', 'Calling…');
  stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
  try {
    const r = await fetch('api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ buyer: st.buyer, difficulty: st.difficulty, lang: st.lang, product: st.product }) });
    const s = await r.json(); if (!r.ok || s.error) { showSaid('you', s.error || 'The call did not connect.'); setState('Ready'); return; }
    st.setup = s; st.live = true; stage.classList.add('oncall'); $<HTMLButtonElement>('#bring').disabled = false;
    $('#know').innerHTML = `<b>${esc(s.company)}</b><br>${esc(s.situation)}`;
    track('call_start', { buyer: st.buyer, difficulty: st.difficulty, lang: st.lang, own: !!st.product });
    if (st.sessionSeconds) { st.ends = Date.now() + st.sessionSeconds * 1000; clockT = window.setInterval(() => { const left = Math.max(0, Math.round((st.ends - Date.now()) / 1000)); clock(left); if (!left) void endCall(); }, 500); }
    st.history.push({ who: 'buyer', text: s.opening });
    await say('buyer', s.opening);
    $('#q').focus();
  } finally { st.busy = false; }
}
/** The buyer's reply to the rep (or to the expert), with the meter, objections and technical questions. */
async function buyerTurn(text: string, from: 'you' | 'expert'): Promise<Turn | null> {
  const r = await fetch('api/turn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call: callBody(), text, interest: st.interest, from }) });
  const t: Turn = await r.json(); if (!r.ok || t.error) { showSaid('you', t.error || 'Something went wrong.'); return null; }
  st.history.push({ who: from, text }, { who: 'buyer', text: t.say });
  showMeter(t.interest, t.why, st.interest); st.interest = t.interest;
  if (t.objection && !st.objections.includes(t.objection)) { st.objections.push(t.objection); showObjections(); }
  return t;
}
async function send(text: string) {
  text = text.trim(); if (!text) return;
  if (st.busy) { $<HTMLInputElement>('#q').value = text; return; } // keep what the rep typed until it is their turn
  if (!st.live) { await startCall(); if (!st.live) return; }
  st.busy = true; hush(); $('#offer').classList.remove('on'); showSaid('you', text); setState('Thinking');
  try {
    const open = st.tq.length && !st.tq[st.tq.length - 1].by ? st.tq[st.tq.length - 1] : null;
    const t = await buyerTurn(text, 'you'); if (!t) return;
    // the rep's answer to an open technical question: good, or vague
    if (open && !t.wantsExpert) { open.by = t.weak ? 'weak' : 'you'; if (!t.weak) st.pending = ''; }
    if (t.technical) addQuestion(t.say);
    showTq(); track('turn', { interest: t.interest, weak: t.weak, technical: t.technical });
    await say('buyer', t.say);
    if (t.end) { await endCall(); return; }
    if (t.wantsExpert) { st.busy = false; await expertAnswer('asked'); return; }
    if (t.weak && !$('#offer').classList.contains('on')) await offer();
  } catch (e) { showSaid('you', (e as Error).message); }
  finally { st.busy = false; if (st.live && stateEl.textContent === 'Thinking') setState('Your turn'); }
}

// ---------- the expert ----------
async function expertJoin() {
  if (!st.expertIn) { st.expertIn = true; $('#tiles').classList.add('two'); track('expert_join'); }
  expertState('in the call');
  await seatFor('expert');
}
/** After a weak answer the expert joins and offers; the rep chooses. */
async function offer() {
  await expertJoin();
  $('#offerText').textContent = LINES[st.lang].offer; $('#offer').classList.add('on');
  track('expert_offer');
  await say('expert', LINES[st.lang].offer);
}
$('#offerYes').onclick = () => { $('#offer').classList.remove('on'); track('offer_yes'); void expertAnswer('offer'); };
$('#offerNo').onclick = async () => { $('#offer').classList.remove('on'); track('offer_no'); await say('expert', LINES[st.lang].ok); seats.expert.seat?.disconnect(); expertState('on the line'); $('#q').focus(); };
/** The expert answers the buyer's latest technical question from the notes, hands back, and the buyer reacts. */
async function expertAnswer(how: 'asked' | 'offer' | 'button') {
  if (st.busy || !st.live) return;
  st.busy = true; hush(); $('#offer').classList.remove('on'); $<HTMLButtonElement>('#bring').disabled = true;
  try {
    await expertJoin(); expertState('answering'); setState('Thinking');
    const question = st.pending || [...st.history].reverse().find((h) => h.who === 'buyer')?.text || '';
    const r = await fetch('api/expert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call: callBody(), question }) });
    const a: Answer = await r.json(); if (!r.ok || a.error) { showSaid('you', a.error || 'The expert could not answer.'); return; }
    track('expert_answer', { how, covered: a.covered });
    await say('expert', a.say);
    if (a.handBack) await say('expert', a.handBack);
    seats.expert.seat?.disconnect(); expertState('on the line'); // she stays on screen, but her avatar stops using minutes
    st.tq.forEach((t) => { if (!t.by || t.by === 'weak') t.by = 'expert'; }); st.pending = ''; showTq(); // she answered what was still open
    const t = await buyerTurn(`${a.say} ${a.handBack}`.trim(), 'expert'); if (!t) return;
    if (t.technical) { addQuestion(t.say); showTq(); }
    await say('buyer', t.say);
    if (t.end) await endCall();
  } catch (e) { showSaid('you', (e as Error).message); }
  finally { st.busy = false; if (st.live) { setState('Your turn'); $<HTMLButtonElement>('#bring').disabled = false; } }
}
$('#bring').onclick = () => { track('bring_button'); void expertAnswer('button'); };

// ---------- the end: the scorecard ----------
async function endCall() {
  if (!st.live) return;
  st.live = false; window.clearInterval(clockT); hush(); $('#offer').classList.remove('on'); stage.classList.remove('oncall'); setState('Call ended');
  seats.expert.seat?.disconnect(); $<HTMLButtonElement>('#bring').disabled = true;
  const words = (who: string) => st.history.filter((h) => h.who === who).reduce((n, h) => n + h.text.split(/\s+/).filter(Boolean).length, 0);
  const you = words('you'), them = words('buyer') + words('expert');
  const talk = you + them ? Math.round((you / (you + them)) * 100) : 0;
  $('#scoreBox').innerHTML = '<p class="wait hp-type-card-copy">Scoring your call…</p>'; $('#score').classList.add('on');
  track('call_end', { turns: st.history.length, expert: st.expertIn, interest: st.interest });
  try {
    const r = await fetch('api/scorecard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call: callBody() }) });
    const c: Card = await r.json(); if (!r.ok || c.error) throw new Error(c.error || 'No scorecard.');
    $('#scoreBox').innerHTML = `
      <div class="head"><div class="ring" style="--v:${c.score}"><span>${c.score}</span></div>
        <div><h3 class="hp-type-card-title" id="scoreTitle">Your scorecard</h3><p class="sum hp-type-card-copy" dir="auto">${esc(c.summary)}</p></div></div>
      <div class="stats">
        <div><b>${c.byRep}</b><span>technical answers by you</span></div>
        <div><b>${c.byExpert}</b><span>answered by the expert</span></div>
        <div><b>${c.weak}</b><span>vague or wrong answers</span></div>
        <div><b>${talk}%</b><span>you talked</span></div>
      </div>
      ${c.handover ? `<div class="handover" dir="auto"><span class="k hp-type-mono">Using the expert</span><br>${esc(c.handover)}</div>` : ''}
      <div class="moments">
        ${c.best.quote ? `<div class="best"><span class="k hp-type-mono">Your strongest line</span><q dir="auto">${esc(c.best.quote)}</q><p dir="auto">${esc(c.best.why)}</p></div>` : ''}
        ${c.weakest.quote ? `<div class="weak"><span class="k hp-type-mono">Your weakest line</span><q dir="auto">${esc(c.weakest.quote)}</q><p class="better" dir="auto">Try: ${esc(c.weakest.better)}</p></div>` : ''}
      </div>
      <div class="row"><button class="btn btn-brand hp-type-action" type="button" id="again">Call again</button><button class="btn btn-secondary hp-type-action" type="button" id="close">Close</button></div>`;
    $('#again').onclick = () => void startCall();
    $('#close').onclick = () => $('#score').classList.remove('on');
    track('scorecard', { score: c.score });
  } catch (e) {
    $('#scoreBox').innerHTML = `<p class="wait hp-type-card-copy">${esc((e as Error).message)}</p><div class="row"><button class="btn btn-secondary hp-type-action" type="button" id="close">Close</button></div>`;
    $('#close').onclick = () => $('#score').classList.remove('on');
  }
}
$('#start').onclick = () => void startCall();
$('#end').onclick = () => (st.live ? void endCall() : undefined);
$('#ask').onsubmit = (e) => { e.preventDefault(); const q = $<HTMLInputElement>('#q'); const v = q.value; q.value = ''; void send(v); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#score').classList.remove('on'); });

// ---------- microphone ----------
let rec: MediaRecorder | null = null;
$('#mic').onclick = async () => {
  const mic = $('#mic');
  if (rec) { rec.stop(); return; }
  if (st.busy) return;
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { showSaid('you', 'Allow the microphone, or type.'); return; }
  hush(); void seatFor('buyer');
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
  const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined); rec = r;
  const parts: Blob[] = []; r.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const ac = new AudioContext(); const an = ac.createAnalyser(); an.fftSize = 1024; ac.createMediaStreamSource(stream).connect(an);
  const buf = new Float32Array(an.fftSize); let heard = false, quiet = performance.now(); const began = performance.now();
  const tick = window.setInterval(() => {
    an.getFloatTimeDomainData(buf); const rms = Math.sqrt(buf.reduce((n, x) => n + x * x, 0) / buf.length);
    if (rms > 0.02) { heard = true; quiet = performance.now(); }
    const now = performance.now();
    if ((heard && now - quiet > 1500) || now - began > 25000 || (!heard && now - began > 7000)) r.stop();
  }, 100);
  r.onstop = async () => {
    window.clearInterval(tick); void ac.close(); stream.getTracks().forEach((t) => t.stop()); rec = null;
    mic.classList.remove('on'); mic.setAttribute('aria-pressed', 'false');
    if (!heard || !parts.length) { setState(st.live ? 'Your turn' : 'Ready'); return; }
    setState('Listening');
    const res = await fetch('api/hear', { method: 'POST', headers: { 'Content-Type': r.mimeType || 'audio/webm', 'x-lang': st.lang }, body: new Blob(parts, { type: r.mimeType || 'audio/webm' }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.text) { showSaid('you', d.error || "I didn't catch that. Try again, or type it."); setState(st.live ? 'Your turn' : 'Ready'); return; }
    void send(d.text);
  };
  r.start(250); mic.classList.add('on'); mic.setAttribute('aria-pressed', 'true'); setState('Listening');
};

// ---------- choices: they apply to the next call ----------
function pickIn(id: string, attr: string, value: string) { $$(`${id} button`).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset[attr] === value))); }
function choose(fn: () => void, event: string, props: Record<string, unknown>) {
  if (st.live) { st.live = false; window.clearInterval(clockT); stage.classList.remove('oncall'); }
  fn(); reset(); setState('Ready'); showSaid('buyer', 'Press Start the call. When it gets technical, bring in the expert.'); track(event, props);
}
$('#buyers').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button'); if (!b || b.dataset.buyer === st.buyer) return;
  choose(() => { st.buyer = b.dataset.buyer!; pickIn('#buyers', 'buyer', st.buyer); $<HTMLImageElement>('#buyerStill').src = b.querySelector('img')!.src; $('#buyerTag').textContent = `${buyerInfo().name} · ${buyerInfo().title}`; }, 'buyer_pick', { buyer: b.dataset.buyer });
  if (seats.buyer.seat || seats.buyer.loading) void seatFor('buyer');
});
$('#levels').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (b && b.dataset.difficulty !== st.difficulty) choose(() => { st.difficulty = b.dataset.difficulty!; pickIn('#levels', 'difficulty', st.difficulty); }, 'difficulty_pick', { difficulty: b.dataset.difficulty }); });
$('#langs').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button'); if (!b || b.dataset.lang === st.lang) return;
  choose(() => { st.lang = b.dataset.lang as Lang; pickIn('#langs', 'lang', st.lang); document.querySelector('.subs')!.setAttribute('dir', st.lang === 'ar' ? 'rtl' : 'ltr'); $<HTMLInputElement>('#q').dir = st.lang === 'ar' ? 'rtl' : 'auto'; }, 'lang_pick', { lang: b.dataset.lang });
});
$('#ownBtn').onclick = () => { const own = $('#own'); own.hidden = !own.hidden; if (!own.hidden) $('#ownText').focus(); };
const ownChanged = () => {
  st.product = $<HTMLTextAreaElement>('#ownText').value.trim().slice(0, 1500); st.notes = $<HTMLTextAreaElement>('#ownNotes').value.trim().slice(0, 4000);
  $('#productName').innerHTML = st.product ? `<b>Your product</b> · ${esc(st.product.slice(0, 70))}${st.notes ? ', with your notes' : ', with the sample notes'}` : '<b>ShiftPilot</b> · staff scheduling for restaurants, with technical notes (sample)';
};
$('#ownText').addEventListener('input', ownChanged); $('#ownNotes').addEventListener('input', ownChanged);
$$<HTMLButtonElement>('.info-btn').forEach((b) => (b.onclick = () => { const box = document.getElementById(b.getAttribute('aria-controls')!)!; const open = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(open)); box.hidden = !open; }));

// ---------- build it (only on the demo page): the download starts with the rep's choices ----------
$('#download')?.addEventListener('click', (e) => {
  const q = new URLSearchParams({ buyer: st.buyer, difficulty: st.difficulty, lang: st.lang });
  if (st.product) q.set('product', st.product.slice(0, 1500));
  if (st.notes) q.set('notes', st.notes.slice(0, 3000));
  (e.currentTarget as HTMLAnchorElement).href = `api/download?${q}`;
  track('download', { buyer: st.buyer, difficulty: st.difficulty, lang: st.lang });
});
$('#deploy')?.addEventListener('click', () => track('deploy_click'));
$('#github')?.addEventListener('click', () => track('github_click'));

// ---------- start ----------
function useChoices(c: Choices) {
  const press = (sel: string) => { const b = document.querySelector<HTMLButtonElement>(sel); if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); };
  press(`#buyers [data-buyer="${c.buyer}"]`); press(`#levels [data-difficulty="${c.difficulty}"]`); press(`#langs [data-lang="${c.lang}"]`);
  if (c.product) $<HTMLTextAreaElement>('#ownText').value = c.product;
  if (c.notes) $<HTMLTextAreaElement>('#ownNotes').value = c.notes;
  if (c.product || c.notes) ownChanged();
}
// choices in the address (?buyer=finance&difficulty=tough, used by embed.js) win over the server's starting choices
const fromUrl = (c: Partial<Choices> = {}) => { const q = new URLSearchParams(location.search); for (const k of ['buyer', 'difficulty', 'lang'] as const) { const v = q.get(k); if (v && /^[a-z]{2,12}$/.test(v)) (c as any)[k] = v; } return c as Choices; };
fetch('api/config').then((r) => r.json()).then(async (c) => {
  cfg = c; st.sessionSeconds = c.sessionSeconds === 0 ? 0 : Number(c.sessionSeconds) || CALL_SECONDS;
  useChoices(fromUrl({ ...(c.choices || {}) })); clock(st.sessionSeconds || CALL_SECONDS); $('#buyerTag').textContent = `${buyerInfo().name} · ${buyerInfo().title}`;
  showSaid('buyer', 'Press Start the call. When it gets technical, bring in the expert.');
  drawable = await canDraw();
}).catch(() => { drawable = false; });
const report = () => parent !== window && parent.postMessage({ type: 'spatius-embed-height', demo: 'sales-expert', height: document.documentElement.scrollHeight }, '*');
new ResizeObserver(report).observe(document.body);
