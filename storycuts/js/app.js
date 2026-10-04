import {
  drawFrame, segmentAt, exportVideo, toSRT, audioGraph, setMix, ASPECTS, shotType, FILTERS, filterCss, TRANSITIONS, CAPTION_STYLES,
} from './render.js';
import {
  SFX_CATS, allSfx, sfxInfo, registerSfx, loadSfxManifest, sfxPeaks, SfxPlayer, MusicPlayer,
} from './sfx.js';
import {
  BILLING, planById, monthlyPrice, yearlyTotal, currentPlan, hasAccess, checkoutUrl, handleReturn,
} from './billing.js';
import {
  VIDEO_MODELS, videoModelInfo, estimateAnimCost, animateScene, animReady,
} from './animate.js';
import { showLoader } from './loader.js';
import { runQC, normalizeScene, normalizeSegments, normalizeCharacters, newId, slug, wordsIn } from './qc.js';
import { planWithClaude, redoSceneWithClaude, estimateCost, DEFAULT_MODEL } from './planner.js';
import { transcribeInBrowser, wordsFromText, wordsFromSubtitles, decodeAudio, speechSpans } from './transcribe.js';
import {
  IMAGE_MODELS, STYLES, canAnimate, modelInfo, storageProblem, deleteBlobs, hasBlob, generateCharacterImage, generateSceneImage, estimateImageCost, getBlob, putBlob, pool, orderForConsistency, loadStyleManifest,
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
  musicPlayer: new MusicPlayer(),
  sfxCat: 'all',
  transScope: 'all',
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
    c.fillStyle = 'rgba(0,0,0,0.38)';
    c.beginPath(); c.roundRect ? c.roundRect(W / 2 - 62, 70, 124, 44, 22) : c.rect(W / 2 - 62, 70, 124, 44); c.fill();
    c.fillStyle = '#fff'; c.font = '700 24px Inter, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('DEMO', W / 2, 93);
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
    videoModel: store.get('storycuts:vmodel', VIDEO_MODELS[0].id),
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
  $('#video-model').innerHTML = VIDEO_MODELS.map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join('');
  $('#video-model').value = s.videoModel;
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
  store.set('storycuts:vmodel', $('#video-model').value);
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
  indexProject();
  store.set(storageKey(), {
    v: 2, title: p.title, duration: p.duration, words: p.words, characters: p.characters, locations: p.locations, sfx: p.sfx,
    segments: p.segments, settings: p.settings, approved: p.approved,
  });
}

const editState = (p) => JSON.stringify({ words: p.words, characters: p.characters, locations: p.locations, sfx: p.sfx, segments: p.segments, approved: p.approved, settings: p.settings });

function syncUndoButtons() {
  $('#btn-undo').disabled = !state.history.length;
  $('#btn-redo').disabled = !state.future?.length;
}

function snapshot() {
  state.history.push(editState(state.project));
  if (state.history.length > 60) state.history.shift();
  state.future = [];
  syncUndoButtons();
}

function restore(snap) {
  Object.assign(state.project, JSON.parse(snap));
  save();
  refresh();
  if (state.step === 5) { renderSoundPane(); renderTextPane(); drawPreview(); }
}

function undo() {
  const snap = state.history.pop();
  if (!snap) return;
  (state.future ||= []).push(editState(state.project));
  restore(snap);
  syncUndoButtons();
  toast('Undone');
}

function redo() {
  const snap = state.future?.pop();
  if (!snap) return;
  state.history.push(editState(state.project));
  restore(snap);
  syncUndoButtons();
  toast('Redone');
}

function edit(fn) {
  snapshot();
  fn();
  save();
  refresh();
}

// ---------- your projects (saved on this device) ----------
const PROJ_INDEX = 'storycuts:projects';
const projectList = () => store.get(PROJ_INDEX, []).filter((x) => x && x.key);

function indexProject() {
  const p = state.project;
  if (!p || !state.file) return;
  const key = storageKey();
  const list = projectList().filter((x) => x.key !== key);
  const first = p.segments.find((sg) => sg.image?.key) || p.characters.find((c) => c.image?.key);
  const prev = projectList().find((x) => x.key === key) || {};
  list.unshift({
    ...prev, key, name: state.file.name, size: state.file.size, title: p.title !== 'My story' ? p.title : state.file.name.replace(/\.[^.]+$/, ''),
    duration: p.duration, updated: Date.now(), approved: !!p.approved, style: p.settings.style,
    thumb: first?.image?.key || null, shots: p.segments.length,
  });
  store.set(PROJ_INDEX, list.slice(0, 40));
  clearTimeout(indexProject.t);
  indexProject.t = setTimeout(renderProjects, 300);
}

/** Keep a copy of the source video so the project can be reopened later. */
async function keepVideo(file) {
  const key = `${storageKey()}/video`;
  if (file.size > 1.5e9 || await hasBlob(key)) return;
  try {
    const est = await navigator.storage?.estimate?.();
    if (est && est.quota - est.usage < file.size * 1.3) return;
    await navigator.storage?.persist?.();
  } catch { /* estimate not supported */ }
  if (await putBlob(key, file, { quiet: true })) renderProjects();
}

/** A small cover frame for the project card. */
async function grabPoster(video) {
  const key = storageKey();
  if (projectList().find((x) => x.key === key)?.poster) return;
  try {
    const t0 = video.currentTime;
    await new Promise((r) => { video.addEventListener('seeked', r, { once: true }); video.currentTime = Math.min(1, video.duration / 3); setTimeout(r, 1500); });
    const c = document.createElement('canvas');
    c.width = 180; c.height = 225;
    const sc = Math.max(c.width / video.videoWidth, c.height / video.videoHeight);
    c.getContext('2d').drawImage(video, (c.width - video.videoWidth * sc) / 2, (c.height - video.videoHeight * sc) / 2, video.videoWidth * sc, video.videoHeight * sc);
    const poster = c.toDataURL('image/jpeg', 0.7);
    video.currentTime = t0;
    store.set(PROJ_INDEX, projectList().map((x) => (x.key === key ? { ...x, poster } : x)));
    renderProjects();
  } catch { /* cosmetic */ }
}

const ago = (ts) => {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
  return new Date(ts).toLocaleDateString();
};

async function renderProjects() {
  const list = projectList();
  $('#projects').hidden = !list.length;
  if (!list.length) return;
  const saved = await Promise.all(list.map((x) => hasBlob(`${x.key}/video`)));
  $('#proj-row').innerHTML = list.map((x, i) => `
    <div class="proj-card" data-key="${esc(x.key)}" role="button" tabindex="0">
      <div class="proj-thumb" style="--t1:${STYLES[x.style]?.tint?.[0] || '#2a2140'};--t2:${STYLES[x.style]?.tint?.[1] || '#1a1428'}">
        ${x.thumb ? '<img alt="">' : x.poster ? `<img class="poster" src="${x.poster}" alt="">` : ''}
        <span class="proj-badge ${x.approved ? 'ed' : ''}">${x.approved ? 'In editor' : 'Draft'}</span>
        <span class="proj-dur">${fmtTime(x.duration || 0)}</span>
      </div>
      <div class="proj-meta">
        <b>${esc(x.title || x.name)}</b>
        <small>${ago(x.updated)}${saved[i] ? '' : ' · video not saved'}</small>
      </div>
      <button class="proj-del" data-del="${esc(x.key)}" aria-label="Delete project" title="Delete">${icon('trash')}</button>
    </div>`).join('');
  $$('#proj-row .proj-card').forEach((card, i) => {
    const img = card.querySelector('img:not(.poster)');
    if (img && list[i].thumb) fillImg(img, list[i].thumb);
  });
}

async function openProject(key) {
  const x = projectList().find((p) => p.key === key);
  if (!x) return;
  const blob = await getBlob(`${key}/video`);
  if (!blob) {
    toast(`This project's video isn't saved on this device. Choose "${x.name}" again to reopen it.`, 6000);
    $('#rights').checked = true;
    $('#file').click();
    return;
  }
  await loadFile(new File([blob], x.name, { type: blob.type || 'video/mp4' }), { reopen: true });
}

$('#proj-row').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del]');
  if (del) {
    e.stopPropagation();
    const key = del.dataset.del;
    const x = projectList().find((p) => p.key === key);
    if (!confirm(`Delete "${x?.title || x?.name}" and its pictures from this device?`)) return;
    store.set(PROJ_INDEX, projectList().filter((p) => p.key !== key));
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    await deleteBlobs(`${key}/`);
    if (state.file && key === storageKey()) { location.reload(); return; }
    renderProjects();
    toast('Project deleted.');
    return;
  }
  const card = e.target.closest('.proj-card');
  if (card) { card.classList.add('opening'); await openProject(card.dataset.key); card.classList.remove('opening'); }
});
$('#proj-row').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.closest('.proj-card')?.click(); });
$$('[data-projects]').forEach((a) => a.addEventListener('click', () => { if (!editorOpen()) goStep(1, { scroll: false }); }));

function defaultSettings() {
  return {
    style: store.get('storycuts:style', 'stick'),
    aspect: 'vertical',
    faceMode: 'full',
    pacing: 'mostly',
    castHints: [],
    captions: true, captionStyle: { upper: true, preset: 'bold', pos: 'low', size: 1, highlight: '#ffd60a' }, punchIn: true,
    filter: 'none', filterAmt: 1, transition: 'cut', music: null, customSfx: [], sceneMotion: 'still', faceX: 0.5, faceY: 0.4, bubbleSide: 'right', watermark: false,
  };
}

