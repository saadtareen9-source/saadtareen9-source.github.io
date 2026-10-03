import { drawFrame, segmentAt, exportVideo, toSRT, audioGraph, setMix, ASPECTS, shotType } from './render.js';
import { SFX, sfxInfo, SfxPlayer } from './sfx.js';
import { runQC, normalizeScene, normalizeSegments, normalizeCharacters, newId, slug, wordsIn } from './qc.js';
import { planWithClaude, redoSceneWithClaude, estimateCost, DEFAULT_MODEL } from './planner.js';
import { transcribeInBrowser, wordsFromText, wordsFromSubtitles, decodeAudio, speechSpans } from './transcribe.js';
import {
  IMAGE_MODELS, STYLES, modelInfo, storageProblem, generateCharacterImage, generateSceneImage, estimateImageCost, getBlob, putBlob, pool, orderForConsistency, loadStyleManifest,
} from './images.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const fmtUSD = (x) => `$${x < 0.01 ? '0.01' : x.toFixed(2)}`;
const errText = (e) => `${e?.name && !['Error', 'TypeError'].includes(e.name) ? `${e.name}: ` : ''}${e?.message || e}`;
const icon = (id) => `<svg><use href="#i-${id}"/></svg>`;

const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};

const STORAGE_WARN = 'Your browser wouldn\'t let StoryCuts save the pictures, so they\'ll be lost if you close this tab. Use a normal (not private) Chrome window to keep them.';

const state = {
  file: null,
  media: null,
  project: null,
  selected: null,
  aspect: 'vertical',
  history: [],
  cache: {},
  busy: false,
  sfxPlayer: new SfxPlayer(),
};

function toast(msg, ms = 3400) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

function setStatus(sel, msg, kind = '') {
  const el = $(sel);
  if (!el) return;
  el.textContent = msg || '';
  el.className = `status ${kind}`;
}

function scrollTo(sel) {
  setTimeout(() => $(sel)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
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

// Stand-in "creator" for the demo story: an animated presenter that talks
// in sync with the demo transcript. Behaves like a <video> for the app.
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
    c.fillStyle = '#fff'; c.font = '700 34px Inter, system-ui, sans-serif'; c.textAlign = 'center';
    c.fillText('DEMO · your face goes here', W / 2, 108);
  }
}

const DEMO_TEXT = `Okay, this is the worst thing I've ever done to my dad. Last Sunday I decided to surprise him with breakfast. I put the pan on the stove, and then my friend Jake texts me, so I'm on my phone for like ten minutes. Then I smell smoke. I run into the kitchen and the whole pan is on fire. And right then my dad walks into the kitchen, sees the smoke, and just freezes. He looks at me and goes, are you trying to burn the house down? And I said, no, I made you breakfast! He laughed so hard he cried. Anyway, we got pizza.`;

// ---------- settings (keys live in this browser only) ----------

function settingsGet() {
  return {
    key: store.get('storycuts:key', ''),
    model: store.get('storycuts:model', DEFAULT_MODEL),
    gemini: store.get('storycuts:gkey', ''),
    openai: store.get('storycuts:okey', ''),
    imageModel: store.get('storycuts:imodel', IMAGE_MODELS[0].id),
    qc: store.get('storycuts:qc', true),
  };
}

const hasImageKey = (s = settingsGet()) => (modelInfo(s.imageModel).provider === 'gemini' ? !!s.gemini : !!s.openai);
const keysReady = (s = settingsGet()) => !!s.key && hasImageKey(s);

function updateKeysDot() {
  $('#keys-dot').classList.toggle('ok', keysReady());
}

function openSettings() {
  const s = settingsGet();
  $('#api-key').value = s.key;
  $('#model').value = s.model;
  $('#gemini-key').value = s.gemini;
  $('#openai-key').value = s.openai;
  $('#image-model').innerHTML = IMAGE_MODELS.map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join('');
  $('#image-model').value = s.imageModel;
  $('#opt-qc').checked = s.qc;
  $('#settings').showModal();
  setTimeout(() => (s.key ? (s.openai ? null : $('#openai-key')) : $('#api-key'))?.focus(), 50);
}

$('#settings').addEventListener('close', () => {
  if ($('#settings').returnValue !== 'save') return;
  store.set('storycuts:key', $('#api-key').value.trim());
  store.set('storycuts:model', $('#model').value);
  store.set('storycuts:gkey', $('#gemini-key').value.trim());
  store.set('storycuts:okey', $('#openai-key').value.trim());
  store.set('storycuts:imodel', $('#image-model').value);
  store.set('storycuts:qc', $('#opt-qc').checked);
  updateKeysDot();
  if (state.project) { updateCosts(); renderChars(); }
  toast(keysReady() ? 'Keys saved. You\'re ready to create.' : 'Saved. You still need both a Claude and an OpenAI key.');
});

function imageJobOpts() {
  const s = settingsGet();
  return {
    keys: { gemini: s.gemini, openai: s.openai, claude: s.qc ? s.key : '' },
    opts: { imageModel: s.imageModel, style: state.project.settings.style, claudeModel: s.model, qc: s.qc },
    projectKey: storageKey(),
  };
}

// ---------- project ----------

function storageKey() {
  return state.file ? `storycuts:${state.file.name}:${state.file.size}` : 'storycuts:demo';
}

function save() {
  const p = state.project;
  if (!p) return;
  store.set(storageKey(), {
    v: 2, title: p.title, duration: p.duration, words: p.words, characters: p.characters, locations: p.locations, sfx: p.sfx,
    segments: p.segments, settings: p.settings, approved: p.approved,
  });
}

function snapshot() {
  const p = state.project;
  state.history.push(JSON.stringify({ words: p.words, characters: p.characters, locations: p.locations, sfx: p.sfx, segments: p.segments, approved: p.approved }));
  if (state.history.length > 60) state.history.shift();
  $('#btn-undo').disabled = false;
}

function undo() {
  const snap = state.history.pop();
  if (!snap) return;
  Object.assign(state.project, JSON.parse(snap));
  $('#btn-undo').disabled = !state.history.length;
  refresh();
  toast('Undone');
}

function edit(fn) {
  snapshot();
  fn();
  save();
  refresh();
}

function defaultSettings() {
  return {
    style: store.get('storycuts:style', 'stick'),
    aspect: 'vertical',
    faceMode: 'full',
    pacing: 'mostly',
    castHints: [],
    captions: true, captionStyle: { upper: true }, punchIn: true, faceX: 0.5, faceY: 0.4, bubbleSide: 'right', watermark: false,
  };
}

function loadProject(duration) {
  const saved = store.get(storageKey());
  state.project = { title: 'My story', duration, words: [], characters: [], locations: [], sfx: [], segments: [], approved: false, settings: defaultSettings() };
  state.peaks = undefined;
  faceThumbs.clear();
  state.history = [];
  state.selected = null;
  state.cache = {};
  if (saved && Math.abs((saved.duration || 0) - duration) < 0.5) {
    Object.assign(state.project, saved, { duration, settings: { ...defaultSettings(), ...saved.settings } });
    if (saved.segments?.length) toast('Picked up where you left off with this video.');
  }
  state.aspect = state.project.settings.aspect || 'vertical';
  syncOptionsUI();
  refresh();
}

/** Re-render everything that depends on the project. */
function refresh() {
  const p = state.project;
  if (!p) return;
  document.body.classList.toggle('bubble-mode', p.settings.faceMode === 'bubble');
  ['#panel-style', '#panel-create'].forEach((s) => $(s).classList.remove('locked'));
  $('#panel-editor').classList.toggle('locked', !p.approved);
  $('#cast').classList.toggle('hidden', !p.characters.length);
  $('#btn-reset').hidden = !p.segments.length;
  renderPipeline();
  renderStepper();
  if (p.characters.length) renderChars();
  if (p.approved) { renderTimeline(); renderInspector(); ensurePeaks(); }
  renderTranscript();
  renderPrep();
  updateCosts();
  sizePreview();
  drawPreview();
  requestAnimationFrame(updateSegThumbs);
}

function renderStepper() {
  const p = state.project;
  const cur = !p ? 1 : p.approved ? 4 : (p.segments.length || state.busy) ? 3 : 2;
  $$('#stepper li').forEach((li) => {
    const n = +li.dataset.s;
    li.classList.toggle('active', n === cur);
    li.classList.toggle('done', n < cur);
  });
}

// pipeline stages: transcribe → plan → cast → scenes
function stageState(stage) {
  const p = state.project;
  if (state.stages?.[stage]) return state.stages[stage];
  if (!p) return '';
  const scenes = p.segments.filter((sg) => sg.type !== 'face' && sg.scene);
  switch (stage) {
    case 'transcribe': return p.words.length ? 'done' : '';
    case 'plan': return p.segments.length ? 'done' : '';
    case 'cast': return p.approved ? 'done' : p.characters.some((c) => c.image?.key) ? 'wait' : '';
    case 'scenes': return p.approved && scenes.length && scenes.every((sg) => sg.image?.key) ? 'done' : '';
    default: return '';
  }
}

function setStage(stage, value) {
  state.stages = { ...(state.stages || {}), [stage]: value };
  renderPipeline();
}

function renderPipeline() {
  $$('#pipeline li').forEach((li) => {
    li.className = stageState(li.dataset.stage);
  });
  const btn = $('#btn-create');
  const p = state.project;
  const label = btn.querySelector('span');
  btn.classList.toggle('busy', state.busy);
  btn.disabled = state.busy;
  if (state.busy) label.textContent = 'Working…';
  else if (!p?.segments.length) label.textContent = 'Create my video';
  else if (!p.approved) label.textContent = 'Continue';
  else label.textContent = 'Open the editor';
  $('#btn-approve').disabled = !!state.charBusy?.size || state.busy;
}

