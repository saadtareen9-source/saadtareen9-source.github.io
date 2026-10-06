import { initExperience, syncStyleShowcase, syncCastNavigation, selectCastCharacter, exampleSceneForStyle } from './experience.js';
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
  VIDEO_MODELS, videoModelInfo, estimateAnimCost, animateScene, animReady, setVideoRelay, checkAnimationSetup,
} from './animate.js';
import { showWork } from './loader.js';
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
  sampleEditor: false,
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

// Silent concept footage. The stock creator did not record the fictional story.
// A separate clock keeps the existing preview and export media contract intact.
class DemoMedia {
  constructor(duration, words) {
    this.duration = duration; this.words = words;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 720; this.canvas.height = 1280;
    this.offset = 0; this.t0 = 0; this.paused = true; this.listeners = new Set();
    this.poster = new Image(); this.poster.src = 'assets/hero/talk.jpg';
    this.presenter = document.createElement('video');
    this.presenter.muted = true; this.presenter.loop = true; this.presenter.playsInline = true;
    this.presenter.preload = 'auto';
    this.presenter.src = `assets/hero/talk.${this.presenter.canPlayType('video/webm; codecs="vp9"') ? 'webm' : 'mp4'}`;
  }
  get time() {
    if (this.paused) return this.offset;
    const t = this.offset + (performance.now() - this.t0) / 1000;
    if (t >= this.duration) { this.offset = this.duration; this.paused = true; this.presenter.pause(); this.listeners.forEach((cb) => setTimeout(cb)); return this.duration; }
    return t;
  }
  get el() { this.render(this.time); return this.canvas; }
  async seek(t) {
    this.offset = Math.max(0, Math.min(this.duration, t)); this.t0 = performance.now();
    const video = this.presenter;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      const target = this.offset % video.duration;
      if (Math.abs(video.currentTime - target) > .03) {
        await new Promise((resolve) => {
          const done = () => { clearTimeout(timer); video.removeEventListener('seeked', done); resolve(); };
          const timer = setTimeout(done, 800);
          video.addEventListener('seeked', done);
          video.currentTime = target;
        });
      }
    }
  }
  async play() {
    if (this.offset >= this.duration - 0.05) this.offset = 0;
    this.t0 = performance.now(); this.paused = false;
    this.presenter.play().catch(() => {});
    clearInterval(this.iv); this.iv = setInterval(() => { if (!this.paused) this.time; else clearInterval(this.iv); }, 100);
  }
  pause() { this.offset = this.time; this.paused = true; this.presenter.pause(); }
  onEnded(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  render(t) {
    const c = this.canvas.getContext('2d'); const W = 720, H = 1280;
    c.fillStyle = '#20252d'; c.fillRect(0, 0, W, H);
    const image = this.presenter.readyState >= 2 ? this.presenter : this.poster;
    const w = image.videoWidth || image.naturalWidth, h = image.videoHeight || image.naturalHeight;
    if (w && h) {
      const scale = Math.max(W / w, H / h);
      c.drawImage(image, (W - w * scale) / 2, (H - h * scale) / 2, w * scale, h * scale);
    }
    c.fillStyle = '#20252dcc'; c.fillRect(28, 28, 178, 44);
    c.fillStyle = '#fff'; c.font = '500 21px Inter, system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText('SILENT SAMPLE', 42, 50);
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
    videoRelay: store.get('storycuts:vrelay', ''),
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
  $('#video-relay').value = s.videoRelay;
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
  store.set('storycuts:vrelay', $('#video-relay').value.trim());
  setVideoRelay($('#video-relay').value);
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
  if (state.sampleEditor) return 'storycuts:sample-v43';
  return state.file ? `storycuts:${state.file.name}:${state.file.size}` : 'storycuts:demo';
}

function save() {
  const p = state.project;
  if (!p) return;
  indexProject();
  store.set(storageKey(), {
    v: 2, title: p.title, duration: p.duration, words: p.words, characters: p.characters, locations: p.locations, sfx: p.sfx,
    segments: p.segments, settings: p.settings, approved: p.approved,
    transcriptSource: p.transcriptSource || 'auto', transcriptReviewed: !!p.transcriptReviewed, transcriptDrafts: p.transcriptDrafts,
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

// Keep one undo entry for a slider gesture, and one for each discrete choice.
const settingGestures = new WeakSet();
function snapshotSetting(input) {
  if (input?.type === 'range') {
    if (settingGestures.has(input)) return;
    settingGestures.add(input);
  }
  snapshot();
}
['change', 'focusout', 'pointercancel'].forEach((type) => document.addEventListener(type, (e) => {
  if (e.target.matches?.('input[type=range]')) settingGestures.delete(e.target);
}));

function restore(snap) {
  Object.assign(state.project, JSON.parse(snap));
  state.aspect = state.project.settings.aspect || state.aspect;
  syncOptionsUI();
  save();
  refresh();
  if (state.step === 5) { renderSoundPane(); renderTextPane(); renderFilterPane(); renderTransPane(); drawPreview(); setMix(graph(), state.project.settings); restartAudio(); }
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
    castHints: [], storyMode: 'auto', planNotes: '',
    captions: true, captionStyle: { upper: true, preset: 'bold', pos: 'low', size: 1, highlight: '#ffd60a' }, punchIn: true,
    filter: 'none', filterAmt: 1, transition: 'cut', music: null, customSfx: [], sceneMotion: 'living', faceX: 0.5, faceY: 0.4, bubbleSide: 'right', watermark: false,
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
  state.reviewingTranscript = false;
  state.reviewOriginalText = null;
  state.speechCache = null;
  state.transcriptTask = (state.transcriptTask || 0) + 1;
  state.transcriptBusy = false;
  $('#paste-box').classList.add('hidden');
  $('#paste-text').value = '';
  $('#transcript-file').value = '';
  setStatus('#story-input-status', '');
  setStatus('#review-status', '');
  if (saved && Math.abs((saved.duration || 0) - duration) < 0.5) {
    Object.assign(state.project, saved, { duration, settings: { ...defaultSettings(), ...saved.settings } });
    if (!saved.settings?.storyMode) state.project.settings.storyMode = ['text', 'subtitles'].includes(saved.transcriptSource) ? 'transcript' : 'auto';
    // animated video scenes were retired (the video API was discontinued)
    if (state.project.settings.sceneMotion === 'animated') state.project.settings.sceneMotion = 'living';
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
  $('.ed-title').textContent = p.title || 'Untitled story';
  $('#sample-editor-note').hidden = !state.sampleEditor;
  renderTranscript();
  renderPrep();
  renderSummary();
  renderSettingsExample();
  updateCosts();
  sizePreview();
  drawPreview();
  requestAnimationFrame(updateSegThumbs);
}

// ---------- step-by-step wizard ----------

const maxStep = () => (!state.project ? 1 : state.project.approved ? 5 : 4);

const JOURNEY_COPY = [
  ['Start with a story.', 'A phone video is all you need. Your video stays on your device.'],
  ['Build a world around it.', 'Pick a look you love. The same style follows your cast through every scene.'],
  ['Make it feel like you.', 'Choose where you share. You can change the creative details again in the editor.'],
  ['Every character matters.', 'Check the names and appearances. Draw your cast, then approve the looks before the scenes.'],
  ['The final cut is yours.', 'Select a shot, choose a tool below the timeline, and make the details your own.'],
];

function enterStudio({ navigate = true } = {}) {
  document.body.classList.add('studio-open');
  if (navigate && location.hash !== '#studio') history.pushState(null, '', '#studio');
}

function leaveStudio() {
  closeSheet();
  setFullEditor(false);
  document.body.classList.remove('studio-open');
  if (state.media && !state.media.paused) { state.media.pause(); stopAudio(); }
}

function syncStudioLocation() {
  if (location.hash === '#studio') {
    enterStudio({ navigate: false });
    goStep(state.step || 1, { scroll: false });
  } else leaveStudio();
}

function renderJourney() {
  const cur = state.step || 1;
  const [title, tip] = JOURNEY_COPY[cur - 1];
  $('#journey-title').textContent = title;
  $('#journey-tip').textContent = tip;
  const position = `Step ${cur} of 5`;
  if ($('#journey-position').textContent !== position) $('#journey-position').textContent = position;
  const p = state.project;
  const box = $('#journey-project');
  box.hidden = !p;
  if (!p) return;
  const style = p.settings.style === 'custom' ? 'Your own style' : STYLES[p.settings.style]?.label || 'Stick figures';
  box.innerHTML = `<span class="jp-label">Your story</span><b>${esc(state.file?.name || 'Demo story')}</b><span>${esc(style)} · ${p.settings.aspect === 'horizontal' ? '16:9' : '9:16'}</span><small>${icon('shield')}Video stays on this device</small>`;
}

function renderStepper() {
  const cur = state.step || 1;
  const max = maxStep();
  $$('#stepper li').forEach((li) => {
    const n = +li.dataset.s;
    li.classList.toggle('active', n === cur);
    li.classList.toggle('done', n < cur);
    li.classList.toggle('reach', n <= max);
    const button = li.querySelector('button');
    button.disabled = n > max;
    if (n === cur) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
  renderJourney();
}

function goStep(n, { scroll = true } = {}) {
  if (scroll) enterStudio();
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
  if (n === 4) { renderSummary(); renderPipeline(); if (state.project?.characters.length) { renderChars(); checkCastPictures(); } }
  setFullEditor(n === 5);
  if (n === 5 && state.project?.approved && !state.project.segments.some((sg) => sg.id === state.selected)) state.selected = state.project.segments[0]?.id;
  if (n === 5 && state.project?.approved) {
    checkScenePictures();
    requestAnimationFrame(() => { sizePreview(); renderTimeline(); renderInspector(); drawPreview(); ensurePeaks(); });
  }
  if (n !== 5 && state.media && !state.media.paused) { state.media.pause(); stopAudio(); }
  requestAnimationFrame(updateSegThumbs);
  if (scroll && !editorOpen()) {
    const target = n === 4 || (n > 1 && innerWidth <= 720) ? $(`.wizard > .panel[data-step="${n}"]`) : $('#studio');
    target.scrollIntoView({ behavior: 'auto', block: 'start' });
    requestAnimationFrame(() => {
      const headings = $$(`.wizard > .panel[data-step="${n}"] .panel-head h3, .wizard > .panel[data-step="${n}"] #cast-title`);
      const heading = headings.find((h) => h.getClientRects().length && !h.closest('[hidden], .hidden'));
      if (heading && !document.body.classList.contains('work-open')) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    });
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
  const phase = state.reviewingTranscript ? 'review' : !started ? 'start' : state.busy || failed || !p0?.segments.length ? 'running' : !p0.approved ? 'cast' : 'ready';
  $('#create-start').classList.toggle('hidden', started || phase === 'review');
  $('#transcript-review').classList.toggle('hidden', phase !== 'review');
  $('#run').classList.toggle('hidden', phase !== 'running');
  $('#ready-card').classList.toggle('hidden', phase !== 'ready');
  // be honest when pictures are missing (never drawn, or cleared by the browser)
  const missChars = p0?.characters.filter(characterNeedsDrawing).length || 0;
  const missScenes = phase === 'ready' ? p0.segments.filter((sg) => sg.type !== 'face' && sg.scene && (!sg.image?.key || sg.image.stale)).length : 0;
  if (phase === 'ready') {
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    $('#ready-card h4').textContent = missChars ? `${plural(missChars, 'character')} need${missChars === 1 ? 's' : ''} a picture` : missScenes ? `${plural(missScenes, 'scene')} still need${missScenes === 1 ? 's' : ''} drawing` : 'Your video is ready to edit';
    $('#ready-card p').textContent = missChars ? 'Draw your characters first. Every scene is drawn from them, so they need to look right before the scenes are drawn.'
      : missScenes ? 'Open the editor and press "Draw scenes" at the top. You can watch and edit while they are drawn.'
        : 'Your characters and scenes are drawn. Open the editor to watch it, change any shot, add music and export.';
    $('#ready-card .rc-ico').hidden = !!(missChars || missScenes);
  }
  // missing characters: the cast and its Draw button are the only next step
  if (missChars) $('#ready-card').classList.add('hidden');
  $('#cast').classList.toggle('hidden', !p0?.characters.length || ['start', 'review'].includes(phase) || (phase === 'ready' && !state.showCast && !missChars));
  $('#cast').classList.toggle('reviewed', phase === 'ready' && !missChars);
  $('#btn-reset').hidden = !p0?.segments.length || !!state.busy;
  $('#btn-show-cast').textContent = state.showCast ? 'Hide your characters' : 'See or change your characters';
  const btn = $('#btn-create');
  const p = state.project;
  const label = btn.querySelector('span');
  btn.classList.toggle('busy', state.busy);
  const needsTranscript = p?.settings.storyMode === 'transcript' && (!p.words.length || !['text', 'subtitles'].includes(p.transcriptSource));
  btn.disabled = state.busy || state.transcriptBusy || !!needsTranscript;
  if (state.busy) label.textContent = 'Working…';
  else if (needsTranscript) label.textContent = 'Add your transcript first';
  else if (!p?.segments.length) label.textContent = 'Find my characters';
  else if (!p.approved) label.textContent = 'Continue';
  else label.textContent = 'Open the editor';
  if (state.project?.characters) renderCastBar();
}

// ---------- step 1: upload ----------

$('#drop').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#file').click(); }
});

async function loadFile(file, { reopen = false } = {}) {
  if (!file) return;
  if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|m4v|mkv)$/i.test(file.name)) { toast('That doesn\'t look like a video file.'); return; }
  if (!reopen && !$('#rights').checked) {
    $('#upload-rights-note').hidden = false;
    $('#rights').setAttribute('aria-invalid', 'true');
    $('#rights').closest('.check').scrollIntoView({ block: 'center', behavior: 'auto' });
    $('#rights').focus({ preventScroll: true });
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
  clearTimeout(toast.timer);
  $('#toast').classList.remove('show');
  state.media?.pause(); stopAudio();
  state.sampleEditor = false;
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

$('#rights').addEventListener('change', () => {
  if ($('#rights').checked) {
    $('#upload-rights-note').hidden = true;
    $('#rights').removeAttribute('aria-invalid');
  }
});

function showFileChip(...parts) {
  const el = $('#video-info');
  el.classList.remove('hidden');
  el.innerHTML = `<span class="pill ok">${icon('check')} Ready</span>${parts.map((x) => `<span class="pill">${x}</span>`).join('')}`;
}

function loadDemo() {
  state.media?.pause(); stopAudio();
  state.sampleEditor = false;
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

// A real, editable local project lets visitors explore before connecting accounts.
// It uses existing licensed footage and concept artwork, never an AI request.
async function openSampleEditor() {
  if (state.busy || state.genAbort || state.exporting || state.sampleLoading) { toast('Finish the current task before opening the sample.'); return; }
  state.sampleLoading = true;
  const buttons = [$('#btn-editor-demo'), $('#pay-demo')];
  buttons.forEach((b) => { b.disabled = true; });
  try {
    const response = await fetch('assets/examples/airport.jpg');
    if (!response.ok) throw new Error('The sample picture could not load. Please try again.');
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const prefix = 'storycuts:sample-v43/';
    const crop = async (name, [x, y, w, h], aspect = '1:1') => {
      const canvas = document.createElement('canvas');
      canvas.width = 600; canvas.height = aspect === '9:16' ? 1067 : 600;
      canvas.getContext('2d').drawImage(bitmap, x * bitmap.width, y * bitmap.height, w * bitmap.width, h * bitmap.height, 0, 0, canvas.width, canvas.height);
      const cropped = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', .9));
      if (!cropped) throw new Error('The sample picture could not open. Please try again.');
      const key = `${prefix}${name}`;
      await putBlob(key, cropped);
      return { key, aspect, stale: false };
    };
    let meImage, catImage, closeImage;
    try {
      meImage = await crop('cast-me', [0, .14, .55, .55 * bitmap.width / bitmap.height]);
      catImage = await crop('cast-cat', [.24, .54, .24, .18]);
      closeImage = await crop('scene-close', [.12, .31, .5, .5 * bitmap.width / bitmap.height * 16 / 9], '9:16');
    } finally { bitmap.close(); }
    const fullKey = `${prefix}scene-full`;
    await putBlob(fullKey, blob);
    state.media?.pause(); stopAudio();
    state.file = null; state.sampleEditor = true;
    const duration = 14;
    const text = 'I thought I had grabbed my suitcase. Then I opened it at the airport. There was a cat inside. Definitely not my suitcase.';
    const words = wordsFromText(text, duration, [[.15, 13.7]]);
    state.media = new DemoMedia(duration, words);
    await state.media.poster.decode().catch(() => {});
    state.stages = {};
    showFileChip('The suitcase mix-up', '0:14', 'fictional sample · no recorded voice');
    loadProject(duration);
    const p = state.project;
    if (!p.approved || !p.segments.length) {
      p.title = 'The suitcase mix-up · Sample';
      p.words = words; p.transcriptSource = 'text'; p.transcriptReviewed = true;
      p.settings = { ...defaultSettings(), style: 'cartoon', aspect: 'vertical' };
      p.characters = [
        { id: 'me', name: 'Me', description: 'Curly dark hair, blue jacket and white shirt.', color: '#3e6b9c', hair: 'curly', hairColor: '#29282a', accessory: 'none', height: 1, image: meImage },
        { id: 'cat', name: 'The surprise guest', description: 'Small orange tabby cat with a white chest.', color: '#c98c52', hair: 'short', hairColor: '#c98c52', accessory: 'none', height: .4, image: catImage },
      ];
      p.locations = [{ id: 'airport', name: 'The airport', description: 'A bright terminal with big windows and yellow suitcases.' }];
      const scene = (moment) => ({ image_prompt: moment, setting: 'airport', location_id: 'airport', moment, offscreen: [], actors: [{ character_id: 'me', x: .3, pose: 'look', expression: 'surprised', facing: 'right', speech: '' }, { character_id: 'cat', x: .55, pose: 'sit', expression: 'happy', facing: 'left', speech: '' }], props: ['yellow suitcase'], effects: [], sound_effect: '' });
      p.segments = [
        { id: 'sample-hook', start: 0, end: 2.8, type: 'face', reason: 'Start with the storyteller.', scene: null },
        { id: 'sample-setting', start: 2.8, end: 6.6, type: 'scene', reason: 'Show the suitcase mix-up.', scene: scene('An unexpected cat in an open suitcase at the airport.'), image: { key: fullKey, aspect: '9:16', stale: false } },
        { id: 'sample-reveal', start: 6.6, end: 11.1, type: 'scene', reason: 'A closer look at the surprise guest.', scene: scene('A close view of the orange cat in the suitcase.'), image: closeImage },
        { id: 'sample-reaction', start: 11.1, end: duration, type: 'face', reason: 'Return to the reaction.', scene: null },
      ];
      p.sfx = []; p.approved = true;
    }
    state.aspect = p.settings.aspect || 'vertical';
    syncOptionsUI(); save(); refresh(); syncUndoButtons();
    selectCastCharacter('me');
    goStep(5);
    await seekTo(3.5);
    state.selected = segmentAt(p.segments, 3.5).id;
    renderTimeline(); renderInspector();
  } catch (e) { toast(errText(e), 6000); }
  finally { state.sampleLoading = false; buttons.forEach((b) => { b.disabled = false; }); }
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
  const gallery = $('#style-track').classList.contains('gallery');
  const step = cfUnit();
  const near = wrapIndex(CF.pos, n);
  cards.forEach((card, i) => {
    let d = (i - CF.pos) % n;
    if (d > n / 2) d -= n;
    if (d < -n / 2) d += n;
    const a = Math.abs(d);
    const fade = Math.max(0, Math.min(1, (2.9 - a) / 0.6));
    if (gallery) {
      ['transform', 'z-index', 'opacity', 'visibility'].forEach((prop) => card.style.removeProperty(prop));
      card.style.setProperty('--dim', 0);
    } else {
      card.style.transform = `translate3d(calc(-50% + ${(d * step).toFixed(2)}px), 0, ${(-a * 120).toFixed(1)}px) rotateY(${(Math.max(-1, Math.min(1, -d)) * 18).toFixed(2)}deg) scale(${Math.max(0.6, 1 - a * 0.16).toFixed(4)})`;
      card.style.zIndex = String(100 - Math.round(a * 10));
      card.style.opacity = fade.toFixed(3);
      card.style.visibility = fade ? '' : 'hidden';
      card.style.setProperty('--dim', Math.min(0.62, a * 0.32).toFixed(3));
    }
    const center = i === near;
    card.classList.toggle('on', center);
    card.setAttribute('aria-selected', center);
    card.tabIndex = center ? 0 : -1;
  });
  $$('#style-dots .dot').forEach((dot, i) => dot.classList.toggle('on', i === near));
  const id = ids[near];
  syncStyleShowcase(id === 'custom' ? { label: 'Your own style', blurb: 'Describe a world of your own, or bring a reference image.' } : STYLES[id]);
  const btn = $('#btn-style-next');
  if (btn) {
    btn.firstChild.textContent = 'Set up video';
    btn.setAttribute('aria-label', `Set up video with ${id === 'custom' ? 'my style' : STYLES[id]?.label || 'this style'}`);
  }
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
  if ($('#style-track').classList.contains('gallery') || matchMedia('(prefers-reduced-motion: reduce)').matches) cfSet(CF.target);
  else cfKick();
  state.styleIndex = wrapIndex(i, n);
  const id = ids[state.styleIndex];
  if (!state.project) { store.set('storycuts:style', id); return; }
  if (id === state.project.settings.style) return;
  const hadArt = state.project.characters.some((c) => c.image?.key);
  state.project.settings.style = id;
  invalidateStyleArtwork();
  store.set('storycuts:style', id);
  save();
  syncStyleExtras();
  syncMotionUI();
  updateCosts();
  renderJourney();
  clearTimeout(selectStyleIndex.t);
  renderSettingsExample();
  if (hadArt) selectStyleIndex.t = setTimeout(() => toast(`Style set to ${id === 'custom' ? 'your custom style' : STYLES[id].label}. Redraw your cast and scenes to apply it.`, 4500), 700);
}

function invalidateStyleArtwork() {
  const p = state.project;
  if (!p) return;
  [...p.characters, ...p.segments].forEach((item) => { if (item.image?.key) item.image.stale = true; });
  renderPipeline();
}

$('#style-prev').addEventListener('click', () => selectStyleIndex(state.styleIndex - 1));
$('#style-next').addEventListener('click', () => selectStyleIndex(state.styleIndex + 1));
$('#style-dots').addEventListener('click', (e) => { const d = e.target.closest('.dot'); if (d) selectStyleIndex(+d.dataset.i); });
$('#style-track').addEventListener('click', (e) => {
  const card = e.target.closest('.style-card');
  if (!card || state.styleDragged) return;
  const i = styleIds().indexOf(card.dataset.style);
  if ($('#style-track').classList.contains('gallery')) {
    selectStyleIndex(i);
    if (card.dataset.style === 'custom') requestAnimationFrame(() => { $('#custom-style').scrollIntoView({ block: 'nearest' }); $('#custom-style').focus({ preventScroll: true }); });
    return;
  }
  if (i !== state.styleIndex) selectStyleIndex(i);
  else if (card.dataset.style === 'custom') $('#custom-style').focus();
  else { card.classList.remove('chosen'); void card.offsetWidth; card.classList.add('chosen'); setTimeout(() => goStep(3), 260); }
});
$('#style-track').addEventListener('keydown', (e) => {
  if ($('#style-track').classList.contains('gallery')) {
    const cols = getComputedStyle($('#style-track')).gridTemplateColumns.split(/\s+/).length;
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? styleIds().length - 1 : delta ? Math.max(0, Math.min(styleIds().length - 1, state.styleIndex + delta)) : null;
    if (next !== null) { e.preventDefault(); selectStyleIndex(next); $('#style-track .style-card.on')?.focus(); }
    return;
  }
  if (e.key === 'ArrowLeft') { e.preventDefault(); selectStyleIndex(state.styleIndex - 1); $('#style-track .style-card.on')?.focus(); }
  if (e.key === 'ArrowRight') { e.preventDefault(); selectStyleIndex(state.styleIndex + 1); $('#style-track .style-card.on')?.focus(); }
});

// drag / swipe / flick with momentum
(function coverflowDrag() {
  const track = $('#style-track');
  let down = false, x0 = 0, p0 = 0, samples = [];
  track.addEventListener('pointerdown', (e) => {
    if (track.classList.contains('gallery')) return;
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
    if (track.classList.contains('gallery')) return;
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
  invalidateStyleArtwork();
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
  invalidateStyleArtwork();
  save();
  syncStyleExtras();
  toast('Style reference added. Every character and scene will copy its look.');
});
$('#btn-clear-ref').addEventListener('click', () => {
  delete state.project.settings.styleRef;
  invalidateStyleArtwork();
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
  renderJourney();
  renderSettingsExample();
}

$$('#seg-format button, #seg-aspect button').forEach((b) => b.addEventListener('click', () => setAspect(b.dataset.aspect)));
$$('#seg-face button').forEach((b) => b.addEventListener('click', () => {
  if (!state.project) return;
  state.project.settings.faceMode = b.dataset.face;
  save();
  $$('#seg-face button').forEach((x) => x.classList.toggle('on', x === b));
  refresh();
}));

/** Living pictures (motion + effects) or plain still pictures. */
function syncMotionUI() {
  const st = state.project?.settings;
  if (!st) return;
  if (st.sceneMotion !== 'still') st.sceneMotion = 'living';
  $$('#seg-motion button').forEach((x) => x.classList.toggle('on', x.dataset.motion === st.sceneMotion));
  $('#opt-living').checked = st.sceneMotion === 'living';
  renderSettingsExample();
}

$$('#seg-motion button').forEach((b) => b.addEventListener('click', () => {
  if (!state.project) return;
  state.project.settings.sceneMotion = b.dataset.motion;
  save();
  syncMotionUI();
  drawPreview();
}));

$$('#seg-pacing button').forEach((b) => b.addEventListener('click', () => {
  if (!state.project) return;
  state.project.settings.pacing = b.dataset.pacing;
  save();
  $$('#seg-pacing button').forEach((x) => x.classList.toggle('on', x === b));
  renderSettingsExample();
  if (state.project.segments.length) toast('Pacing changed. Press "Start over with new settings" in step 4 to re-plan the edit with it.', 5000);
}));

// ---------- step 4 summary ----------

function renderSettingsExample() {
  const s = state.project?.settings;
  if (!s) return;
  const still = s.sceneMotion === 'still', bubble = s.faceMode === 'bubble';
  $('#setup-detail-summary').textContent = `${still ? 'Still pictures' : 'Living pictures'} · ${bubble ? 'face bubble' : 'full-frame cuts'}`;
  const pacing = s.pacing || 'mostly';
  const image = exampleSceneForStyle(s.style, STYLES[s.style]?.thumb || 'assets/styles/stick.jpg');
  const player = $('#example-player');
  Object.assign(player.dataset, { format: state.aspect, face: s.faceMode || 'full', motion: still ? 'still' : 'living', pacing });
  if ($('#example-scene').getAttribute('src') !== image) $('#example-scene').src = image;
  $$('#panel-settings [data-example-scene]').forEach((img) => { if (img.getAttribute('src') !== image) img.src = image; });
  $$('#seg-pacing .cut-example i:not(.ex-you)').forEach((el) => { el.style.backgroundImage = `url("${image}")`; });
  const copy = {
    mostly: ['Your face. A world around it.', 'Scenes carry the story. Your face returns for reactions.'],
    bookends: ['Open with you. End with you.', 'You open and close the story. Scenes fill the middle.'],
    story: ['Let the illustrations tell it.', 'A quick opening with you, then scenes follow your voice.'],
  }[pacing];
  $('#example-title').textContent = copy[0];
  $('#example-description').textContent = `${copy[1]} ${bubble ? 'You stay in a corner of each scene.' : 'Scenes fill the screen.'} ${still ? 'Calm, slow zooms.' : 'Small movements bring scenes to life.'}`;
  const shots = { mostly: ['face', 'scene', 'scene', 'face', 'scene'], bookends: ['face', 'scene', 'scene', 'scene', 'face'], story: ['face-short', 'scene', 'scene', 'scene', 'scene'] }[pacing];
  $('#example-sequence').innerHTML = shots.map((kind, i) => `<span class="example-shot ${kind}" style="--shot-index:${i}"><img src="${kind.startsWith('face') ? 'assets/hero/talk.jpg' : esc(image)}" alt=""><small>${kind.startsWith('face') ? 'You' : 'Story'}</small></span>`).join('');
}

function renderSummary() {
  const p = state.project;
  if (!p) return;
  const s = p.settings;
  const st = s.style === 'custom' ? { label: 'Your custom style' } : STYLES[s.style] || STYLES.stick;
  const pacing = { mostly: 'Story + you', bookends: 'Intro & outro', story: 'Mostly story' }[s.pacing] || 'Story + you';
  const row = (ico, label, value, back, story = false) => `<div class="sum-row"><span class="sum-ico">${ico}</span><span class="sum-txt"><small>${label}</small><b>${esc(value)}</b></span><button class="btn link" data-back="${back}" ${story ? 'data-story-change="1"' : ''} aria-label="Change ${esc(label.toLowerCase())}">Change</button></div>`;
  $('#create-summary').innerHTML = [
    row(icon('text'), 'Story', s.storyMode === 'transcript' ? p.words.length && ['text', 'subtitles'].includes(p.transcriptSource) ? `Your transcript, ${p.words.length} words` : 'Your transcript — add your words' : 'AI finds everything', 4, true),
    row(st.thumb ? `<img src="${esc(st.thumb)}" alt="">` : icon('palette'), 'Style', st.label + (s.styleNotes?.trim() ? ' + your details' : ''), 2),
    row(icon('film'), 'Format & pacing', `${state.aspect === 'horizontal' ? '16:9' : '9:16'} · ${pacing}${s.faceMode === 'bubble' ? ' · face bubble' : ''}${p.settings.sceneMotion === 'still' ? ' · still pictures' : ' · living pictures'}`, 3),
    row(icon('user'), 'Video', state.file ? state.file.name : 'Demo story', 1),
  ].join('');
}

$('#btn-reset-setup').addEventListener('click', () => {
  $('#seg-format [data-aspect=vertical]').click();
  $('#seg-pacing [data-pacing=mostly]').click();
  $('#seg-motion [data-motion=living]').click();
  $('#seg-face [data-face=full]').click();
  toast('Recommended settings restored.');
});

// ---------- step 3 prep: transcript + your characters ----------

function renderPrep(forceCast = false) {
  const p = state.project;
  if (!p) return;
  const manual = p.settings.storyMode === 'transcript';
  const custom = ['text', 'subtitles'].includes(p.transcriptSource);
  const n = p.words.length;
  const ready = manual && custom && n > 0;
  $$('#seg-story button').forEach((b) => { const on = b.dataset.storyMode === p.settings.storyMode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.disabled = !!state.busy || !!state.transcriptBusy || !!p.segments.length; });
  $('#prep-transcript').classList.toggle('hidden', !manual);
  $('#story-auto-note').hidden = manual;
  $('#listening-options').hidden = manual;
  $('#transcript-state').textContent = state.transcriptBusy ? 'Lining your words up with your voice…' : ready ? `${n} words ready${p.transcriptSource === 'subtitles' ? ' · your subtitle timing is kept' : ' · lined up with your voice'}.` : 'Upload a file or paste your words to continue.';
  $('#prep-transcript').classList.toggle('ready', !!ready);
  $('#btn-transcript-clear').hidden = !(manual && !p.segments.length);
  $('#btn-check-transcript').hidden = !n || !!p.segments.length;
  $('#btn-paste-open').textContent = ready ? 'Edit your text' : 'Paste text';
  $('#btn-paste-open').disabled = !!state.transcriptBusy || !!state.busy;
  $('#transcript-file').disabled = !!state.transcriptBusy || !!state.busy;
  $('#btn-use-paste').disabled = !!state.transcriptBusy;
  $('#btn-use-paste').firstChild.textContent = state.transcriptBusy ? 'Preparing your words…' : 'Use this transcript';
  const pasting = !$('#paste-box').classList.contains('hidden');
  $('#create-action').hidden = pasting || (manual && !ready);
  const upload = $('#btn-transcript-upload');
  upload.classList.toggle('primary', manual && !ready && !pasting);
  upload.setAttribute('aria-disabled', String(!!state.transcriptBusy || !!state.busy));
  if (document.activeElement !== $('#plan-notes')) $('#plan-notes').value = p.settings.planNotes || '';
  const hints = p.settings.castHints || [];
  const box = $('#cast-pre');
  if (forceCast || !document.activeElement?.closest('#cast-pre')) box.innerHTML = hints.map((h, i) => `
    <div class="row" data-i="${i}">
      <span class="hint-avatar">${icon('user')}</span><label class="field">Name<input data-k="name" placeholder="e.g. Jake, Dad or Biscuit" value="${esc(h.name)}" maxlength="30"></label>
      <label class="field">What do they look like?<input data-k="description" placeholder="e.g. curly hair, glasses, green hoodie" value="${esc(h.description)}" maxlength="160"></label>
      <button class="x icon-btn" data-del="${i}" aria-label="Remove ${esc(h.name || 'character details')}">${icon('close')}</button>
    </div>`).join('');
  $('#btn-cast-pre-add').disabled = hints.length >= 8;
  $('#prep-cast').classList.toggle('ready', hints.some((h) => h.name?.trim()));
}

function setStoryMode(mode) {
  const p = state.project;
  if (!p || state.busy || state.transcriptBusy || transcriptLocked()) return;
  if (p.settings.storyMode !== mode) {
    p.transcriptDrafts ||= {};
    if (p.words.length) p.transcriptDrafts[p.settings.storyMode] = { words: p.words, source: p.transcriptSource, reviewed: p.transcriptReviewed };
    const draft = p.transcriptDrafts[mode];
    p.words = draft?.words || [];
    p.transcriptSource = draft?.source || 'auto';
    p.transcriptReviewed = draft?.reviewed || false;
    p.settings.storyMode = mode;
  }
  state.stages = {}; state.reviewingTranscript = false;
  $('#paste-box').classList.add('hidden');
  setStatus('#story-input-status', '');
  setStatus('#create-status', '');
  save(); renderPrep(); renderSummary(); renderPipeline(); updateCosts(); renderTranscript();
}
$('#seg-story').addEventListener('click', (e) => { const b = e.target.closest('[data-story-mode]'); if (b && !b.disabled) setStoryMode(b.dataset.storyMode); });
$('#wizard').addEventListener('click', (e) => {
  if (!e.target.closest('[data-story-change]')) return;
  requestAnimationFrame(() => { $('#story-input').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); $('#story-input-title').focus({ preventScroll: true }); });
});
$('#plan-notes').addEventListener('input', (e) => { if (state.project) { state.project.settings.planNotes = e.target.value; save(); } });

$('#btn-cast-pre-add').addEventListener('click', () => {
  if (!state.project || state.project.settings.castHints.length >= 8) return;
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
  const i = +d.dataset.del;
  state.project.settings.castHints.splice(i, 1);
  save(); renderPrep(true);
  ($$('#cast-pre .row')[Math.min(i, state.project.settings.castHints.length - 1)]?.querySelector('[data-k=name]') || $('#btn-cast-pre-add')).focus({ preventScroll: true });
});

function transcriptLocked() {
  if (state.project?.segments.length) { toast('Your edit is already planned. Use "Start over" to change the transcript.', 4500); return true; }
  return false;
}

async function storySpeechSpans(p) {
  const file = state.file;
  if (!file) return null;
  if (state.speechCache?.project === p && state.speechCache.file === file) return state.speechCache.spans;
  let spans = null;
  try { spans = speechSpans(await decodeAudio(file)); } catch { /* videos without audio use the existing duration fallback */ }
  if (state.project === p && state.file === file) state.speechCache = { project: p, file, spans };
  return spans;
}

function acceptTranscript(p, words, source) {
  p.words = words; p.transcriptSource = source; p.transcriptReviewed = true;
  p.settings.storyMode = 'transcript';
  state.stages = {}; state.reviewingTranscript = false;
  $('#paste-box').classList.add('hidden');
  setStatus('#story-input-status', '');
  setStatus('#create-status', '');
  save(); renderPrep(); renderTranscript(); renderSummary(); renderPipeline(); updateCosts();
}

$('#transcript-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f || !state.project || transcriptLocked()) return;
  const p = state.project, task = ++state.transcriptTask;
  state.transcriptBusy = true; renderPrep(); renderPipeline();
  try {
    const text = await f.text();
    const subs = wordsFromSubtitles(text);
    if (/\.(srt|vtt)$/i.test(f.name) && !subs) { toast('We couldn\'t read that subtitle file. Try another file or paste the words.'); return; }
    const words = subs || wordsFromText(text, p.duration, await storySpeechSpans(p));
    if (p !== state.project || task !== state.transcriptTask) return;
    if (!words.length) { toast('That file doesn\'t seem to contain any words.'); return; }
    acceptTranscript(p, words, subs ? 'subtitles' : 'text');
  } catch { toast('We couldn\'t read that file. Try again or paste your words.'); }
  finally { if (p === state.project && task === state.transcriptTask) { state.transcriptBusy = false; renderPrep(); renderPipeline(); } }
});
$('#btn-transcript-upload').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!$('#transcript-file').disabled) $('#transcript-file').click(); }
});
$('#btn-paste-open').addEventListener('click', () => {
  if (transcriptLocked()) return;
  if (state.busy || state.transcriptBusy) return;
  $('#paste-msg').textContent = 'Paste what you say in the video';
  $('#paste-text').value = ['text', 'subtitles'].includes(state.project.transcriptSource) ? state.project.words.map((w) => w.w).join(' ') : '';
  $('#paste-box').classList.remove('hidden');
  renderPrep();
  $('#paste-text').focus({ preventScroll: true });
  $('#paste-box').scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
});
$('#btn-paste-cancel').addEventListener('click', () => { $('#paste-box').classList.add('hidden'); renderPrep(); $('#btn-paste-open').focus({ preventScroll: true }); });
$('#btn-transcript-clear').addEventListener('click', () => {
  setStoryMode('auto');
});

function showTranscriptReview() {
  const p = state.project;
  if (!p?.words.length || p.segments.length) return;
  liveStop();
  state.reviewingTranscript = true;
  state.reviewOriginalText = p.words.map((w) => w.w).join(' ');
  $('#review-text').value = state.reviewOriginalText;
  $('#review-text').readOnly = true;
  $('#review-count').textContent = `${p.words.length} words`;
  $('#review-edit-note').hidden = true;
  $('#btn-review-edit').hidden = false;
  $('#btn-review-continue').firstChild.textContent = 'Looks right, continue';
  $('#skip-transcript-review').checked = store.get('storycuts:skip-transcript-review', false);
  setStatus('#review-status', '');
  renderPipeline();
  requestAnimationFrame(() => { $('#transcript-review').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); $('#review-title').focus({ preventScroll: true }); });
}
$('#btn-check-transcript').addEventListener('click', showTranscriptReview);
$('#btn-review-edit').addEventListener('click', () => {
  $('#review-text').readOnly = false; $('#review-edit-note').hidden = false; $('#btn-review-edit').hidden = true;
  $('#btn-review-continue').firstChild.textContent = 'Save & continue';
  $('#review-text').focus();
});
$('#review-text').addEventListener('input', () => { $('#review-count').textContent = `${$('#review-text').value.trim().split(/\s+/).filter(Boolean).length} words`; });
$('#btn-review-continue').addEventListener('click', async () => {
  const p = state.project;
  if (!state.reviewingTranscript || state.busy || !p) return;
  const text = $('#review-text').value.trim();
  if (!text) { setStatus('#review-status', 'Add your words before continuing.', 'err'); $('#review-text').focus(); return; }
  state.busy = true; $('#btn-review-continue').disabled = true;
  try {
    if (text !== state.reviewOriginalText) {
      setStatus('#review-status', 'Lining the corrected words up with your voice…', 'busy');
      const words = wordsFromText(text, p.duration, await storySpeechSpans(p));
      if (p !== state.project) return;
      p.words = words; p.transcriptSource = 'text';
    }
    p.transcriptReviewed = true;
    store.set('storycuts:skip-transcript-review', $('#skip-transcript-review').checked);
    state.reviewingTranscript = false;
    save(); renderTranscript(); renderPrep(); renderSummary();
  } finally { state.busy = false; $('#btn-review-continue').disabled = false; }
  if (p === state.project) createVideo();
});

// ---------- live progress card ----------

const TIPS = {
  transcribe: ['Listening to every word…', 'Lining each word up with your audio…', 'The first time sets up the voice reader on your device. Next time starts faster.'],
  plan: ['Finding the hook…', 'Deciding when to show you and when to cut away…', 'Spotting every character and place in your story…', 'Writing a scene for each moment…'],
  cast: ['Sketching your characters…', 'Picking colours and outfits…', 'Checking hands, faces and details…', 'Each character is drawn once and reused in every scene.'],
  scenes: ['Drawing your scenes…', 'Keeping every character\'s look consistent…', 'Checking each picture and redrawing any that need it…'],
};

const LOADER_KIND = { transcribe: 'listen', plan: 'plan', cast: 'cast', scenes: 'draw' };

const LIVE_STEPS = ['Listening to your story', 'Planning the edit', 'Checking every scene'];

/** Full-screen progress while the story is transcribed and planned. */
function liveStart(stage, title) {
  const p = state.project;
  const eta = stage === 'transcribe' ? Math.max(20, (p?.duration || 60) * 0.5) : stage === 'plan' ? 50 : 30;
  const step = stage === 'transcribe' ? 0 : 1;
  if (state.live) { state.live.update({ kind: LOADER_KIND[stage], title, tips: TIPS[stage] || [], step, eta }); return; }
  state.live = showWork({ kind: LOADER_KIND[stage], title, tips: TIPS[stage] || [], eta, steps: LIVE_STEPS, note: 'This usually takes a minute or two.' });
  state.live.update({ step });
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
  $('#create-cost').textContent = `About ${fmtUSD(plan + imgs + animEst)}${animated ? ' with animated scenes' : ''} · billed to your AI accounts`;
  if (p.approved) {
    const todo = sceneSegs().filter(needsImage).length;
    const animTodo = animated && !todo ? animSegs().length : 0;
    const busy = !!state.genAbort;
    const costNow = fmtUSD(estimateImageCost(todo, s, s.qc && !!s.key));
    const mins = Math.max(1, Math.round(Math.ceil(todo / 2) * 35 / 60));
    $('#dc-title').textContent = todo ? `${todo} scene${todo === 1 ? ' isn\'t' : 's aren\'t'} drawn yet` : animTodo ? `${animTodo} scene${animTodo === 1 ? '' : 's'} to animate` : 'All scenes drawn';
    $('#scenes-cost').textContent = todo ? `About ${costNow} · takes about ${mins} minute${mins === 1 ? '' : 's'}` : animTodo ? `About ${fmtUSD(estimateAnimCost(animSegs(), s.videoModel))}` : '';
    $('#draw-card').hidden = false;
    $('#draw-card').classList.toggle('busy', busy);
    $('#draw-card').classList.toggle('done', !busy && !todo && !animTodo);
    $('#btn-redraw-all').hidden = busy || !!todo || !sceneSegs().length;
    const btn = $('#btn-gen-scenes');
    btn.querySelector('span').textContent = todo ? `Draw ${todo === 1 ? 'it' : `${todo} scenes`}` : animTodo ? 'Animate' : 'Redraw all';
  }
}

async function createVideo() {
  const p = state.project;
  if (state.busy || state.transcriptBusy) return;
  if (!p) { toast('Upload a video first (or try the demo).'); goStep(1); return; }
  if (p.approved) { goStep(5); return; }
  if (p.settings.storyMode === 'transcript' && (!p.words.length || !['text', 'subtitles'].includes(p.transcriptSource))) { toast('Add your transcript before continuing.'); goStep(4); $('#prep-transcript').scrollIntoView({ block: 'center' }); return; }
  if (state.file && !hasAccess() && (paidCheckoutOpen() || !keysReady())) { openPaywall(); return; }
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
          onStatus: (m) => {
            const percent = m.match(/(\d+)%/);
            state.live?.update({ title: percent ? `Getting ready to listen · ${percent[1]}%` : /Loading/.test(m) ? 'Getting ready to listen' : /Reading/.test(m) ? 'Opening your audio' : 'Listening to your story' });
          },
        });
        if (!words.length) throw new Error('no speech found');
        p.words = words; p.transcriptSource = 'auto'; p.transcriptReviewed = false; save(); renderTranscript(); renderPrep();
      } catch (e) {
        console.warn('StoryCuts could not read the speech:', errText(e));
        liveStop();
        p.settings.storyMode = 'transcript';
        state.stages = {};
        setStatus('#story-input-status', 'We couldn\'t hear your words on this device. Upload a transcript or paste what you say to keep going.', 'err');
        save(); renderPrep(); renderSummary();
        return;
      }
    }
    setStage('transcribe', 'done');
    if (p.settings.storyMode === 'auto' && !p.transcriptReviewed && !store.get('storycuts:skip-transcript-review', false)) { showTranscriptReview(); return; }

    // 2. plan
    if (!p.segments.length) {
      setStage('plan', 'active');
      liveStart('plan', 'Planning your edit and characters');
      const s = settingsGet();
      const notes = [
        p.settings.planNotes?.trim(),
        p.settings.faceMode === 'bubble' ? '' : 'Use only "face" and "scene" shots (no scene_bubble): the creator wants full-frame cuts.',
      ].filter(Boolean).join(' ');
      try {
        const raw = await planWithClaude(s.key, p.words, p.duration, {
          model: s.model, notes, pacing: p.settings.pacing, cast: p.settings.castHints || [],
          onStage: () => state.live?.update({ step: 2, eta: 25, title: 'Checking every scene for continuity', tips: ['Making sure everyone is only where they really are…', 'Texts and calls get one shot per side…', 'Matching each scene to the right place…'] }),
        });
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
    scrollTo('#cast');
  } finally {
    state.busy = false;
    liveStop();
    renderPrep(); renderPipeline(); renderStepper();
  }
}