function loadProject(duration) {
  const saved = store.get(storageKey());
  state.project = { title: 'My story', duration, words: [], characters: [], locations: [], sfx: [], segments: [], approved: false, settings: defaultSettings() };
  state.peaks = undefined;
  faceThumbs.clear();
  state.history = [];
  state.future = [];
  state.selected = null;
  state.cache = {};
  if (saved && Math.abs((saved.duration || 0) - duration) < 0.5) {
    Object.assign(state.project, saved, { duration, settings: { ...defaultSettings(), ...saved.settings } });
    if (!['mostly', 'bookends', 'story'].includes(state.project.settings.pacing)) state.project.settings.pacing = 'mostly';
    if (saved.segments?.length) toast('Picked up where you left off with this video.');
  }
  state.aspect = state.project.settings.aspect || 'vertical';
  (state.project.settings.customSfx || []).forEach(registerSfx);
  syncOptionsUI();
  refresh();
}

/** Re-render everything that depends on the project. */
function refresh() {
  const p = state.project;
  if (!p) return;
  document.body.classList.toggle('bubble-mode', p.settings.faceMode === 'bubble');
  $('#panel-upload [data-next]').disabled = false;
  $('#btn-to-editor').hidden = true;
  $('#btn-reset').hidden = !p.segments.length;
  renderPipeline();
  renderStepper();
  if (p.characters.length) renderChars();
  if (p.approved) { renderTimeline(); renderInspector(); ensurePeaks(); }
  renderTranscript();
  renderPrep();
  renderSummary();
  updateCosts();
  sizePreview();
  drawPreview();
  requestAnimationFrame(updateSegThumbs);
}

// ---------- step-by-step wizard ----------

const maxStep = () => (!state.project ? 1 : state.project.approved ? 5 : 4);

function renderStepper() {
  const cur = state.step || 1;
  const max = maxStep();
  $$('#stepper li').forEach((li) => {
    const n = +li.dataset.s;
    li.classList.toggle('active', n === cur);
    li.classList.toggle('done', n < cur);
    li.classList.toggle('reach', n <= max);
  });
}

function goStep(n, { scroll = true } = {}) {
  n = Math.max(1, Math.min(maxStep(), n));
  const prev = state.step || 1;
  state.step = n;
  $$('.wizard > .panel').forEach((panel) => {
    const on = +panel.dataset.step === n;
    panel.classList.toggle('active', on);
    panel.classList.remove('in-fwd', 'in-back');
    if (on && prev !== n) { void panel.offsetWidth; panel.classList.add(n > prev ? 'in-fwd' : 'in-back'); }
  });
  renderStepper();
  if (n === 2) requestAnimationFrame(() => layoutStyles(true));
  if (n === 4) { renderSummary(); if (state.project?.characters.length) checkCastPictures(); }
  setFullEditor(n === 5);
  if (n === 5 && state.project?.approved && !state.project.segments.some((sg) => sg.id === state.selected)) state.selected = state.project.segments[0]?.id;
  if (n === 5 && state.project?.approved) {
    checkScenePictures();
    requestAnimationFrame(() => { sizePreview(); renderTimeline(); renderInspector(); drawPreview(); ensurePeaks(); });
  }
  if (n !== 5 && state.media && !state.media.paused) { state.media.pause(); stopAudio(); }
  requestAnimationFrame(updateSegThumbs);
  if (scroll && !editorOpen()) {
    const top = $('#studio').getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.4) $('#studio').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

$('#wizard').addEventListener('click', (e) => {
  const b = e.target.closest('[data-next], [data-back]');
  if (!b || b.disabled) return;
  goStep(+(b.dataset.next || b.dataset.back));
});
$('#stepper').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (li && +li.dataset.s <= maxStep()) goStep(+li.dataset.s);
});

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
  const p0 = state.project;
  const started = !!(state.busy || p0?.segments.length || Object.values(state.stages || {}).some(Boolean));
  const failed = Object.values(state.stages || {}).includes('error');
  const phase = !started ? 'start' : state.busy || failed || !p0?.segments.length ? 'running' : !p0.approved ? 'cast' : 'ready';
  $('#create-start').classList.toggle('hidden', started);
  $('#run').classList.toggle('hidden', phase !== 'running');
  $('#ready-card').classList.toggle('hidden', phase !== 'ready');
  $('#cast').classList.toggle('hidden', !p0?.characters.length || phase === 'start' || (phase === 'ready' && !state.showCast));
  $('#cast').classList.toggle('reviewed', phase === 'ready');
  $('#btn-reset').hidden = !p0?.segments.length || !!state.busy;
  $('#btn-show-cast').textContent = state.showCast ? 'Hide your characters' : 'See or change your characters';
  const btn = $('#btn-create');
  const p = state.project;
  const label = btn.querySelector('span');
  btn.classList.toggle('busy', state.busy);
  btn.disabled = state.busy;
  if (state.busy) label.textContent = 'Working…';
  else if (!p?.segments.length) label.textContent = 'Create my video';
  else if (!p.approved) label.textContent = 'Continue';
  else label.textContent = 'Open the editor';
  if (state.project?.characters) renderCastBar();
}

// ---------- step 1: upload ----------

async function loadFile(file, { reopen = false } = {}) {
  if (!file) return;
  if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|m4v|mkv)$/i.test(file.name)) { toast('That doesn\'t look like a video file.'); return; }
  if (!reopen && !$('#rights').checked) {
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
  save();
  keepVideo(file);
  grabPoster(video);
  if (video.duration > 600) toast('Long video: StoryCuts works best on stories under 5 minutes.', 6000);
  setTimeout(() => goStep(state.project.approved ? 5 : 2), 500);
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
  goStep(state.project.approved ? 5 : 2);
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
      <span class="sel-pill">${icon('check')}Selected</span>
      ${s.stillOnly ? '<span class="still-tag">Still only</span>' : ''}
      <span class="meta"><b>${esc(s.label)}</b><small>${esc(s.blurb)}</small></span>
    </button>`).join('') + `
    <button class="style-card custom" data-style="custom" role="option" aria-label="Create your own style">
      <span class="thumb"><span class="ph"><span class="plus">+</span></span><img class="ref-thumb" alt="" hidden></span>
      <span class="sel-pill">${icon('check')}Selected</span>
      <span class="meta"><b>Create your own</b><small>Describe it or upload an example</small></span>
    </button>`;
  $('#style-dots').innerHTML = styleIds().map((id, i) => `<button class="dot" data-i="${i}" aria-label="${esc(id === 'custom' ? 'Create your own' : STYLES[id].label)}"></button>`).join('');
  state.styleIndex = Math.max(0, styleIds().indexOf(cur));
  cfSet(state.styleIndex);
  syncStyleExtras();
}

// The carousel is driven by one continuous number, CF.pos (which card is in
// the middle, fractional while moving). Dragging, trackpad swipes and the
// arrows all move it, and a spring settles it on a whole card.
const CF = { pos: 0, target: 0, vel: 0, raf: 0, last: 0, held: false };
const wrapIndex = (i, n = styleIds().length) => ((Math.round(i) % n) + n) % n;
const cfUnit = () => {
  const track = $('#style-track');
  return Math.max(60, Math.min(($('#style-track .style-card')?.offsetWidth || 300) * 0.62, track.clientWidth * 0.3));
};

/** Position every card relative to CF.pos (wrapping around). */
function layoutStyles() {
  const ids = styleIds();
  const n = ids.length;
  const cards = $$('#style-track .style-card');
  const step = cfUnit();
  const near = wrapIndex(CF.pos, n);
  cards.forEach((card, i) => {
    let d = (i - CF.pos) % n;
    if (d > n / 2) d -= n;
    if (d < -n / 2) d += n;
    const a = Math.abs(d);
    const fade = Math.max(0, Math.min(1, (2.9 - a) / 0.6));
    card.style.transform = `translate3d(calc(-50% + ${(d * step).toFixed(2)}px), 0, ${(-a * 120).toFixed(1)}px) rotateY(${(Math.max(-1, Math.min(1, -d)) * 18).toFixed(2)}deg) scale(${Math.max(0.6, 1 - a * 0.16).toFixed(4)})`;
    card.style.zIndex = String(100 - Math.round(a * 10));
    card.style.opacity = fade.toFixed(3);
    card.style.visibility = fade ? '' : 'hidden';
    card.style.setProperty('--dim', Math.min(0.62, a * 0.32).toFixed(3));
    const center = i === near;
    if (card.classList.contains('on') !== center) {
      card.classList.toggle('on', center);
      card.setAttribute('aria-selected', center);
      card.tabIndex = center ? 0 : -1;
    }
  });
  $$('#style-dots .dot').forEach((dot, i) => dot.classList.toggle('on', i === near));
  const id = ids[near];
  const btn = $('#btn-style-next');
  if (btn) btn.firstChild.textContent = `Continue with ${id === 'custom' ? 'my style' : STYLES[id]?.label || 'this style'}`;
}

function cfTick(now) {
  const dt = Math.min(0.032, (now - (CF.last || now)) / 1000) || 0.016;
  CF.last = now;
  if (!CF.held) {
    // critically damped spring: quick, no wobble
    const k = 210, c = 2 * Math.sqrt(k);
    CF.vel += (k * (CF.target - CF.pos) - c * CF.vel) * dt;
    CF.pos += CF.vel * dt;
    if (Math.abs(CF.target - CF.pos) < 0.0005 && Math.abs(CF.vel) < 0.005) { CF.pos = CF.target; CF.vel = 0; }
  }
  layoutStyles();
  if (CF.held || CF.pos !== CF.target) CF.raf = requestAnimationFrame(cfTick);
  else { CF.raf = 0; CF.last = 0; }
}
const cfKick = () => { if (!CF.raf) { CF.last = 0; CF.raf = requestAnimationFrame(cfTick); } };

/** Jump the carousel to an absolute position (no animation). */
function cfSet(i) { CF.pos = CF.target = i; CF.vel = 0; layoutStyles(); }

function selectStyleIndex(i) {
  const ids = styleIds();
  const n = ids.length;
  // aim for the closest copy of card i so wrapping never spins the long way
  let delta = (wrapIndex(i, n) - wrapIndex(CF.target, n)) % n;
  if (delta > n / 2) delta -= n;
  if (delta < -n / 2) delta += n;
  CF.target = Math.round(CF.target) + delta;
  cfKick();
  state.styleIndex = wrapIndex(i, n);
  const id = ids[state.styleIndex];
  if (!state.project) { store.set('storycuts:style', id); return; }
  if (id === state.project.settings.style) return;
  const hadArt = state.project.characters.some((c) => c.image?.key);
  state.project.settings.style = id;
  store.set('storycuts:style', id);
  save();
  syncStyleExtras();
  syncMotionUI({ announce: true });
  updateCosts();
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
  else { card.classList.remove('chosen'); void card.offsetWidth; card.classList.add('chosen'); setTimeout(() => goStep(3), 260); }
});
$('#style-track').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') { e.preventDefault(); selectStyleIndex(state.styleIndex - 1); $('#style-track .style-card.on')?.focus(); }
  if (e.key === 'ArrowRight') { e.preventDefault(); selectStyleIndex(state.styleIndex + 1); $('#style-track .style-card.on')?.focus(); }
});

// drag / swipe / flick with momentum
(function coverflowDrag() {
  const track = $('#style-track');
  let down = false, x0 = 0, p0 = 0, samples = [];
  track.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    down = true; x0 = e.clientX; p0 = CF.pos; samples = [[performance.now(), e.clientX]];
    state.styleDragged = false;
  });
  window.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - x0;
    if (!state.styleDragged && Math.abs(dx) > 6) {
      state.styleDragged = true; CF.held = true; CF.vel = 0;
      track.classList.add('dragging');
      try { track.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      cfKick();
    }
    if (!state.styleDragged) return;
    CF.pos = p0 - dx / cfUnit();
    samples.push([performance.now(), e.clientX]);
    if (samples.length > 6) samples.shift();
  });
  const end = () => {
    if (!down) return;
    down = false;
    if (!state.styleDragged) return;
    track.classList.remove('dragging');
    // release velocity in cards per second, from the last ~100ms of movement
    const now = performance.now();
    const recent = samples.filter(([t]) => now - t < 120);
    let v = 0;
    if (recent.length > 1) {
      const [t1, x1] = recent[0];
      const [t2, x2] = recent[recent.length - 1];
      if (t2 > t1) v = -((x2 - x1) / (t2 - t1)) * 1000 / cfUnit();
    }
    const projected = CF.pos + v * 0.22;
    const target = Math.round(Math.max(CF.pos - 3, Math.min(CF.pos + 3, projected)));
    CF.held = false;
    CF.vel = v;
    CF.target = target;
    selectStyleIndex(wrapIndex(target));
    CF.target = target;
    cfKick();
    setTimeout(() => { state.styleDragged = false; }, 0);
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);

  // two-finger trackpad swipe (and shift + mouse wheel)
  let wheelTimer = 0;
  track.addEventListener('wheel', (e) => {
    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) * 0.8;
    let d = horizontal ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    if (!d) return;
    e.preventDefault();
    if (e.deltaMode === 1) d *= 16;
    CF.held = true; CF.vel = 0;
    CF.pos += d / (cfUnit() * 1.15);
    CF.target = CF.pos;
    cfKick();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      CF.held = false;
      const target = Math.round(CF.pos);
      selectStyleIndex(wrapIndex(target));
      CF.target = target;
      cfKick();
    }, 90);
  }, { passive: false });

  window.addEventListener('resize', () => layoutStyles());
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
  syncMotionUI();
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

/** Animated scenes are only offered for styles that video models can animate. */
function syncMotionUI({ announce = false } = {}) {
  const st = state.project?.settings;
  if (!st) return;
  const ok = canAnimate(st);
  const btn = $('#seg-motion [data-motion=animated]');
  const small = btn.querySelector('small');
  small.dataset.text ||= small.textContent;
  btn.disabled = !ok;
  btn.classList.toggle('unavailable', !ok);
  small.textContent = ok ? small.dataset.text : `Not available for ${STYLES[st.style]?.label || 'this'} style: video models can't animate photo-real people reliably.`;
  if (!ok && st.sceneMotion === 'animated') {
    st.sceneMotion = 'still';
    save();
    if (announce) toast(`${STYLES[st.style]?.label || 'This'} style uses still pictures, so animated scenes were turned off.`, 5000);
  }
  $$('#seg-motion button').forEach((x) => x.classList.toggle('on', x.dataset.motion === (st.sceneMotion || 'still')));
}