// ---------- step 1: upload ----------

async function loadFile(file) {
  if (!file) return;
  if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|m4v|mkv)$/i.test(file.name)) { toast('That doesn\'t look like a video file.'); return; }
  if (!$('#rights').checked) {
    toast('Please tick the box confirming you have the rights to this video.');
    $('#rights').closest('.check').animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 300 });
    $('#file').value = '';
    return;
  }
  const video = $('#video');
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = URL.createObjectURL(file);
  video.src = state.objectUrl;
  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('This browser can\'t play that video format. Try an MP4 from your phone.'));
    });
  } catch (e) { toast(e.message, 6000); return; }
  if (!Number.isFinite(video.duration)) { toast('Could not read the video length.'); return; }
  state.file = file;
  state.media = new VideoMedia(video);
  state.stages = {};
  showFileChip(`${icon('film')} ${esc(file.name)}`, fmtTime(video.duration), `${video.videoWidth}×${video.videoHeight}`);
  loadProject(video.duration);
  if (video.duration > 600) toast('Long video: StoryCuts works best on stories under 5 minutes.', 6000);
  scrollTo('#panel-style');
}

function showFileChip(...parts) {
  const el = $('#video-info');
  el.classList.remove('hidden');
  el.innerHTML = `<span class="pill ok">${icon('check')} Ready</span>${parts.map((x) => `<span class="pill">${x}</span>`).join('')}`;
}

function loadDemo() {
  state.file = null;
  const duration = 44;
  const words = wordsFromText(DEMO_TEXT, duration, [[0.6, 43.4]]);
  state.media = new DemoMedia(duration, words);
  state.stages = {};
  showFileChip('Demo story', '0:44', 'silent demo: your own video keeps its sound');
  loadProject(duration);
  if (!state.project.words.length) { state.project.words = words; save(); refresh(); }
  scrollTo('#panel-style');
}

// ---------- step 2: style & options ----------

// Coverflow style picker: the centred card is the selected style.
const styleIds = () => [...Object.keys(STYLES), 'custom'];

function renderStyles() {
  const cur = state.project?.settings.style || store.get('storycuts:style', 'stick');
  $('#style-track').innerHTML = Object.entries(STYLES).map(([id, s]) => `
    <button class="style-card" data-style="${id}" role="option" aria-label="${esc(s.label)}" style="--t1:${s.tint[0]};--t2:${s.tint[1]}">
      <span class="thumb">
        <span class="ph"><b>${esc(s.label)}</b></span>
        ${s.thumb ? `<img src="${esc(s.thumb)}" alt="" onerror="this.remove()">` : ''}
      </span>
      <span class="tick">${icon('check')}</span>
      <span class="meta"><b>${esc(s.label)}</b><small>${esc(s.blurb)}</small></span>
    </button>`).join('') + `
    <button class="style-card custom" data-style="custom" role="option" aria-label="Create your own style">
      <span class="thumb"><span class="ph"><span class="plus">+</span></span><img class="ref-thumb" alt="" hidden></span>
      <span class="tick">${icon('check')}</span>
      <span class="meta"><b>Create your own</b><small>Describe it or upload an example</small></span>
    </button>`;
  $('#style-dots').innerHTML = styleIds().map((id, i) => `<button class="dot" data-i="${i}" aria-label="${esc(id === 'custom' ? 'Create your own' : STYLES[id].label)}"></button>`).join('');
  state.styleIndex = Math.max(0, styleIds().indexOf(cur));
  layoutStyles(true);
  syncStyleExtras();
}

/** Position every card relative to the centred one (wrapping around). */
function layoutStyles(instant = false, drag = 0) {
  const ids = styleIds();
  const n = ids.length;
  const cards = $$('#style-track .style-card');
  const track = $('#style-track');
  track.classList.toggle('instant', instant || drag !== 0);
  const w = cards[0]?.offsetWidth || 300;
  const step = Math.min(w * 0.62, track.clientWidth * 0.3);
  cards.forEach((card, i) => {
    let d = i - state.styleIndex;
    if (d > n / 2) d -= n;
    if (d < -n / 2) d += n;
    const pos = d + drag;
    const a = Math.abs(pos);
    card.style.transform = `translateX(calc(-50% + ${pos * step}px)) translateZ(${-a * 120}px) rotateY(${Math.max(-1, Math.min(1, -pos)) * 18}deg) scale(${Math.max(0.6, 1 - a * 0.16)})`;
    card.style.zIndex = String(100 - Math.round(a * 10));
    card.style.opacity = a > 2.6 ? '0' : '1';
    card.style.pointerEvents = a > 2.6 ? 'none' : '';
    card.style.setProperty('--dim', String(Math.min(0.62, a * 0.32)));
    const center = Math.round(a * 100) === 0;
    card.classList.toggle('on', center);
    card.setAttribute('aria-selected', center);
    card.tabIndex = center ? 0 : -1;
  });
  $$('#style-dots .dot').forEach((dot, i) => dot.classList.toggle('on', i === state.styleIndex));
  if (instant) requestAnimationFrame(() => track.classList.remove('instant'));
}

function selectStyleIndex(i) {
  const ids = styleIds();
  const n = ids.length;
  state.styleIndex = ((i % n) + n) % n;
  layoutStyles();
  const id = ids[state.styleIndex];
  if (!state.project) { store.set('storycuts:style', id); return; }
  if (id === state.project.settings.style) return;
  const hadArt = state.project.characters.some((c) => c.image?.key);
  state.project.settings.style = id;
  store.set('storycuts:style', id);
  save();
  syncStyleExtras();
  clearTimeout(selectStyleIndex.t);
  if (hadArt) selectStyleIndex.t = setTimeout(() => toast(`Style set to ${id === 'custom' ? 'your custom style' : STYLES[id].label}. Redraw your cast and scenes to apply it.`, 4500), 700);
}

$('#style-prev').addEventListener('click', () => selectStyleIndex(state.styleIndex - 1));
$('#style-next').addEventListener('click', () => selectStyleIndex(state.styleIndex + 1));
$('#style-dots').addEventListener('click', (e) => { const d = e.target.closest('.dot'); if (d) selectStyleIndex(+d.dataset.i); });
$('#style-track').addEventListener('click', (e) => {
  const card = e.target.closest('.style-card');
  if (!card || state.styleDragged) return;
  const i = styleIds().indexOf(card.dataset.style);
  if (i !== state.styleIndex) selectStyleIndex(i);
  else if (card.dataset.style === 'custom') $('#custom-style').focus();
});
$('#style-track').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') { e.preventDefault(); selectStyleIndex(state.styleIndex - 1); $('#style-track .style-card.on')?.focus(); }
  if (e.key === 'ArrowRight') { e.preventDefault(); selectStyleIndex(state.styleIndex + 1); $('#style-track .style-card.on')?.focus(); }
});

// drag / swipe
(function coverflowDrag() {
  const track = $('#style-track');
  let down = false, x0 = 0, dx = 0;
  const unit = () => Math.min(($('#style-track .style-card')?.offsetWidth || 300) * 0.62, track.clientWidth * 0.3);
  track.addEventListener('pointerdown', (e) => { down = true; x0 = e.clientX; dx = 0; state.styleDragged = false; });
  window.addEventListener('pointermove', (e) => {
    if (!down) return;
    dx = e.clientX - x0;
    if (Math.abs(dx) > 6) { state.styleDragged = true; track.classList.add('dragging'); }
    if (state.styleDragged) layoutStyles(false, dx / unit());
  });
  window.addEventListener('pointerup', () => {
    if (!down) return;
    down = false;
    track.classList.remove('dragging');
    if (state.styleDragged) {
      const moveBy = Math.round(-dx / unit());
      if (moveBy) selectStyleIndex(state.styleIndex + moveBy); else layoutStyles();
      setTimeout(() => { state.styleDragged = false; }, 0);
    }
  });
  window.addEventListener('resize', () => layoutStyles(true));
  // the stage never scrolls; cards are positioned with transforms
  track.addEventListener('scroll', () => { if (track.scrollLeft) track.scrollLeft = 0; });
}());

function syncStyleExtras() {
  const s = state.project?.settings;
  const custom = s?.style === 'custom';
  $('#custom-box').classList.toggle('hidden', !custom);
  if (!s) return;
  if (document.activeElement !== $('#style-notes')) $('#style-notes').value = s.styleNotes || '';
  if (document.activeElement !== $('#custom-style')) $('#custom-style').value = s.customStyle || '';
  const showRef = async (img) => {
    if (!img) return;
    if (s.styleRef?.key) { await fillImg(img, s.styleRef.key); img.hidden = false; } else img.hidden = true;
  };
  showRef($('#style-ref-img'));
  showRef($('.style-card.custom .ref-thumb'));
  $('#btn-clear-ref').hidden = !s.styleRef?.key;
}

let styleTimer;
['#style-notes', '#custom-style'].forEach((sel) => $(sel).addEventListener('input', (e) => {
  if (!state.project) return;
  state.project.settings[sel === '#style-notes' ? 'styleNotes' : 'customStyle'] = e.target.value.slice(0, 400);
  clearTimeout(styleTimer);
  styleTimer = setTimeout(save, 300);
}));

