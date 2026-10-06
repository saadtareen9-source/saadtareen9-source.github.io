// Compositor: turns (video, plan, time) into a frame. The same function drives
// the live preview and the export, so what you review is what you get.

import { drawSoundEffect } from './draw.js';
import { faceAt } from './facetrack.js';
import { captionPages, drawCaptions, resolveCaptionStyle, loadCaptionFonts, CAPTION_STYLES } from './captions.js';
import { bitmapFor, preloadBitmap, canAnimate } from './images.js';
import { animReady, animVideo, syncAnim, pauseAnimsExcept, preloadAnim } from './animate.js';

export const ASPECTS = {
  vertical: { w: 1080, h: 1920, label: '9:16 (TikTok, Reels, Shorts)' },
  horizontal: { w: 1920, h: 1080, label: '16:9 (YouTube)' },
};

export function segmentAt(segments, t) {
  let lo = 0, hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid].start <= t) lo = mid; else hi = mid - 1;
  }
  return segments[lo];
}

function drawVideoCover(ctx, video, x, y, w, h, focusX = 0.5, focusY = 0.4, zoom = 1) {
  const vw = video.videoWidth || video.width, vh = video.videoHeight || video.height;
  if (!vw || !vh) { ctx.fillStyle = '#222'; ctx.fillRect(x, y, w, h); return; }
  const scale = Math.max(w / vw, h / vh) * zoom;
  const sw = w / scale, sh = h / scale;
  const sx = Math.min(vw - sw, Math.max(0, focusX * vw - sw / 2));
  const sy = Math.min(vh - sh, Math.max(0, focusY * vh - sh / 2));
  ctx.drawImage(video, sx, sy, sw, sh, x, y, w, h);
}

// A phone (portrait) video in a horizontal frame: show the whole person in the
// middle over a soft, blurred copy, instead of cropping to a thin strip.
let blurCanvas = null;
// Crop the camera to a frame, keeping a tracked face well placed: centred
// across, with the eyes a little above the middle (how editors frame a talker).
function drawFramed(ctx, video, x, y, w, h, face, focusX, focusY, zoom) {
  const vw = video.videoWidth || video.width, vh = video.videoHeight || video.height;
  if (!face || !vw || !vh) { drawVideoCover(ctx, video, x, y, w, h, focusX, focusY, zoom); return; }
  const scale = Math.max(w / vw, h / vh) * zoom;
  const sw = w / scale, sh = h / scale;
  const sx = Math.min(vw - sw, Math.max(0, face.x * vw - sw / 2));
  const sy = Math.min(vh - sh, Math.max(0, face.y * vh - sh * 0.4));
  ctx.drawImage(video, sx, sy, sw, sh, x, y, w, h);
}

// The face bubble: a square crop around the face, sized so the face fills it nicely.
function drawFaceCrop(ctx, video, x, y, size, face, focusX, focusY) {
  const vw = video.videoWidth || video.width, vh = video.videoHeight || video.height;
  if (!face || !vw || !vh) { drawVideoCover(ctx, video, x, y, size, size, focusX, focusY, 1.35); return; }
  const side = Math.min(vw, vh, Math.max(face.s * vh * 2.1, Math.min(vw, vh) * 0.3));
  const sx = Math.min(vw - side, Math.max(0, face.x * vw - side / 2));
  const sy = Math.min(vh - side, Math.max(0, face.y * vh - side * 0.45));
  ctx.drawImage(video, sx, sy, side, side, x, y, size, size);
}

function drawCameraShot(ctx, video, W, H, focusX, focusY, zoom, face) {
  const vw = video.videoWidth || video.width, vh = video.videoHeight || video.height;
  if (!vw || !vh || W <= H || vw / vh > 0.9) { drawFramed(ctx, video, 0, 0, W, H, face, focusX, focusY, zoom); return; }
  blurCanvas ||= Object.assign(document.createElement('canvas'), { width: 48, height: 27 });
  const b = blurCanvas.getContext('2d');
  drawVideoCover(b, video, 0, 0, 48, 27, 0.5, 0.5, 1);
  ctx.save();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(blurCanvas, -W * 0.05, -H * 0.05, W * 1.1, H * 1.1);
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H);
  ctx.restore();
  const h = H, w = Math.min(W, h * (vw / vh) * zoom);
  drawFramed(ctx, video, (W - w) / 2, 0, w, h, face, focusX, focusY, zoom);
}