$$('#seg-motion button').forEach((b) => b.addEventListener('click', () => {
  if (!state.project || b.disabled) return;
  state.project.settings.sceneMotion = b.dataset.motion;
  save();
  $$('#seg-motion button').forEach((x) => x.classList.toggle('on', x === b));
  updateCosts(); drawPreview();
  if (b.dataset.motion === 'animated') toast(`Animated scenes: each picture becomes a short clip, about ${fmtUSD(videoModelInfo(settingsGet().videoModel).perSec * 4)} to ${fmtUSD(videoModelInfo(settingsGet().videoModel).perSec * 8)} per scene.`, 5000);
}));

$$('#seg-pacing button').forEach((b) => b.addEventListener('click', () => {
  if (!state.project) return;
  state.project.settings.pacing = b.dataset.pacing;
  save();
  $$('#seg-pacing button').forEach((x) => x.classList.toggle('on', x === b));
  if (state.project.segments.length) toast('Pacing changed. Press "Start over with new settings" in step 4 to re-plan the edit with it.', 5000);
}));

// ---------- step 4 summary ----------

function renderSummary() {
  const p = state.project;
  if (!p) return;
  const s = p.settings;
  const st = s.style === 'custom' ? { label: 'Your custom style' } : STYLES[s.style] || STYLES.stick;
  const pacing = { mostly: 'Normal', bookends: 'Intro & outro', story: 'Voice-over' }[s.pacing] || 'Normal';
  const row = (ico, label, value, back) => `<div class="sum-row"><span class="sum-ico">${ico}</span><span class="sum-txt"><small>${label}</small><b>${esc(value)}</b></span><button class="btn link" data-back="${back}">Change</button></div>`;
  $('#create-summary').innerHTML = [
    row(st.thumb ? `<img src="${esc(st.thumb)}" alt="">` : icon('palette'), 'Style', st.label + (s.styleNotes?.trim() ? ' + your details' : ''), 2),
    row(icon('film'), 'Format & pacing', `${state.aspect === 'horizontal' ? '16:9' : '9:16'} · ${pacing}${s.faceMode === 'bubble' ? ' · face bubble' : ''}${animatedOn(p) ? ' · animated' : ''}`, 3),
    row(icon('user'), 'Video', state.file ? state.file.name : 'Demo story', 1),
  ].join('');
}

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
      <button class="x" data-del="${i}" aria-label="Remove">${icon('close')}</button>
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

const LOADER_KIND = { transcribe: 'listen', plan: 'plan', cast: 'draw', scenes: 'draw' };

function liveStart(stage, title) {
  state.live?.stop();
  const p = state.project;
  const eta = stage === 'transcribe' ? Math.max(20, (p?.duration || 60) * 0.5) : stage === 'plan' ? 40 : 30;
  state.live = showLoader($('#create-live'), { kind: LOADER_KIND[stage], title, tips: TIPS[stage] || [], eta });
}

function liveStop() {
  state.live?.stop();
  state.live = null;
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
  const animated = animatedOn(p);
  const animEst = animated ? (p.segments.length ? estimateAnimCost(sceneSegs(), s.videoModel) : shots * 5 * videoModelInfo(s.videoModel).perSec) : 0;
  $('#create-cost').textContent = `Estimated cost about ${fmtUSD(plan + imgs + animEst)}${animated ? ' with animated scenes' : ''}, paid to your own AI accounts.`;
  if (p.approved) {
    const todo = sceneSegs().filter(needsImage).length;
    const animTodo = animated && !todo ? animSegs().length : 0;
    const busy = !!state.genAbort;
    const animating = busy && state.genMode === 'animate';
    $('#dc-title').textContent = busy ? (animating ? 'Animating your scenes' : 'Drawing your scenes') : todo ? 'Scenes to draw' : animTodo ? 'Scenes to animate' : animated ? 'All scenes animated' : 'All scenes drawn';
    $('#scenes-cost').textContent = busy ? `${state.genDone || 0} of ${state.genTotal} done${animating ? ' · about a minute each' : ''}`
      : todo ? `${todo} scene${todo === 1 ? '' : 's'} · about ${fmtUSD(estimateImageCost(todo, s, s.qc && !!s.key) + (animated ? estimateAnimCost(sceneSegs().filter(needsImage), s.videoModel) : 0))}${animated ? ' incl. animation' : ''}`
        : animTodo ? `${animTodo} scene${animTodo === 1 ? '' : 's'} · about ${fmtUSD(estimateAnimCost(animSegs(), s.videoModel))}`
          : `${sceneSegs().length} scenes, ready to watch`;
    $('#draw-card').classList.toggle('busy', busy);
    $('#draw-card').classList.toggle('done', !busy && !todo && !animTodo);
    const btn = $('#btn-gen-scenes');
    const pending = todo || animTodo;
    btn.classList.toggle('primary', !busy && !!pending);
    btn.classList.toggle('glass', busy || !pending);
    btn.querySelector('svg use').setAttribute('href', busy ? '#i-close' : pending ? '#i-spark' : '#i-redo');
    btn.querySelector('span').textContent = busy ? 'Stop' : todo ? `Draw ${todo === 1 ? 'it' : 'all'}` : animTodo ? `Animate ${animTodo === 1 ? 'it' : 'all'}` : 'Redraw all';
  }
}