$('#style-ref').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f || !state.project) return;
  if (!f.type.startsWith('image/')) { toast('Please choose an image file.'); return; }
  const key = `${storageKey()}/styleref/${Date.now().toString(36)}`;
  await putBlob(key, f);
  state.project.settings.styleRef = { key, name: f.name };
  save();
  syncStyleExtras();
  toast('Style reference added. Every character and scene will copy its look.');
});
$('#btn-clear-ref').addEventListener('click', () => {
  delete state.project.settings.styleRef;
  save();
  syncStyleExtras();
});

function syncOptionsUI() {
  const s = state.project.settings;
  $$('#seg-format button, #seg-aspect button').forEach((b) => b.classList.toggle('on', b.dataset.aspect === state.aspect));
  $$('#seg-face button').forEach((b) => b.classList.toggle('on', b.dataset.face === (s.faceMode || 'full')));
  $$('#seg-pacing button').forEach((b) => b.classList.toggle('on', b.dataset.pacing === (s.pacing || 'mostly')));
  $('#opt-captions').checked = !!s.captions;
  $('#opt-upper').checked = !!s.captionStyle?.upper;
  $('#opt-punch').checked = !!s.punchIn;
  $('#opt-watermark').checked = !!s.watermark;
  $('#face-x').value = s.faceX ?? 0.5;
  renderStyles();
}

function setAspect(a) {
  state.aspect = a;
  if (state.project) { state.project.settings.aspect = a; save(); }
  $$('#seg-format button, #seg-aspect button').forEach((b) => b.classList.toggle('on', b.dataset.aspect === a));
  const drawn = state.project?.segments.some((sg) => sg.image?.key && sg.image.aspect !== (a === 'vertical' ? '9:16' : '16:9'));
  if (drawn) toast('Scenes drawn in the other format are cropped to fit. Redraw them for the best framing.', 4500);
  sizePreview(); drawPreview();
}

$$('#seg-format button, #seg-aspect button').forEach((b) => b.addEventListener('click', () => setAspect(b.dataset.aspect)));
$$('#seg-face button').forEach((b) => b.addEventListener('click', () => {
  if (!state.project) return;
  state.project.settings.faceMode = b.dataset.face;
  save();
  $$('#seg-face button').forEach((x) => x.classList.toggle('on', x === b));
  refresh();
}));

$$('#seg-pacing button').forEach((b) => b.addEventListener('click', () => {
  if (!state.project) return;
  state.project.settings.pacing = b.dataset.pacing;
  save();
  $$('#seg-pacing button').forEach((x) => x.classList.toggle('on', x === b));
  if (state.project.segments.length) toast('Pacing changed. Use "Start over" in step 3 to re-plan the edit with it.', 5000);
}));

// ---------- step 3 prep: transcript + your characters ----------

function renderPrep() {
  const p = state.project;
  if (!p) return;
  const custom = p.transcriptSource && p.transcriptSource !== 'auto';
  const n = p.words.length;
  $('#transcript-state').textContent = n
    ? `${n} words ready${p.transcriptSource === 'subtitles' ? ' (from your subtitles, with exact timing)' : p.transcriptSource === 'text' ? ' (from your text, timed to your audio)' : state.file ? ' (transcribed)' : ' (demo)'}.`
    : 'We\'ll transcribe your video automatically.';
  $('#prep-transcript').classList.toggle('ready', n > 0);
  $('#btn-transcript-clear').hidden = !(custom && state.file && !p.segments.length);
  const hints = p.settings.castHints || [];
  const box = $('#cast-pre');
  if (document.activeElement?.closest('#cast-pre')) return;
  box.innerHTML = hints.map((h, i) => `
    <div class="row" data-i="${i}">
      <input data-k="name" placeholder="Name (e.g. Dad)" value="${esc(h.name)}" maxlength="30">
      <input data-k="description" placeholder="Look (e.g. tall, bald, big mustache, red polo)" value="${esc(h.description)}" maxlength="160">
      <button class="x" data-del="${i}" aria-label="Remove">✕</button>
    </div>`).join('');
  $('#prep-cast').classList.toggle('ready', hints.some((h) => h.name?.trim()));
}

$('#btn-cast-pre-add').addEventListener('click', () => {
  if (!state.project) return;
  state.project.settings.castHints = [...(state.project.settings.castHints || []), { name: '', description: '' }];
  save(); renderPrep();
  $('#cast-pre .row:last-child input')?.focus();
});
$('#cast-pre').addEventListener('input', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  state.project.settings.castHints[+row.dataset.i][e.target.dataset.k] = e.target.value;
  save();
  $('#prep-cast').classList.toggle('ready', state.project.settings.castHints.some((h) => h.name?.trim()));
});
$('#cast-pre').addEventListener('click', (e) => {
  const d = e.target.closest('[data-del]');
  if (!d) return;
  state.project.settings.castHints.splice(+d.dataset.del, 1);
  save(); renderPrep();
});

function transcriptLocked() {
  if (state.project?.segments.length) { toast('Your edit is already planned. Use "Start over" to change the transcript.', 4500); return true; }
  return false;
}

$('#transcript-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f || !state.project || transcriptLocked()) return;
  const text = await f.text();
  const subs = wordsFromSubtitles(text);
  let words = subs;
  if (!words) {
    let spans = null;
    try { if (state.file) spans = speechSpans(await decodeAudio(state.file)); } catch { /* no audio */ }
    words = wordsFromText(text, state.project.duration, spans);
  }
  if (!words.length) { toast('That file doesn\'t seem to contain any words.'); return; }
  state.project.words = words;
  state.project.transcriptSource = subs ? 'subtitles' : 'text';
  save(); renderPrep(); renderTranscript();
  toast(subs ? 'Subtitles loaded with their exact timing.' : 'Transcript loaded and lined up with your audio.');
});
$('#btn-paste-open').addEventListener('click', () => {
  if (transcriptLocked()) return;
  $('#paste-msg').innerHTML = '<b>Paste what you say in the video.</b> We\'ll line the words up with your audio.';
  $('#paste-box').classList.remove('hidden');
  $('#paste-text').focus();
});
$('#btn-paste-cancel').addEventListener('click', () => $('#paste-box').classList.add('hidden'));
$('#btn-transcript-clear').addEventListener('click', () => {
  state.project.words = [];
  state.project.transcriptSource = 'auto';
  save(); renderPrep(); renderTranscript();
});

// ---------- live progress card ----------

const TIPS = {
  transcribe: ['Listening to every word…', 'Lining each word up with your audio…', 'First run downloads the speech model; after that it\'s faster.'],
  plan: ['Finding the hook…', 'Deciding when to show you and when to cut away…', 'Spotting every character and place in your story…', 'Writing a scene for each moment…'],
  cast: ['Sketching your characters…', 'Picking colours and outfits…', 'Checking hands, faces and details…', 'Each character is drawn once and reused in every scene.'],
  scenes: ['Drawing your scenes…', 'Keeping every character on-model…', 'Checking each frame and redrawing any that slip…'],
};