// ---------- captions (see captions.js) ----------

export { captionPages, CAPTION_STYLES };

// ---------- looks: filters and transitions ----------

export const FILTERS = [
  { id: 'none', name: 'Original', css: () => 'none' },
  { id: 'vivid', name: 'Vivid', css: (a) => `saturate(${1 + 0.4 * a}) contrast(${1 + 0.1 * a})` },
  { id: 'warm', name: 'Warm', css: (a) => `sepia(${0.28 * a}) saturate(${1 + 0.2 * a}) brightness(${1 + 0.03 * a})` },
  { id: 'cool', name: 'Cool', css: (a) => `hue-rotate(${-12 * a}deg) saturate(${1 + 0.05 * a}) brightness(${1 + 0.03 * a})` },
  { id: 'film', name: 'Film', css: (a) => `sepia(${0.18 * a}) contrast(${1 - 0.08 * a}) brightness(${1 + 0.05 * a}) saturate(${1 - 0.12 * a})` },
  { id: 'drama', name: 'Drama', css: (a) => `contrast(${1 + 0.3 * a}) saturate(${1 + 0.1 * a}) brightness(${1 - 0.08 * a})` },
  { id: 'soft', name: 'Soft', css: (a) => `brightness(${1 + 0.08 * a}) contrast(${1 - 0.12 * a}) saturate(${1 + 0.1 * a})` },
  { id: 'mono', name: 'Mono', css: (a) => `grayscale(${a}) contrast(${1 + 0.12 * a})` },
];
export const filterCss = (id, amt = 1) => (FILTERS.find((f) => f.id === id) || FILTERS[0]).css(Math.max(0, Math.min(1, amt)));

export const TRANSITIONS = [
  { id: 'cut', name: 'Cut', dur: 0 },
  { id: 'fade', name: 'Fade', dur: 0.4 },
  { id: 'flash', name: 'Flash', dur: 0.3 },
  { id: 'zoom', name: 'Zoom', dur: 0.4 },
  { id: 'slide', name: 'Slide', dur: 0.4 },
  { id: 'whip', name: 'Whip', dur: 0.3 },
  { id: 'blur', name: 'Blur', dur: 0.45 },
];
const transInfo = (id) => TRANSITIONS.find((x) => x.id === id) || TRANSITIONS[0];
/** The transition into segment i (from i-1). */
export const transitionInto = (segments, i, settings) => (i > 0 ? (segments[i].transIn || settings.transition || 'cut') : 'cut');

// ---------- frame ----------

/** With full-frame cuts (the default) a "scene + face" shot is shown as a plain scene. */
export function shotType(seg, settings) {
  return seg.type === 'scene_bubble' && settings.faceMode !== 'bubble' ? 'scene' : seg.type;
}

function wrap(ctx, text, maxW) {
  const out = [];
  let line = '';
  for (const w of text.split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}

/** A clean card for scenes that haven't been drawn yet. */
function drawPlaceholder(ctx, W, H, seg, local, pending) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#1d1533'); g.addColorStop(0.55, '#2a1530'); g.addColorStop(1, '#2d1f12');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const u = Math.min(W, H) / 1000;
  ctx.save();
  ctx.globalAlpha = 0.5;
  for (const [x, y, r, c] of [[0.2, 0.25, 0.5, '#8b5cf6'], [0.85, 0.7, 0.45, '#ec4899'], [0.4, 0.95, 0.35, '#f59e0b']]) {
    const rg = ctx.createRadialGradient(x * W, y * H, 0, x * W, y * H, r * Math.max(W, H));
    rg.addColorStop(0, c); rg.addColorStop(1, 'transparent');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const pulse = pending ? 0.6 + 0.4 * Math.sin(local * 5) : 1;
  ctx.fillStyle = `rgba(255,255,255,${0.9 * pulse})`;
  ctx.font = `700 ${46 * u}px Sora, Inter, system-ui, sans-serif`;
  ctx.fillText(pending ? 'Drawing this scene…' : 'Scene not drawn yet', W / 2, H * 0.4);
  const desc = seg.scene?.image_prompt || '';
  if (desc) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = `400 ${32 * u}px Inter, system-ui, sans-serif`;
    wrap(ctx, desc, W * 0.78).slice(0, 5).forEach((l, i) => ctx.fillText(l, W / 2, H * 0.4 + 80 * u + i * 44 * u));
  }
  ctx.restore();
}