async function createVideo() {
  const p = state.project;
  if (!p) { toast('Upload a video first (or try the demo).'); goStep(1); return; }
  if (p.approved) { goStep(5); return; }
  if (state.file && !hasAccess()) { openPaywall(); return; }
  if (!keysReady()) { toast('Connect your Claude and OpenAI accounts to start.', 4500); openSettings(); return; }
  state.busy = true;
  state.stages = {};
  setStatus('#create-status', '');
  renderPipeline(); renderStepper();
  try {
    // 1. transcript
    if (!p.words.length) {
      setStage('transcribe', 'active');
      liveStart('transcribe', 'Listening to your story');
      try {
        const words = await transcribeInBrowser(state.file, {
          quality: $('#asr-quality').value,
          onStatus: (m) => state.live?.update({ title: m.replace(/…$/, '') }),
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
      liveStart('plan', 'Planning your edit and characters');
      const s = settingsGet();
      const notes = [
        $('#plan-notes').value.trim(),
        p.settings.faceMode === 'bubble' ? '' : 'Use only "face" and "scene" shots (no scene_bubble): the creator wants full-frame cuts.',
      ].filter(Boolean).join(' ');
      try {
        const raw = await planWithClaude(s.key, p.words, p.duration, { model: s.model, notes, pacing: p.settings.pacing, cast: p.settings.castHints || [] });
        snapshot();
        p.title = raw.title || p.title;
        p.storySummary = raw.summary || '';
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

    // 3. cast: the creator checks each character's details, then draws them
    liveStop();
    setStage('cast', 'wait');
    setStatus('#create-status', '');
    toast(`Your story has ${p.characters.length} character${p.characters.length === 1 ? '' : 's'}. Check their details, then draw them.`, 5000);
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
  const q = img?.qc;
  if (!q || q.pass) return '';
  return `<span class="qc-badge warn" title="${esc(q.issues.join('; '))}">${icon('alert')}Needs a look</span>`;
}

/** Scene pictures or animations that can't be loaded need drawing again. */
async function checkScenePictures() {
  const p = state.project;
  if (!p?.approved) return;
  let lost = 0;
  for (const sg of p.segments) {
    if (sg.image?.key && !(await hasBlob(sg.image.key))) { delete sg.image; delete sg.anim; lost++; }
    else if (sg.anim?.key && !(await hasBlob(sg.anim.key))) delete sg.anim;
  }
  if (!lost || state.project !== p) return;
  save();
  updateCosts(); renderTimeline(); renderInspector(); drawPreview();
  toast(`${lost} scene picture${lost > 1 ? 's were' : ' was'} missing from this device. Press "Draw" to draw ${lost > 1 ? 'them' : 'it'} again.`, 6000);
}

/** A character whose picture can't be loaded (cleared storage, another device) needs redrawing. */
async function checkCastPictures() {
  const p = state.project;
  const gone = [];
  for (const c of p.characters) if (c.image?.key && !(await hasBlob(c.image.key))) gone.push(c);
  if (!gone.length || state.project !== p) return;
  gone.forEach((c) => { delete c.image; });
  save();
  renderChars(); renderPipeline();
  toast(`${gone.length} character picture${gone.length > 1 ? 's were' : ' was'} missing from this device. Draw ${gone.length > 1 ? 'them' : 'it'} again.`, 5000);
}

async function fillImg(el, key) {
  const blob = await getBlob(key);
  if (!blob) { el.classList.add('missing'); return; }
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
        ${c.image?.key ? '<img alt="">' : `<div class="empty"><span class="avatar">${esc((c.name || '?').trim()[0] || '?')}</span><span class="empty-txt">${busy.size ? 'Waiting to be drawn' : 'Ready to draw'}</span></div>`}
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
  checkCastPictures();
  renderCastBar();
}

/** The bar under the cast: one clear next step at a time. */
function renderCastBar() {
  const p = state.project;
  if (!p) return;
  const n = p.characters.length;
  const drawn = p.characters.filter((c) => c.image?.key).length;
  const missing = n - drawn;
  const busy = state.charBusy?.size || 0;
  const gen = $('#btn-gen-chars');
  const ok = $('#btn-approve');
  const scenes = p.segments.filter((sg) => sg.type !== 'face').length;
  let title, sub;
  if (busy) {
    title = `Drawing your characters: ${drawn} of ${n} done`;
    sub = 'This takes about a minute. You can edit the descriptions while you wait.';
  } else if (missing) {
    title = drawn ? `${missing} character${missing > 1 ? 's' : ''} still need${missing > 1 ? '' : 's'} a picture` : 'Step 1: check the details, then draw';
    sub = drawn ? 'Every scene is drawn from these designs, so each character needs a picture first.' : 'Change any name or description above so each person looks the way you imagine. Then draw them.';
  } else {
    title = 'Step 2: check your characters';
    sub = `Look at each picture. Redraw anyone who looks wrong, then press the button to draw your ${scenes} scene${scenes === 1 ? '' : 's'}.`;
  }
  $('#cb-title').textContent = title;
  $('#cb-sub').textContent = sub;
  gen.hidden = !missing && !busy;
  gen.disabled = !!busy || state.busy;
  gen.classList.toggle('busy', !!busy);
  gen.querySelector('span').textContent = busy ? 'Drawing…' : drawn ? `Draw ${missing} missing` : `Draw ${n === 1 ? 'my character' : `all ${n} characters`}`;
  const sNow = settingsGet();
  $('#cb-cost').textContent = missing && !busy ? `About ${missing > 2 ? Math.ceil(missing / 2) : 1} minute${missing > 2 ? 's' : ''} · about ${fmtUSD(estimateImageCost(missing, sNow, sNow.qc && !!sNow.key))}` : '';
  $('#cb-cost').parentElement.hidden = gen.hidden;
  $('#cast-bar').classList.toggle('cta-big', !!missing && !busy && !drawn);
  $('#cast-title').textContent = !drawn && !busy ? `Your ${n} character${n === 1 ? '' : 's'}` : 'Meet your cast';
  $('#cast-sub').textContent = !drawn && !busy ? 'We found these people in your story. Edit their names and looks below before drawing them.' : missing || busy ? 'Every scene is drawn from these designs.' : 'Every scene is drawn from these designs. Redraw anyone you don\'t love.';
  ok.hidden = !!missing || !!busy;
  ok.disabled = state.busy;
  ok.querySelector('span').textContent = `They look good, draw the ${scenes} scene${scenes === 1 ? '' : 's'}`;
  $('#cb-step1').className = `cb-step ${missing || busy ? 'on' : 'done'}`;
  $('#cb-step2').className = `cb-step ${missing || busy ? '' : 'on'}`;
  $('#cb-step3').className = 'cb-step';
  $('#cast-bar').classList.toggle('ready', !missing && !busy);
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
  const ld = showLoader($('#cast-loader'), {
    kind: 'draw', title: `Drawing ${list.length === 1 ? list[0].name : `your ${list.length} characters`}`, total: list.length, perItem: job.keys.claude ? 40 : 25, parallel: 2,
    tips: ['Each character is designed once and reused in every scene.', 'Picking faces, hair, outfits and colours from your descriptions…', 'Every picture is checked for mistakes like extra fingers, and redrawn if needed.', 'You can keep editing the other descriptions while this runs.'],
  });
  let drawnN = 0;
  setStatus('#chars-status', '');
  const me = list.find((c) => c.id === 'me' && c.useVideoLook !== false);
  const selfFrame = me ? await grabSelfFrame().catch(() => null) : null;
  const results = await pool(list, 2, async (ch) => {
    try {
      const img = await generateCharacterImage(state.project, ch, {
        ...job, selfFrame, onStatus: () => {},
      });
      ch.image = img;
      save();
    } finally {
      state.charBusy.delete(ch.id);
      ld.update({ done: ++drawnN });
      renderChars();
    }
  });
  state.charBusy = new Set();
  ld.stop();
  renderChars();
  const failed = results.filter((r) => !r.ok);
  failed.forEach((f) => console.error('StoryCuts character drawing failed', f.error));
  if (failed.length) {
    setStatus('#chars-status', `Couldn't draw ${failed.length}: ${errText(failed[0].error)}`, 'err');
    return false;
  }
  const scenesDrawn = state.project.segments.some((sg) => sg.image?.key);
  setStatus('#chars-status', `${storageProblem ? `${STORAGE_WARN} ` : ''}${scenesDrawn ? 'Redraw your scenes to use the new looks.' : ''}`);
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
  goStep(5);
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
/** Scenes that still need an animated clip (animated mode only). */
const animatedOn = (p) => p?.settings.sceneMotion === 'animated' && canAnimate(p.settings);
const animSegs = () => sceneSegs().filter((sg) => sg.image?.key && !sg.image.stale && !sg.still && !animReady(sg));

async function animateScenes(list) {
  const s = settingsGet();
  if (!s.openai) { openSettings(); return; }
  if (!list.length) return;
  const ac = { stop: false };
  state.genAbort = ac;
  state.genMode = 'animate';
  state.cache.animating = new Set(list.map((sg) => sg.id));
  state.genDone = 0; state.genTotal = list.length;
  updateCosts(); renderTimeline();
  const ld = showLoader($('#draw-loader'), {
    kind: 'film', compact: true, title: `Animating ${list.length === 1 ? 'this scene' : `${list.length} scenes`}`, total: list.length, perItem: 100, parallel: 2,
    tips: ['Each picture becomes the first frame of a short animated clip.', 'Animation takes one to two minutes per scene.', 'Finished scenes switch to animation as soon as they arrive.', 'You can keep editing while this runs.'],
  });
  setStatus('#scenes-status', '');
  const results = await pool(list, 2, async (sg) => {
    if (ac.stop) throw new Error('stopped');
    try {
      sg.anim = await animateScene(s.openai, state.project, sg, {
        model: s.videoModel, aspect: state.aspect === 'vertical' ? '9:16' : '16:9', projectKey: storageKey(), signal: ac,
        onStatus: (m) => { if (sg.id === state.selected) setStatus('#anim-status', m, 'busy'); },
      });
      save();
    } finally {
      state.cache.animating.delete(sg.id);
      state.genDone++;
      ld.update({ done: state.genDone });
      updateCosts(); renderTimeline(); drawPreview();
      if (sg.id === state.selected) renderInspector();
    }
  });
  state.genAbort = null; state.genMode = null;
  ld.stop();
  const failed = results.filter((r) => !r.ok && r.error.message !== 'stopped');
  failed.forEach((f) => console.error('StoryCuts animation failed', f.error));
  if (failed.length) setStatus('#scenes-status', `${list.length - failed.length} animated. ${failed.length} kept as still pictures: ${errText(failed[0].error)}`, 'err');
  else setStatus('#scenes-status', ac.stop ? 'Stopped.' : '');
  updateCosts(); renderInspector();
}

async function generateScenes(list, note = '') {
  if (!hasImageKey()) { openSettings(); return; }
  if (!list.length) return;
  const job = imageJobOpts();
  const ac = { stop: false };
  state.genAbort = ac;
  state.cache.pending = new Set(list.map((sg) => sg.id));
  updateCosts(); renderTimeline();
  const bar = $('#gen-progress');
  let done = 0;
  state.genDone = 0; state.genTotal = list.length;
  updateCosts();
  const ld = showLoader($('#draw-loader'), {
    kind: 'draw', compact: true, title: `Drawing ${list.length === 1 ? 'this scene' : `${list.length} scenes`}`, total: list.length, perItem: job.keys.claude ? 40 : 25, parallel: 2,
    tips: ['You can keep editing while this runs.', 'Each scene uses your approved characters, so they look the same every time.', 'Scenes in the same place are drawn to match each other.', 'Every picture is checked and redrawn automatically if something looks off.'],
  });
  const aspect = state.aspect === 'vertical' ? '9:16' : '16:9';
  setStatus('#scenes-status', '');
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
      ld.update({ done });
      state.genDone = done; updateCosts();
      renderTimeline();
      if (sg.id === state.selected) renderInspector();
      drawPreview();
    }
  };
  const results = [...await pool(anchors, 2, drawOne), ...await pool(rest, 2, drawOne)];
  state.genAbort = null;
  ld.stop();
  bar.classList.add('hidden');
  const failed = results.filter((r) => !r.ok && r.error.message !== 'stopped');
  const flagged = list.filter((sg) => sg.image?.qc && !sg.image.qc.pass).length;
  const redrawn = list.filter((sg) => sg.image?.attempts > 1).length;
  failed.forEach((f) => console.error('StoryCuts scene drawing failed', f.error));
  if (failed.length) setStatus('#scenes-status', `${list.length - failed.length} drawn, ${failed.length} failed: ${errText(failed[0].error)}`, 'err');
  else if (ac.stop) setStatus('#scenes-status', 'Stopped.');
  else {
    const notes = [storageProblem ? STORAGE_WARN : '', redrawn ? `${redrawn} redrawn automatically after a quality check.` : '', flagged ? `${flagged} marked "Needs a look".` : ''].filter(Boolean).join(' ');
    setStatus('#scenes-status', notes);
  }
  updateCosts();
  renderInspector();
  renderPipeline();
  if (!ac.stop && !failed.length && animatedOn(state.project)) {
    const todo = animSegs().filter((sg) => list.includes(sg));
    if (todo.length) animateScenes(todo);
  }
}

$('#btn-gen-scenes').addEventListener('click', () => {
  if (state.genAbort) { state.genAbort.stop = true; toast(state.genMode === 'animate' ? 'Finishing the animations already in progress…' : 'Finishing the images already in progress…'); return; }
  const todo = sceneSegs().filter(needsImage);
  if (!todo.length && animatedOn(state.project) && animSegs().length) { animateScenes(animSegs()); return; }
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
  state.cache.live = !state.media.paused;
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
  else { $('#btn-play').innerHTML = icon('play'); stopAudio(); }
}

async function togglePlay() {
  const m = state.media;
  if (!m || !state.project?.approved) return;
  if (m.paused) {
    if (m.time >= state.project.duration - 0.05) await m.seek(0);
    await m.play();
    startAudio(m.time);
    $('#btn-play').innerHTML = icon('pause');
    loop();
  } else {
    m.pause();
    stopAudio();
  }
}

function startAudio(from) {
  const g = graph();
  const p = state.project;
  setMix(g, p.settings);
  state.sfxPlayer.start(g, p.sfx || [], from);
  state.musicPlayer.start(g, p.settings.music, from, p.duration);
}
function stopAudio() { state.sfxPlayer.stop(); state.musicPlayer.stop(); }
function restartAudio() { if (state.media && !state.media.paused) startAudio(state.media.time); }

async function seekTo(t, { follow = true } = {}) {
  const m = state.media;
  if (!m) return;
  const playing = !m.paused;
  await m.seek(Math.max(0, Math.min(state.project.duration - 0.01, t)));
  if (playing) startAudio(m.time);
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
  if (!p?.approved || !$('#tl-scroll').clientWidth) return; // editor not visible yet
  tlSetup();
  const el = $('#timeline');
  el.innerHTML = p.segments.map((s, i) => {
    const type = shotType(s, p.settings);
    const st = type === 'face' ? '' : state.cache.pending?.has(s.id) ? 'pending' : !s.image?.key ? 'noimg' : s.image.qc && !s.image.qc.pass ? 'warn' : s.image.stale ? 'stale' : 'hasimg';
    const thumb = type === 'face' ? faceThumb(s.start, tlRefreshSoon) : s.image?.key ? sceneThumb(s.image.key, tlRefreshSoon) : null;
    const sel = s.id === state.selected;
    const moving = type !== 'face' && animatedOn(p) && !s.still && (animReady(s) ? 'anim' : state.cache.animating?.has(s.id) ? 'animating' : '');
    return `<div class="clip ${type} ${st} ${moving || ''} ${sel ? 'sel' : ''}" data-id="${s.id}" style="left:${TL.pad + s.start * TL.pps}px;width:${Math.max(6, (s.end - s.start) * TL.pps - 3)}px" title="${esc(shotText(s))}">
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
    const info = sfxInfo(c.type) || { name: c.type, icon: 'note', dur: 0.5 };
    return `<div class="fxclip ${c.id === state.selectedFx ? 'sel' : ''}" data-id="${c.id}" style="left:${TL.pad + c.t * TL.pps}px;width:${Math.max(34, info.dur * TL.pps)}px"><svg><use href="#i-sfx-${info.icon}"/></svg><em>${esc(info.name)}</em></div>`;
  }).join('') || `<span class="fx-empty" style="left:${TL.pad + 8}px">No sound effects yet. Add some in the Audio tab.</span>`;
  const m = p.settings.music;
  $('#tl-music').innerHTML = m
    ? `<div class="musicclip" data-music="1" style="left:${TL.pad}px;width:${Math.max(40, p.duration * TL.pps)}px">${icon('music')}<em>${esc(m.name)}</em></div>`
    : `<button class="music-empty" data-music="add" style="left:${TL.pad + 8}px">${icon('plus')}Add music</button>`;
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
  if (!state.media.paused) { state.media.pause(); stopAudio(); }
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
  window.addEventListener('pointercancel', () => { drag = null; });
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
  const tab = $('#ed-tabs button.on')?.dataset.tab;
  showTab(tab === 'trans' ? 'trans' : 'shot');
  if (seek && seg && state.media) await seekTo(seg.start + Math.min(0.2, (seg.end - seg.start) / 3));
}

// tabs
// ---------- phone: full-screen editor (CapCut-style) ----------
const isPhone = () => matchMedia('(max-width: 720px)').matches;
const TAB_TITLES = { shot: 'Edit', sound: 'Audio', captions: 'Text', filters: 'Filters', trans: 'Transitions', export: 'Export' };

const editorOpen = () => document.body.classList.contains('ed-full') || document.body.classList.contains('ed-app');

/** Step 5 takes over the screen: a sheet-based layout on phones, an app layout on computers. */
function setFullEditor(on) {
  const phone = on && isPhone();
  const app = on && !phone;
  const b = document.body.classList;
  if (b.contains('ed-full') === phone && b.contains('ed-app') === app) return;
  const was = editorOpen();
  b.toggle('ed-full', phone);
  b.toggle('ed-app', app);
  closeSheet();
  if (on === was) { requestAnimationFrame(() => { if (state.step === 5) { renderTimeline(); drawPreview(); } }); return; }
  if (on) window.scrollTo(0, 0);
  else requestAnimationFrame(() => $('#studio').scrollIntoView({ block: 'start' }));
  requestAnimationFrame(() => { if (state.step === 5) { renderTimeline(); drawPreview(); } });
}
function openSheet(name) {
  if (!document.body.classList.contains('ed-full')) return;
  $('#sheet-title').textContent = TAB_TITLES[name] || '';
  $('#ed-sheet').classList.add('open');
  document.body.classList.add('sheet-open');
}
function closeSheet() {
  $('#ed-sheet').classList.remove('open');
  document.body.classList.remove('sheet-open');
  if (document.body.classList.contains('ed-full')) $$('#ed-tabs button').forEach((b) => b.classList.remove('on'));
  else showTab(state.tab || 'shot', { open: false });
}
$('#sheet-done').addEventListener('click', closeSheet);
$('#ed-close').addEventListener('click', () => goStep(4));
$('#ed-export').addEventListener('click', () => showTab('export'));
window.addEventListener('resize', () => { if (state.step === 5) setFullEditor(true); });
document.addEventListener('keydown', (e) => {
  if (!editorOpen() || e.target.closest('input, textarea, select, [contenteditable]')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (e.code === 'Space') { e.preventDefault(); if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur(); togglePlay(); }
  else if (mod && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
  else if (mod && e.code === 'KeyY') { e.preventDefault(); redo(); }
  else if (!mod && !e.altKey && e.code === 'KeyS') { e.preventDefault(); splitAtPlayhead(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); nextCut(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); nextCut(-1); }
});

function showTab(name, { open = true } = {}) {
  state.tab = name;
  $('#sheet-title').textContent = TAB_TITLES[name] || '';
  if (open) openSheet(name);
  $$('#ed-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $$('.ed-panel').forEach((p) => { p.hidden = p.dataset.pane !== name; });
  if (name === 'sound') renderSoundPane();
  if (name === 'captions') renderTextPane();
  if (name === 'filters') renderFilterPane();
  if (name === 'trans') renderTransPane();
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
  const st = p.settings;
  $('#vol-voice').value = st.voiceVol ?? 1;
  $('#vol-sfx').value = st.sfxVol ?? 0.8;
  $('#vol-music').value = st.music?.vol ?? 0.35;
  $('#mix-voice').hidden = !state.file;
  $('#mix-music').hidden = !st.music;
  $('#music-card').innerHTML = st.music ? `
    <div class="mc-row">
      <span class="mc-ico">${icon('music')}</span>
      <div class="mc-txt"><b>${esc(st.music.name)}</b><small>Loops under the whole video</small></div>
      <button class="icon-btn" data-m="replace" title="Replace">${icon('redo')}</button>
      <button class="icon-btn" data-m="del" title="Remove">${icon('trash')}</button>
    </div>
    <label class="switch"><input type="checkbox" data-m="fade" ${st.music.fade !== false ? 'checked' : ''}><span></span>Fade in and out</label>`
    : `<button class="add-tile" data-m="add">${icon('plus')}<span><b>Add music</b><small>MP3, M4A or WAV from your device</small></span></button>`;
  const c = (p.sfx || []).find((x) => x.id === state.selectedFx);
  const ci = c && (sfxInfo(c.type) || { name: c.type, icon: 'note' });
  $('#sfx-selected').innerHTML = c ? `
    <div class="fx-card">
      <div class="fx-card-head"><span class="fx-ico"><svg><use href="#i-sfx-${ci.icon}"/></svg></span><div><b>${esc(ci.name)}</b><small class="muted">at ${fmtTC(c.t)} · drag it on the timeline to move</small></div><button class="icon-btn sm" data-fx="close" aria-label="Close">${icon('close')}</button></div>
      <label class="range-field"><span>Volume</span><input type="range" data-fx="vol" min="0" max="1.5" step="0.05" value="${c.vol ?? 1}"></label>
      <div class="tool-row">
        <button class="btn glass sm" data-fx="play">${icon('play')}Play</button>
        <button class="btn glass sm" data-fx="here">Move to playhead</button>
        <button class="btn glass sm danger" data-fx="del">${icon('trash')}Delete</button>
      </div>
    </div>` : '';
  const mine = (st.customSfx || []).length;
  $('#sfx-cats').innerHTML = SFX_CATS.filter((x) => x.id !== 'mine' || mine).map((x) => `<button data-cat="${x.id}" class="${state.sfxCat === x.id ? 'on' : ''}">${esc(x.name)}</button>`).join('');
  const list = allSfx().filter((x) => state.sfxCat === 'all' || x.cat === state.sfxCat);
  $('#sfx-lib').innerHTML = list.map((x) => `
    <button class="sfx-tile" data-add="${esc(x.id)}">
      <span class="st-ico"><svg><use href="#i-sfx-${x.icon}"/></svg></span>
      <span class="st-txt"><b>${esc(x.name)}</b><canvas class="st-wave" data-wave="${esc(x.id)}" width="96" height="18"></canvas></span>
      <i class="pv" data-pv="${esc(x.id)}" title="Preview">${icon('play')}</i>
    </button>`).join('') + `
    <button class="sfx-tile upload" data-upload="1"><span class="st-ico">${icon('upload')}</span><span class="st-txt"><b>Upload a sound</b><small>Use your own audio</small></span></button>`;
  $$('#sfx-lib canvas[data-wave]').forEach(drawMiniWave);
}

async function drawMiniWave(cv) {
  const peaks = await sfxPeaks(cv.dataset.wave, 24).catch(() => []);
  if (!cv.isConnected || !peaks.length) return;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  const bw = cv.width / peaks.length;
  g.fillStyle = 'rgba(240, 171, 252, 0.75)';
  peaks.forEach((v, i) => { const h = Math.max(2, v * cv.height); g.fillRect(i * bw + 1, (cv.height - h) / 2, bw - 2, h); });
}

function addSfxAt(type) {
  snapshot();
  const c = { id: newId(), type, t: +(state.media?.time || 0).toFixed(2), vol: 1 };
  state.project.sfx = [...(state.project.sfx || []), c];
  save();
  state.selectedFx = c.id;
  renderFxTrack(); renderSoundPane();
  state.sfxPlayer.preview(graph(), c.type, (state.project.settings.sfxVol ?? 0.8));
  toast(`${sfxInfo(c.type)?.name || 'Sound'} added at ${fmtTC(c.t)}`);
}

$('#sfx-cats').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (b) { state.sfxCat = b.dataset.cat; renderSoundPane(); }
});
$('#sfx-lib').addEventListener('click', (e) => {
  const pv = e.target.closest('[data-pv]');
  if (pv) { e.stopPropagation(); state.sfxPlayer.preview(graph(), pv.dataset.pv, state.project.settings.sfxVol ?? 0.8); return; }
  if (e.target.closest('[data-upload]')) { $('#sfx-file').click(); return; }
  const add = e.target.closest('[data-add]');
  if (add && state.project) addSfxAt(add.dataset.add);
});
$('#sfx-file').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  const p = state.project;
  if (!p) return;
  let added = 0;
  for (const f of files) {
    if (!f.type.startsWith('audio/') && !/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name)) continue;
    if (f.size > 15e6) { toast(`${f.name} is too big (max 15 MB).`); continue; }
    const id = `u_${newId()}`;
    const key = `${storageKey()}/sfx/${id}`;
    await putBlob(key, f);
    const info = { id, key, name: f.name.replace(/\.[^.]+$/, '').slice(0, 28), cat: 'mine', icon: 'note', dur: 1 };
    p.settings.customSfx = [...(p.settings.customSfx || []), info];
    registerSfx(info);
    added++;
  }
  if (!added) return;
  save();
  state.sfxCat = 'mine';
  renderSoundPane();
  toast(`${added} sound${added > 1 ? 's' : ''} added to My sounds. Tap one to place it.`);
});

$('#music-card').addEventListener('click', (e) => {
  const b = e.target.closest('[data-m]');
  if (!b || !state.project) return;
  if (b.dataset.m === 'add' || b.dataset.m === 'replace') $('#music-file').click();
  if (b.dataset.m === 'del') { snapshot(); state.project.settings.music = null; save(); stopAudio(); renderSoundPane(); renderFxTrack(); setMix(graph(), state.project.settings); }
});
$('#music-card').addEventListener('change', (e) => {
  if (e.target.dataset.m === 'fade' && state.project?.settings.music) { state.project.settings.music.fade = e.target.checked; save(); restartAudio(); }
});
$('#music-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f || !state.project) return;
  if (f.size > 40e6) { toast('That file is too big (max 40 MB).'); return; }
  const key = `${storageKey()}/music/${Date.now().toString(36)}`;
  await putBlob(key, f);
  snapshot();
  state.project.settings.music = { key, name: f.name.replace(/\.[^.]+$/, '').slice(0, 40), vol: state.project.settings.music?.vol ?? 0.35, fade: true };
  save();
  setMix(graph(), state.project.settings);
  renderSoundPane(); renderFxTrack(); restartAudio();
  toast('Music added. Press play to hear it under your story.');
});
$('#tl-music').addEventListener('click', (e) => {
  const b = e.target.closest('[data-music]');
  if (!b) return;
  showTab('sound');
  if (b.dataset.music === 'add') $('#music-file').click();
});
['#vol-voice', '#vol-sfx', '#vol-music'].forEach((sel) => $(sel).addEventListener('input', (e) => {
  const st = state.project?.settings;
  if (!st) return;
  if (sel === '#vol-music') { if (st.music) st.music.vol = +e.target.value; } else st[sel === '#vol-voice' ? 'voiceVol' : 'sfxVol'] = +e.target.value;
  setMix(graph(), st);
  save();
}));

// ---------- text, filters, transitions panes ----------

const HIGHLIGHTS = ['#ffd60a', '#ff4fd8', '#38bdf8', '#4ade80', '#fb923c', '#ffffff'];

function renderTextPane() {
  const st = state.project?.settings;
  if (!st) return;
  const cs = st.captionStyle || {};
  $('#opt-captions').checked = !!st.captions;
  $('#opt-upper').checked = !!cs.upper;
  $('#cap-styles').innerHTML = CAPTION_STYLES.map((x) => `<button class="cap-tile cs-${x.id} ${(cs.preset || 'bold') === x.id ? 'on' : ''}" data-preset="${x.id}" style="--hl:${cs.highlight || '#ffd60a'}"><span class="cs-demo">${cs.upper ? 'THE <i>BEST</i>' : 'The <i>best</i>'}</span><small>${esc(x.name)}</small></button>`).join('');
  $$('#cap-pos button').forEach((b) => b.classList.toggle('on', b.dataset.v === (cs.pos || 'low')));
  $$('#cap-size button').forEach((b) => b.classList.toggle('on', +b.dataset.v === (cs.size || 1)));
  $('#cap-colors').innerHTML = HIGHLIGHTS.map((c) => `<button data-c="${c}" class="${(cs.highlight || '#ffd60a') === c ? 'on' : ''}" style="--c:${c}" aria-label="Highlight ${c}"></button>`).join('');
  $('#cap-styles').closest('.ed-panel').classList.toggle('caps-off', !st.captions);
}
function setCaption(patch) {
  const st = state.project.settings;
  st.captionStyle = { ...(st.captionStyle || {}), ...patch };
  save(); renderTextPane(); drawPreview();
}
$('#cap-styles').addEventListener('click', (e) => { const b = e.target.closest('[data-preset]'); if (b) setCaption({ preset: b.dataset.preset }); });
$('#cap-pos').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) setCaption({ pos: b.dataset.v }); });
$('#cap-size').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) setCaption({ size: +b.dataset.v }); });
$('#cap-colors').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) setCaption({ highlight: b.dataset.c }); });

const p0Ready = () => !!(state.project?.approved && state.project.segments.length);

function renderFilterPane() {
  const st = state.project?.settings;
  if (!st) return;
  // thumbnails start from the unfiltered frame
  const src = document.createElement('canvas');
  src.width = 128; src.height = state.aspect === 'vertical' ? 192 : 80;
  if (state.media && p0Ready()) drawFrame(src.getContext('2d'), src.width, src.height, state.media.time, { ...state.project, settings: { ...st, filter: 'none', captions: false, watermark: false } }, state.media.el, state.cache);
  $('#filter-grid').innerHTML = FILTERS.map((f) => `<button class="filter-tile ${(st.filter || 'none') === f.id ? 'on' : ''}" data-filter="${f.id}"><canvas width="64" height="${state.aspect === 'vertical' ? 96 : 40}"></canvas><small>${esc(f.name)}</small></button>`).join('');
  $$('#filter-grid .filter-tile').forEach((b) => {
    const cv = b.querySelector('canvas');
    const g = cv.getContext('2d');
    if ('filter' in g) g.filter = filterCss(b.dataset.filter, 1);
    try { g.drawImage(src, 0, 0, cv.width, cv.height); } catch { /* preview not ready */ }
  });
  $('#filter-amt').value = st.filterAmt ?? 1;
  $('#filter-amt-row').hidden = !st.filter || st.filter === 'none';
  $('#opt-punch').checked = !!st.punchIn;
  $('#face-x').value = st.faceX ?? 0.5;
}
$('#filter-grid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-filter]');
  if (!b) return;
  state.project.settings.filter = b.dataset.filter;
  save(); drawPreview(); renderFilterPane();
});
$('#filter-amt').addEventListener('input', (e) => { state.project.settings.filterAmt = +e.target.value; save(); drawPreview(); });

function renderTransPane() {
  const p = state.project;
  if (!p) return;
  const i = p.segments.findIndex((sg) => sg.id === state.selected);
  const one = state.transScope === 'one';
  $$('#trans-scope button').forEach((b) => b.classList.toggle('on', b.dataset.v === state.transScope));
  const cur = one ? (i > 0 ? (p.segments[i].transIn || p.settings.transition || 'cut') : null) : (p.settings.transition || 'cut');
  $('#trans-hint').textContent = one
    ? (i > 0 ? `The cut into shot ${i + 1}. Pick a clip on the timeline to change another cut.` : 'Pick a clip on the timeline (not the first one) to style the cut into it.')
    : 'Used on every cut, unless you set a different one on a specific cut.';
  $('#trans-grid').innerHTML = TRANSITIONS.map((x) => `<button class="trans-tile tr-${x.id} ${cur === x.id ? 'on' : ''}" data-tr="${x.id}" ${one && i <= 0 ? 'disabled' : ''}><span class="tr-demo"><i></i><i></i></span><small>${esc(x.name)}</small></button>`).join('');
}
$('#trans-scope').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) { state.transScope = b.dataset.v; renderTransPane(); } });
$('#trans-grid').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-tr]');
  const p = state.project;
  if (!b || !p) return;
  snapshot();
  let at = null;
  if (state.transScope === 'one') {
    const seg = p.segments.find((sg) => sg.id === state.selected);
    if (!seg) return;
    seg.transIn = b.dataset.tr;
    at = seg.start;
  } else {
    p.settings.transition = b.dataset.tr;
    p.segments.forEach((sg) => { delete sg.transIn; });
    at = p.segments.find((sg, k) => k > 0 && sg.start > (state.media?.time || 0))?.start ?? p.segments[1]?.start;
  }
  save(); renderTransPane();
  // show it: jump just before the cut and play through it
  if (at != null && b.dataset.tr !== 'cut' && state.media?.paused) {
    await seekTo(Math.max(0, at - 0.9));
    togglePlay();
    setTimeout(() => { if (!state.media.paused) togglePlay(); }, 1900);
  } else drawPreview();
});



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
  renderInspector();
  toast(`Split into two shots at ${fmtTC(now)}. Change either one in Edit.`);
}

/** Move the playhead to the start of the next shot. */
function nextCut(dir = 1) {
  const p = state.project;
  if (!p?.segments.length || !state.media) return;
  const t = state.media.time;
  const seg = dir > 0 ? p.segments.find((sg) => sg.start > t + 0.05) : [...p.segments].reverse().find((sg) => sg.start < t - 0.3);
  if (!seg) return;
  state.selected = seg.id;
  renderTimeline(); renderInspector();
  seekTo(seg.start + 0.02);
}
$('#btn-split').addEventListener('click', splitAtPlayhead);
$('#btn-snap').addEventListener('click', () => nextCut(1));
$('#btn-redo').addEventListener('click', redo);

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
  el.classList.toggle('fresh', el.dataset.seg !== seg.id);
  el.dataset.seg = seg.id;
  el.innerHTML = `
    <div class="insp-head"><strong>Shot ${i + 1} <span class="muted">of ${p.segments.length}</span></strong><span class="time-chip">${fmtTime(seg.start)}–${fmtTime(seg.end)} · ${(seg.end - seg.start).toFixed(1)}s</span></div>
    <p class="quote">“${esc(shotText(seg))}”</p>
    <div class="type-switch">${types.map((t) => `<button data-type="${t}" class="${type === t ? 'on' : ''}"><i></i>${{ face: 'Your face', scene: 'Scene', scene_bubble: 'Scene + face' }[t]}</button>`).join('')}</div>
    ${type === 'face' || !sc ? '' : `
      <div class="shot-img">
        ${seg.image?.key ? '<img alt="Scene illustration">' : `<div class="noimg">${pending ? 'Drawing…' : 'Not drawn yet'}</div>`}
        ${seg.image?.key ? qcBadge(seg.image) : ''}
      </div>
      ${seg.image?.qc && !seg.image.qc.pass ? `<p class="warn-text">Quality check: ${esc(seg.image.qc.issues.join('; '))}</p>` : ''}
      ${seg.image?.stale ? '<p class="warn-text">You changed this scene since it was drawn. Redraw to update it.</p>' : ''}
      ${animatedOn(p) && seg.image?.key && !sceneSegs().some(needsImage) ? (() => {
        const busy = state.cache.animating?.has(seg.id);
        const ok = animReady(seg);
        const label = seg.still ? 'Using the still picture' : busy ? 'Animating…' : ok ? 'Animated' : 'Not animated yet';
        return `<div class="anim-row ${ok && !seg.still ? 'ok' : ''}">
          <span class="anim-state">${icon(ok && !seg.still ? 'play' : 'film')}${label}</span>
          ${seg.still ? '' : `<button class="btn glass sm" data-act="animate" ${busy || state.genAbort ? 'disabled' : ''}>${icon('spark')}${ok ? 'Re-animate' : 'Animate'}</button>`}
        </div>
        <label class="switch"><input type="checkbox" data-k="still" ${seg.still ? 'checked' : ''}><span></span>Use the still picture for this shot</label>
        <div class="status" id="anim-status"></div>`;
      })() : ''}
      <label class="field">What the scene shows
        <textarea data-s="image_prompt" rows="3" placeholder="Who is where, doing what, with which expressions">${esc(sc.image_prompt || '')}</textarea>
      </label>
      <div class="field">Characters in this shot
        <div class="chips">${sc.actors.map((a, k) => `<span class="chip">${esc(p.characters.find((c) => c.id === a.character_id)?.name || a.character_id)}<button data-a="remove" data-k="${k}" aria-label="Remove">${icon('close')}</button></span>`).join('')}
          ${sc.actors.length < 4 && p.characters.some((c) => !sc.actors.some((a) => a.character_id === c.id)) ? `<select data-act="add-cast"><option value="">+ Add</option>${p.characters.filter((c) => !sc.actors.some((a) => a.character_id === c.id)).map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select>` : ''}
        </div>
      </div>
      <label class="field">Change request <span class="hint">optional</span>
        <input id="redo-note" placeholder="e.g. make Dad look more shocked">
      </label>
      <div class="tool-row">
        <button class="btn primary sm" data-act="redraw" ${pending ? 'disabled' : ''}>${icon('redo')}${seg.image?.key ? 'Redraw image' : 'Draw this scene'}</button>
        <button class="btn glass sm" data-act="redo-ai" title="Let the AI rethink this scene, then redraw">${icon('wand')}Rethink scene</button>
      </div>
      <div class="status" id="redo-status"></div>`}
    <details>
      <summary>Timing</summary>
      <div class="time-row" style="margin-top:12px">
        <label class="field">Starts (s)<input type="number" step="0.1" data-f="start" value="${seg.start.toFixed(2)}" ${i === 0 ? 'disabled' : ''}></label>
        <label class="field">Ends (s)<input type="number" step="0.1" data-f="end" value="${seg.end.toFixed(2)}" ${i === p.segments.length - 1 ? 'disabled' : ''}></label>
      </div>
      <div class="tool-row" style="margin-top:10px">
        <button class="btn glass sm" data-act="split" title="Split this shot where the playhead is">${icon('scissors')}Split</button>
        <button class="btn glass sm" data-act="merge" ${i === p.segments.length - 1 ? 'disabled' : ''} title="Join with the next shot">${icon('merge')}Merge</button>
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
  } else if (act === 'animate') {
    if (state.genAbort) { toast('Wait for the current drawing or animation to finish.'); return; }
    const s = settingsGet();
    if (animReady(seg) && !confirm(`Animate this scene again? About ${fmtUSD(estimateAnimCost([seg], s.videoModel))}.`)) return;
    animateScenes([seg]);
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
  if (e.target.dataset.k === 'still') {
    const seg = currentSeg();
    if (seg) { edit(() => { seg.still = e.target.checked; }); renderInspector(); drawPreview(); }
    return;
  }
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
  renderTextPane();
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
  const secs = Math.ceil(state.project.duration);
  const ld = showLoader($('#ex-loader'), {
    kind: 'film', title: 'Exporting your video', total: secs, perItem: 1, parallel: 1,
    tips: ['Your video plays once in real time while it records.', 'Keep this tab open and in front until it finishes.', 'Music, sound effects, captions and transitions are all included.'],
  });
  setStatus('#ex-status', '');
  try {
    if (!state.media.paused) state.media.pause();
    const { blob, ext } = await exportVideo(state.project, state.media, {
      aspect: state.aspect, signal: ac.signal, sfxPlayer: state.sfxPlayer, musicPlayer: state.musicPlayer, onProgress: (f) => ld.update({ done: Math.min(secs, Math.floor(f * secs)) }),
    });
    if (ac.signal.aborted) { setStatus('#ex-status', 'Export cancelled.'); return; }
    download(blob, `${baseName()}-storycuts-${state.aspect}.${ext}`);
    setStatus('#ex-status', `Done! ${(blob.size / 1e6).toFixed(1)} MB ${ext.toUpperCase()} saved to your downloads.${ext === 'webm' ? ' (WebM works on TikTok and YouTube.)' : ''}`, 'ok');
  } catch (e) {
    console.error(e);
    setStatus('#ex-status', `Export failed: ${errText(e)}`, 'err');
  } finally {
    state.exporting = null;
    ld.stop();
    btn.querySelector('span').textContent = 'Export video';
    bar.classList.add('hidden');
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
$$('a[href="#studio"]').forEach((a) => a.addEventListener('click', () => { if (state.project) return; goStep(1, { scroll: false }); }));
$('#btn-create').addEventListener('click', createVideo);
$('#btn-use-paste').addEventListener('click', usePaste);
$('#btn-reset').addEventListener('click', resetPlan);
$('#btn-approve').addEventListener('click', approveAndDraw);
$('#btn-open-editor').addEventListener('click', () => goStep(5));
$('#btn-show-cast').addEventListener('click', () => { state.showCast = !state.showCast; renderPipeline(); if (state.showCast) scrollTo('#cast'); });
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
  if (e.pointerType !== 'mouse') return;
  const el = e.target.closest?.('.spot, .btn.glass, .char, .pipeline li');
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${e.clientX - r.left}px`);
  el.style.setProperty('--my', `${e.clientY - r.top}px`);
}, { passive: true });

/** Reveal sections as they scroll into view. */
const io = new IntersectionObserver((entries) => entries.forEach((en) => {
  if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
}), { threshold: 0.12 });
$$('.reveal').forEach((el) => io.observe(el));

// ---------- subscriptions ----------

let billingPeriod = store.get('storycuts:period', 'monthly');

function planCard(plan, { compact = false } = {}) {
  const mine = currentPlan()?.id === plan.id;
  const price = monthlyPrice(plan, billingPeriod);
  const sub = billingPeriod === 'yearly' ? `$${yearlyTotal(plan)} billed yearly` : 'billed monthly';
  const cta = mine ? 'Your plan' : `Get ${plan.name}`;
  if (compact) {
    return `<button class="pay-plan${plan.popular ? ' popular' : ''}" data-plan="${plan.id}" ${mine ? 'disabled' : ''}>
      <span class="pp-name"><b>${esc(plan.name)}</b>${plan.popular ? '<em>Most popular</em>' : ''}<small>${plan.videos} videos a month</small></span>
      <span class="pp-price"><b>$${price}</b><small>/mo</small></span>
    </button>`;
  }
  return `<article class="plan spot${plan.popular ? ' popular' : ''}${mine ? ' mine' : ''}">
    ${plan.popular ? '<span class="plan-flag">Most popular</span>' : ''}
    <h3>${esc(plan.name)}</h3>
    <p class="plan-blurb">${esc(plan.blurb)}</p>
    <div class="plan-price"><span class="cur">$</span><b class="amt">${price}</b><span class="per">/month</span></div>
    <p class="plan-sub">${sub}</p>
    <button class="btn ${plan.popular ? 'primary' : 'glass'} lg wide" data-plan="${plan.id}" ${mine ? 'disabled' : ''}>${mine ? icon('check') : ''}${cta}</button>
    <ul>${plan.features.map((f) => `<li>${icon('check')}${esc(f)}</li>`).join('')}</ul>
  </article>`;
}

function renderPlans() {
  $('#plans').innerHTML = BILLING.plans.map((p) => planCard(p)).join('');
  $('#pay-plans').innerHTML = BILLING.plans.map((p) => planCard(p, { compact: true })).join('');
  $$('.period').forEach((g) => {
    g.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.period === billingPeriod));
    movePeriodThumb(g);
  });
  const mine = currentPlan();
  const nav = $('#nav-plan');
  nav.innerHTML = mine ? `${icon('crown')}<span>${esc(mine.plan.name)}</span>` : '<span>Get started</span>';
  nav.classList.toggle('primary', !mine);
  nav.classList.toggle('glass', !!mine);
  const portal = BILLING.portalUrl;
  $$('#manage-sub, .manage-link').forEach((a) => { a.hidden = !(mine && portal); if (portal) a.href = portal; });
}

function movePeriodThumb(g) {
  const on = g.querySelector('button.on');
  const thumb = g.querySelector('.period-thumb');
  if (!on || !thumb || !on.offsetWidth) return;
  thumb.style.width = `${on.offsetWidth}px`;
  thumb.style.transform = `translateX(${on.offsetLeft - 4}px)`;
}

$$('.period').forEach((g) => g.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-period]');
  if (!b || b.dataset.period === billingPeriod) return;
  billingPeriod = b.dataset.period;
  store.set('storycuts:period', billingPeriod);
  renderPlans();
  $$('.plan .amt, .pp-price b').forEach((el) => { el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick'); });
}));

function startCheckout(planId) {
  const url = checkoutUrl(planId, billingPeriod);
  if (!url) {
    console.info('[StoryCuts] Add Stripe Payment Links in js/billing.js to open checkout.');
    toast('Checkout opens very soon. Check back shortly!', 4000);
    return;
  }
  location.href = url;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-plan]');
  if (b && !b.disabled) startCheckout(b.dataset.plan);
});

function openPaywall() {
  renderPlans();
  const d = $('#paywall');
  if (!d.open) d.showModal();
  requestAnimationFrame(() => movePeriodThumb($('#pay-period')));
}
$('#pay-close').addEventListener('click', () => $('#paywall').close());
$('#paywall').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
$('#pay-demo').addEventListener('click', () => { $('#paywall').close(); loadDemo(); goStep(2); });

// ---------- site chrome ----------

// mobile menu
(function menu() {
  const btn = $('#btn-menu');
  const sheet = $('#menu-sheet');
  const set = (open) => {
    btn.setAttribute('aria-expanded', open);
    btn.innerHTML = icon(open ? 'close' : 'menu');
    document.body.classList.toggle('menu-open', open);
    if (open) { sheet.style.top = `${$('.nav').getBoundingClientRect().bottom}px`; sheet.hidden = false; requestAnimationFrame(() => sheet.classList.add('open')); } else {
      sheet.classList.remove('open');
      setTimeout(() => { if (!sheet.classList.contains('open')) sheet.hidden = true; }, 300);
    }
  };
  btn.addEventListener('click', () => set(btn.getAttribute('aria-expanded') !== 'true'));
  sheet.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
  window.addEventListener('resize', () => { if (innerWidth > 860) set(false); });
}());

// nav gets a solid edge once you scroll, and highlights the section you're in
(function navState() {
  const nav = $('.nav');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  const links = $$('#nav-links a');
  const spy = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (en.isIntersecting) links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${en.target.id}`));
  }), { rootMargin: '-45% 0px -50% 0px' });
  links.forEach((a) => { const t = $(a.getAttribute('href')); if (t) spy.observe(t); });
}());

// tactile ripple on every button
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('.btn:not(.link), .play, .choices button, .pay-plan');
  if (!b || b.disabled) return;
  const r = b.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2.2;
  const dot = document.createElement('span');
  dot.className = 'ripple';
  dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
  b.appendChild(dot);
  setTimeout(() => dot.remove(), 650);
}, { passive: true });

// style strip under the hero
function renderMarquee() {
  const items = Object.values(STYLES).filter((s) => s.thumb);
  if (!items.length) return;
  const row = items.map((s) => `<figure class="mq-item"><img src="${esc(s.thumb)}" alt="" loading="lazy" decoding="async"><figcaption>${esc(s.label)}</figcaption></figure>`).join('');
  $('#marquee-row').innerHTML = row + row;
  $('#marquee-row').style.setProperty('--mq-count', items.length);
}

// hero phone: her clip plays, and the middle of each loop cuts to a drawn scene
(function heroCuts() {
  const v = $('#hero-talk');
  const screen = v?.closest('.phone-screen');
  if (!v || !screen) return;
  const inCut = (t) => t > 3.4 && t < 6.2;
  let usingClock = false;
  const tick = () => {
    if (!usingClock) screen.classList.toggle('cut', inCut(v.currentTime));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // if the browser won't autoplay (e.g. iPhone low power mode), still show the cut
  setTimeout(() => {
    if (!v.paused && v.currentTime > 0) return;
    usingClock = true;
    let t = 0;
    setInterval(() => { t = (t + 0.5) % 7; screen.classList.toggle('cut', inCut(t)); }, 500);
  }, 2500);
  // save battery: pause when the hero is off screen
  new IntersectionObserver(([en]) => { if (en.isIntersecting) v.play().catch(() => {}); else v.pause(); }).observe(v);
}());

// staggered reveal for grids
$$('.stagger').forEach((g) => [...g.children].forEach((c, i) => c.style.setProperty('--i', i)));
$('#year').textContent = new Date().getFullYear();

{
  const msg = handleReturn();
  if (msg) setTimeout(() => toast(msg, 5000), 400);
}
renderPlans();
document.fonts?.ready.then(() => $$('.period').forEach(movePeriodThumb));

goStep(1, { scroll: false });
renderProjects();
renderStyles();
loadStyleManifest().then(() => { renderStyles(); renderMarquee(); });
loadSfxManifest();
requestAnimationFrame(updateSegThumbs);
updateKeysDot();
sizePreview();
renderStepper();

// test hook
window.__storycuts = { state, loadDemo };