function liveStart(stage, title) {
  const el = $('#create-live');
  el.classList.remove('hidden');
  $('#live-title').textContent = title;
  clearInterval(state.liveTimer);
  const t0 = state.liveT0 || (state.liveT0 = performance.now());
  let k = 0;
  const tips = TIPS[stage] || [];
  const tick = () => {
    const s = Math.floor((performance.now() - t0) / 1000);
    $('#live-time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const tip = () => {
    const p = $('#live-tip');
    p.style.opacity = 0;
    setTimeout(() => { p.textContent = tips[k++ % Math.max(1, tips.length)] || ''; p.style.opacity = 1; }, 250);
  };
  tip(); tick();
  state.liveTimer = setInterval(() => { tick(); if (Math.floor((performance.now() - t0) / 1000) % 4 === 0) tip(); }, 1000);
}

function liveStop() {
  clearInterval(state.liveTimer);
  state.liveT0 = null;
  $('#create-live').classList.add('hidden');
}

// ---------- step 3: create ----------

function updateCosts() {
  const p = state.project;
  if (!p) return;
  const s = settingsGet();
  const plan = p.words.length ? estimateCost(p.words, s.model).usd : 0.08;
  const shots = p.segments.length ? p.segments.filter((sg) => sg.type !== 'face').length : Math.max(4, Math.round(p.duration / 5));
  const chars = p.characters.length || 3;
  const imgs = estimateImageCost(shots + chars, s, s.qc && !!s.key);
  $('#create-cost').textContent = `Estimated cost ≈ ${fmtUSD(plan + imgs)} · paid to your AI accounts`;
  if (p.approved) {
    const todo = sceneSegs().filter(needsImage).length;
    $('#scenes-cost').textContent = todo ? `${todo} to draw · ≈ ${fmtUSD(estimateImageCost(todo, s, s.qc && !!s.key))}` : `${sceneSegs().length} scenes drawn`;
    const btn = $('#btn-gen-scenes');
    btn.querySelector('span').textContent = state.genAbort ? 'Stop' : todo ? `Draw ${todo} scene${todo === 1 ? '' : 's'}` : 'Redraw all';
  }
}

async function createVideo() {
  const p = state.project;
  if (!p) { toast('Upload a video first (or try the demo).'); scrollTo('#panel-upload'); return; }
  if (p.approved) { scrollTo('#panel-editor'); return; }
  if (!keysReady()) { toast('Connect your Claude and OpenAI accounts to start.', 4500); openSettings(); return; }
  state.busy = true;
  state.stages = {};
  setStatus('#create-status', '');
  renderPipeline(); renderStepper();
  try {
    // 1. transcript
    if (!p.words.length) {
      setStage('transcribe', 'active');
      liveStart('transcribe', 'Transcribing your story');
      try {
        const words = await transcribeInBrowser(state.file, {
          quality: $('#asr-quality').value,
          onStatus: (m) => { $('#live-title').textContent = m.replace(/…$/, ''); },
        });
        if (!words.length) throw new Error('no speech found');
        p.words = words; p.transcriptSource = 'auto'; save(); renderTranscript(); renderPrep();
      } catch (e) {
        console.error(e);
        setStage('transcribe', 'error');
        liveStop();
        setStatus('#create-status', `Couldn't transcribe automatically (${errText(e)}). Upload or paste your transcript instead.`, 'err');
        $('#paste-msg').innerHTML = '<b>Automatic transcription didn\'t work on this device.</b> Paste what you say in the video and we\'ll line it up with your audio.';
        $('#paste-box').classList.remove('hidden');
        return;
      }
    }
    setStage('transcribe', 'done');

    // 2. plan
    if (!p.segments.length) {
      setStage('plan', 'active');
      liveStart('plan', 'Planning your edit');
      const s = settingsGet();
      const notes = [
        $('#plan-notes').value.trim(),
        p.settings.faceMode === 'bubble' ? '' : 'Use only "face" and "scene" shots (no scene_bubble): the creator wants full-frame cuts.',
      ].filter(Boolean).join(' ');
      try {
        const raw = await planWithClaude(s.key, p.words, p.duration, { model: s.model, notes, pacing: p.settings.pacing, cast: p.settings.castHints || [] });
        snapshot();
        p.title = raw.title || p.title;
        p.characters = raw.characters;
        p.locations = (raw.locations || []).map((l) => ({ ...l, id: slug(l.id) }));
        p.segments = raw.segments;
        p.sfx = raw.segments.filter((sg) => sg.sfx && sg.sfx !== 'none' && sfxInfo(sg.sfx)).map((sg) => ({ id: newId(), type: sg.sfx, t: +(sg.start + 0.05).toFixed(2), vol: 1 }));
        p.approved = false;
        runQC(p);
        save();
      } catch (e) {
        console.error(e);
        setStage('plan', 'error');
        liveStop();
        setStatus('#create-status', `Planning failed: ${e?.status === 401 ? 'your Claude key was rejected. Check it under API keys.' : errText(e)}`, 'err');
        return;
      }
    }
    setStage('plan', 'done');
    $('#cast').classList.remove('hidden');
    renderChars();

    // 3. cast
    const missing = p.characters.filter((c) => !c.image?.key);
    setStage('cast', 'active');
    if (missing.length) {
      setStatus('#create-status', '');
      liveStart('cast', `Designing your cast (${missing.length})`);
      scrollTo('#cast');
      const ok = await drawCharacters(missing);
      if (!ok) { setStage('cast', 'error'); liveStop(); return; }
    }
    liveStop();
    setStage('cast', 'wait');
    setStatus('#create-status', 'Your cast is ready. Take a look, then draw the scenes.', 'ok');
    scrollTo('#cast');
  } finally {
    state.busy = false;
    liveStop();
    renderPipeline(); renderStepper();
  }
}

async function usePaste() {
  const text = $('#paste-text').value.trim();
  if (!text) { toast('Paste what you say in the video first.'); return; }
  setStatus('#create-status', 'Lining the words up with your audio…', 'busy');
  let spans = null;
  try { if (state.file) spans = speechSpans(await decodeAudio(state.file)); } catch { /* no audio track */ }
  state.project.words = wordsFromText(text, state.project.duration, spans);
  state.project.transcriptSource = 'text';
  save();
  $('#paste-box').classList.add('hidden');
  setStatus('#create-status', '');
  renderTranscript(); renderPrep();
  if (stageState('transcribe') === 'error') createVideo();
}

function resetPlan() {
  if (!confirm('Start over? This clears the plan, cast and scenes for this video (your transcript is kept).')) return;
  snapshot();
  Object.assign(state.project, { characters: [], locations: [], sfx: [], segments: [], approved: false });
  state.stages = {};
  state.selected = null;
  save();
  refresh();
  setStatus('#create-status', '');
}

// ---------- cast ----------

function qcBadge(img) {
  if (!img?.qc) return '';
  const q = img.qc;
  return q.pass
    ? `<span class="qc-badge ok" title="${esc(q.issues.join('; '))}">✓ Checked${q.score ? ` ${q.score}/10` : ''}</span>`
    : `<span class="qc-badge warn" title="${esc(q.issues.join('; '))}">⚠ ${esc(q.issues[0] || 'Needs a look')}</span>`;
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
        ${c.image?.key ? '<img alt="">' : `<div class="empty"><div><b>${esc((c.name || '?')[0])}</b>Not drawn yet</div></div>`}
        ${busy.has(c.id) ? `<div class="art-busy"><svg viewBox="0 0 100 120"><circle cx="50" cy="24" r="14"/><path d="M50 38v40"/><path d="M50 50l-20 16M50 50l20 16"/><path d="M50 78l-16 30M50 78l16 30"/></svg><small>Sketching ${esc(c.name)}…</small></div>` : ''}
        ${c.image?.key ? qcBadge(c.image) : ''}
      </div>
      <div class="char-fields">
        <input data-k="name" value="${esc(c.name)}" aria-label="Name">
        <textarea data-k="description" rows="3" placeholder="What they look like: age, hair, clothes, a signature detail">${esc(c.description)}</textarea>
        ${c.id === 'me' && state.media instanceof VideoMedia ? `<label class="check small"><input type="checkbox" data-k="useVideoLook" ${c.useVideoLook !== false ? 'checked' : ''}><span class="box">${icon('check')}</span>Look like me (uses a frame of my video)</label>` : ''}
        <div class="char-row">
          <button class="btn glass sm" data-redraw="${i}" ${busy.has(c.id) ? 'disabled' : ''}>${icon('redo')}${c.image?.key ? 'Redraw' : 'Draw'}</button>
          ${c.id === 'me' ? '<small>This is you</small>' : `<button class="btn link sm danger" data-del="${i}">Remove</button>`}
        </div>
      </div>
    </div>`).join('');
  el.querySelectorAll('.char').forEach((card) => {
    const ch = p.characters[+card.dataset.i];
    const img = card.querySelector('img');
    if (img) fillImg(img, ch.image.key);
  });
  const missing = p.characters.filter((c) => !c.image?.key).length;
  $('#btn-gen-chars').lastChild.textContent = missing ? `Draw ${missing} missing` : 'Redraw all';
  $('#btn-approve').disabled = !!state.charBusy?.size || state.busy;
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

/** Draws the given characters. Resolves true if all succeeded. */
async function drawCharacters(list) {
  if (!hasImageKey()) { openSettings(); return false; }
  if (!list.length) return true;
  const job = imageJobOpts();
  state.charBusy = new Set(list.map((c) => c.id));
  renderChars();
  $('#btn-gen-chars').disabled = true;
  setStatus('#chars-status', `Designing ${list.length} character${list.length > 1 ? 's' : ''} in ${STYLES[state.project.settings.style]?.label || 'your'} style…`, 'busy');
  const me = list.find((c) => c.id === 'me' && c.useVideoLook !== false);
  const selfFrame = me ? await grabSelfFrame().catch(() => null) : null;
  const results = await pool(list, 2, async (ch) => {
    try {
      const img = await generateCharacterImage(state.project, ch, {
        ...job, selfFrame, onStatus: (m) => setStatus('#chars-status', `${ch.name}: ${m}`, 'busy'),
      });
      ch.image = img;
      save();
    } finally {
      state.charBusy.delete(ch.id);
      renderChars();
    }
  });
  state.charBusy = new Set();
  $('#btn-gen-chars').disabled = false;
  renderChars();
  const failed = results.filter((r) => !r.ok);
  failed.forEach((f) => console.error('StoryCuts character drawing failed', f.error));
  if (failed.length) {
    setStatus('#chars-status', `Couldn't draw ${failed.length}: ${errText(failed[0].error)}`, 'err');
    return false;
  }
  const scenesDrawn = state.project.segments.some((sg) => sg.image?.key);
  setStatus('#chars-status', `${storageProblem ? `${STORAGE_WARN} ` : ''}${scenesDrawn ? 'Done. Redraw your scenes to use the new looks.' : 'Done.'}`, storageProblem ? '' : 'ok');
  return true;
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
  ch[k] = k === 'useVideoLook' ? e.target.checked : e.target.value;
  save();
});

$('#chars').addEventListener('click', (e) => {
  const t = e.target.closest('button');
  const card = e.target.closest('.char');
  if (!t || !card) return;
  const i = +card.dataset.i;
  if (t.dataset.redraw) {
    drawCharacters([state.project.characters[i]]);
  } else if (t.dataset.del) {
    const ch = state.project.characters[i];
    edit(() => {
      state.project.characters.splice(i, 1);
      state.project.segments.forEach((sg) => {
        if (sg.scene) sg.scene.actors = sg.scene.actors.filter((a) => a.character_id !== ch.id);
      });
      state.project.segments = normalizeSegments(state.project.segments, state.project.characters, state.project.duration, [], { pacing: state.project.settings.pacing });
    });
  }
});

$('#btn-add-char').addEventListener('click', () => {
  const name = prompt('Who should we add? (e.g. "Grandma", "Jake", "Biscuit the dog")');
  if (!name) return;
  edit(() => {
    const p = state.project;
    let id = slug(name);
    while (p.characters.some((c) => c.id === id)) id += '_2';
    p.characters.push({ id, name, description: '', color: '#8854d0', hair: 'short', hairColor: '#2b2b2b', accessory: 'none', height: 1 });
  });
});

