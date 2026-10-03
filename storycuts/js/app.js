import {
  SETTINGS, POSES, EXPRESSIONS, HAIR, ACCESSORIES, PROPS, EFFECTS, COLORS,
} from './constants.js';
import { drawCharacterCard } from './draw.js';
import { drawFrame, segmentAt, exportVideo, toSRT, audioGraph, ASPECTS } from './render.js';
import { runQC, normalizeScene, normalizeSegments, normalizeCharacters, newId, slug, wordsIn } from './qc.js';
import {
  planWithClaude, heuristicPlan, redoSceneWithClaude, remixScene, estimateCost, DEFAULT_MODEL,
} from './planner.js';
import { transcribeInBrowser, wordsFromText, decodeAudio, speechSpans } from './transcribe.js';
import {
  IMAGE_MODELS, STYLES, modelInfo, generateCharacterImage, generateSceneImage, estimateImageCost, getBlob, pool,
} from './images.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const label = (s) => s.replace(/_/g, ' ');

const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};

const state = {
  file: null,
  media: null,
  project: null,
  selected: null,
  aspect: 'vertical',
  history: [],
  cache: {},
};

function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

function setStatus(sel, msg, kind = '') {
  const el = $(sel);
  el.textContent = msg || '';
  el.className = `status ${kind}`;
}

function unlock(n) {
  document.querySelectorAll('[data-step]').forEach((el) => {
    if (+el.dataset.step <= n) el.classList.remove('locked');
  });
}

// ---------- media wrappers ----------

class VideoMedia {
  constructor(video) { this.video = video; }
  get el() { return this.video; }
  get time() { return this.video.currentTime; }
  get paused() { return this.video.paused; }
  get duration() { return this.video.duration; }
  seek(t) {
    return new Promise((resolve) => {
      if (Math.abs(this.video.currentTime - t) < 0.001) return resolve();
      const done = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(done, 1500);
      this.video.addEventListener('seeked', done, { once: true });
      this.video.currentTime = t;
    });
  }
  async play() { audioGraph(this.video); await this.video.play(); }
  pause() { this.video.pause(); }
  onEnded(cb) { this.video.addEventListener('ended', cb); return () => this.video.removeEventListener('ended', cb); }
}