/** AI illustration with a slow push-in and drift, plus a little pop on the cut. */
function drawKenBurns(ctx, img, W, H, local, dur, idx) {
  const prog = Math.min(1, local / Math.max(0.5, dur));
  const ease = prog * prog * (3 - 2 * prog);
  const pop = local < 0.18 ? 1.035 - (local / 0.18) * 0.035 : 1;
  const zoom = (1.02 + ease * 0.08) * pop;
  const scale = Math.max(W / img.width, H / img.height) * zoom;
  const dw = img.width * scale, dh = img.height * scale;
  const dir = idx % 2 ? 1 : -1;
  const maxX = (dw - W) / 2, maxY = (dh - H) / 2;
  const x = (W - dw) / 2 + dir * maxX * (ease - 0.5) * 0.8;
  const y = (H - dh) / 2 + maxY * (0.5 - ease) * 0.5;
  ctx.drawImage(img, x, y, dw, dh);
}

// ---------- living pictures ----------
// Free motion for still scenes: a camera move picked per shot, a little
// handheld drift and light effects that match what's in the picture. Every
// value is a pure function of time and the shot, so preview and export match.

const rand = (seed) => { const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

const MOVES = ['push', 'pull', 'panL', 'panR', 'rise', 'push'];

const AMBIENT = [
  ['steam', /\b(steam|steaming|smok\w*|burn\w*|cook\w*|coffee|tea|soup|pan|stove|kettle|sizzl\w*|hot)\b/i],
  ['fire', /\b(fire|flames?|candles?|fireplace|campfire|bonfire|torch)\b/i],
  ['rain', /\b(rain\w*|storm\w*|drizzl\w*|downpour)\b/i],
  ['snow', /\b(snow\w*|blizzard|winter)\b/i],
  ['sparkle', /\b(sparkl\w*|glitter\w*|magic\w*|shin\w+|twinkl\w*|celebrat\w*|party|confetti)\b/i],
  ['screen', /\b(phone|screen|texting|texts?|laptop|tv|television|monitor|computer|scrolling)\b/i],
  ['hearts', /\b(love|crush|heart\w*|kiss\w*|romantic|date)\b/i],
  ['sleep', /\b(sleep\w*|asleep|nap\w*|snor\w*|bed ?time)\b/i],
  ['shake', /\b(bang|crash\w*|boom|slam\w*|explo\w*|smash\w*|thud|fell|falls?|trip\w*|punch\w*|scream\w*)\b/i],
];
const EFFECT_MAP = { smoke: 'steam', fire: 'fire', rain: 'rain', sparkles: 'sparkle', stars: 'sparkle', hearts: 'hearts', zzz: 'sleep', exclamation: 'shake', anger: 'shake', motion_lines: 'shake' };

const ambientMemo = new WeakMap();
function ambientFor(scene) {
  if (!scene) return [];
  if (ambientMemo.has(scene)) return ambientMemo.get(scene);
  const text = [scene.image_prompt, scene.moment, scene.sound_effect, (scene.props || []).join(' ')].filter(Boolean).join(' ');
  const set = new Set((scene.effects || []).map((e) => EFFECT_MAP[e]).filter(Boolean));
  AMBIENT.forEach(([k, re]) => { if (re.test(text)) set.add(k); });
  if (set.has('fire')) set.delete('steam');
  // keep it tasteful: at most three effects, always some floating dust
  const list = [...set].slice(0, 3);
  if (!list.some((k) => ['rain', 'snow', 'steam'].includes(k))) list.push('dust');
  ambientMemo.set(scene, list);
  return list;
}

function cameraFor(img, W, H, local, dur, idx, fx) {
  const prog = Math.min(1, local / Math.max(0.5, dur));
  const ease = prog * prog * (3 - 2 * prog);
  const move = MOVES[Math.floor(rand(idx + 1) * MOVES.length)];
  let zoom = 1.08, px = 0, py = 0;
  if (move === 'push') zoom = 1.05 + ease * 0.13;
  if (move === 'pull') zoom = 1.18 - ease * 0.12;
  if (move === 'panL') { zoom = 1.14; px = 0.8 - ease * 1.6; }
  if (move === 'panR') { zoom = 1.14; px = -0.8 + ease * 1.6; }
  if (move === 'rise') { zoom = 1.12; py = 0.7 - ease * 1.4; }
  // impact: a short punch-in and shake at the start of the shot
  let sx = 0, sy = 0;
  if (fx.includes('shake') && local < 0.5) {
    const k = (1 - local / 0.5) ** 2;
    zoom *= 1 + 0.05 * k;
    sx = Math.sin(local * 90) * 14 * k; sy = Math.cos(local * 77) * 10 * k;
  }
  const pop = local < 0.18 ? 1.03 - (local / 0.18) * 0.03 : 1;
  zoom *= pop;
  const scale = Math.max(W / img.width, H / img.height) * zoom;
  const dw = img.width * scale, dh = img.height * scale;
  const maxX = (dw - W) / 2, maxY = (dh - H) / 2;
  // slow handheld drift
  const u = Math.min(W, H) / 1000;
  const hx = (Math.sin(local * 0.9 + idx) * 5 + Math.sin(local * 2.3 + idx * 2) * 2) * u;
  const hy = (Math.cos(local * 0.7 + idx * 3) * 4 + Math.sin(local * 1.9 + idx) * 1.5) * u;
  const x = (W - dw) / 2 + Math.max(-maxX, Math.min(maxX, px * maxX * 0.8 + hx)) + sx * u;
  const y = (H - dh) / 2 + Math.max(-maxY, Math.min(maxY, py * maxY * 0.8 + hy)) + sy * u;
  return { x, y, dw, dh };
}

function drawAmbience(ctx, W, H, local, idx, fx) {
  const u = Math.min(W, H) / 1000;
  ctx.save();
  for (const k of fx) {
    if (k === 'dust') {
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 18; i++) {
        const r = (s) => rand(idx * 97 + i * 13 + s);
        const x = ((r(1) * W + Math.sin(local * 0.4 + i) * 30 * u + local * 8 * u) % W + W) % W;
        const y = ((r(2) * H - local * (6 + r(3) * 10) * u) % H + H) % H;
        ctx.globalAlpha = 0.12 + 0.18 * (0.5 + 0.5 * Math.sin(local * 1.5 + i * 2));
        ctx.beginPath(); ctx.arc(x, y, (1.5 + r(4) * 2.5) * u, 0, Math.PI * 2); ctx.fill();
      }
    } else if (k === 'steam') {
      for (let i = 0; i < 9; i++) {
        const r = (s) => rand(idx * 31 + i * 7 + s);
        const life = 3.2, t = (local + r(1) * life) % life, q = t / life;
        const x = W * (0.3 + r(2) * 0.4) + Math.sin(t * 1.7 + i) * 26 * u;
        const y = H * (0.72 - r(3) * 0.12) - q * H * 0.35;
        const rad = (40 + q * 120) * u;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, `rgba(240,240,240,${0.3 * Math.sin(q * Math.PI)})`); g.addColorStop(1, 'rgba(235,235,235,0)');
        ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
    } else if (k === 'fire') {
      const f = 0.75 + 0.15 * Math.sin(local * 13) + 0.1 * Math.sin(local * 29 + 1);
      const g = ctx.createRadialGradient(W / 2, H * 1.05, 0, W / 2, H * 1.05, Math.max(W, H) * 0.75);
      g.addColorStop(0, `rgba(255,140,40,${0.4 * f})`); g.addColorStop(1, 'rgba(255,120,30,0)');
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#ffb347';
      for (let i = 0; i < 22; i++) {
        const r = (s) => rand(idx * 53 + i * 11 + s);
        const life = 2.4, t = (local + r(1) * life) % life, q = t / life;
        ctx.globalAlpha = 0.8 * (1 - q);
        ctx.beginPath(); ctx.arc(W * r(2) + Math.sin(t * 4 + i) * 12 * u, H * (0.95 - q * 0.6), (3 + r(3) * 4) * u, 0, Math.PI * 2); ctx.fill();
      }
    } else if (k === 'rain') {
      ctx.strokeStyle = 'rgba(210,225,255,0.6)'; ctx.lineWidth = 2.5 * u; ctx.globalAlpha = 1;
      ctx.beginPath();
      for (let i = 0; i < 70; i++) {
        const r = (s) => rand(idx * 17 + i * 5 + s);
        const sp = H * (1.6 + r(1));
        const y = ((r(2) * H + local * sp) % (H + 60 * u)) - 30 * u;
        const x = (r(3) * W * 1.2 - y * 0.12) % W;
        ctx.moveTo(x, y); ctx.lineTo(x - 6 * u, y + 34 * u);
      }
      ctx.stroke();
      ctx.fillStyle = 'rgba(20,30,60,0.12)'; ctx.fillRect(0, 0, W, H);
    } else if (k === 'snow') {
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 45; i++) {
        const r = (s) => rand(idx * 23 + i * 3 + s);
        const y = (r(1) * H + local * (40 + r(2) * 50) * u) % H;
        const x = (r(3) * W + Math.sin(local + i) * 20 * u + W) % W;
        ctx.globalAlpha = 0.5 + r(4) * 0.4;
        ctx.beginPath(); ctx.arc(x, y, (2 + r(5) * 3) * u, 0, Math.PI * 2); ctx.fill();
      }
    } else if (k === 'sparkle') {
      ctx.fillStyle = '#fff7d6';
      for (let i = 0; i < 12; i++) {
        const r = (s) => rand(idx * 41 + i * 9 + s);
        const tw = Math.max(0, Math.sin(local * (2 + r(1) * 2) + r(2) * 6));
        const x = W * (0.08 + r(3) * 0.84), y = H * (0.08 + r(4) * 0.7), s = (12 + r(5) * 16) * u * tw;
        ctx.globalAlpha = 0.9 * tw;
        ctx.beginPath();
        ctx.moveTo(x, y - s); ctx.quadraticCurveTo(x, y, x + s, y); ctx.quadraticCurveTo(x, y, x, y + s);
        ctx.quadraticCurveTo(x, y, x - s, y); ctx.quadraticCurveTo(x, y, x, y - s); ctx.fill();
      }
    } else if (k === 'screen') {
      const f = 0.6 + 0.25 * Math.sin(local * 2.2) + 0.15 * Math.sin(local * 7.3);
      const g = ctx.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H * 0.55, Math.max(W, H) * 0.6);
      g.addColorStop(0, `rgba(120,170,255,${0.22 * f})`); g.addColorStop(1, 'rgba(120,170,255,0)');
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    } else if (k === 'hearts') {
      ctx.fillStyle = '#ff5c8a';
      for (let i = 0; i < 6; i++) {
        const r = (s) => rand(idx * 61 + i * 19 + s);
        const life = 3, t = (local + r(1) * life) % life, q = t / life;
        const x = W * (0.15 + r(2) * 0.7) + Math.sin(t * 2 + i) * 18 * u, y = H * (0.85 - q * 0.6), s = (10 + r(3) * 8) * u;
        ctx.globalAlpha = 0.75 * Math.sin(q * Math.PI);
        ctx.beginPath(); ctx.moveTo(x, y + s * 0.9);
        ctx.bezierCurveTo(x - s * 1.4, y - s * 0.2, x - s * 0.6, y - s * 1.2, x, y - s * 0.4);
        ctx.bezierCurveTo(x + s * 0.6, y - s * 1.2, x + s * 1.4, y - s * 0.2, x, y + s * 0.9); ctx.fill();
      }
    } else if (k === 'sleep') {
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
      for (let i = 0; i < 3; i++) {
        const life = 2.4, t = (local + i * 0.8) % life, q = t / life;
        ctx.globalAlpha = 0.85 * Math.sin(q * Math.PI);
        ctx.font = `800 ${(26 + i * 8) * u}px system-ui, sans-serif`;
        ctx.fillText('Z', W * (0.62 + q * 0.12) + Math.sin(t * 3) * 10 * u, H * (0.32 - q * 0.14));
      }
    }
  }
  ctx.restore();
}