async function approveAndDraw() {
  const p = state.project;
  if (p.characters.some((c) => !c.image?.key) && !confirm('Some characters haven\'t been drawn yet, so their scenes may not match. Continue anyway?')) return;
  snapshot();
  p.characters = normalizeCharacters(p.characters);
  p.segments = normalizeSegments(p.segments, p.characters, p.duration, [], { pacing: p.settings.pacing });
  p.approved = true;
  save();
  state.stages = { ...(state.stages || {}), cast: 'done' };
  if (!state.selected) state.selected = p.segments.find((s) => s.type !== 'face')?.id;
  refresh();
  ensurePeaks();
  scrollTo('#panel-editor');
  const todo = sceneSegs().filter(needsImage);
  if (todo.length && hasImageKey()) {
    setStage('scenes', 'active');
    await generateScenes(todo);
    setStage('scenes', sceneSegs().every((sg) => sg.image?.key) ? 'done' : 'error');
  }
}

// ---------- scene images ----------

const sceneSegs = () => state.project.segments.filter((sg) => sg.type !== 'face' && sg.scene);
const needsImage = (sg) => !sg.image?.key || sg.image.stale;

async function generateScenes(list, note = '') {
  if (!hasImageKey()) { openSettings(); return; }
  if (!list.length) return;
  const job = imageJobOpts();
  const ac = { stop: false };
  state.genAbort = ac;
  state.cache.pending = new Set(list.map((sg) => sg.id));
  updateCosts(); renderTimeline();
  const bar = $('#gen-progress');
  bar.classList.remove('hidden');
  bar.firstElementChild.style.width = '3%';
  let done = 0;
  const aspect = state.aspect === 'vertical' ? '9:16' : '16:9';
  setStatus('#scenes-status', `Drawing ${list.length} scene${list.length > 1 ? 's' : ''}… you can keep editing while this runs.`, 'busy');
  // first shot of each location is drawn first so later shots can reuse it as a reference
  const [anchors, rest] = orderForConsistency(state.project, list);
  const drawOne = async (sg) => {
    if (ac.stop) throw new Error('stopped');
    try {
      sg.image = await generateSceneImage(state.project, sg, {
        ...job, aspect, note,
        onStatus: (m) => { if (sg.id === state.selected) setStatus('#redo-status', m, 'busy'); },
      });
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
  };
  const results = [...await pool(anchors, 3, drawOne), ...await pool(rest, 3, drawOne)];
  state.genAbort = null;
  setTimeout(() => bar.classList.add('hidden'), 600);
  const failed = results.filter((r) => !r.ok && r.error.message !== 'stopped');
  const flagged = list.filter((sg) => sg.image?.qc && !sg.image.qc.pass).length;
  const redrawn = list.filter((sg) => sg.image?.attempts > 1).length;
  failed.forEach((f) => console.error('StoryCuts scene drawing failed', f.error));
  if (failed.length) setStatus('#scenes-status', `${list.length - failed.length} drawn, ${failed.length} failed: ${errText(failed[0].error)}`, 'err');
  else if (ac.stop) setStatus('#scenes-status', 'Stopped.');
  else {
    setStatus('#scenes-status', `${storageProblem ? `${STORAGE_WARN} ` : ''}All ${list.length} scene${list.length > 1 ? 's' : ''} drawn.${redrawn ? ` ${redrawn} redrawn automatically after a quality check.` : ''}${flagged ? ` ${flagged} flagged with ⚠: take a look.` : ' Press play to watch.'}`, flagged || storageProblem ? '' : 'ok');
  }
  updateCosts();
  renderInspector();
  renderPipeline();
}

$('#btn-gen-scenes').addEventListener('click', () => {
  if (state.genAbort) { state.genAbort.stop = true; toast('Finishing the images already in progress…'); return; }
  const todo = sceneSegs().filter(needsImage);
  const list = todo.length ? todo : sceneSegs();
  const s = settingsGet();
  if (!hasImageKey(s)) { openSettings(); return; }
  if (!todo.length && !confirm(`Redraw all ${list.length} scenes? ≈ ${fmtUSD(estimateImageCost(list.length, s, s.qc && !!s.key))}`)) return;
  generateScenes(list);
});

// ---------- step 4: editor (CapCut-style) ----------

const fmtTC = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

function sizePreview() {
  const { w, h } = ASPECTS[state.aspect];
  const c = $('#preview');
  c.width = Math.round(w * 0.5); c.height = Math.round(h * 0.5);
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
  $('#time').textContent = window.innerWidth < 640 ? fmtTC(t) : `${fmtTC(t)} / ${fmtTC(p.duration)}`;
  if (!state.userScrolling) scrollTimelineTo(t);
  $$('#timeline .clip').forEach((b) => b.classList.toggle('live', b.dataset.id === seg.id));
}

function graph() { return audioGraph(state.media?.video || null); }

function loop() {
  drawPreview();
  if (state.media && !state.media.paused) requestAnimationFrame(loop);
  else { $('#btn-play').innerHTML = icon('play'); state.sfxPlayer.stop(); }
}

async function togglePlay() {
  const m = state.media;
  if (!m || !state.project?.approved) return;
  if (m.paused) {
    if (m.time >= state.project.duration - 0.05) await m.seek(0);
    await m.play();
    const g = graph();
    setMix(g, state.project.settings);
    state.sfxPlayer.start(g, state.project.sfx || [], m.time);
    $('#btn-play').innerHTML = icon('pause');
    loop();
  } else {
    m.pause();
    state.sfxPlayer.stop();
  }
}

async function seekTo(t, { follow = true } = {}) {
  const m = state.media;
  if (!m) return;
  const playing = !m.paused;
  await m.seek(Math.max(0, Math.min(state.project.duration - 0.01, t)));
  if (playing) state.sfxPlayer.start(graph(), state.project.sfx || [], m.time);
  if (follow) scrollTimelineTo(m.time);
  drawPreview();
}

const shotText = (seg) => wordsIn(state.project.words, seg.start, seg.end).map((w) => w.w).join(' ');

// --- timeline geometry ---
const TL = { pps: 0, pad: 0 };

function tlSetup() {
  const sc = $('#tl-scroll');
  const p = state.project;
  TL.pad = Math.round(sc.clientWidth / 2);
  if (!TL.pps) TL.pps = Math.max(28, Math.min(120, sc.clientWidth / 9));
  const width = Math.ceil(p.duration * TL.pps);
  const content = $('#tl-content');
  content.style.width = `${width + TL.pad * 2}px`;
  content.style.setProperty('--pad', `${TL.pad}px`);
  // ruler
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60];
  const step = steps.find((x) => x * TL.pps >= 70) || 60;
  let html = '';
  for (let t = 0; t <= p.duration + 0.001; t += step) {
    html += `<span style="left:${TL.pad + t * TL.pps}px">${fmtTime(t)}</span>`;
    if (step * TL.pps >= 140) html += `<i style="left:${TL.pad + (t + step / 2) * TL.pps}px"></i>`;
  }
  $('#tl-ruler').innerHTML = html;
}

function scrollTimelineTo(t) {
  const sc = $('#tl-scroll');
  const x = Math.round(t * TL.pps);
  if (Math.abs(sc.scrollLeft - x) < 1) return;
  state.ignoreScrollAt = x;
  sc.scrollLeft = x;
}

// thumbnails: scene images and frames from the creator's video
const thumbUrls = new Map();
function sceneThumb(key, onReady) {
  if (thumbUrls.has(key)) return thumbUrls.get(key);
  thumbUrls.set(key, null);
  getBlob(key).then((b) => { if (b) { thumbUrls.set(key, URL.createObjectURL(b)); onReady(); } });
  return null;
}

const faceThumbs = new Map();
let thumbQueue = Promise.resolve();
function faceThumb(t, onReady) {
  const k = Math.round(t * 2) / 2;
  if (faceThumbs.has(k)) return faceThumbs.get(k);
  faceThumbs.set(k, null);
  thumbQueue = thumbQueue.then(async () => {
    const c = document.createElement('canvas');
    c.width = 72; c.height = 128;
    const ctx = c.getContext('2d');
    try {
      if (state.media instanceof DemoMedia) {
        state.media.render(k);
        ctx.drawImage(state.media.canvas, 0, 0, 72, 128);
      } else if (state.objectUrl) {
        if (!state.thumbVideo || state.thumbVideo.dataset.src !== state.objectUrl) {
          state.thumbVideo = Object.assign(document.createElement('video'), { muted: true, playsInline: true, preload: 'auto', src: state.objectUrl });
          state.thumbVideo.dataset.src = state.objectUrl;
          await new Promise((r) => { state.thumbVideo.onloadeddata = r; setTimeout(r, 3000); });
        }
        const v = state.thumbVideo;
        await new Promise((r) => { v.onseeked = r; v.currentTime = Math.min(k + 0.3, v.duration - 0.05); setTimeout(r, 1500); });
        const sc = Math.max(72 / v.videoWidth, 128 / v.videoHeight);
        ctx.drawImage(v, (72 - v.videoWidth * sc) / 2, (128 - v.videoHeight * sc) / 2, v.videoWidth * sc, v.videoHeight * sc);
      }
      faceThumbs.set(k, c.toDataURL('image/jpeg', 0.7));
      onReady();
    } catch { /* thumbnail is cosmetic */ }
  });
  return null;
}

let tlRefreshTimer;
const tlRefreshSoon = () => { clearTimeout(tlRefreshTimer); tlRefreshTimer = setTimeout(renderTimeline, 120); };

