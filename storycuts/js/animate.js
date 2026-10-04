// Animated scenes: bring an approved scene illustration to life with OpenAI's
// Sora video model (image-to-video), so characters and style stay exactly as
// drawn. The still image is always kept as a fallback.

import { getBlob, putBlob } from './images.js';

// Prices are per second of generated video; check platform.openai.com/docs/pricing.
export const VIDEO_MODELS = [
  { id: 'sora-2', label: 'Sora 2 (recommended)', perSec: 0.1 },
  { id: 'sora-2-pro', label: 'Sora 2 Pro (sharper, slower, 3x price)', perSec: 0.3 },
];
export const videoModelInfo = (id) => VIDEO_MODELS.find((m) => m.id === id) || VIDEO_MODELS[0];

/** Clip length to generate for a shot (Sora makes 4, 8 or 12 second clips). */
export const clipSeconds = (shotLen) => (shotLen > 5.5 ? 8 : 4);

export function estimateAnimCost(segs, modelId) {
  const m = videoModelInfo(modelId);
  return segs.reduce((sum, sg) => sum + clipSeconds(sg.end - sg.start) * m.perSec, 0);
}

/** Is this shot's animation usable (made from the current picture)? */
export const animReady = (seg) => !!(seg.anim?.key && seg.anim.from === seg.image?.key);

const SIZES = { '9:16': [720, 1280], '16:9': [1280, 720] };

/** Sora wants the first frame at exactly the output size. */
async function firstFrame(blob, [W, H]) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const s = Math.max(W / bmp.width, H / bmp.height);
  g.drawImage(bmp, (W - bmp.width * s) / 2, (H - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
  bmp.close?.();
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
}

function motionPrompt(project, seg) {
  const sc = seg.scene || {};
  const names = (sc.actors || []).map((a) => project.characters.find((c) => c.id === a.character_id)?.name).filter(Boolean);
  return [
    'Animate this exact illustration as one short, continuous cartoon shot. The image is the first frame: keep the same art style, line work, colours, characters, outfits, background and framing throughout.',
    `What happens: ${sc.image_prompt || 'the characters react to the moment'}`,
    sc.moment ? `Context: ${sc.moment}` : '',
    `Motion: ${names.length ? `${names.join(' and ')} move` : 'the characters move'} naturally and expressively to act out this moment: gestures, facial expressions, small body movements, things in the scene reacting (steam, flames, a phone buzzing). A gentle, slow camera push-in at most.`,
    'Do not add new people, cut to another shot, change anyone\'s design, or show any text, captions or speech bubbles. No talking mouths needed; the creator\'s voice is added later.',
  ].filter(Boolean).join('\n');
}

const STEP_NAMES = { start: 'starting the animation', poll: 'checking on the animation', download: 'downloading the finished clip' };

/** Network failures (no response at all) get retried, then explained by step. */
/** Optional relay (see server/video-relay.js) for browsers OpenAI's video API won't talk to. */
let relayBase = '';
export function setVideoRelay(url) { relayBase = normalizeRelay(url); }
const normalizeRelay = (url) => {
  let u = (url || '').trim();
  if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u.replace(/\/+$/, '').replace(/\/v1(\/videos)?$/i, '');
};

/** Check a relay address: is it the StoryCuts relay, and is it up to date? */
export async function testRelay(url) {
  const base = normalizeRelay(url);
  if (!base) return { ok: false, message: 'Paste your relay address first.' };
  try {
    const r = await fetch(`${base}/health`);
    const body = await r.json().catch(() => null);
    if (body?.relay === 'storycuts') return { ok: body.version >= 3, message: body.version >= 3 ? 'Relay connected. Animation will go through it.' : 'Relay connected, but it\'s an older version. Re-paste the latest relay code in Cloudflare and deploy again.' };
    return { ok: false, message: `That address answered, but it isn't the StoryCuts relay (HTTP ${r.status}). In Cloudflare, open the worker → Edit code, replace everything with the relay code, and press Deploy.` };
  } catch (e) {
    return { ok: false, message: `Couldn't reach that address (${e.message}). Check it's the worker address ending in .workers.dev.` };
  }
}

async function api(apiKey, path, init = {}, step = 'start') {
  let res;
  for (let attempt = 0; attempt <= 5; attempt++) {
    try {
      res = await fetch(`${relayBase || 'https://api.openai.com'}/v1${path}`, { ...init, headers: { authorization: `Bearer ${apiKey}`, ...(init.headers || {}) } });
    } catch (e) {
      if (attempt < 3) { await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt)); continue; }
      const err = new Error(`Couldn't reach OpenAI while ${STEP_NAMES[step]} (${e?.message || 'network error'}). `
        + (step === 'start'
          ? 'Your browser was not allowed to talk to OpenAI\'s video service directly. Check that no ad blocker is blocking api.openai.com; if it keeps happening, set up the free video relay (API keys → More options → Video relay address).'
          : 'Your connection may have dropped. Try again in a minute.'));
      err.step = step;
      err.network = true;
      throw err;
    }
    if (res.status !== 429 && res.status < 500) break;
    const body = await res.clone().json().catch(() => ({}));
    if (body?.error?.code === 'insufficient_quota' || attempt === 5) break;
    const wait = Number(res.headers.get('retry-after')) || Math.min(60, 5 * 2 ** attempt);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  return res;
}