async function usePaste() {
  const p = state.project;
  if (!p || state.busy || state.transcriptBusy || transcriptLocked()) return;
  const text = $('#paste-text').value.trim();
  if (!text) { toast('Paste what you say in the video first.'); return; }
  const task = ++state.transcriptTask;
  state.transcriptBusy = true; renderPrep(); renderPipeline();
  try {
    const words = wordsFromText(text, p.duration, await storySpeechSpans(p));
    if (p !== state.project || task !== state.transcriptTask) return;
    acceptTranscript(p, words, 'text');
  } finally { if (p === state.project && task === state.transcriptTask) { state.transcriptBusy = false; renderPrep(); renderPipeline(); } }
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

/** Can this browser actually keep pictures? Warn clearly if not. */
async function checkStorage() {
  const key = 'storycuts:healthcheck';
  let ok = false;
  try {
    await putBlob(key, new Blob(['ok'], { type: 'text/plain' }));
    ok = await hasBlob(key) && !storageProblem;
    await deleteBlobs(key);
  } catch { ok = false; }
  let persisted = true;
  try { persisted = (await navigator.storage?.persisted?.()) ?? true; } catch { /* unknown */ }
  const bar = $('#storage-warn');
  if (!ok) {
    bar.innerHTML = `${icon('alert')}<span><b>This browser isn't saving your pictures.</b> Private or incognito windows (and some browser settings) delete them when you close the tab. Use a normal Chrome or Edge window so your characters and scenes stay saved.</span>`;
    bar.hidden = false;
  } else if (!persisted) {
    // not fatal: the browser may clear data if the device runs low on space
    try { await navigator.storage?.persist?.(); } catch { /* ignore */ }
  }
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
  if (!el.isConnected) return;
  if (!blob) { el.classList.add('missing'); return; }
  if (el.dataset.url) URL.revokeObjectURL(el.dataset.url);
  el.classList.remove('missing');
  el.dataset.url = URL.createObjectURL(blob);
  el.src = el.dataset.url;
}

// A redraw must not throw away a draft in a different card or in the inspector.
function captureEditing(host) {
  const a = document.activeElement;
  if (!host.contains(a) || !a.matches('input, textarea, select')) return null;
  const k = ['k', 's', 'f'].find((key) => a.dataset[key]);
  const field = a.id ? `#${CSS.escape(a.id)}` : k ? `[data-${k}="${CSS.escape(a.dataset[k])}"]` : null;
  if (!field) return null;
  const card = a.closest('.char');
  return { selector: `${card ? `[data-character="${CSS.escape(card.dataset.character)}"] ` : ''}${field}`, value: a.value, checked: a.checked, start: a.selectionStart, end: a.selectionEnd, scroll: a.scrollTop };
}

function restoreEditing(host, draft) {
  if (!draft) return;
  const a = host.querySelector(draft.selector);
  if (!a || a.disabled) return;
  a.value = draft.value;
  if (a.type === 'checkbox') a.checked = draft.checked;
  a.focus({ preventScroll: true });
  if (typeof draft.start === 'number') a.setSelectionRange(draft.start, draft.end);
  a.scrollTop = draft.scroll;
}

function releaseImageUrls(host) {
  host.querySelectorAll('img[data-url]').forEach((img) => URL.revokeObjectURL(img.dataset.url));
}

const characterNeedsDrawing = (c) => !c.image?.key || !!c.image.stale;

function invalidateCharacterScenes(ch) {
  state.project.segments.forEach((sg) => {
    if (sg.image?.key && sg.scene?.actors.some((a) => a.character_id === ch.id)) sg.image.stale = true;
  });
}

function renderChars() {
  const el = $('#chars');
  const p = state.project;
  const busy = state.charBusy || new Set();
  const draft = captureEditing(el);
  if ($('#character-preview').open) $('#character-preview').close();
  releaseImageUrls(el);
  el.innerHTML = p.characters.map((c, i) => `
    <div class="char ${c.image?.stale ? 'stale' : ''}" data-i="${i}" data-character="${esc(c.id)}">
      <div class="char-top"><span class="char-number">${i + 1}</span><b class="char-name">${esc(c.name)}</b><span class="char-state ${characterNeedsDrawing(c) ? 'waiting' : 'complete'}">${busy.has(c.id) ? 'Drawing…' : c.image?.stale ? 'Update needed' : c.image?.key ? 'Ready to review' : 'Not drawn yet'}</span></div><div class="char-main">
      <div class="char-art">
        ${c.image?.key ? `<img alt="Design for ${esc(c.name)}">` : `<div class="empty"><span class="avatar" aria-hidden="true">${esc([...String(c.name ?? "").trim()][0] || '?')}</span><span class="empty-txt">${busy.size ? 'Waiting to be drawn' : 'Your drawing appears here'}</span></div>`}
        ${busy.has(c.id) ? `<div class="art-busy"><svg viewBox="0 0 100 120"><circle cx="50" cy="24" r="14"/><path d="M50 38v40"/><path d="M50 50l-20 16M50 50l20 16"/><path d="M50 78l-16 30M50 78l16 30"/></svg><small>Sketching ${esc(c.name)}…</small></div>` : ''}
        ${c.image?.key ? qcBadge(c.image) : ''}
        ${c.image?.key ? `<button class="icon-btn portrait-zoom" data-character-preview="${i}" aria-label="View ${esc(c.name)} larger">${icon('plus')}</button>` : ''}
      </div>
      <div class="char-fields">
        <label class="field">Character name<input data-k="name" value="${esc(c.name)}" maxlength="24" ${busy.has(c.id) ? 'disabled' : ''}></label>
        <label class="field">What they look like<textarea data-k="description" rows="3" maxlength="140" placeholder="Hair, clothes, one recognizable detail" ${busy.has(c.id) ? 'disabled' : ''}>${esc(c.description)}</textarea></label>
        ${c.id === 'me' && state.media instanceof VideoMedia ? `<label class="check small"><input type="checkbox" data-k="useVideoLook" ${c.useVideoLook !== false ? 'checked' : ''} ${busy.has(c.id) ? 'disabled' : ''}><span class="box">${icon('check')}</span>Look like me (uses a frame of my video)</label>` : ''}
        <p class="char-edit-note" ${c.image?.stale ? '' : 'hidden'}>Details changed. Redraw to update this look.</p>
        <div class="char-row">
          <button class="btn sm char-draw" data-redraw="${i}" ${busy.size ? 'disabled' : ''} aria-label="${c.image?.key ? 'Redraw' : 'Draw'} ${esc(c.name)}">${icon(c.image?.key ? 'redo' : 'edit')}${c.image?.key ? 'Try a new look' : 'Draw this character'}</button>
          ${c.id === 'me' ? '<small>This is you</small>' : `<button class="icon-btn sm" data-del="${i}" aria-label="Remove ${esc(c.name)}" data-tip="Remove" ${busy.size ? 'disabled' : ''}>${icon('trash')}</button>`}
        </div>
      </div>
      </div>
    </div>`).join('');
  el.querySelectorAll('.char').forEach((card) => {
    const ch = p.characters[+card.dataset.i];
    const img = card.querySelector('img');
    if (img) fillImg(img, ch.image.key);
  });
  restoreEditing(el, draft);
  syncCastNavigation(p.characters);
  $('#btn-add-char').disabled = !!busy.size;
  checkCastPictures();
  renderCastBar();
}

/** The bar under the cast: one clear next step at a time. */
function renderCastBar() {
  const p = state.project;
  if (!p) return;
  const n = p.characters.length;
  const drawn = p.characters.filter((c) => !characterNeedsDrawing(c)).length;
  const missing = n - drawn;
  const changed = p.characters.filter((c) => c.image?.stale).length;
  const busy = state.charBusy?.size || 0;
  const gen = $('#btn-gen-chars');
  const ok = $('#btn-approve');
  const scenes = p.segments.filter((sg) => sg.type !== 'face').length;
  let title, sub;
  if (busy) {
    title = `Drawing your characters: ${drawn} of ${n} done`;
    sub = 'This takes about a minute. When the pictures are ready, check each look before continuing.';
  } else if (missing) {
    title = changed ? `Update ${missing} character${missing === 1 ? '' : 's'} before continuing` : drawn ? `${missing} character${missing > 1 ? 's' : ''} still need${missing > 1 ? '' : 's'} a picture` : 'Check the details, then draw your cast';
    sub = changed ? 'Redraw the updated characters so your scenes use the right look.' : drawn ? 'Each character needs a picture before we draw the scenes.' : 'Your edits save as you type. Draw everyone when the details look right.';
  } else {
    title = 'Do these look like your characters?';
    sub = `Check each picture. Try a new look if you need to, then approve your cast to draw the scenes.`;
  }
  $('#cb-title').textContent = title;
  $('#cb-sub').textContent = sub;
  gen.hidden = !missing && !busy;
  gen.disabled = !!busy || state.busy;
  gen.classList.toggle('busy', !!busy);
  gen.querySelector('span').textContent = busy ? 'Drawing your cast…' : changed ? `Update ${missing} character${missing === 1 ? '' : 's'}` : drawn ? `Draw ${missing} missing` : 'Draw my cast';
  const sNow = settingsGet();
  $('#cb-cost').textContent = missing && !busy ? `About ${missing > 2 ? Math.ceil(missing / 2) : 1} minute${missing > 2 ? 's' : ''} · about ${fmtUSD(estimateImageCost(missing, sNow, sNow.qc && !!sNow.key))}` : '';
  $('#cb-cost').parentElement.hidden = gen.hidden;
  $('#cast-bar').classList.toggle('cta-big', !!missing && !busy && !drawn);
  const firstDraw = !p.characters.some((c) => c.image?.key) && !busy;
  $('#cast-title').textContent = firstDraw ? `Your ${n} character${n === 1 ? '' : 's'}` : 'Meet your cast';
  $('#cast-sub').textContent = firstDraw ? 'Check the names and appearances. Then draw your cast.' : changed ? 'Redraw the updated characters before drawing your scenes.' : missing || busy ? 'Every scene is drawn from these designs.' : 'Check each look. Try a new look for anyone you\'d like to change.';
  ok.hidden = !!missing || !!busy;
  ok.disabled = state.busy;
  ok.querySelector('span').textContent = `Approve & draw ${scenes} scene${scenes === 1 ? '' : 's'}`;
  $('#cb-step1').className = `cb-step ${missing || busy ? 'on' : 'done'}`;
  $('#cb-step2').className = `cb-step ${missing || busy ? '' : 'on'}`;
  $('#cb-step3').className = 'cb-step';
  $('#cast-bar').classList.toggle('ready', !missing && !busy);
  const ready = p.approved && !missing && !busy;
  $$('#cast-guide > div').forEach((el, i) => { el.classList.toggle('current', !ready && (busy ? i === 1 : missing ? i === 0 : i === 2)); el.classList.toggle('complete', ready || !missing && i < 2); });
  $('#cast-guide > div:last-child b').textContent = ready ? 'Cast ready' : 'Review & approve';
  $('#cast-guide > div:last-child small').textContent = ready ? 'Edit any look below.' : 'Then draw the scenes.';
  $('#cast-guide').setAttribute('aria-label', ready ? 'Your cast is ready. Edit any character or open the editor.' : busy ? 'Drawing your cast' : missing ? 'Check the names and appearances, then draw your cast' : 'Review your pictures, then approve your cast');
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
  if (state.charBusy?.size) { toast('Your characters are still being drawn.'); return false; }
  if (!hasImageKey()) { openSettings(); return false; }
  if (!list.length) return true;
  const job = imageJobOpts();
  state.charBusy = new Set(list.map((c) => c.id));
  renderChars();
  const ld = showWork({
    kind: 'cast', title: `Drawing ${list.length === 1 ? list[0].name : `your ${list.length} characters`}`, short: 'Drawing characters', total: list.length, perItem: job.keys.claude ? 40 : 25, parallel: 2,
    background: 'Watch them appear',
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
      invalidateCharacterScenes(ch);
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
  const missing = p.characters.filter(characterNeedsDrawing);
  drawCharacters(missing.length ? missing : p.characters);
});

$('#chars').addEventListener('input', (e) => {
  const card = e.target.closest('.char');
  const k = e.target.dataset.k;
  if (!card || !k) return;
  const ch = state.project.characters[+card.dataset.i];
  if (!state._charEditing) { snapshot(); state._charEditing = true; setTimeout(() => { state._charEditing = false; }, 800); }
  ch[k] = k === 'useVideoLook' ? e.target.checked : e.target.value;
  card.querySelector('.char-name').textContent = ch.name || 'Your character';
  card.querySelector('[data-redraw]').setAttribute('aria-label', `${ch.image?.key ? 'Redraw' : 'Draw'} ${ch.name || 'your character'}`);
  card.querySelector('[data-del]')?.setAttribute('aria-label', `Remove ${ch.name || 'your character'}`);
  card.querySelector('[data-character-preview]')?.setAttribute('aria-label', `View ${ch.name || 'your character'} larger`);
  if (k === 'name') {
    syncCastNavigation(state.project.characters);
    const avatar = card.querySelector('.avatar');
    if (avatar) avatar.textContent = [...String(ch.name ?? "").trim()][0] || '?';
  }
  const portrait = card.querySelector('.char-art img');
  if (portrait) portrait.alt = `Design for ${ch.name || 'your character'}`;
  if (ch.image?.key && k !== 'name') {
    ch.image.stale = true;
    invalidateCharacterScenes(ch);
    card.classList.add('stale');
    card.querySelector('.char-edit-note').hidden = false;
    card.querySelector('.char-state').textContent = 'Update needed';
    card.querySelector('.char-state').classList.remove('complete');
    card.querySelector('.char-state').classList.add('waiting');
  }
  save();
  renderPipeline();
});

$('#chars').addEventListener('focusin', (e) => {
  if (!isPhone() || !e.target.matches('input, textarea')) return;
  const bottom = e.target.getBoundingClientRect().bottom;
  const bar = $('#cast-bar').getBoundingClientRect();
  if (bar.height && bottom > bar.top - 16) window.scrollBy({ top: bottom - bar.top + 24, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
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
    const next = state.project.characters[Math.min(i, state.project.characters.length - 1)];
    if (next) selectCastCharacter(next.id, { focus: true, scroll: true });
  }
});

$('#btn-add-char').addEventListener('click', () => {
  if (state.charBusy?.size) return;
  if (state.project.characters.length >= 8) { toast('A story can have up to 8 characters.'); return; }
  const name = 'New character';
  let added;
  edit(() => {
    const p = state.project;
    let id = slug(name);
    while (p.characters.some((c) => c.id === id)) id += '_2';
    added = id;
    p.characters.push({ id, name, description: '', color: '#8854d0', hair: 'short', hairColor: '#2b2b2b', accessory: 'none', height: 1 });
  });
  selectCastCharacter(added);
  const input = $(`#chars [data-character="${CSS.escape(added)}"] [data-k="name"]`);
  input?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  input?.focus({ preventScroll: true });
  input?.select();
});

async function approveAndDraw() {
  const p = state.project;
  if (p.characters.some(characterNeedsDrawing)) { toast('Draw or update your characters before approving the cast.'); return; }
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
  setVideoRelay(s.videoRelay);
  if (!s.openai) { openSettings(); return; }
  if (!list.length) return;
  const ac = { stop: false };
  state.genAbort = ac;
  state.genMode = 'animate';
  state.cache.animating = new Set(list.map((sg) => sg.id));
  state.genDone = 0; state.genTotal = list.length;
  updateCosts(); renderTimeline();
  const ld = showWork({
    kind: 'film', background: 'Back to editor', short: 'Animating', title: `Animating ${list.length === 1 ? 'this scene' : `${list.length} scenes`}`, total: list.length, perItem: 100, parallel: 2,
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
    } catch (e) {
      // if OpenAI can't be reached at all, the other scenes will fail the same way
      if (e.network && e.step === 'start') ac.stop = true;
      throw e;
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
  const skipped = results.filter((r) => !r.ok && r.error.message === 'stopped').length;
  if (failed.length) {
    const e = failed[0].error;
    const why = e.network && e.step === 'start'
      ? 'Your browser couldn\'t reach OpenAI\'s video service. Add the free video relay under API keys → More options, then try again.'
      : errText(e);
    setStatus('#scenes-status', `${list.length - failed.length - skipped} animated, ${failed.length + skipped} kept as still pictures. ${why}`, 'err');
  }
  else setStatus('#scenes-status', ac.stop ? 'Stopped.' : '');
  updateCosts(); renderInspector();
}

async function generateScenes(list, note = '') {
  if (!hasImageKey()) { openSettings(); return; }
  if (!list.length) return;
  if (state.genAbort) { toast('Your scenes are still being drawn.'); return; }
  if (state.project.characters.some(characterNeedsDrawing)) { toast('Update your cast before drawing scenes in this style.'); goStep(4); return; }
  if (document.body.classList.contains('sheet-open')) closeSheet();
  const job = imageJobOpts();
  const ac = { stop: false };
  state.genAbort = ac;
  state.cache.pending = new Set(list.map((sg) => sg.id));
  updateCosts(); renderTimeline();
  const bar = $('#gen-progress');
  let done = 0;
  state.genDone = 0; state.genTotal = list.length;
  updateCosts();
  const ld = showWork({
    kind: 'draw', title: `Drawing ${list.length === 1 ? 'this scene' : `${list.length} scenes`}`, short: 'Drawing scenes', total: list.length, perItem: job.keys.claude ? 40 : 25, parallel: 2,
    background: 'Back to editor',
    actions: [{ label: 'Stop', onClick: (b) => { ac.stop = true; b.disabled = true; ld.update({ title: 'Finishing the scenes in progress' }); } }],
    tips: ['Press "Back to editor" to keep editing while this runs.', 'Each scene uses your approved characters, so they look the same every time.', 'Scenes in the same place are drawn to match each other.', 'Every picture is checked and redrawn automatically if something looks off.'],
  });
  const aspect = state.aspect === 'vertical' ? '9:16' : '16:9';
  setStatus('#scenes-status', '');
  // first shot of each location is drawn first so later shots can reuse it as a reference
  const [anchors, rest] = orderForConsistency(state.project, list);
  const drawOne = async (sg) => {
    if (ac.stop) throw new Error('stopped');
    try {
      const requestScene = JSON.stringify(sg.scene);
      sg.image = await generateSceneImage(state.project, sg, {
        ...job, aspect, note,
        onStatus: (m) => { if (sg.id === state.selected) setStatus('#redo-status', m, 'busy'); },
      });
      if (JSON.stringify(sg.scene) !== requestScene) sg.image.stale = true;
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

$('#btn-redraw-all').addEventListener('click', () => $('#btn-gen-scenes').click());
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
  $('#preview-spec').textContent = state.aspect === 'vertical' ? '9:16 · Vertical' : '16:9 · Horizontal';
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
  else { $('#btn-play').innerHTML = icon('play'); $('#btn-play').setAttribute('aria-label', 'Play'); stopAudio(); }
}

async function togglePlay() {
  const m = state.media;
  if (!m || !state.project?.approved) return;
  if (m.paused) {
    if (m.time >= state.project.duration - 0.05) await m.seek(0);
    await m.play();
    startAudio(m.time);
    $('#btn-play').innerHTML = icon('pause');
    $('#btn-play').setAttribute('aria-label', 'Pause');
    loop();
  } else {
    m.pause();
    $('#btn-play').innerHTML = icon('play');
    $('#btn-play').setAttribute('aria-label', 'Play');
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
    return `<div class="clip ${type} ${st} ${moving || ''} ${sel ? 'sel' : ''}" data-id="${s.id}" role="button" tabindex="${sel ? '0' : '-1'}" aria-pressed="${sel}" aria-label="Shot ${i + 1}, ${type === 'face' ? 'your face' : 'illustrated scene'}, ${fmtTime(s.start)} to ${fmtTime(s.end)}" style="left:${TL.pad + s.start * TL.pps}px;width:${Math.max(6, (s.end - s.start) * TL.pps - 3)}px" title="${esc(shotText(s))}">
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
    ctx.font = '500 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(state.file ? 'Reading audio…' : 'Demo: no recorded voice', w / 2 + 30, mid + 4);
    return;
  }
  ctx.fillStyle = '#84bca5';
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
const TAB_TITLES = { shot: 'Shots', sound: 'Audio', captions: 'Captions', filters: 'Filters', trans: 'Transitions', export: 'Export' };

const editorOpen = () => document.body.classList.contains('ed-full') || document.body.classList.contains('ed-app');
let sheetTrigger = null;

function sheetBackground(inert) {
  $$('.ed-top, .ed-view, .tl, #ed-tabs').forEach((el) => { el.inert = inert; });
}

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
  if (!$('#ed-sheet').classList.contains('open')) sheetTrigger = document.activeElement;
  $('#sheet-title').textContent = TAB_TITLES[name] || '';
  $('#ed-sheet').inert = false;
  $('#ed-sheet').setAttribute('role', 'dialog');
  $('#ed-sheet').setAttribute('aria-modal', 'true');
  $('#ed-sheet').setAttribute('aria-labelledby', 'sheet-title');
  $('#ed-sheet').classList.add('open');
  document.body.classList.add('sheet-open');
  $('#ed-scrim').hidden = false;
  sheetBackground(true);
  // Wait for the sheet's visible state before transferring focus.
  requestAnimationFrame(() => {
    if ($('#ed-sheet').classList.contains('open') && !document.body.classList.contains('work-open')) $('#sheet-done').focus({ preventScroll: true });
  });
}
function closeSheet() {
  const wasOpen = $('#ed-sheet').classList.contains('open');
  $('#ed-sheet').classList.remove('open');
  $('#ed-sheet').removeAttribute('role');
  $('#ed-sheet').removeAttribute('aria-modal');
  $('#ed-sheet').removeAttribute('aria-labelledby');
  $('#ed-sheet').inert = document.body.classList.contains('ed-full');
  document.body.classList.remove('sheet-open');
  $('#ed-scrim').hidden = true;
  sheetBackground(false);
  if (document.body.classList.contains('ed-full')) $$('#ed-tabs button').forEach((b) => { b.classList.remove('on'); b.setAttribute('aria-selected', 'false'); b.tabIndex = 0; });
  else showTab(state.tab || 'shot', { open: false });
  if (wasOpen && sheetTrigger?.isConnected) sheetTrigger.focus({ preventScroll: true });
  sheetTrigger = null;
}
$('#sheet-done').addEventListener('click', closeSheet);
$('#ed-scrim').addEventListener('click', closeSheet);
$('#btn-test-relay').addEventListener('click', async (e) => {
  e.preventDefault();
  const out = $('#relay-result');
  out.className = 'relay-result busy'; out.textContent = 'Checking your relay and OpenAI video access…';
  const r = await checkAnimationSetup($('#openai-key').value.trim(), $('#video-relay').value, $('#video-model').value);
  out.className = `relay-result ${r.ok ? 'ok' : 'err'}`; out.textContent = r.message;
});
$('#ed-close').addEventListener('click', () => goStep(4));
$('#ed-export').addEventListener('click', () => showTab('export'));
window.addEventListener('resize', () => { if (state.step === 5) setFullEditor(true); });
document.addEventListener('keydown', (e) => {
  if (document.body.classList.contains('work-open') || $('dialog[open]')) return;
  if (document.body.classList.contains('sheet-open')) {
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(); }
    if (e.key === 'Tab') {
      const controls = [...$('#ed-sheet').querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, a[href]')].filter((el) => el.getClientRects().length && !el.closest('[hidden]'));
      const first = controls[0], last = controls.at(-1);
      if (!$('#ed-sheet').contains(document.activeElement) || (e.shiftKey && document.activeElement === first)) { e.preventDefault(); (e.shiftKey ? last : first)?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
    return;
  }
  if (!editorOpen() || e.target.closest('input, textarea, select, [contenteditable]')) return;
  const mod = e.ctrlKey || e.metaKey;
  const control = e.target.closest('button, a, summary, [role="button"]');
  if (e.code === 'Space' && !control) { e.preventDefault(); togglePlay(); }
  else if (mod && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
  else if (mod && e.code === 'KeyY') { e.preventDefault(); redo(); }
  else if (!mod && !e.altKey && e.code === 'KeyS') { e.preventDefault(); splitAtPlayhead(); }
  else if (e.key === 'ArrowRight' && !control) { e.preventDefault(); nextCut(1); }
  else if (e.key === 'ArrowLeft' && !control) { e.preventDefault(); nextCut(-1); }
});

function showTab(name, { open = true } = {}) {
  state.tab = name;
  $('#sheet-title').textContent = TAB_TITLES[name] || '';
  if (open) openSheet(name);
  $('#ed-tabs').setAttribute('aria-orientation', 'horizontal');
  $$('#ed-tabs button').forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on || isPhone() ? 0 : -1;
  });
  $$('.ed-panel').forEach((p) => { p.hidden = p.dataset.pane !== name; });
  if (name === 'sound') renderSoundPane();
  if (name === 'captions') renderTextPane();
  if (name === 'filters') renderFilterPane();
  if (name === 'trans') renderTransPane();
  requestAnimationFrame(updateSegThumbs);
}
$('#ed-tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });
$('#ed-tabs').addEventListener('keydown', (e) => {
  const tabs = $$('#ed-tabs button').filter((b) => b.getClientRects().length);
  const i = tabs.indexOf(e.target.closest('button'));
  if (i < 0) return;
  const dir = ['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 0;
  const next = e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs.at(-1) : dir ? tabs[(i + dir + tabs.length) % tabs.length] : null;
  if (!next) return;
  e.preventDefault(); e.stopPropagation();
  showTab(next.dataset.tab, { open: !isPhone() });
  next.focus();
});
$('#timeline').addEventListener('keydown', async (e) => {
  const clip = e.target.closest('.clip');
  if (!clip) return;
  const clips = $$('#timeline .clip');
  const i = clips.indexOf(clip);
  const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
  const next = dir ? clips[Math.max(0, Math.min(clips.length - 1, i + dir))] : clip;
  if (!dir && !['Enter', ' '].includes(e.key)) return;
  e.preventDefault(); e.stopPropagation();
  await select(next.dataset.id, true);
  if (!isPhone()) $(`#timeline .clip[data-id="${CSS.escape(next.dataset.id)}"]`)?.focus({ preventScroll: true });
});

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
  if (e.target.dataset.m === 'fade' && state.project?.settings.music) { snapshot(); state.project.settings.music.fade = e.target.checked; save(); restartAudio(); }
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
  if (sel === '#vol-music' && !st.music) return;
  snapshotSetting(e.target);
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
  if (Object.entries(patch).every(([key, value]) => st.captionStyle?.[key] === value)) return;
  snapshot();
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
  $('#opt-living').checked = st.sceneMotion !== 'still';
  $('#face-x').value = st.faceX ?? 0.5;
}
$('#filter-grid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-filter]');
  if (!b) return;
  if (state.project.settings.filter === b.dataset.filter) return;
  snapshot();
  state.project.settings.filter = b.dataset.filter;
  save(); drawPreview(); renderFilterPane();
});
$('#filter-amt').addEventListener('input', (e) => { if (!state.project) return; snapshotSetting(e.target); state.project.settings.filterAmt = +e.target.value; save(); drawPreview(); });

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
  const draft = el.dataset.seg === seg?.id ? captureEditing(el) : null;
  const requestNote = el.dataset.seg === seg?.id ? el.querySelector('#redo-note')?.value : '';
  releaseImageUrls(el);
  if (!seg) { el.innerHTML = '<p class="muted">Click a shot on the timeline below to edit it.</p>'; return; }
  const type = shotType(seg, p.settings);
  const sc = seg.scene;
  const types = p.settings.faceMode === 'bubble' ? ['face', 'scene', 'scene_bubble'] : ['face', 'scene'];
  const pending = state.cache.pending?.has(seg.id);
  const selectedChanged = el.dataset.seg !== seg.id;
  el.classList.toggle('fresh', selectedChanged);
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
      ${animatedOn(p) && seg.image?.key && !seg.image.stale ? (() => {
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
  if (el.querySelector('#redo-note')) el.querySelector('#redo-note').value = requestNote || '';
  restoreEditing(el, draft);
  if (selectedChanged) el.closest('.ed-panel').scrollTop = 0;
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

function readExportUI(id) {
  const s = state.project.settings;
  if (id === 'opt-captions') s.captions = $('#opt-captions').checked;
  if (id === 'opt-upper') s.captionStyle = { ...(s.captionStyle || {}), upper: $('#opt-upper').checked };
  renderTextPane();
  if (id === 'opt-punch') s.punchIn = $('#opt-punch').checked;
  if (id === 'opt-living') s.sceneMotion = $('#opt-living').checked ? 'living' : 'still';
  syncMotionUI();
  if (id === 'opt-watermark') s.watermark = $('#opt-watermark').checked;
  if (id === 'face-x') s.faceX = +$('#face-x').value;
  save(); drawPreview();
}
['#opt-captions', '#opt-upper', '#opt-punch', '#opt-living', '#opt-watermark', '#face-x'].forEach((sel) => $(sel).addEventListener('input', (e) => {
  if (!state.project) return;
  snapshotSetting(e.target);
  readExportUI(e.target.id);
}));

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
  const undrawn = sceneSegs().filter(needsImage).length;
  if (undrawn && !confirm(`${undrawn} scene${undrawn > 1 ? 's still need' : ' still needs'} drawing or updating. Export with the current pictures or placeholders?`)) return;
  const ac = new AbortController();
  state.exporting = ac;
  btn.querySelector('span').textContent = 'Cancel export';
  const bar = $('#ex-progress');
  const secs = Math.ceil(state.project.duration);
  const ld = showWork({
    kind: 'film', title: 'Exporting your video', total: secs, perItem: 1, parallel: 1,
    actions: [{ label: 'Cancel export', onClick: () => ac.abort() }],
    countText: (d, t) => `${fmtTime(d)} of ${fmtTime(t)}`,
    note: 'Keep this tab open and visible until it finishes.',
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
    const { words, characters, segments, settings, approved, title, locations = [], sfx = [], transcriptSource = 'auto', transcriptReviewed = false, transcriptDrafts = {} } = data;
    Object.assign(state.project, { words, characters, locations, sfx, segments, settings: { ...state.project.settings, ...settings }, approved, title, transcriptSource, transcriptReviewed, transcriptDrafts });
    if (!settings?.storyMode) state.project.settings.storyMode = ['text', 'subtitles'].includes(transcriptSource) ? 'transcript' : 'auto';
    state.reviewingTranscript = false;
    $('#paste-box').classList.add('hidden');
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
$('#btn-editor-demo').addEventListener('click', openSampleEditor);
$('#btn-sample-start').addEventListener('click', () => goStep(1));
$$('a[href="#studio"]').forEach((a) => a.addEventListener('click', (e) => {
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  goStep(state.project ? state.step || 1 : 1);
}));
$$('a[href="#top"], .nav-links a:not([href="#studio"]), #menu-sheet a:not([href="#studio"])').forEach((a) => a.addEventListener('click', (e) => {
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || !document.body.classList.contains('studio-open')) return;
  leaveStudio();
}));
window.addEventListener('hashchange', syncStudioLocation);
window.addEventListener('popstate', syncStudioLocation);
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
  if (!editorOpen() || document.body.classList.contains('work-open') || document.body.classList.contains('sheet-open') || $('dialog[open]')) return;
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
let previewPlanId = null;
const paidCheckoutOpen = () => BILLING.plans.some((p) => checkoutUrl(p.id, 'monthly') || checkoutUrl(p.id, 'yearly'));

function planCard(plan, { compact = false } = {}) {
  const mine = currentPlan()?.id === plan.id;
  const price = monthlyPrice(plan, billingPeriod);
  const sub = billingPeriod === 'yearly' ? `$${yearlyTotal(plan)} billed yearly` : 'billed monthly';
  const cta = mine ? 'Your plan' : checkoutUrl(plan.id, billingPeriod) ? `Get ${plan.name}` : `View ${plan.name} plan`;
  if (compact) {
    return `<button class="pay-plan${plan.popular ? ' popular' : ''}${previewPlanId === plan.id ? ' on' : ''}" data-plan="${plan.id}" aria-pressed="${previewPlanId === plan.id}" ${mine ? 'disabled' : ''}>
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
    g.querySelectorAll('button').forEach((b) => {
      const on = b.dataset.period === billingPeriod;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    movePeriodThumb(g);
  });
  const mine = currentPlan();
  const nav = $('#nav-plan');
  nav.innerHTML = '<span>Open studio</span>';
  nav.title = mine ? `${mine.plan.name} plan` : '';
  nav.classList.add('primary');
  nav.classList.remove('glass');
  const portal = BILLING.portalUrl;
  $$('#manage-sub, .manage-link').forEach((a) => { a.hidden = !(mine && portal); if (portal) a.href = portal; });
  const selected = planById(previewPlanId);
  $('#pay-selection').textContent = selected ? `${selected.name}: $${monthlyPrice(selected, billingPeriod)}/month${billingPeriod === 'yearly' ? `, $${yearlyTotal(selected)} billed yearly` : ', billed monthly'}. Preview pricing only. Checkout isn't open and no payment will be taken.` : 'Preview the plans below. No payment will be taken.';
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
    previewPlanId = planId;
    openPaywall();
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
  $('#pay-description').textContent = `We're preparing subscriptions with AI creation included. Checkout isn't open yet. ${state.project ? 'Your video and settings are saved in this browser.' : 'Try the free sample editor to explore what you can make.'}`;
  const d = $('#paywall');
  if (!d.open) d.showModal();
  requestAnimationFrame(() => movePeriodThumb($('#pay-period')));
}
$('#pay-close').addEventListener('click', () => $('#paywall').close());
$('#paywall').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
$('#pay-demo').addEventListener('click', () => { $('#paywall').close(); openSampleEditor(); });
$('#btn-advanced-preview').addEventListener('click', () => { $('#paywall').close(); openSettings(); });

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

// style strip under the hero
function renderMarquee() {
  const items = Object.values(STYLES).filter((s) => s.thumb);
  if (!items.length) return;
  const row = items.map((s) => `<figure class="mq-item"><img src="${esc(s.thumb)}" alt="" loading="lazy" decoding="async"><figcaption>${esc(s.label)}</figcaption></figure>`).join('');
  $('#marquee-row').innerHTML = row;
  $('#marquee-row').style.setProperty('--mq-count', items.length);
}

// The showreel pauses completely off screen and in background tabs.
initExperience();

// staggered reveal for grids
$$('.stagger').forEach((g) => [...g.children].forEach((c, i) => c.style.setProperty('--i', i)));
$('#year').textContent = new Date().getFullYear();

{
  const msg = handleReturn();
  if (msg) setTimeout(() => toast(msg, 5000), 400);
}
renderPlans();
document.fonts?.ready.then(() => $$('.period').forEach(movePeriodThumb));

if (location.hash === '#studio') enterStudio({ navigate: false });
goStep(1, { scroll: false });
renderProjects();
checkStorage();
renderStyles();
loadStyleManifest().then(() => { renderStyles(); renderMarquee(); });
loadSfxManifest();
requestAnimationFrame(updateSegThumbs);
updateKeysDot();
sizePreview();
renderStepper();

// test hook
window.__storycuts = { state, loadDemo };