function renderTimeline() {
  const p = state.project;
  if (!p?.approved) return;
  tlSetup();
  const el = $('#timeline');
  el.innerHTML = p.segments.map((s, i) => {
    const type = shotType(s, p.settings);
    const st = type === 'face' ? '' : state.cache.pending?.has(s.id) ? 'pending' : !s.image?.key ? 'noimg' : s.image.qc && !s.image.qc.pass ? 'warn' : s.image.stale ? 'stale' : 'hasimg';
    const thumb = type === 'face' ? faceThumb(s.start, tlRefreshSoon) : s.image?.key ? sceneThumb(s.image.key, tlRefreshSoon) : null;
    const sel = s.id === state.selected;
    return `<div class="clip ${type} ${st} ${sel ? 'sel' : ''}" data-id="${s.id}" style="left:${TL.pad + s.start * TL.pps}px;width:${Math.max(6, (s.end - s.start) * TL.pps - 3)}px" title="${esc(shotText(s))}">
      <div class="thumbs" ${thumb ? `style="background-image:url('${thumb}')"` : ''}></div>
      <span class="cap">${type === 'face' ? icon('user') : ''}${esc(shotText(s).split(' ').slice(0, 4).join(' '))}</span>
      ${sel ? `${i > 0 ? '<b class="trim l" data-edge="l"></b>' : ''}${i < p.segments.length - 1 ? '<b class="trim r" data-edge="r"></b>' : ''}` : ''}
    </div>`;
  }).join('');
  renderFxTrack();
  drawWave();
  renderTranscript();
  scrollTimelineTo(state.media?.time || 0);
}

function renderFxTrack() {
  const p = state.project;
  const fx = (p.sfx || []).slice().sort((a, b) => a.t - b.t);
  $('#tl-fx').innerHTML = fx.map((c) => {
    const info = sfxInfo(c.type) || { name: c.type, icon: '♪', dur: 0.5 };
    return `<div class="fxclip ${c.id === state.selectedFx ? 'sel' : ''}" data-id="${c.id}" style="left:${TL.pad + c.t * TL.pps}px;width:${Math.max(34, info.dur * TL.pps)}px"><span>${info.icon}</span><em>${esc(info.name)}</em></div>`;
  }).join('') || `<span class="fx-empty" style="left:${TL.pad + 8}px">No sound effects yet. Add some in the Sound tab.</span>`;
}

// voice waveform (from the video's own audio)
async function ensurePeaks() {
  if (state.peaks !== undefined || !state.file) return;
  state.peaks = null;
  try {
    const samples = await decodeAudio(state.file, 8000);
    const per = 80; // 10ms buckets at 8kHz
    const peaks = new Float32Array(Math.ceil(samples.length / per));
    for (let i = 0; i < peaks.length; i++) {
      let m = 0;
      for (let j = i * per, e = Math.min(samples.length, j + per); j < e; j++) m = Math.max(m, Math.abs(samples[j]));
      peaks[i] = m;
    }
    const max = peaks.reduce((a, b) => Math.max(a, b), 0.001);
    state.peaks = peaks.map((v) => v / max);
    drawWave();
  } catch { state.peaks = null; }
}

function drawWave() {
  const cv = $('#tl-wave');
  const sc = $('#tl-scroll');
  const w = sc.clientWidth, h = cv.parentElement.clientHeight || 34;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = w * dpr; cv.height = h * dpr;
  cv.style.width = `${w}px`; cv.style.height = `${h}px`;
  cv.style.left = `${sc.scrollLeft}px`;
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  const p = state.project;
  if (!p) return;
  const x0 = TL.pad, mid = h / 2;
  if (!state.peaks) {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(state.file ? 'Reading audio…' : 'The demo has no voice track (sound effects still play)', w / 2 + 30, mid + 4);
    return;
  }
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, '#2dd4bf'); g.addColorStop(1, '#22d3ee');
  ctx.fillStyle = g;
  for (let px = 0; px < w; px += 2) {
    const t = (px + sc.scrollLeft - x0) / TL.pps;
    if (t < 0 || t > p.duration) continue;
    const v = state.peaks[Math.floor(t * 100)] || 0;
    const bh = Math.max(1.5, v * (h - 6));
    ctx.fillRect(px, mid - bh / 2, 1.4, bh);
  }
}

// scrolling the timeline scrubs the video
$('#tl-scroll').addEventListener('scroll', () => {
  const sc = $('#tl-scroll');
  drawWave();
  if (state.ignoreScrollAt != null && Math.abs(sc.scrollLeft - state.ignoreScrollAt) < 2) { state.ignoreScrollAt = null; return; }
  if (!state.project?.approved || !state.media) return;
  state.userScrolling = true;
  clearTimeout(state.userScrollTimer);
  state.userScrollTimer = setTimeout(() => { state.userScrolling = false; }, 150);
  if (!state.media.paused) { state.media.pause(); state.sfxPlayer.stop(); }
  cancelAnimationFrame(state.scrubRaf);
  state.scrubRaf = requestAnimationFrame(() => seekTo(sc.scrollLeft / TL.pps, { follow: false }));
}, { passive: true });

function zoom(f) {
  const t = state.media?.time || 0;
  TL.pps = Math.max(12, Math.min(260, TL.pps * f));
  renderTimeline();
  scrollTimelineTo(t);
}
$('#zoom-in').addEventListener('click', () => zoom(1.4));
$('#zoom-out').addEventListener('click', () => zoom(1 / 1.4));
$('#tl-scroll').addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12); } }, { passive: false });
window.addEventListener('resize', () => { if (state.project?.approved) renderTimeline(); });

// clips: tap to select, drag trim handles, drag sound effects
(function timelinePointer() {
  let drag = null;
  $('#tl-content').addEventListener('pointerdown', (e) => {
    const trim = e.target.closest('.trim');
    const fx = e.target.closest('.fxclip');
    const clip = e.target.closest('.clip');
    if (!trim && !fx && !clip) return;
    drag = { x0: e.clientX, moved: false, trim, fx, clip };
    if (trim) {
      const seg = currentSeg();
      const i = state.project.segments.indexOf(seg);
      drag.index = trim.dataset.edge === 'l' ? i : i + 1;
      drag.t0 = state.project.segments[drag.index].start;
      e.preventDefault();
    }
    if (fx) {
      const c = state.project.sfx.find((x) => x.id === fx.dataset.id);
      drag.c = c; drag.t0 = c.t;
      e.preventDefault();
    }
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    if (!drag.moved && Math.abs(dx) < 4) return;
    if (!drag.moved) { drag.moved = true; if (drag.trim || drag.fx) snapshot(); }
    if (drag.trim) {
      setBoundary(drag.index, drag.t0 + dx / TL.pps);
      renderTimeline();
    } else if (drag.fx) {
      drag.c.t = Math.max(0, Math.min(state.project.duration - 0.1, drag.t0 + dx / TL.pps));
      renderFxTrack();
    }
  });
  window.addEventListener('pointerup', () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.moved) {
      if (d.trim || d.fx) { save(); if (d.trim) renderInspector(); else renderSoundPane(); }
      return;
    }
    if (d.fx) selectFx(d.fx.dataset.id);
    else if (d.clip) select(d.clip.dataset.id, true);
  });
}());

async function select(id, seek) {
  state.selected = id;
  state.selectedFx = null;
  const seg = state.project.segments.find((s) => s.id === id);
  renderTimeline();
  renderInspector();
  showTab('shot');
  if (seek && seg && state.media) await seekTo(seg.start + Math.min(0.2, (seg.end - seg.start) / 3));
}