/** Where an answer came from, plus the raw reply, for error messages. */
const replyInfo = (res, text) => {
  const via = res.headers.get('x-storycuts-relay') ? `via relay v${res.headers.get('x-storycuts-relay')}` : relayBase ? 'from the relay address' : 'direct';
  return `HTTP ${res.status} · ${via}${text ? ` · "${text.replace(/\s+/g, ' ').slice(0, 140).trim()}"` : ' · empty reply'}`;
};

async function apiError(res) {
  const text = await res.text().catch(() => '');
  let json = {};
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  const detail = ` [${replyInfo(res, text)}]`;
  const msg = json?.error?.message || `HTTP ${res.status}`;
  // an answer that isn't OpenAI's JSON came from the relay address, not OpenAI
  if (!json?.error && relayBase && !res.headers.get('x-storycuts-relay')) {
    return new Error(`The video relay address answered instead of passing the request to OpenAI. Open API keys → More options → Check animation setup, and make sure the worker has the latest relay code.${detail}`);
  }
  if (/^StoryCuts relay:/.test(msg)) return new Error(msg + detail);
  if (res.status === 401) return new Error(`Your OpenAI API key was rejected. Check it in Settings.${detail}`);
  if (/verif/i.test(msg)) return new Error(`OpenAI says: ${msg} (video models may require verifying your organization at platform.openai.com → Settings → Organization → Verify).${detail}`);
  if (/billing|quota|insufficient/i.test(msg)) return new Error(`OpenAI says: ${msg} (add credit at platform.openai.com → Billing).${detail}`);
  if (/moderation|safety|policy|face/i.test(msg)) return new Error(`OpenAI's safety filter declined to animate this picture. The still picture is used instead.${detail}`);
  if (res.status === 404 || /model/i.test(msg) && /access|exist|found/i.test(msg)) return new Error(`OpenAI says: ${msg} (your account may not have Sora video access yet).${detail}`);
  return new Error(`Video model error: ${msg}${detail}`);
}

/**
 * Animate one scene. Resolves to { key, dur, model, from } stored on the
 * segment as `seg.anim`. Takes one to a few minutes.
 */