export function drawLiving(ctx, img, W, H, local, dur, idx, scene) {
  const fx = ambientFor(scene);
  const { x, y, dw, dh } = cameraFor(img, W, H, local, dur, idx, fx);
  ctx.drawImage(img, x, y, dw, dh);
  drawAmbience(ctx, W, H, local, idx, fx);
}

/** Draw one shot (no captions) at time t. */
function drawShot(ctx, W, H, t, project, seg, video, cache) {
  const { segments, settings } = project;
  const type = shotType(seg, settings);
  const idx = segments.indexOf(seg);
  const local = t - seg.start;
  const dur = seg.end - seg.start;
  const fx = settings.faceX ?? 0.5, fy = settings.faceY ?? 0.4;
  const face = settings.autoFrame !== false ? faceAt(project.faceTrack, t) : null;

  if (type === 'face' || !seg.scene) {
    // alternate punch-in on consecutive face shots, like a jump-cut zoom
    const faceShots = segments.slice(0, idx).filter((s) => s.type === 'face').length;
    const zoom = settings.punchIn && faceShots % 2 === 1 ? 1.15 : 1;
    drawCameraShot(ctx, video, W, H, fx, fy, zoom, face);
  } else {
    const sfxSide = type === 'scene_bubble' && settings.bubbleSide !== 'left' ? 'left' : 'right';
    const bmp = seg.image?.key ? bitmapFor(seg.image.key, cache.onImage) : null;
    const anim = settings.sceneMotion === 'animated' && canAnimate(settings) && !seg.still && animReady(seg) ? animVideo(seg.anim.key, cache.onImage) : null;
    if (anim) {
      (cache.usedAnims ||= new Set()).add(seg.anim.key);
      syncAnim(anim, local, !!cache.live);
      drawVideoCover(ctx, anim, 0, 0, W, H, 0.5, 0.5, 1);
      drawSoundEffect(ctx, seg.scene.sound_effect, W, H, local, Math.min(W, H) / 1000, sfxSide);
    } else if (bmp) {
      if (settings.sceneMotion === 'still') drawKenBurns(ctx, bmp, W, H, local, dur, idx);
      else drawLiving(ctx, bmp, W, H, local, dur, idx, seg.scene);
      drawSoundEffect(ctx, seg.scene.sound_effect, W, H, local, Math.min(W, H) / 1000, sfxSide);
    } else {
      drawPlaceholder(ctx, W, H, seg, local, cache.pending?.has(seg.id));
    }
    if (type === 'scene_bubble') {
      const R = Math.min(W, H) * (H > W ? 0.24 : 0.2);
      const pad = Math.min(W, H) * 0.045;
      const cx = settings.bubbleSide === 'left' ? pad + R : W - pad - R;
      const cy = (H > W ? H * 0.08 : pad) + R;
      const pop = Math.min(1, local / 0.15);
      ctx.save();
      ctx.translate(cx, cy); ctx.scale(pop, pop); ctx.translate(-cx, -cy);
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.closePath();
      ctx.save(); ctx.clip();
      drawFaceCrop(ctx, video, cx - R, cy - R, R * 2, face, fx, fy);
      ctx.restore();
      ctx.lineWidth = R * 0.07; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.lineWidth = R * 0.02; ctx.strokeStyle = '#141414';
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.035, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }
}

function offscreen(cache, W, H) {
  let c = cache.off;
  if (!c || c.width !== W || c.height !== H) {
    c = cache.off = document.createElement('canvas');
    c.width = W; c.height = H;
  }
  return c;
}

const smooth = (x) => { const v = Math.max(0, Math.min(1, x)); return v * v * (3 - 2 * v); };

/** Draw the picture at t, blending across a cut when a transition is set. */
function drawPicture(ctx, W, H, t, project, video, cache) {
  const { segments, settings } = project;
  const seg = segmentAt(segments, t);
  const i = segments.indexOf(seg);
  // are we inside the transition window of the cut before or after this shot?
  let cut = -1;
  const tIn = transInfo(transitionInto(segments, i, settings));
  if (tIn.dur && t - seg.start < tIn.dur / 2) cut = i;
  const next = segments[i + 1];
  if (cut < 0 && next) {
    const tOut = transInfo(transitionInto(segments, i + 1, settings));
    if (tOut.dur && seg.end - t < tOut.dur / 2) cut = i + 1;
  }
  if (cut < 0) { drawShot(ctx, W, H, t, project, seg, video, cache); return seg; }

  const A = segments[cut - 1], B = segments[cut];
  const tr = transInfo(transitionInto(segments, cut, settings));
  const p = smooth((t - (B.start - tr.dur / 2)) / tr.dur);
  const off = offscreen(cache, W, H);
  const o = off.getContext('2d');
  if (tr.id === 'flash') {
    drawShot(ctx, W, H, t, project, t < B.start ? A : B, video, cache);
    ctx.save(); ctx.globalAlpha = 1 - Math.abs(p - 0.5) * 2; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.restore();
    return seg;
  }
  drawShot(o, W, H, t, project, B, video, cache);
  if (tr.id === 'fade') {
    drawShot(ctx, W, H, t, project, A, video, cache);
    ctx.save(); ctx.globalAlpha = p; ctx.drawImage(off, 0, 0); ctx.restore();
  } else if (tr.id === 'zoom') {
    ctx.save();
    const sA = 1 + 0.35 * p;
    ctx.translate(W / 2, H / 2); ctx.scale(sA, sA); ctx.translate(-W / 2, -H / 2);
    drawShot(ctx, W, H, t, project, A, video, cache);
    ctx.restore();
    ctx.save();
    const sB = 1.35 - 0.35 * p;
    ctx.globalAlpha = p;
    ctx.translate(W / 2, H / 2); ctx.scale(sB, sB); ctx.translate(-W / 2, -H / 2);
    ctx.drawImage(off, 0, 0);
    ctx.restore();
  } else if (tr.id === 'slide' || tr.id === 'whip') {
    const dx = W * p;
    ctx.save();
    if (tr.id === 'whip' && 'filter' in ctx) ctx.filter = `blur(${Math.round(Math.sin(p * Math.PI) * W * 0.012)}px)`;
    ctx.translate(-dx, 0);
    drawShot(ctx, W, H, t, project, A, video, cache);
    ctx.translate(W, 0);
    ctx.drawImage(off, 0, 0);
    ctx.restore();
  } else if (tr.id === 'blur') {
    const b = Math.sin(p * Math.PI) * Math.min(W, H) * 0.025;
    ctx.save();
    if ('filter' in ctx) ctx.filter = `blur(${b.toFixed(1)}px)`;
    drawShot(ctx, W, H, t, project, A, video, cache);
    ctx.globalAlpha = p;
    ctx.drawImage(off, 0, 0);
    ctx.restore();
  }
  return seg;
}

export function drawFrame(ctx, W, H, t, project, video, cache = {}) {
  const { settings } = project;
  (cache.usedAnims ||= new Set()).clear();
  const look = settings.filter && settings.filter !== 'none' ? filterCss(settings.filter, settings.filterAmt ?? 1) : '';
  let seg;
  if (look && 'filter' in ctx) {
    // render the picture, then copy it through the colour filter
    const pic = cache.pic && cache.pic.width === W && cache.pic.height === H ? cache.pic : (cache.pic = Object.assign(document.createElement('canvas'), { width: W, height: H }));
    seg = drawPicture(pic.getContext('2d'), W, H, t, project, video, cache);
    ctx.save(); ctx.filter = look; ctx.drawImage(pic, 0, 0); ctx.restore();
  } else {
    seg = drawPicture(ctx, W, H, t, project, video, cache);
  }
  if (settings.captions) {
    const cs = resolveCaptionStyle(settings.captionStyle);
    if (!cache.pages || cache.pagesFor !== project.words || cache.pagesN !== cs.words) {
      cache.pages = captionPages(project.words, cs.words); cache.pagesFor = project.words; cache.pagesN = cs.words;
    }
    cache.capBox = drawCaptions(ctx, W, H, cache.pages, t, cs);
  } else cache.capBox = null;
  if (settings.watermark) {
    ctx.save();
    const fs = Math.min(W, H) * 0.028;
    ctx.font = `700 ${fs}px system-ui, sans-serif`; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = fs * 0.15;
    ctx.strokeText('made with StoryCuts', W - fs, H - fs); ctx.fillText('made with StoryCuts', W - fs, H - fs);
    ctx.restore();
  }
  pauseAnimsExcept(cache.usedAnims);
  return seg;
}

// ---------- audio routing (shared by preview and export) ----------

const graphs = new WeakMap();
const NO_VIDEO = {};
/**
 * Audio mix shared by preview and export:
 *   voice (the video's own audio), sound effects and music
 *   all go to the speakers and to a recordable stream.
 * `video` may be null (the demo has no audio track).
 */
export function audioGraph(video) {
  const keyObj = video || NO_VIDEO;
  let g = graphs.get(keyObj);
  if (!g) {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const dest = ac.createMediaStreamDestination();
    const master = ac.createGain();
    master.connect(ac.destination);
    const sfx = ac.createGain();
    sfx.connect(master); sfx.connect(dest);
    const music = ac.createGain();
    music.connect(master); music.connect(dest);
    let voice = null;
    if (video) {
      const src = ac.createMediaElementSource(video);
      voice = ac.createGain();
      src.connect(voice);
      voice.connect(master); voice.connect(dest);
    }
    g = { ac, dest, master, sfx, music, voice };
    graphs.set(keyObj, g);
  }
  if (g.ac.state === 'suspended') g.ac.resume();
  return g;
}

export function setMix(graph, settings) {
  if (graph.voice) graph.voice.gain.value = settings.voiceVol ?? 1;
  graph.sfx.gain.value = settings.sfxVol ?? 0.8;
  graph.music.gain.value = settings.music ? (settings.music.vol ?? 0.35) : 0;
}

function pickMime() {
  const options = [
    'video/mp4;codecs=avc1.640028,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return options.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}

/**
 * Render the final video in real time: the source plays once while the
 * composited canvas (plus the original audio) is recorded.
 * `media` is the app's media wrapper (see app.js): { el, video?, time, seek, play, pause, onEnded }.
 */
export async function exportVideo(project, media, { aspect = 'vertical', onProgress = () => {}, signal, sfxPlayer, musicPlayer } = {}) {
  const { w: W, h: H } = ASPECTS[aspect];
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const cache = {};
  const mimeType = pickMime();
  const stream = canvas.captureStream(30);
  const graph = audioGraph(media.video || null);
  setMix(graph, project.settings);
  graph.dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: aspect === 'vertical' ? 8e6 : 10e6, audioBitsPerSecond: 160e3 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  media.pause();
  if (project.settings.captions) await loadCaptionFonts([resolveCaptionStyle(project.settings.captionStyle).font]);
  await Promise.all(project.segments.filter((sg) => sg.image?.key).map((sg) => preloadBitmap(sg.image.key)));
  if (project.settings.sceneMotion === 'animated' && canAnimate(project.settings)) await Promise.all(project.segments.filter((sg) => animReady(sg) && !sg.still).map((sg) => preloadAnim(sg.anim.key)));
  await media.seek(0);
  drawFrame(ctx, W, H, 0, project, media.el, cache);

  const done = new Promise((resolve, reject) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: (mimeType || 'video/webm').split(';')[0] }));
    rec.onerror = (e) => reject(e.error || new Error('Recording failed'));
  });
  rec.start(1000);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    media.pause();
    sfxPlayer?.stop();
    musicPlayer?.stop();
    setTimeout(() => rec.state !== 'inactive' && rec.stop(), 200);
  };
  signal?.addEventListener('abort', stop);
  const offEnded = media.onEnded(stop);

  const draw = () => {
    if (stopped) return;
    const t = media.time;
    drawFrame(ctx, W, H, t, project, media.el, cache);
    onProgress(t / project.duration);
    if (t >= project.duration - 0.03) stop();
  };
  await media.play();
  cache.live = true;
  sfxPlayer?.start(graph, project.sfx || [], 0);
  musicPlayer?.start(graph, project.settings.music, 0, project.duration);
  // a timer (not requestAnimationFrame) so a briefly hidden tab keeps rendering
  const iv = setInterval(draw, 1000 / 30);
  const blob = await done;
  clearInterval(iv);
  offEnded();
  onProgress(1);
  return { blob, ext: blob.type.includes('mp4') ? 'mp4' : 'webm' };
}

export function toSRT(words) {
  const pages = captionPages(words);
  const ts = (t) => {
    const ms = Math.round(t * 1000);
    const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
    const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
    const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
    return `${h}:${m}:${s},${String(ms % 1000).padStart(3, '0')}`;
  };
  return pages.map((p, i) => `${i + 1}\n${ts(p.start)} --> ${ts(Math.min(p.end, p.start + 4))}\n${p.words.map((w) => w.w).join(' ')}\n`).join('\n');
}