// tabs
function showTab(name) {
  $$('#ed-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $$('.ed-panel').forEach((p) => { p.hidden = p.dataset.pane !== name; });
  if (name === 'sound') renderSoundPane();
  requestAnimationFrame(updateSegThumbs);
}
$('#ed-tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });

// sound effects pane
function selectFx(id) {
  state.selectedFx = id;
  renderFxTrack();
  showTab('sound');
  const c = state.project.sfx.find((x) => x.id === id);
  if (c) state.sfxPlayer.preview(graph(), c.type, c.vol ?? 1);
}

function renderSoundPane() {
  const p = state.project;
  if (!p) return;
  $('#vol-voice').value = p.settings.voiceVol ?? 1;
  $('#vol-sfx').value = p.settings.sfxVol ?? 0.8;
  $('#vol-voice').closest('label').hidden = !state.file;
  const c = (p.sfx || []).find((x) => x.id === state.selectedFx);
  $('#sfx-selected').innerHTML = c ? `
    <div class="fx-card">
      <div class="fx-card-head"><span class="fx-ico">${sfxInfo(c.type)?.icon || '♪'}</span><div><b>${esc(sfxInfo(c.type)?.name || c.type)}</b><small class="muted">at ${fmtTC(c.t)} · drag it on the timeline to move</small></div></div>
      <label class="range-field">Volume <input type="range" data-fx="vol" min="0" max="1.5" step="0.05" value="${c.vol ?? 1}"></label>
      <div class="tool-row">
        <button class="btn glass sm" data-fx="play">${icon('play')}Play</button>
        <button class="btn glass sm" data-fx="here">Move to playhead</button>
        <button class="btn glass sm danger" data-fx="del">${icon('trash')}Delete</button>
      </div>
    </div>` : '';
  $('#sfx-lib').innerHTML = SFX.map((x) => `
    <button class="sfx-tile" data-add="${x.id}"><span>${x.icon}</span><b>${esc(x.name)}</b><i class="pv" data-pv="${x.id}" title="Preview">${icon('play')}</i></button>`).join('');
}

$('#sfx-lib').addEventListener('click', (e) => {
  const pv = e.target.closest('[data-pv]');
  if (pv) { e.stopPropagation(); state.sfxPlayer.preview(graph(), pv.dataset.pv, state.project.settings.sfxVol ?? 0.8); return; }
  const add = e.target.closest('[data-add]');
  if (!add || !state.project) return;
  snapshot();
  const c = { id: newId(), type: add.dataset.add, t: +(state.media?.time || 0).toFixed(2), vol: 1 };
  state.project.sfx = [...(state.project.sfx || []), c];
  save();
  state.selectedFx = c.id;
  renderFxTrack(); renderSoundPane();
  state.sfxPlayer.preview(graph(), c.type, (state.project.settings.sfxVol ?? 0.8));
  toast(`${sfxInfo(c.type).name} added at ${fmtTC(c.t)}`);
});
$('#sfx-selected').addEventListener('click', (e) => {
  const b = e.target.closest('[data-fx]');
  const c = state.project?.sfx?.find((x) => x.id === state.selectedFx);
  if (!b || !c) return;
  if (b.dataset.fx === 'play') state.sfxPlayer.preview(graph(), c.type, c.vol ?? 1);
  if (b.dataset.fx === 'here') { snapshot(); c.t = +(state.media?.time || 0).toFixed(2); save(); renderFxTrack(); renderSoundPane(); }
  if (b.dataset.fx === 'del') { snapshot(); state.project.sfx = state.project.sfx.filter((x) => x !== c); state.selectedFx = null; save(); renderFxTrack(); renderSoundPane(); }
});
$('#sfx-selected').addEventListener('change', (e) => {
  const c = state.project?.sfx?.find((x) => x.id === state.selectedFx);
  if (c && e.target.dataset.fx === 'vol') { snapshot(); c.vol = +e.target.value; save(); state.sfxPlayer.preview(graph(), c.type, c.vol); }
});
['#vol-voice', '#vol-sfx'].forEach((sel) => $(sel).addEventListener('input', (e) => {
  if (!state.project) return;
  state.project.settings[sel === '#vol-voice' ? 'voiceVol' : 'sfxVol'] = +e.target.value;
  setMix(graph(), state.project.settings);
  save();
}));

function splitAtPlayhead() {
  const p = state.project;
  const now = state.media.time;
  const seg = segmentAt(p.segments, now);
  const i = p.segments.indexOf(seg);
  if (now < seg.start + 0.4 || now > seg.end - 0.4) { toast('Move the playhead further inside a clip to split it.'); return; }
  edit(() => {
    const copy = JSON.parse(JSON.stringify(seg));
    copy.id = newId(); copy.start = now; copy.reason = 'Split from the previous shot.';
    seg.end = now;
    p.segments.splice(i + 1, 0, copy);
    state.selected = copy.id;
  });
}
$('#btn-split').addEventListener('click', splitAtPlayhead);

function renderTranscript() {
  const p = state.project;
  const el = $('#transcript');
  const segs = p.approved ? p.segments : [];
  el.innerHTML = p.words.map((w, i) => {
    const seg = segs.length ? segmentAt(segs, w.s) : null;
    return `<span data-i="${i}" class="${seg ? `w-${shotType(seg, p.settings)}` : ''}">${esc(w.w)}</span>`;
  }).join(' ');
}

const currentSeg = () => state.project.segments.find((s) => s.id === state.selected);

function renderInspector() {
  const p = state.project;
  const el = $('#inspector');
  const i = p.segments.findIndex((s) => s.id === state.selected);
  const seg = p.segments[i];
  if (!seg) { el.innerHTML = '<p class="muted">Click a shot on the timeline below to edit it.</p>'; return; }
  const type = shotType(seg, p.settings);
  const sc = seg.scene;
  const types = p.settings.faceMode === 'bubble' ? ['face', 'scene', 'scene_bubble'] : ['face', 'scene'];
  const pending = state.cache.pending?.has(seg.id);
  el.innerHTML = `
    <div class="insp-head"><strong>Shot ${i + 1} of ${p.segments.length}</strong><span class="muted small">${fmtTime(seg.start)}–${fmtTime(seg.end)} · ${(seg.end - seg.start).toFixed(1)}s</span></div>
    <p class="quote">“${esc(shotText(seg))}”</p>
    <div class="type-switch">${types.map((t) => `<button data-type="${t}" class="${type === t ? 'on' : ''}"><i></i>${{ face: 'Your face', scene: 'Scene', scene_bubble: 'Scene + face' }[t]}</button>`).join('')}</div>
    ${type === 'face' || !sc ? '' : `
      <div class="shot-img">
        ${seg.image?.key ? '<img alt="Scene illustration">' : `<div class="noimg">${pending ? 'Drawing…' : 'Not drawn yet'}</div>`}
        ${seg.image?.key ? qcBadge(seg.image) : ''}
      </div>
      ${seg.image?.qc && !seg.image.qc.pass ? `<p class="warn-text">Quality check: ${esc(seg.image.qc.issues.join('; '))}</p>` : ''}
      ${seg.image?.stale ? '<p class="warn-text">You changed this scene since it was drawn. Redraw to update it.</p>' : ''}
      <label class="field">What the scene shows
        <textarea data-s="image_prompt" rows="3" placeholder="Who is where, doing what, with which expressions">${esc(sc.image_prompt || '')}</textarea>
      </label>
      <div class="field">Characters in this shot
        <div class="chips">${sc.actors.map((a, k) => `<span class="chip">${esc(p.characters.find((c) => c.id === a.character_id)?.name || a.character_id)}<button data-a="remove" data-k="${k}" aria-label="Remove">✕</button></span>`).join('')}
          ${sc.actors.length < 4 && p.characters.some((c) => !sc.actors.some((a) => a.character_id === c.id)) ? `<select data-act="add-cast"><option value="">+ Add</option>${p.characters.filter((c) => !sc.actors.some((a) => a.character_id === c.id)).map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select>` : ''}
        </div>
      </div>
      <label class="field">Change request <span class="hint">optional</span>
        <input id="redo-note" placeholder="e.g. make Dad look more shocked">
      </label>
      <div class="tool-row">
        <button class="btn primary sm" data-act="redraw" ${pending ? 'disabled' : ''}>${icon('redo')}${seg.image?.key ? 'Redraw image' : 'Draw this scene'}</button>
        <button class="btn glass sm" data-act="redo-ai" data-tip="Let the AI rethink this scene, then redraw">${icon('wand')}Rethink scene</button>
      </div>
      <div class="status" id="redo-status"></div>`}
    <details>
      <summary>Timing</summary>
      <div class="time-row" style="margin-top:12px">
        <label class="field">Starts (s)<input type="number" step="0.1" data-f="start" value="${seg.start.toFixed(2)}" ${i === 0 ? 'disabled' : ''}></label>
        <label class="field">Ends (s)<input type="number" step="0.1" data-f="end" value="${seg.end.toFixed(2)}" ${i === p.segments.length - 1 ? 'disabled' : ''}></label>
      </div>
      <div class="tool-row" style="margin-top:10px">
        <button class="btn glass sm" data-act="split" data-tip="Split this shot where the playhead is">${icon('scissors')}Split</button>
        <button class="btn glass sm" data-act="merge" ${i === p.segments.length - 1 ? 'disabled' : ''} data-tip="Join with the next shot">${icon('merge')}Merge</button>
      </div>
    </details>`;
  const img = el.querySelector('.shot-img img');
  if (img) fillImg(img, seg.image.key);
}

function defaultSceneFor(seg) {
  const p = state.project;
  const i = p.segments.indexOf(seg);
  const near = [...p.segments.slice(0, i).reverse(), ...p.segments.slice(i + 1)].find((s) => s.scene);
  const scene = near ? JSON.parse(JSON.stringify(near.scene)) : { setting: 'blank', actors: [{ character_id: 'me', x: 0.5, pose: 'stand', expression: 'neutral', facing: 'right', speech: '' }], props: [], effects: [] };
  return { ...scene, image_prompt: shotText(seg), sound_effect: '' };
}

function setBoundary(i, t) {
  const segs = state.project.segments;
  if (i <= 0 || i >= segs.length) return;
  const lo = segs[i - 1].start + 0.5, hi = segs[i].end - 0.5;
  if (lo > hi) return;
  const v = Math.min(hi, Math.max(lo, t));
  segs[i].start = v; segs[i - 1].end = v;
}

const markStale = (seg) => { if (seg.image?.key) seg.image.stale = true; };

$('#inspector').addEventListener('click', async (e) => {
  const seg = currentSeg();
  const t = e.target.closest('button');
  if (!seg || !t) return;
  const p = state.project;
  const i = p.segments.indexOf(seg);
  const act = t.dataset.act;
  if (t.dataset.type) {
    edit(() => {
      seg.type = t.dataset.type;
      if (seg.type !== 'face' && !seg.scene) seg.scene = defaultSceneFor(seg);
    });
  } else if (t.dataset.a === 'remove') {
    if (seg.scene.actors.length <= 1) { toast('A scene needs at least one character.'); return; }
    edit(() => { seg.scene.actors.splice(+t.dataset.k, 1); seg.scene = normalizeScene(seg.scene, p.characters); markStale(seg); });
  } else if (act === 'split') {
    const now = state.media.time;
    if (now < seg.start + 0.5 || now > seg.end - 0.5) { toast('Move the playhead inside this shot (at least 0.5s from either end) to split it.'); return; }
    edit(() => {
      const copy = JSON.parse(JSON.stringify(seg));
      copy.id = newId(); copy.start = now; copy.reason = 'Split from the previous shot.';
      seg.end = now;
      p.segments.splice(i + 1, 0, copy);
    });
  } else if (act === 'merge') {
    edit(() => { const next = p.segments[i + 1]; seg.end = next.end; p.segments.splice(i + 1, 1); });
  } else if (act === 'redraw') {
    generateScenes([seg], $('#redo-note')?.value.trim());
  } else if (act === 'redo-ai') {
    const { key, model } = settingsGet();
    if (!key) { openSettings(); return; }
    t.disabled = true;
    setStatus('#redo-status', 'Rethinking this scene…', 'busy');
    try {
      const scene = await redoSceneWithClaude(key, p, seg, $('#redo-note')?.value.trim(), { model });
      edit(() => { seg.scene = normalizeScene(scene, p.characters); markStale(seg); });
      if (hasImageKey()) generateScenes([seg]);
    } catch (err) {
      console.error(err);
      setStatus('#redo-status', `Couldn't rethink it: ${errText(err)}`, 'err');
      t.disabled = false;
    }
  }
});

$('#inspector').addEventListener('change', (e) => {
  const seg = currentSeg();
  if (!seg) return;
  const p = state.project;
  const i = p.segments.indexOf(seg);
  const t = e.target;
  if (t.dataset.f === 'start') edit(() => setBoundary(i, +t.value));
  else if (t.dataset.f === 'end') edit(() => setBoundary(i + 1, +t.value));
  else if (t.dataset.s) edit(() => { seg.scene[t.dataset.s] = t.value; seg.scene = normalizeScene(seg.scene, p.characters); markStale(seg); });
  else if (t.dataset.act === 'add-cast' && t.value) {
    edit(() => {
      seg.scene.actors.push({ character_id: t.value, x: 0.8, pose: 'stand', expression: 'neutral', facing: 'left', speech: '' });
      seg.scene = normalizeScene(seg.scene, p.characters);
      markStale(seg);
    });
  }
});

// ---------- export ----------

function readExportUI() {
  const s = state.project.settings;
  s.captions = $('#opt-captions').checked;
  s.captionStyle = { ...(s.captionStyle || {}), upper: $('#opt-upper').checked };
  s.punchIn = $('#opt-punch').checked;
  s.watermark = $('#opt-watermark').checked;
  s.faceX = +$('#face-x').value;
  save(); drawPreview();
}
['#opt-captions', '#opt-upper', '#opt-punch', '#opt-watermark', '#face-x'].forEach((sel) => $(sel).addEventListener('input', () => state.project && readExportUI()));

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

const baseName = () => (state.file ? state.file.name.replace(/\.[^.]+$/, '') : 'storycuts-demo');

async function doExport() {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) { toast('This browser can\'t record video. Please use Chrome or Edge.', 6000); return; }
  const btn = $('#btn-export');
  if (state.exporting) { state.exporting.abort(); return; }
  const undrawn = sceneSegs().filter((sg) => !sg.image?.key).length;
  if (undrawn && !confirm(`${undrawn} scene${undrawn > 1 ? 's aren\'t' : ' isn\'t'} drawn yet and will show as a placeholder. Export anyway?`)) return;
  const ac = new AbortController();
  state.exporting = ac;
  btn.querySelector('span').textContent = 'Cancel export';
  const bar = $('#ex-progress');
  bar.classList.remove('hidden');
  setStatus('#ex-status', 'Rendering… keep this tab open and in front.', 'busy');
  try {
    if (!state.media.paused) state.media.pause();
    const { blob, ext } = await exportVideo(state.project, state.media, {
      aspect: state.aspect, signal: ac.signal, sfxPlayer: state.sfxPlayer, onProgress: (f) => { bar.firstElementChild.style.width = `${Math.min(100, f * 100).toFixed(1)}%`; },
    });
    if (ac.signal.aborted) { setStatus('#ex-status', 'Export cancelled.'); return; }
    download(blob, `${baseName()}-storycuts-${state.aspect}.${ext}`);
    setStatus('#ex-status', `Done! ${(blob.size / 1e6).toFixed(1)} MB ${ext.toUpperCase()} saved to your downloads.${ext === 'webm' ? ' (WebM works on TikTok and YouTube.)' : ''}`, 'ok');
  } catch (e) {
    console.error(e);
    setStatus('#ex-status', `Export failed: ${errText(e)}`, 'err');
  } finally {
    state.exporting = null;
    btn.querySelector('span').textContent = 'Export video';
    setTimeout(() => bar.classList.add('hidden'), 800);
  }
}

function saveProjectFile() {
  const blob = new Blob([JSON.stringify({ app: 'storycuts', v: 2, video: state.file?.name || 'demo', ...state.project }, null, 1)], { type: 'application/json' });
  download(blob, `${baseName()}.storycuts.json`);
}

async function loadProjectFile(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'storycuts') throw new Error('Not a StoryCuts project file.');
    if (!state.project) { toast(`Upload the matching video first (${data.video}).`); return; }
    if (Math.abs(data.duration - state.project.duration) > 0.5) toast(`Heads up: this project was made for a different video (${data.video}).`, 6000);
    snapshot();
    const { words, characters, segments, settings, approved, title, locations = [], sfx = [] } = data;
    Object.assign(state.project, { words, characters, locations, sfx, segments, settings: { ...state.project.settings, ...settings }, approved, title });
    runQC(state.project);
    save(); syncOptionsUI(); refresh();
    toast('Project loaded.');
  } catch (e) {
    toast(`Couldn't open that project: ${e.message}`, 5000);
  }
}

