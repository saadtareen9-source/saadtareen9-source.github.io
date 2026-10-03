// Compositor: turns (video, plan, time) into a frame. The same function drives
// the live preview and the export, so what you review is what you get.

import { drawSoundEffect } from './draw.js';
import { bitmapFor, preloadBitmap } from './images.js';

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

// ---------- captions ----------

export function captionPages(words) {
  const pages = [];
  let cur = [];
  const flush = () => { if (cur.length) pages.push(cur); cur = []; };
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (cur.length && (cur.length >= 3 || (prev && w.s - prev.e > 0.45) || cur.map((x) => x.w).join(' ').length > 16)) flush();
    cur.push(w);
    if (/[.?!,]$/.test(w.w)) flush();
  });
  flush();
  return pages.map((ws, i) => ({
    words: ws,
    start: ws[0].s,
    end: Math.min(ws[ws.length - 1].e + 0.5, pages[i + 1]?.[0]?.s ?? Infinity),
  }));
}

function drawCaptions(ctx, W, H, pages, t, style) {
  const page = pages.find((p) => t >= p.start && t < p.end);
  if (!page) return;
  const portrait = H > W;
  const fs = Math.round((portrait ? W * 0.082 : H * 0.075) * (style.size || 1));
  ctx.save();
  ctx.font = `900 ${fs}px "Arial Black", Impact, system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  const fmt = (s) => (style.upper ? s.toUpperCase() : s).replace(/[,.]$/, '');
  const parts = page.words.map((w) => fmt(w.w));
  const space = ctx.measureText(' ').width;
  const widths = parts.map((p) => ctx.measureText(p).width);
  const total = widths.reduce((a, b) => a + b, 0) + space * (parts.length - 1);
  const scale = Math.min(1, (W * 0.9) / total);
  const y = H * (portrait ? 0.8 : 0.9);
  ctx.translate(W / 2, y);
  ctx.scale(scale, scale);
  let x = -total / 2;
  parts.forEach((p, i) => {
    const w = page.words[i];
    const active = t >= w.s && t < (page.words[i + 1]?.s ?? page.end);
    ctx.save();
    ctx.translate(x + widths[i] / 2, 0);
    if (active) ctx.scale(1.08, 1.08);
    ctx.lineJoin = 'round';
    ctx.lineWidth = fs * 0.2; ctx.strokeStyle = '#000';
    ctx.textAlign = 'center';
    ctx.strokeText(p, 0, 0);
    ctx.fillStyle = active ? (style.highlight || '#ffd60a') : '#fff';
    ctx.fillText(p, 0, 0);
    ctx.restore();
    x += widths[i] + space;
  });
  ctx.restore();
}

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

export function drawFrame(ctx, W, H, t, project, video, cache = {}) {
  const { segments, characters, settings } = project;
  const seg = segmentAt(segments, t);
  const type = shotType(seg, settings);
  const idx = segments.indexOf(seg);
  const local = t - seg.start;
  const dur = seg.end - seg.start;
  const fx = settings.faceX ?? 0.5, fy = settings.faceY ?? 0.4;

  if (type === 'face' || !seg.scene) {
    // alternate punch-in on consecutive face shots, like a jump-cut zoom
    const faceShots = segments.slice(0, idx).filter((s) => s.type === 'face').length;
    const zoom = settings.punchIn && faceShots % 2 === 1 ? 1.15 : 1;
    drawVideoCover(ctx, video, 0, 0, W, H, fx, fy, zoom);
  } else {
    const sfxSide = type === 'scene_bubble' && settings.bubbleSide !== 'left' ? 'left' : 'right';
    const bmp = seg.image?.key ? bitmapFor(seg.image.key, cache.onImage) : null;
    if (bmp) {
      drawKenBurns(ctx, bmp, W, H, local, dur, idx);
      drawSoundEffect(ctx, seg.scene.sound_effect, W, H, local, Math.min(W, H) / 1000, sfxSide);
    } else {
      drawPlaceholder(ctx, W, H, seg, local, cache.pending?.has(seg.id));
    }
    if (type === 'scene_bubble') {
      const R = Math.min(W, H) * (H > W ? 0.2 : 0.17);
      const pad = Math.min(W, H) * 0.045;
      const cx = settings.bubbleSide === 'left' ? pad + R : W - pad - R;
      const cy = (H > W ? H * 0.08 : pad) + R;
      const pop = Math.min(1, local / 0.15);
      ctx.save();
      ctx.translate(cx, cy); ctx.scale(pop, pop); ctx.translate(-cx, -cy);
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.closePath();
      ctx.save(); ctx.clip();
      drawVideoCover(ctx, video, cx - R, cy - R, R * 2, R * 2, fx, fy, 1.6);
      ctx.restore();
      ctx.lineWidth = R * 0.07; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.lineWidth = R * 0.02; ctx.strokeStyle = '#141414';
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.035, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }
  if (settings.captions) {
    if (!cache.pages || cache.pagesFor !== project.words) { cache.pages = captionPages(project.words); cache.pagesFor = project.words; }
    drawCaptions(ctx, W, H, cache.pages, t, settings.captionStyle || { upper: true });
  }
  if (settings.watermark) {
    ctx.save();
    const fs = Math.min(W, H) * 0.028;
    ctx.font = `700 ${fs}px system-ui, sans-serif`; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = fs * 0.15;
    ctx.strokeText('made with StoryCuts', W - fs, H - fs); ctx.fillText('made with StoryCuts', W - fs, H - fs);
    ctx.restore();
  }
  return seg;
}

// ---------- audio routing (shared by preview and export) ----------

const graphs = new WeakMap();
const NO_VIDEO = {};
/**
 * Audio mix shared by preview and export:
 *   voice (the video's own audio) ─┐
 *   sound effects ─────────────────┼─> speakers + a recordable stream
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
    let voice = null;
    if (video) {
      const src = ac.createMediaElementSource(video);
      voice = ac.createGain();
      src.connect(voice);
      voice.connect(master); voice.connect(dest);
    }
    g = { ac, dest, master, sfx, voice };
    graphs.set(keyObj, g);
  }
  if (g.ac.state === 'suspended') g.ac.resume();
  return g;
}

export function setMix(graph, settings) {
  if (graph.voice) graph.voice.gain.value = settings.voiceVol ?? 1;
  graph.sfx.gain.value = settings.sfxVol ?? 0.8;
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
export async function exportVideo(project, media, { aspect = 'vertical', onProgress = () => {}, signal, sfxPlayer } = {}) {
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
  await Promise.all(project.segments.filter((sg) => sg.image?.key).map((sg) => preloadBitmap(sg.image.key)));
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
  sfxPlayer?.start(graph, project.sfx || [], 0);
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