export async function animateScene(apiKey, project, seg, { model = 'sora-2', aspect = '9:16', projectKey, onStatus = () => {}, signal } = {}) {
  if (!seg.image?.key) throw new Error('Draw the picture for this scene first.');
  const still = await getBlob(seg.image.key);
  if (!still) throw new Error('The picture for this scene is missing. Redraw it first.');
  const size = SIZES[aspect] || SIZES['9:16'];
  const seconds = clipSeconds(seg.end - seg.start);
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', motionPrompt(project, seg));
  form.append('size', `${size[0]}x${size[1]}`);
  form.append('seconds', String(seconds));
  form.append('input_reference', await firstFrame(still, size), 'first-frame.jpg');
  onStatus('Starting animation…');
  const created = await api(apiKey, '/videos', { method: 'POST', body: form }, 'start');
  if (!created.ok) throw await apiError(created);
  let job = await created.json();
  const t0 = Date.now();
  while (job.status !== 'completed') {
    if (signal?.stop) throw new Error('stopped');
    if (job.status === 'failed' || job.status === 'cancelled') throw new Error(`Animation failed: ${job.error?.message || 'the video model could not animate this scene'}`);
    if (Date.now() - t0 > 15 * 60 * 1000) throw new Error('Animation took too long. Try again later.');
    onStatus(`Animating… ${Math.round(job.progress || 0)}%`);
    await new Promise((r) => setTimeout(r, 5000));
    const r = await api(apiKey, `/videos/${job.id}`, {}, 'poll');
    if (!r.ok) throw await apiError(r);
    job = await r.json();
  }
  onStatus('Downloading animation…');
  const vid = await api(apiKey, `/videos/${job.id}/content`, {}, 'download');
  if (!vid.ok) throw await apiError(vid);
  const blob = await vid.blob();
  const key = `${projectKey}/anim/${seg.id}-${Date.now().toString(36)}`;
  await putBlob(key, blob.type ? blob : new Blob([blob], { type: 'video/mp4' }));
  return { key, dur: seconds, model, from: seg.image.key };
}

// ---------- playback ----------

const players = new Map();

/** A muted <video> for an animation, created on first use. Null until it can draw. */
export function animVideo(key, onReady) {
  let p = players.get(key);
  if (!p) {
    p = { v: null, ready: false };
    players.set(key, p);
    getBlob(key).then((blob) => {
      if (!blob) return;
      const v = document.createElement('video');
      Object.assign(v, { muted: true, playsInline: true, preload: 'auto', loop: false });
      v.src = URL.createObjectURL(blob);
      v.addEventListener('loadeddata', () => { p.ready = true; onReady?.(); }, { once: true });
      p.v = v;
    });
  }
  return p.ready ? p.v : null;
}

export function preloadAnim(key) {
  return new Promise((resolve) => {
    if (animVideo(key, resolve)) resolve();
    setTimeout(resolve, 5000);
  });
}

/** Keep an animation in step with the timeline: play along when live, seek when scrubbing. */
export function syncAnim(v, local, live) {
  const t = Math.max(0, Math.min(local, (v.duration || 4) - 0.04));
  if (live) {
    if (local < v.duration - 0.05 && v.paused) v.play().catch(() => {});
    if (Math.abs(v.currentTime - t) > 0.25) v.currentTime = t;
  } else {
    if (!v.paused) v.pause();
    if (Math.abs(v.currentTime - t) > 0.03) v.currentTime = t;
  }
}

/** Pause every animation not drawn in the current frame. */
export function pauseAnimsExcept(used) {
  for (const [key, p] of players) if (p.v && !used.has(key) && !p.v.paused) p.v.pause();
}


/**
 * Check animation end to end without spending anything: can we reach
 * OpenAI's video service (directly or via the relay), and does this account
 * have access? Returns { ok, message }.
 */
export async function checkAnimationSetup(apiKey, relayUrl) {
  setVideoRelay(relayUrl);
  if (!apiKey) return { ok: false, message: 'Add your OpenAI key first.' };
  if (relayBase) {
    const t = await testRelay(relayBase);
    if (!t.ok) return t;
  }
  let res;
  try {
    res = await fetch(`${relayBase || 'https://api.openai.com'}/v1/videos?limit=1`, { headers: { authorization: `Bearer ${apiKey}` } });
  } catch (e) {
    return { ok: false, message: relayBase ? `Couldn't reach the relay (${e.message}).` : 'Your browser can\'t talk to OpenAI\'s video service directly. Set up the free video relay (instructions in the StoryCuts README) and paste its address above.' };
  }
  if (res.ok) return { ok: true, message: `Animation is ready: your OpenAI account can use the video service${relayBase ? ' through your relay' : ''}.` };
  const err = await apiError(res);
  return { ok: false, message: err.message };
}