// ---------- wiring ----------

$('#file').addEventListener('change', (e) => loadFile(e.target.files[0]));
const drop = $('#drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));
$('#btn-demo').addEventListener('click', loadDemo);
$('#cta-demo').addEventListener('click', () => { loadDemo(); });
$('#btn-create').addEventListener('click', createVideo);
$('#btn-use-paste').addEventListener('click', usePaste);
$('#btn-reset').addEventListener('click', resetPlan);
$('#btn-approve').addEventListener('click', approveAndDraw);
$('#btn-play').addEventListener('click', togglePlay);
$('#transcript').addEventListener('click', async (e) => {
  const i = e.target.dataset.i;
  if (i == null || !state.media) return;
  const w = state.project.words[+i];
  await state.media.seek(w.s);
  if (state.project.approved) select(segmentAt(state.project.segments, w.s).id, false);
  drawPreview();
});
$('#btn-export').addEventListener('click', doExport);
$('#btn-srt').addEventListener('click', () => state.project?.words.length && download(new Blob([toSRT(state.project.words)], { type: 'text/plain' }), `${baseName()}.srt`));
$('#btn-save').addEventListener('click', saveProjectFile);
$('#load-project').addEventListener('change', (e) => e.target.files[0] && loadProjectFile(e.target.files[0]));
$('#btn-keys').addEventListener('click', openSettings);
$('#btn-undo').addEventListener('click', undo);
document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !typing) { e.preventDefault(); undo(); }
  if (e.key === ' ' && state.project?.approved && !typing && document.activeElement.tagName !== 'BUTTON') { e.preventDefault(); togglePlay(); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && state.selectedFx && state.project) {
    e.preventDefault(); snapshot();
    state.project.sfx = state.project.sfx.filter((x) => x.id !== state.selectedFx);
    state.selectedFx = null; save(); renderFxTrack(); renderSoundPane();
  }
});
$('#video').addEventListener('seeked', drawPreview);

// ---------- interaction polish ----------

/** Segmented controls get a thumb that slides to the selected option. */
function updateSegThumbs() {
  $$('.seg').forEach((seg) => {
    let thumb = seg.querySelector('.seg-thumb');
    if (!thumb) {
      thumb = document.createElement('span');
      thumb.className = 'seg-thumb';
      seg.prepend(thumb);
      seg.classList.add('has-thumb');
      new MutationObserver(updateSegThumbs).observe(seg, { subtree: true, attributeFilter: ['class'] });
    }
    const on = seg.querySelector('button.on');
    if (!on || !on.offsetWidth) { thumb.style.opacity = 0; return; }
    thumb.style.opacity = 1;
    const tx = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`;
    if (thumb.style.transform !== tx || thumb.style.width !== `${on.offsetWidth}px`) {
      thumb.style.transform = tx;
      thumb.style.width = `${on.offsetWidth}px`;
      thumb.style.height = `${on.offsetHeight}px`;
    }
  });
}
window.addEventListener('resize', () => requestAnimationFrame(updateSegThumbs));
document.fonts?.ready.then(updateSegThumbs);

/** Cursor spotlight + gentle 3D tilt on cards and glass buttons. */
document.addEventListener('pointermove', (e) => {
  const el = e.target.closest?.('.spot, .btn.glass, .style-card, .char, .pipeline li');
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${e.clientX - r.left}px`);
  el.style.setProperty('--my', `${e.clientY - r.top}px`);
  if (el.classList.contains('style-card') && e.pointerType === 'mouse') {
    el.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 10}deg`);
    el.style.setProperty('--rx', `${(0.5 - (e.clientY - r.top) / r.height) * 8}deg`);
  }
}, { passive: true });
document.addEventListener('pointerout', (e) => {
  const el = e.target.closest?.('.style-card');
  if (el && !el.contains(e.relatedTarget)) { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); }
});

/** Reveal sections as they scroll into view. */
const io = new IntersectionObserver((entries) => entries.forEach((en) => {
  if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
}), { threshold: 0.12 });
$$('.reveal').forEach((el) => io.observe(el));

renderStyles();
loadStyleManifest().then(() => renderStyles());
requestAnimationFrame(updateSegThumbs);
updateKeysDot();
sizePreview();
renderStepper();

// test hook
window.__storycuts = { state, loadDemo };