// A stand-in "creator" for the demo: an animated presenter head that talks
// in sync with the demo transcript. It behaves like a <video> for the app.
class DemoMedia {
  constructor(duration, words) {
    this.duration = duration; this.words = words;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 720; this.canvas.height = 1280;
    this.offset = 0; this.t0 = 0; this.paused = true; this.listeners = new Set();
  }
  get time() {
    if (this.paused) return this.offset;
    const t = this.offset + (performance.now() - this.t0) / 1000;
    if (t >= this.duration) { this.offset = this.duration; this.paused = true; this.listeners.forEach((cb) => setTimeout(cb)); return this.duration; }
    return t;
  }
  get el() { this.render(this.time); return this.canvas; }
  async seek(t) { this.offset = Math.max(0, Math.min(this.duration, t)); this.t0 = performance.now(); }
  async play() {
    if (this.offset >= this.duration - 0.05) this.offset = 0;
    this.t0 = performance.now(); this.paused = false;
    clearInterval(this.iv); this.iv = setInterval(() => { if (!this.paused) this.time; else clearInterval(this.iv); }, 100);
  }
  pause() { this.offset = this.time; this.paused = true; }
  onEnded(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  render(t) {
    const c = this.canvas.getContext('2d'); const W = 720, H = 1280;
    const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#ffd6a5'); g.addColorStop(1, '#ff8fab');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    const talking = this.words.some((w) => t >= w.s && t < w.e);
    const sway = Math.sin(t * 1.3) * 8;
    c.save(); c.translate(W / 2 + sway, 0);
    c.fillStyle = '#3d348b'; c.beginPath(); c.ellipse(0, 1240, 300, 330, 0, Math.PI, 0); c.fill();
    c.fillStyle = '#f1c27d'; c.fillRect(-55, 760, 110, 120);
    c.beginPath(); c.ellipse(0, 600, 210, 250, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#2b2118'; c.beginPath(); c.ellipse(0, 420, 225, 120, 0, Math.PI, 0); c.fill();
    c.fillRect(-225, 410, 40, 140); c.fillRect(185, 410, 40, 140);
    const blink = (t % 3.7) < 0.12;
    c.fillStyle = '#1b1b1b';
    for (const ex of [-75, 75]) { c.beginPath(); c.ellipse(ex, 580, 18, blink ? 3 : 22, 0, 0, Math.PI * 2); c.fill(); }
    c.lineWidth = 9; c.lineCap = 'round'; c.strokeStyle = '#1b1b1b';
    const lift = Math.sin(t * 2.1) > 0.6 ? 12 : 0;
    c.beginPath(); c.moveTo(-105, 530 - lift); c.lineTo(-45, 525 - lift); c.moveTo(45, 525 - lift); c.lineTo(105, 530 - lift); c.stroke();
    const open = talking ? 14 + Math.abs(Math.sin(t * 17)) * 30 : 4;
    c.fillStyle = '#7a1f1f'; c.beginPath(); c.ellipse(0, 700, 55, open, 0, 0, Math.PI * 2); c.fill();
    c.restore();
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(0, 60, W, 70);
    c.fillStyle = '#fff'; c.font = '700 34px system-ui, sans-serif'; c.textAlign = 'center';
    c.fillText('DEMO · your face goes here', W / 2, 108);
  }
}

const DEMO_TEXT = `Okay, this is the worst thing I've ever done to my dad. Last Sunday I decided to surprise him with breakfast. I put the pan on the stove, and then my friend Jake texts me, so I'm on my phone for like ten minutes. Then I smell smoke. I run into the kitchen and the whole pan is on fire. And right then my dad walks into the kitchen, sees the smoke, and just freezes. He looks at me and goes, are you trying to burn the house down? And I said, no, I made you breakfast! He laughed so hard he cried. Anyway, we got pizza.`;

// ---------- project ----------

function storageKey() {
  return state.file ? `storycuts:${state.file.name}:${state.file.size}` : 'storycuts:demo';
}

function save() {
  const p = state.project;
  if (!p) return;
  store.set(storageKey(), {
    v: 1, title: p.title, duration: p.duration, words: p.words, characters: p.characters,
    segments: p.segments, settings: p.settings, approved: p.approved,
  });
}

function snapshot() {
  const p = state.project;
  state.history.push(JSON.stringify({ words: p.words, characters: p.characters, segments: p.segments, approved: p.approved }));
  if (state.history.length > 60) state.history.shift();
  $('#btn-undo').disabled = false;
}

function undo() {
  const snap = state.history.pop();
  if (!snap) return;
  Object.assign(state.project, JSON.parse(snap));
  $('#btn-undo').disabled = !state.history.length;
  afterChange(false);
  toast('Undone');
}

function afterChange(record = true) {
  save();
  if (state.project.characters?.length) renderChars();
  if (state.project.approved) { renderTimeline(); renderInspector(); }
  drawPreview();
  if (record) $('#btn-undo').disabled = !state.history.length;
}

function edit(fn) {
  snapshot();
  fn();
  afterChange();
}

function newProject(duration) {
  return {
    title: 'My story',
    duration,
    words: [],
    characters: [],
    segments: [],
    approved: false,
    settings: {
      captions: true, captionStyle: { upper: true }, punchIn: true, faceX: 0.5, faceY: 0.4, bubbleSide: 'right', watermark: false,
    },
  };
}

function restoreOrInit(duration) {
  const saved = store.get(storageKey());
  state.project = newProject(duration);
  state.history = [];
  if (saved && Math.abs((saved.duration || 0) - duration) < 0.5) {
    Object.assign(state.project, saved, { duration, settings: { ...state.project.settings, ...saved.settings } });
    toast('Picked up where you left off with this video.');
  }
  syncSettingsUI();
  renderAll();
}

function renderAll() {
  const p = state.project;
  unlock(2);
  if (p.words.length) { renderTranscript(); updateCost(); unlock(3); }
  if (p.characters.length) { renderChars(); unlock(4); }
  if (p.approved) { unlock(6); renderTimeline(); renderInspector(); }
  sizePreview();
  drawPreview();
}

// ---------- step 1: upload ----------

async function loadFile(file) {
  if (!file) return;
  if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|m4v|mkv)$/i.test(file.name)) { toast('That doesn\'t look like a video file.'); return; }
  if (!$('#rights').checked) { toast('Please confirm you have the rights to this video first.'); $('#rights').focus(); return; }
  const video = $('#video');
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = URL.createObjectURL(file);
  video.src = state.objectUrl;
  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(new Error('This browser can\'t play that video format. Try MP4 (H.264).'));
  }).catch((e) => { toast(e.message, 6000); throw e; });
  if (!Number.isFinite(video.duration)) { toast('Could not read the video length.'); return; }
  state.file = file;
  state.media = new VideoMedia(video);
  $('#video-info').classList.remove('hidden');
  $('#video-info').innerHTML = `<span class="pill">🎬 ${esc(file.name)}</span><span class="pill">${fmtTime(video.duration)}</span><span class="pill">${video.videoWidth}×${video.videoHeight}</span>`;
  $('#btn-transcribe').disabled = false;
  restoreOrInit(video.duration);
  if (video.duration > 600) toast('Long video: StoryCuts works best on stories under 5 minutes.', 6000);
  $('#step-transcript').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function loadDemo() {
  state.file = null;
  const duration = 44;
  const words = wordsFromText(DEMO_TEXT, duration, [[0.6, 43.4]]);
  state.media = new DemoMedia(duration, words);
  $('#video-info').classList.remove('hidden');
  $('#video-info').innerHTML = '<span class="pill">🎭 Demo story</span><span class="pill">0:44</span><span class="pill">transcript included</span>';
  $('#btn-transcribe').disabled = true;
  restoreOrInit(duration);
  if (!state.project.words.length) { state.project.words = words; save(); renderAll(); }
  toast('Demo loaded. Next: plan the edit.');
  $('#step-plan').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- step 2: transcript ----------

function setWords(words) {
  if (!words.length) { toast('No words found.'); return; }
  snapshot();
  state.project.words = words;
  state.cache = {};
  save();
  renderTranscript();
  updateCost();
  unlock(3);
  $('#step-plan').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function doTranscribe() {
  if (!state.file) return;
  const btn = $('#btn-transcribe');
  btn.disabled = true;
  try {
    const words = await transcribeInBrowser(state.file, {
      quality: $('#asr-quality').value,
      onStatus: (m) => setStatus('#asr-status', m, 'busy'),
    });
    setStatus('#asr-status', `Transcribed ${words.length} words.`, 'ok');
    setWords(words);
  } catch (e) {
    console.error(e);
    setStatus('#asr-status', `Automatic transcription failed (${e.message}). You can paste the transcript instead.`, 'err');
    $('#paste-box').open = true;
  } finally {
    btn.disabled = false;
  }
}

async function usePaste() {
  const text = $('#paste-text').value.trim();
  if (!text) { toast('Paste the transcript first.'); return; }
  if (!state.project) { toast('Upload a video first.'); return; }
  setStatus('#asr-status', 'Lining the words up with your audio…', 'busy');
  let spans = null;
  try { if (state.file) spans = speechSpans(await decodeAudio(state.file)); } catch { /* no audio track */ }
  const words = wordsFromText(text, state.project.duration, spans);
  setStatus('#asr-status', `Timed ${words.length} words. Timing is approximate; automatic transcription is more precise.`, 'ok');
  setWords(words);
}

function renderTranscript() {
  const el = $('#transcript');
  el.classList.remove('hidden');
  const segs = state.project.approved ? state.project.segments : [];
  el.innerHTML = state.project.words.map((w, i) => {
    const seg = segs.length ? segmentAt(segs, w.s) : null;
    return `<span data-i="${i}" class="${seg ? `w-${seg.type}` : ''}" title="${w.s.toFixed(2)}s">${esc(w.w)}</span>`;
  }).join(' ');
}

// ---------- step 3: plan ----------

function settingsGet() {
  return {
    key: store.get('storycuts:key', ''),
    model: store.get('storycuts:model', DEFAULT_MODEL),
    gemini: store.get('storycuts:gkey', ''),
    openai: store.get('storycuts:okey', ''),
    imageModel: store.get('storycuts:imodel', IMAGE_MODELS[0].id),
    style: store.get('storycuts:style', 'stick'),
    qc: store.get('storycuts:qc', true),
  };
}

function imageJobOpts() {
  const s = settingsGet();
  return {
    keys: { gemini: s.gemini, openai: s.openai, claude: s.qc ? s.key : '' },
    opts: { imageModel: s.imageModel, style: s.style, claudeModel: s.model, qc: s.qc },
    projectKey: storageKey(),
  };
}

function hasImageKey(s = settingsGet()) {
  return modelInfo(s.imageModel).provider === 'gemini' ? !!s.gemini : !!s.openai;
}

function needImageKey() {
  if (hasImageKey()) return false;
  const gem = modelInfo(settingsGet().imageModel).provider === 'gemini';
  toast(`Add your ${gem ? 'Google Gemini' : 'OpenAI'} API key in Settings to draw images with AI.`, 5000);
  openSettings();
  return true;
}

const fmtUSD = (x) => `$${x < 0.01 ? '0.01' : x.toFixed(2)}`;

function updateCost() {
  const { model } = settingsGet();
  const c = estimateCost(state.project.words, model);
  $('#cost').textContent = `≈ $${c.usd < 0.01 ? '0.01' : c.usd.toFixed(2)} in Claude usage · scenes are drawn, so no image costs`;
}

function applyPlan(raw, source) {
  snapshot();
  const p = state.project;
  p.title = raw.title || p.title;
  p.characters = raw.characters;
  p.segments = raw.segments;
  p.approved = false;
  const { report, checks, scenes } = runQC(p);
  save();
  const fixes = report.filter((r) => r.fix);
  const qc = $('#qc');
  qc.classList.remove('hidden');
  qc.innerHTML = `<div class="qc-head">✓ ${p.segments.length} shots planned by ${esc(source)} · ${scenes} illustrated · ${checks} quality checks run · ${fixes.length} auto-fixed</div>`
    + (fixes.length ? `<details><summary>What got fixed</summary><ul>${[...new Set(fixes.map((f) => f.fix))].map((f) => `<li>${esc(f)}</li>`).join('')}</ul></details>` : '');
  renderChars();
  unlock(4);
  $('#step-chars').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function planAI() {
  const { key, model } = settingsGet();
  if (!key) { toast('Add your Anthropic API key in Settings, or use the offline planner.'); openSettings(); return; }
  const btn = $('#btn-plan-ai');
  btn.disabled = true;
  setStatus('#plan-status', 'Claude is watching your story and planning the cuts… (usually 20–60s)', 'busy');
  try {
    const raw = await planWithClaude(key, state.project.words, state.project.duration, { model, notes: $('#plan-notes').value.trim() });
    const u = raw.usage || {};
    setStatus('#plan-status', `Planned by ${raw.served || model}${u.output_tokens ? ` · ${u.input_tokens} in / ${u.output_tokens} out tokens` : ''}.`, 'ok');
    applyPlan(raw, 'Claude');
  } catch (e) {
    console.error(e);
    const msg = e?.status === 401 ? 'That API key was rejected. Check it in Settings.' : e.message;
    setStatus('#plan-status', `Planning failed: ${msg}`, 'err');
  } finally {
    btn.disabled = false;
  }
}

function planQuick() {
  const raw = heuristicPlan(state.project.words, state.project.duration);
  setStatus('#plan-status', 'Planned offline with keyword rules. Claude makes much better editorial choices.', 'ok');
  applyPlan(raw, 'the offline planner');
}

// ---------- step 4: characters ----------

const opt = (list, v, fmt = label) => list.map((x) => `<option value="${esc(x)}" ${x === v ? 'selected' : ''}>${esc(fmt(x))}</option>`).join('');

function qcBadge(img) {
  if (!img?.qc) return '';
  const q = img.qc;
  return q.pass
    ? `<span class="qc-badge ok" title="${esc(q.issues.join('; '))}">✓ checked ${q.score ? `${q.score}/10` : ''}</span>`
    : `<span class="qc-badge warn" title="${esc(q.issues.join('; '))}">⚠ ${esc(q.issues[0] || 'needs a look')}</span>`;
}

async function fillImg(el, key) {
  const blob = await getBlob(key);
  if (!blob) return;
  if (el.dataset.url) URL.revokeObjectURL(el.dataset.url);
  el.dataset.url = URL.createObjectURL(blob);
  el.src = el.dataset.url;
}

function renderChars() {
  const el = $('#chars');
  const p = state.project;
  const busy = state.charBusy || new Set();
  el.innerHTML = p.characters.map((c, i) => `
    <div class="char" data-i="${i}">
      <div class="char-art">
        ${c.image?.key ? '<img alt="">' : '<canvas width="360" height="240"></canvas>'}
        ${busy.has(c.id) ? '<div class="art-busy">Drawing…</div>' : ''}
        ${c.image?.key ? qcBadge(c.image) : '<span class="qc-badge">draft</span>'}
      </div>
      <div class="char-fields">
        <input data-k="name" value="${esc(c.name)}" aria-label="Name">
        <textarea data-k="description" rows="2" placeholder="What they look like (age, hair, clothes, signature detail)">${esc(c.description)}</textarea>
        ${c.id === 'me' && state.media instanceof VideoMedia ? `<label class="check small"><input type="checkbox" data-k="useVideoLook" ${c.useVideoLook !== false ? 'checked' : ''}> Base my character on how I look in my video</label>` : ''}
        <details><summary>Colours &amp; details</summary>
          <div class="swatches">${COLORS.map((col) => `<button data-color="${col}" style="background:${col}" class="${col === c.color ? 'on' : ''}" aria-label="Shirt colour ${col}"></button>`).join('')}</div>
          <label>Hair <select data-k="hair">${opt(HAIR, c.hair)}</select></label>
          <label>Hair colour <select data-k="hairColor">${opt(['#2b2b2b', '#6b4423', '#c8a165', '#d35400', '#9e9e9e', '#e84393'], c.hairColor, (x) => ({ '#2b2b2b': 'black', '#6b4423': 'brown', '#c8a165': 'blond', '#d35400': 'ginger', '#9e9e9e': 'grey', '#e84393': 'pink' }[x]))}</select></label>
          <label>Extra <select data-k="accessory">${opt(ACCESSORIES, c.accessory)}</select></label>
          <label>Height <input type="range" data-k="height" min="0.75" max="1.25" step="0.05" value="${c.height}"></label>
        </details>
        <div class="row tight">
          <button data-redraw="${i}" ${busy.has(c.id) ? 'disabled' : ''}>${c.image?.key ? 'Redraw' : 'Draw'}</button>
          ${c.id === 'me' ? '<small class="muted">This is you</small>' : `<button class="link danger" data-del="${i}">Remove</button>`}
        </div>
      </div>
    </div>`).join('');
  el.querySelectorAll('.char').forEach((card) => {
    const ch = p.characters[+card.dataset.i];
    const img = card.querySelector('img');
    if (img) fillImg(img, ch.image.key);
    else drawCharacterCard(card.querySelector('canvas').getContext('2d'), 360, 240, ch, 0.4);
  });
  const missing = p.characters.filter((c) => !c.image?.key).length;
  const s = settingsGet();
  $('#btn-gen-chars').textContent = missing ? `Draw ${missing === p.characters.length ? 'the characters' : `${missing} missing`} with AI` : 'Redraw all characters';
  $('#chars-cost').textContent = `≈ ${fmtUSD(estimateImageCost(missing || p.characters.length, s, s.qc && !!s.key))} with ${modelInfo(s.imageModel).label.split(':')[0]}`;
  $('#btn-approve').textContent = p.approved ? 'Cast approved ✓' : 'Approve cast';
}

async function grabSelfFrame() {
  if (!(state.media instanceof VideoMedia)) return null;
  const m = state.media;
  const v = m.video;
  const back = m.time;
  const face = state.project.segments.find((sg) => sg.type === 'face');
  await m.seek(Math.min(v.duration - 0.1, (face ? face.start : 0) + 0.8));
  const c = document.createElement('canvas');
  const k = Math.min(1, 768 / Math.max(v.videoWidth, v.videoHeight));
  c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  await m.seek(back);
  return c;
}

async function drawCharacters(list) {
  if (needImageKey() || !list.length) return;
  const job = imageJobOpts();
  state.charBusy = new Set(list.map((c) => c.id));
  renderChars();
  $('#btn-gen-chars').disabled = true;
  setStatus('#chars-status', `Drawing ${list.length} character${list.length > 1 ? 's' : ''}…`, 'busy');
  const me = list.find((c) => c.id === 'me' && c.useVideoLook !== false);
  const selfFrame = me ? await grabSelfFrame().catch(() => null) : null;
  const results = await pool(list, 2, async (ch) => {
    const img = await generateCharacterImage(state.project, ch, {
      ...job, selfFrame, onStatus: (m) => setStatus('#chars-status', `${ch.name}: ${m}`, 'busy'),
    });
    snapshot();
    ch.image = img;
    state.charBusy.delete(ch.id);
    save(); renderChars();
  });
  state.charBusy = new Set();
  $('#btn-gen-chars').disabled = false;
  const failed = results.filter((r) => !r.ok);
  renderChars();
  if (failed.length) setStatus('#chars-status', `Couldn't draw ${failed.length}: ${failed[0].error.message}`, 'err');
  else {
    const scenesDrawn = state.project.segments.some((sg) => sg.image?.key);
    setStatus('#chars-status', `Done.${scenesDrawn ? ' Redraw your scenes to use the new looks.' : ' Happy with them? Approve the cast.'}`, 'ok');
  }
}

$('#btn-gen-chars').addEventListener('click', () => {
  const p = state.project;
  const missing = p.characters.filter((c) => !c.image?.key);
  drawCharacters(missing.length ? missing : p.characters);
});

$('#chars').addEventListener('input', (e) => {
  const card = e.target.closest('.char');
  const k = e.target.dataset.k;
  if (!card || !k) return;
  const ch = state.project.characters[+card.dataset.i];
  if (!state._charEditing) { snapshot(); state._charEditing = true; setTimeout(() => { state._charEditing = false; }, 800); }
  ch[k] = k === 'height' ? +e.target.value : k === 'useVideoLook' ? e.target.checked : e.target.value;
  const cv = card.querySelector('canvas');
  if (cv) drawCharacterCard(cv.getContext('2d'), 360, 240, ch, 0.4);
  save();
  drawPreview();
});

$('#chars').addEventListener('click', (e) => {
  const card = e.target.closest('.char');
  if (!card) return;
  const i = +card.dataset.i;
  if (e.target.dataset.color) {
    edit(() => { state.project.characters[i].color = e.target.dataset.color; });
  } else if (e.target.dataset.redraw) {
    drawCharacters([state.project.characters[i]]);
  } else if (e.target.dataset.del) {
    const ch = state.project.characters[i];
    edit(() => {
      state.project.characters.splice(i, 1);
      state.project.segments.forEach((sg) => {
        if (sg.scene) sg.scene.actors = sg.scene.actors.filter((a) => a.character_id !== ch.id);
      });
      state.project.segments = normalizeSegments(state.project.segments, state.project.characters, state.project.duration);
    });
  }
});

$('#btn-add-char').addEventListener('click', () => {
  const name = prompt('Character name (e.g. "Grandma", "Jake")');
  if (!name) return;
  edit(() => {
    const p = state.project;
    let id = slug(name);
    while (p.characters.some((c) => c.id === id)) id += '_2';
    p.characters.push({
      id, name, description: '', color: COLORS[p.characters.length % COLORS.length], hair: HAIR[(p.characters.length * 2) % HAIR.length],
      hairColor: '#2b2b2b', accessory: 'none', height: 1,
    });
  });
});

$('#btn-approve').addEventListener('click', () => {
  edit(() => {
    const p = state.project;
    p.characters = normalizeCharacters(p.characters);
    p.segments = normalizeSegments(p.segments, p.characters, p.duration);
    p.approved = true;
  });
  renderTranscript();
  unlock(6);
  if (!state.selected) state.selected = state.project.segments.find((s) => s.type !== 'face')?.id;
  renderTimeline(); renderInspector();
  sizePreview(); drawPreview();
  $('#step-review').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ---------- step 5: scene images ----------

const sceneSegs = () => state.project.segments.filter((sg) => sg.type !== 'face' && sg.scene);
const needsImage = (sg) => !sg.image?.key || sg.image.stale;

function updateSceneBar() {
  if (!state.project?.approved) return;
  const s = settingsGet();
  const todo = sceneSegs().filter(needsImage).length;
  const all = sceneSegs().length;
  const btn = $('#btn-gen-scenes');
  if (state.genAbort) btn.textContent = 'Stop generating';
  else btn.textContent = todo ? `Generate ${todo === all ? 'all' : todo} scene image${todo === 1 ? '' : 's'}` : 'All scenes drawn ✓ (redraw all)';
  $('#scenes-cost').textContent = `${all} illustrated shots · ≈ ${fmtUSD(estimateImageCost(todo || all, s, s.qc && !!s.key))}${s.qc && s.key ? ' incl. Claude quality checks' : s.qc ? ' · add a Claude key to auto-check images' : ''}`;
}

async function generateScenes(list, note = '') {
  if (needImageKey() || !list.length) return;
  const job = imageJobOpts();
  const ac = { stop: false };
  state.genAbort = ac;
  state.cache.pending = new Set(list.map((sg) => sg.id));
  updateSceneBar(); renderTimeline();
  const bar = $('#gen-progress');
  bar.classList.remove('hidden');
  let done = 0;
  const aspect = state.aspect === 'vertical' ? '9:16' : '16:9';
  setStatus('#scenes-status', `Drawing ${list.length} scene${list.length > 1 ? 's' : ''} (${aspect})…`, 'busy');
  const results = await pool(list, 3, async (sg) => {
    if (ac.stop) throw new Error('stopped');
    try {
      const img = await generateSceneImage(state.project, sg, {
        ...job, aspect, note,
        onStatus: (m) => { if (sg.id === state.selected) setStatus('#redo-status', m, 'busy'); },
      });
      sg.image = img;
      save();
    } finally {
      state.cache.pending.delete(sg.id);
      done++;
      bar.firstElementChild.style.width = `${(done / list.length) * 100}%`;
      setStatus('#scenes-status', `Drew ${done} of ${list.length}…`, 'busy');
      renderTimeline();
      if (sg.id === state.selected) renderInspector();
      drawPreview();
    }
  });
  state.genAbort = null;
  bar.classList.add('hidden');
  const failed = results.filter((r) => !r.ok && r.error.message !== 'stopped');
  const flagged = list.filter((sg) => sg.image?.qc && !sg.image.qc.pass).length;
  const redrawn = list.filter((sg) => sg.image?.attempts > 1).length;
  if (failed.length) setStatus('#scenes-status', `${list.length - failed.length} drawn, ${failed.length} failed: ${failed[0].error.message}`, 'err');
  else if (ac.stop) setStatus('#scenes-status', 'Stopped.', '');
  else setStatus('#scenes-status', `All ${list.length} drawn.${redrawn ? ` ${redrawn} auto-redrawn after failing the quality check.` : ''}${flagged ? ` ${flagged} still flagged (⚠ on the timeline): take a look.` : ''}`, flagged ? '' : 'ok');
  updateSceneBar();
  renderInspector();
}

$('#btn-gen-scenes').addEventListener('click', () => {
  if (state.genAbort) { state.genAbort.stop = true; toast('Finishing the images already in progress…'); return; }
  const todo = sceneSegs().filter(needsImage);
  const list = todo.length ? todo : sceneSegs();
  const s = settingsGet();
  if (!hasImageKey(s)) { needImageKey(); return; }
  if (!todo.length && !confirm(`Redraw all ${list.length} scenes? ≈ ${fmtUSD(estimateImageCost(list.length, s, s.qc && !!s.key))}`)) return;
  generateScenes(list);
});

// ---------- step 5: preview + timeline ----------

function sizePreview() {
  const { w, h } = ASPECTS[state.aspect];
  const c = $('#preview');
  const scale = state.aspect === 'vertical' ? 0.5 : 0.5;
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  $('#stage').dataset.aspect = state.aspect;
}

function drawPreview() {
  const p = state.project;
  if (!p || !p.approved || !state.media || !p.segments.length) return;
  const c = $('#preview');
  const t = Math.min(state.media.time, p.duration - 0.001);
  state.cache.preview = true;
  state.cache.onImage = () => requestAnimationFrame(drawPreview);
  const seg = drawFrame(c.getContext('2d'), c.width, c.height, t, p, state.media.el, state.cache);
  $('#time').textContent = `${fmtTime(t)} / ${fmtTime(p.duration)}`;
  if (!state.scrubbing) $('#scrub').value = Math.round((t / p.duration) * 1000);
  $('#playhead').style.left = `${(t / p.duration) * 100}%`;
  document.querySelectorAll('.block').forEach((b) => b.classList.toggle('live', b.dataset.id === seg.id));
}

function loop() {
  drawPreview();
  if (state.media && !state.media.paused) requestAnimationFrame(loop);
  else $('#btn-play').textContent = '▶';
}

async function togglePlay() {
  const m = state.media;
  if (!m) return;
  if (m.paused) {
    if (m.time >= state.project.duration - 0.05) await m.seek(0);
    await m.play();
    $('#btn-play').textContent = '❚❚';
    loop();
  } else {
    m.pause();
  }
}

function shotText(seg) {
  return wordsIn(state.project.words, seg.start, seg.end).map((w) => w.w).join(' ');
}

function renderTimeline() {
  const p = state.project;
  const el = $('#timeline');
  el.querySelectorAll('.block').forEach((b) => b.remove());
  p.segments.forEach((s) => {
    const b = document.createElement('button');
    const st = s.type === 'face' ? '' : state.cache.pending?.has(s.id) ? 'pending' : !s.image?.key ? 'noimg' : s.image.qc && !s.image.qc.pass ? 'warn' : s.image.stale ? 'stale' : 'hasimg';
    b.className = `block ${s.type} ${st} ${s.id === state.selected ? 'sel' : ''}`;
    b.dataset.id = s.id;
    b.style.left = `${(s.start / p.duration) * 100}%`;
    b.style.width = `${((s.end - s.start) / p.duration) * 100}%`;
    b.title = `${fmtTime(s.start)} ${label(s.type)}: ${shotText(s)}`;
    b.textContent = shotText(s).split(' ').slice(0, 3).join(' ');
    el.appendChild(b);
  });
  renderTranscript();
  updateSceneBar();
}

$('#timeline').addEventListener('click', async (e) => {
  const b = e.target.closest('.block');
  if (!b) return;
  select(b.dataset.id, true);
});

async function select(id, seek) {
  state.selected = id;
  const seg = state.project.segments.find((s) => s.id === id);
  document.querySelectorAll('.block').forEach((b) => b.classList.toggle('sel', b.dataset.id === id));
  renderInspector();
  if (seek && seg && state.media) {
    await state.media.seek(Math.min(seg.start + 0.25 * Math.min(1, seg.end - seg.start), state.project.duration));
    drawPreview();
  }
}

function renderInspector() {
  const p = state.project;
  const el = $('#inspector');
  const i = p.segments.findIndex((s) => s.id === state.selected);
  const seg = p.segments[i];
  if (!seg) { el.innerHTML = '<p class="muted">Select a shot on the timeline.</p>'; return; }
  const sc = seg.scene;
  const charOpts = (v) => p.characters.map((c) => `<option value="${esc(c.id)}" ${c.id === v ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  el.innerHTML = `
    <div class="insp-head">
      <strong>Shot ${i + 1} of ${p.segments.length}</strong>
      <span class="muted">${fmtTime(seg.start)}–${fmtTime(seg.end)} · ${(seg.end - seg.start).toFixed(1)}s</span>
    </div>
    <blockquote>“${esc(shotText(seg))}”</blockquote>
    ${seg.reason ? `<p class="muted small">Editor's note: ${esc(seg.reason)}</p>` : ''}
    <div class="seg-types" role="radiogroup">
      ${['face', 'scene', 'scene_bubble'].map((t) => `<button data-type="${t}" class="tag ${t} ${seg.type === t ? 'on' : ''}">${{ face: 'Your face', scene: 'Scene', scene_bubble: 'Scene + face' }[t]}</button>`).join('')}
    </div>
    <div class="grid2 tight">
      <label class="field">Starts at (s)<input type="number" step="0.1" data-f="start" value="${seg.start.toFixed(2)}" ${i === 0 ? 'disabled' : ''}></label>
      <label class="field">Ends at (s)<input type="number" step="0.1" data-f="end" value="${seg.end.toFixed(2)}" ${i === p.segments.length - 1 ? 'disabled' : ''}></label>
    </div>
    <div class="row">
      <button data-act="split">Split at playhead</button>
      <button data-act="merge" ${i === p.segments.length - 1 ? 'disabled' : ''}>Merge with next</button>
    </div>
    ${seg.type === 'face' || !sc ? '' : `
    <hr>
    <div class="shot-img">
      ${seg.image?.key ? '<img alt="Scene illustration">' : `<div class="noimg">${state.cache.pending?.has(seg.id) ? 'Drawing…' : 'No AI image yet: the preview shows a quick draft.'}</div>`}
      ${seg.image?.key ? qcBadge(seg.image) : ''}
    </div>
    ${seg.image?.qc && !seg.image.qc.pass ? `<p class="small warn-text">Quality check: ${esc(seg.image.qc.issues.join('; '))}</p>` : ''}
    ${seg.image?.attempts > 1 ? `<p class="small muted">Auto-redrawn ${seg.image.attempts - 1}× after failing the quality check.</p>` : ''}
    ${seg.image?.stale ? '<p class="small muted">You changed this scene since it was drawn. Redraw to update it.</p>' : ''}
    <label class="field">What the image shows
      <textarea data-s="image_prompt" rows="3" placeholder="Who is where, doing what, with which expressions">${esc(sc.image_prompt || '')}</textarea>
    </label>
    <div class="field">Characters in this shot
      <div class="chips">${sc.actors.map((a, k) => `<span class="chip">${esc(p.characters.find((c) => c.id === a.character_id)?.name || a.character_id)}<button data-a="remove" data-k="${k}" aria-label="remove">✕</button></span>`).join('')}
        ${sc.actors.length < 4 ? `<select data-act="add-cast"><option value="">+ add</option>${p.characters.filter((c) => !sc.actors.some((a) => a.character_id === c.id)).map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select>` : ''}
      </div>
    </div>
    <label class="field">Sound effect overlay <input data-s="sound_effect" value="${esc(sc.sound_effect)}" maxlength="12" placeholder="e.g. CRASH!"></label>
    <div class="row">
      <input id="redo-note" placeholder="What should change? e.g. make dad look more shocked" class="grow">
    </div>
    <div class="row">
      <button class="primary" data-act="redraw" ${state.cache.pending?.has(seg.id) ? 'disabled' : ''}>${seg.image?.key ? 'Redraw image' : 'Draw this scene'}</button>
      <button data-act="redo-ai">Rewrite scene with Claude</button>
    </div>
    <div class="status" id="redo-status"></div>
    <details class="draft">
      <summary>Draft drawing details</summary>
      <label class="field">Setting <select data-s="setting">${opt(SETTINGS, sc.setting)}</select></label>
      <div class="actors">
        ${sc.actors.map((a, k) => `
          <div class="actor" data-k="${k}">
            <select data-a="character_id" aria-label="Character">${charOpts(a.character_id)}</select>
            <select data-a="pose" aria-label="Pose">${opt(POSES, a.pose)}</select>
            <select data-a="expression" aria-label="Expression">${opt(EXPRESSIONS, a.expression)}</select>
            <button data-a="facing" title="Flip direction">${a.facing === 'left' ? '←' : '→'}</button>
            <input type="range" data-a="x" min="0.1" max="0.9" step="0.01" value="${a.x}" aria-label="Position">
            <input data-a="speech" placeholder="speech bubble" value="${esc(a.speech)}" maxlength="60">
          </div>`).join('')}
      </div>
      <label class="field">Props
        <div class="chips">${sc.props.map((pr, k) => `<span class="chip">${esc(label(pr.kind))}<button data-rmprop="${k}" aria-label="remove">✕</button></span>`).join('')}
          ${sc.props.length < 3 ? `<select data-act="add-prop"><option value="">+ prop</option>${opt(PROPS, '')}</select>` : ''}</div>
      </label>
      <div class="field">Effects
        <div class="chips">${EFFECTS.map((ef) => `<label class="chip toggle ${sc.effects.includes(ef) ? 'on' : ''}"><input type="checkbox" data-effect="${ef}" ${sc.effects.includes(ef) ? 'checked' : ''}>${esc(label(ef))}</label>`).join('')}</div>
      </div>
      <div class="row"><button data-act="remix">Surprise me (draft)</button></div>
    </details>`}
  `;
  const img = el.querySelector('.shot-img img');
  if (img) fillImg(img, seg.image.key);
  const det = el.querySelector('details.draft');
  if (det) { det.open = !!state.draftOpen; det.addEventListener('toggle', () => { state.draftOpen = det.open; }); }
}

function currentSeg() {
  return state.project.segments.find((s) => s.id === state.selected);
}

function defaultSceneFor(seg) {
  const p = state.project;
  const i = p.segments.indexOf(seg);
  const near = [...p.segments.slice(0, i).reverse(), ...p.segments.slice(i + 1)].find((s) => s.scene);
  if (near) return { ...JSON.parse(JSON.stringify(near.scene)), sound_effect: '' };
  return { setting: 'blank', actors: [{ character_id: 'me', x: 0.5, pose: 'stand', expression: 'neutral', facing: 'right', speech: '' }], props: [], effects: [], sound_effect: '' };
}

function setBoundary(i, t) {
  const segs = state.project.segments;
  if (i <= 0 || i >= segs.length) return;
  const lo = segs[i - 1].start + 0.5, hi = segs[i].end - 0.5;
  if (lo > hi) return;
  const v = Math.min(hi, Math.max(lo, t));
  segs[i].start = v; segs[i - 1].end = v;
}

const inspector = $('#inspector');

inspector.addEventListener('click', async (e) => {
  const seg = currentSeg();
  if (!seg) return;
  const p = state.project;
  const i = p.segments.indexOf(seg);
  const t = e.target;
  if (t.dataset.type) {
    edit(() => {
      seg.type = t.dataset.type;
      if (seg.type !== 'face' && !seg.scene) seg.scene = defaultSceneFor(seg);
    });
    return;
  }
  const act = t.dataset.act;
  if (t.dataset.a === 'facing') {
    const k = +t.closest('.actor').dataset.k;
    edit(() => { const a = seg.scene.actors[k]; a.facing = a.facing === 'left' ? 'right' : 'left'; seg.scene.keepFacing = true; });
  } else if (t.dataset.a === 'remove') {
    const k = +t.dataset.k;
    if (seg.scene.actors.length <= 1) { toast('A scene needs at least one character.'); return; }
    edit(() => { seg.scene.actors.splice(k, 1); seg.scene = normalizeScene(seg.scene, p.characters); markStale(seg); });
  } else if (t.dataset.rmprop) {
    edit(() => { seg.scene.props.splice(+t.dataset.rmprop, 1); });
  } else if (act === 'add-actor') {
    const used = new Set(seg.scene.actors.map((a) => a.character_id));
    const ch = p.characters.find((c) => !used.has(c.id));
    if (!ch) { toast('Everyone is already in this scene.'); return; }
    edit(() => {
      seg.scene.actors.push({ character_id: ch.id, x: 0.8, pose: 'stand', expression: 'neutral', facing: 'left', speech: '' });
      seg.scene = normalizeScene(seg.scene, p.characters);
    });
  } else if (act === 'split') {
    const now = state.media.time;
    if (now < seg.start + 0.5 || now > seg.end - 0.5) { toast('Move the playhead inside this shot (at least 0.5s from either end) to split.'); return; }
    edit(() => {
      const copy = JSON.parse(JSON.stringify(seg));
      copy.id = newId(); copy.start = now; copy.reason = 'Split from the previous shot.';
      seg.end = now;
      p.segments.splice(i + 1, 0, copy);
    });
  } else if (act === 'merge') {
    edit(() => { const next = p.segments[i + 1]; seg.end = next.end; p.segments.splice(i + 1, 1); });
  } else if (act === 'remix') {
    edit(() => { seg.scene = normalizeScene(remixScene(seg.scene), p.characters); });
  } else if (act === 'redraw') {
    generateScenes([seg], $('#redo-note')?.value.trim());
  } else if (act === 'redo-ai') {
    const { key, model } = settingsGet();
    if (!key) { toast('Add your Anthropic API key in Settings to rewrite scenes with Claude.'); openSettings(); return; }
    t.disabled = true;
    setStatus('#redo-status', 'Claude is rewriting this scene…', 'busy');
    try {
      const scene = await redoSceneWithClaude(key, p, seg, $('#redo-note')?.value.trim(), { model });
      edit(() => { seg.scene = normalizeScene(scene, p.characters); markStale(seg); });
      if (hasImageKey()) generateScenes([seg]);
      else toast('New scene written. Add an image key in Settings to draw it.');
    } catch (err) {
      console.error(err);
      setStatus('#redo-status', `Couldn't rewrite: ${err.message}`, 'err');
      t.disabled = false;
    }
  }
});

function markStale(seg) {
  if (seg.image?.key) seg.image.stale = true;
}

inspector.addEventListener('change', (e) => {
  const seg = currentSeg();
  if (!seg) return;
  const p = state.project;
  const i = p.segments.indexOf(seg);
  const t = e.target;
  if (t.dataset.f === 'start') edit(() => setBoundary(i, +t.value));
  else if (t.dataset.f === 'end') edit(() => setBoundary(i + 1, +t.value));
  else if (t.dataset.s) edit(() => { seg.scene[t.dataset.s] = t.value; seg.scene = normalizeScene(seg.scene, p.characters); if (t.dataset.s === 'image_prompt') markStale(seg); });
  else if (t.dataset.act === 'add-cast' && t.value) {
    edit(() => {
      seg.scene.actors.push({ character_id: t.value, x: 0.8, pose: 'stand', expression: 'neutral', facing: 'left', speech: '' });
      seg.scene = normalizeScene(seg.scene, p.characters);
      markStale(seg);
    });
  }
  else if (t.dataset.act === 'add-prop' && t.value) edit(() => { seg.scene.props.push({ kind: t.value, x: seg.scene.props.length ? 0.12 : 0.86 }); });
  else if (t.dataset.effect) {
    edit(() => {
      const ef = t.dataset.effect;
      seg.scene.effects = t.checked ? [...seg.scene.effects, ef].slice(-3) : seg.scene.effects.filter((x) => x !== ef);
    });
  } else if (t.dataset.a && t.dataset.a !== 'x') {
    const k = +t.closest('.actor').dataset.k;
    edit(() => { seg.scene.actors[k][t.dataset.a] = t.value; if (t.dataset.a === 'character_id') seg.scene = normalizeScene(seg.scene, p.characters); });
  } else if (t.dataset.a === 'x') {
    save(); renderInspector();
  }
});

inspector.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.a !== 'x') return;
  const seg = currentSeg();
  const k = +t.closest('.actor').dataset.k;
  if (!state._dragging) { snapshot(); state._dragging = true; t.addEventListener('change', () => { state._dragging = false; }, { once: true }); }
  seg.scene.actors[k].x = +t.value;
  drawPreview();
});

// ---------- step 6: export ----------

function syncSettingsUI() {
  const s = state.project.settings;
  $('#opt-captions').checked = !!s.captions;
  $('#opt-upper').checked = !!s.captionStyle?.upper;
  $('#opt-punch').checked = !!s.punchIn;
  $('#opt-bubble-left').checked = s.bubbleSide === 'left';
  $('#opt-watermark').checked = !!s.watermark;
  $('#face-x').value = s.faceX ?? 0.5;
}

function readSettingsUI() {
  const s = state.project.settings;
  s.captions = $('#opt-captions').checked;
  s.captionStyle = { ...(s.captionStyle || {}), upper: $('#opt-upper').checked };
  s.punchIn = $('#opt-punch').checked;
  s.bubbleSide = $('#opt-bubble-left').checked ? 'left' : 'right';
  s.watermark = $('#opt-watermark').checked;
  s.faceX = +$('#face-x').value;
  save(); drawPreview();
}
['#opt-captions', '#opt-upper', '#opt-punch', '#opt-bubble-left', '#opt-watermark', '#face-x'].forEach((sel) => $(sel).addEventListener('input', () => state.project && readSettingsUI()));

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

const baseName = () => (state.file ? state.file.name.replace(/\.[^.]+$/, '') : 'storycuts-demo');

async function doExport() {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) { toast('This browser can\'t record video. Try Chrome, Edge or Safari 17+.', 6000); return; }
  const btn = $('#btn-export');
  if (state.exporting) { state.exporting.abort(); return; }
  const ac = new AbortController();
  state.exporting = ac;
  btn.textContent = 'Cancel export';
  const bar = $('#ex-progress');
  bar.classList.remove('hidden');
  setStatus('#ex-status', 'Rendering… keep this tab open and in front.', 'busy');
  try {
    if (!state.media.paused) state.media.pause();
    const aspect = $('#ex-aspect').value;
    const { blob, ext } = await exportVideo(state.project, state.media, {
      aspect, signal: ac.signal, onProgress: (f) => { bar.firstElementChild.style.width = `${Math.min(100, f * 100).toFixed(1)}%`; },
    });
    if (ac.signal.aborted) { setStatus('#ex-status', 'Export cancelled.', ''); return; }
    download(blob, `${baseName()}-storycuts-${aspect}.${ext}`);
    setStatus('#ex-status', `Done: ${(blob.size / 1e6).toFixed(1)} MB ${ext.toUpperCase()}.${ext === 'webm' ? ' (Your browser records WebM; TikTok and YouTube accept it, or convert to MP4 with any converter.)' : ''}`, 'ok');
  } catch (e) {
    console.error(e);
    setStatus('#ex-status', `Export failed: ${e.message}`, 'err');
  } finally {
    state.exporting = null;
    btn.textContent = 'Export video';
  }
}

function saveProjectFile() {
  const p = state.project;
  const blob = new Blob([JSON.stringify({ app: 'storycuts', v: 1, video: state.file?.name || 'demo', ...p }, null, 1)], { type: 'application/json' });
  download(blob, `${baseName()}.storycuts.json`);
}

async function loadProjectFile(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'storycuts') throw new Error('Not a StoryCuts project file.');
    if (!state.project) { toast(`Upload the matching video first (${data.video}).`); return; }
    if (Math.abs(data.duration - state.project.duration) > 0.5) toast(`Heads up: this project was made for a different video (${data.video}).`, 6000);
    snapshot();
    const { words, characters, segments, settings, approved, title } = data;
    Object.assign(state.project, { words, characters, segments, settings: { ...state.project.settings, ...settings }, approved, title });
    runQC(state.project);
    save(); syncSettingsUI(); renderAll();
    toast('Project loaded.');
  } catch (e) {
    toast(`Couldn't open that project: ${e.message}`, 5000);
  }
}

// ---------- settings ----------

function openSettings() {
  const s = settingsGet();
  $('#api-key').value = s.key;
  $('#model').value = s.model;
  $('#gemini-key').value = s.gemini;
  $('#openai-key').value = s.openai;
  $('#image-model').innerHTML = IMAGE_MODELS.map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join('');
  $('#image-model').value = s.imageModel;
  $('#art-style').innerHTML = Object.entries(STYLES).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
  $('#art-style').value = s.style;
  $('#opt-qc').checked = s.qc;
  $('#settings').showModal();
}

$('#settings').addEventListener('close', () => {
  if ($('#settings').returnValue === 'save') {
    const before = settingsGet().style;
    store.set('storycuts:key', $('#api-key').value.trim());
    store.set('storycuts:model', $('#model').value);
    store.set('storycuts:gkey', $('#gemini-key').value.trim());
    store.set('storycuts:okey', $('#openai-key').value.trim());
    store.set('storycuts:imodel', $('#image-model').value);
    store.set('storycuts:style', $('#art-style').value);
    store.set('storycuts:qc', $('#opt-qc').checked);
    if (state.project?.words.length) updateCost();
    if (state.project?.characters.length) renderChars();
    updateSceneBar();
    toast(before !== $('#art-style').value && state.project?.characters.some((c) => c.image)
      ? 'Saved. New art style: redraw characters, then scenes.' : 'Settings saved in this browser.', 4500);
  }
});

// ---------- wiring ----------

$('#file').addEventListener('change', (e) => loadFile(e.target.files[0]).catch(() => {}));
const drop = $('#drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]).catch(() => {}));
$('#btn-demo').addEventListener('click', loadDemo);
$('#btn-transcribe').addEventListener('click', doTranscribe);
$('#btn-use-paste').addEventListener('click', usePaste);
$('#transcript').addEventListener('click', async (e) => {
  const i = e.target.dataset.i;
  if (i == null || !state.media) return;
  const w = state.project.words[+i];
  await state.media.seek(w.s);
  if (state.project.approved) select(segmentAt(state.project.segments, w.s).id, false);
  drawPreview();
});
$('#btn-plan-ai').addEventListener('click', planAI);
$('#btn-plan-quick').addEventListener('click', planQuick);
$('#btn-play').addEventListener('click', togglePlay);
$('#scrub').addEventListener('input', async (e) => {
  state.scrubbing = true;
  await state.media?.seek((+e.target.value / 1000) * state.project.duration);
  drawPreview();
  state.scrubbing = false;
});
document.querySelectorAll('.aspect-toggle button').forEach((b) => b.addEventListener('click', () => {
  state.aspect = b.dataset.aspect;
  document.querySelectorAll('.aspect-toggle button').forEach((x) => x.classList.toggle('on', x === b));
  $('#ex-aspect').value = state.aspect;
  sizePreview(); drawPreview();
}));
$('#ex-aspect').addEventListener('change', (e) => {
  state.aspect = e.target.value;
  document.querySelectorAll('.aspect-toggle button').forEach((x) => x.classList.toggle('on', x.dataset.aspect === state.aspect));
  sizePreview(); drawPreview();
});
$('#btn-export').addEventListener('click', doExport);
$('#btn-srt').addEventListener('click', () => state.project?.words.length && download(new Blob([toSRT(state.project.words)], { type: 'text/plain' }), `${baseName()}.srt`));
$('#btn-save').addEventListener('click', saveProjectFile);
$('#load-project').addEventListener('change', (e) => e.target.files[0] && loadProjectFile(e.target.files[0]));
$('#btn-settings').addEventListener('click', openSettings);
$('#btn-undo').addEventListener('click', undo);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); undo(); }
  if (e.key === ' ' && state.project?.approved && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement.tagName)) { e.preventDefault(); togglePlay(); }
});
$('#video').addEventListener('seeked', drawPreview);
sizePreview();

// test hook
window.__storycuts = { state, loadDemo, planQuick };
