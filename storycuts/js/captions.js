// Captions: styles, fonts and drawing. Used by the live preview, the export
// and the style tiles in the editor, so every caption looks the same everywhere.
//
// A caption style is a flat object. Picking a preset copies its values in;
// the creator can then change any of them (font, size, colours, outline,
// background, effect, animation, words at a time) and drag it on the video.

export const CAPTION_FONTS = {
  montserrat: { name: 'Montserrat', weight: 900, family: 'Montserrat, "Arial Black", sans-serif' },
  impact: { name: 'Impact', weight: 900, family: '"Arial Black", Impact, sans-serif' },
  anton: { name: 'Anton', weight: 400, family: 'Anton, Impact, sans-serif', scale: 1.12 },
  bebas: { name: 'Bebas', weight: 400, family: '"Bebas Neue", Impact, sans-serif', scale: 1.25 },
  bangers: { name: 'Comic', weight: 400, family: 'Bangers, Impact, sans-serif', scale: 1.1 },
  luckiest: { name: 'Bubbly', weight: 400, family: '"Luckiest Guy", Impact, sans-serif' },
  marker: { name: 'Marker', weight: 400, family: '"Permanent Marker", cursive' },
  poppins: { name: 'Poppins', weight: 800, family: 'Poppins, Inter, sans-serif' },
  inter: { name: 'Inter', weight: 700, family: 'Inter, "Helvetica Neue", Arial, sans-serif' },
  mono: { name: 'Typewriter', weight: 700, family: '"Space Mono", "Courier New", monospace', scale: 0.9 },
};

export const CAPTION_ANIMS = [
  { id: 'none', name: 'None' },
  { id: 'pop', name: 'Pop' },
  { id: 'bounce', name: 'Bounce' },
  { id: 'karaoke', name: 'Karaoke' },
  { id: 'type', name: 'Word by word' },
  { id: 'slide', name: 'Slide up' },
  { id: 'zoom', name: 'Punch in' },
];

export const CAPTION_BGS = [
  { id: 'none', name: 'None' },
  { id: 'box', name: 'Box' },
  { id: 'bar', name: 'Bar' },
  { id: 'word', name: 'Word' },
  { id: 'pill', name: 'Pills' },
];

export const CAPTION_EFFECTS = [
  { id: 'none', name: 'None' },
  { id: 'shadow', name: 'Shadow' },
  { id: 'glow', name: 'Glow' },
  { id: '3d', name: '3D' },
  { id: 'gradient', name: 'Gradient' },
];

const BASE = {
  font: 'montserrat', color: '#ffffff', highlight: '#ffd60a', outline: '#000000', outlineW: 0.12,
  bg: 'none', bgColor: '#000000', effect: 'none', anim: 'pop', words: 3, upper: true, tilt: 0, spacing: 0,
};

// A wide range of looks, from classic to loud.
export const CAPTION_PRESETS = [
  { id: 'bold', name: 'Classic', font: 'montserrat', highlight: '#ffd60a', outlineW: 0.13, anim: 'pop' },
  { id: 'viral', name: 'Viral', font: 'anton', highlight: '#4ade80', outlineW: 0.16, effect: 'shadow', anim: 'bounce', words: 2 },
  { id: 'pop', name: 'Highlighter', font: 'montserrat', highlight: '#ffd60a', bg: 'word', outlineW: 0.1, anim: 'pop' },
  { id: 'karaoke', name: 'Karaoke', font: 'poppins', color: '#ffffff', highlight: '#38bdf8', outlineW: 0.1, anim: 'karaoke', words: 4 },
  { id: 'oneword', name: 'One word', font: 'anton', highlight: '#ffffff', outlineW: 0.14, effect: 'shadow', anim: 'zoom', words: 1, size: 1.35 },
  { id: 'comic', name: 'Comic', font: 'bangers', color: '#ffe14d', highlight: '#ffffff', outline: '#111111', outlineW: 0.16, effect: '3d', anim: 'bounce', tilt: -4, spacing: 0.04 },
  { id: 'bubbly', name: 'Bubbly', font: 'luckiest', color: '#ffffff', highlight: '#ff6fb5', outline: '#2b1a4a', outlineW: 0.14, effect: '3d', anim: 'pop' },
  { id: 'boxed', name: 'Boxed', font: 'poppins', highlight: '#ffd60a', outlineW: 0, bg: 'box', bgColor: '#000000', anim: 'pop' },
  { id: 'pills', name: 'Pills', font: 'poppins', color: '#111111', highlight: '#7c5cff', outlineW: 0, bg: 'pill', bgColor: '#ffffff', anim: 'type', upper: false },
  { id: 'subtitle', name: 'Subtitle', font: 'inter', color: '#ffffff', highlight: '#ffffff', outlineW: 0, bg: 'bar', bgColor: '#000000', anim: 'none', upper: false, words: 6, size: 0.75 },
  { id: 'clean', name: 'Clean', font: 'inter', highlight: '#ffd60a', outlineW: 0, effect: 'shadow', anim: 'pop', upper: false },
  { id: 'minimal', name: 'Minimal', font: 'poppins', color: '#ffffff', highlight: '#ffffff', outlineW: 0, effect: 'shadow', anim: 'slide', upper: false, words: 4, size: 0.8 },
  { id: 'neon', name: 'Neon', font: 'montserrat', color: '#ffd1f4', highlight: '#ffffff', outline: '#ff2fd0', outlineW: 0.05, effect: 'glow', anim: 'pop' },
  { id: 'sunset', name: 'Sunset', font: 'anton', color: '#ff7a59', highlight: '#ffd60a', outlineW: 0.1, effect: 'gradient', anim: 'bounce', words: 2 },
  { id: 'marker', name: 'Marker', font: 'marker', color: '#ffffff', highlight: '#ffd60a', outline: '#000000', outlineW: 0.1, effect: 'shadow', anim: 'type', upper: false, tilt: -3 },
  { id: 'cinema', name: 'Cinematic', font: 'bebas', color: '#f5f5f5', highlight: '#f5c26b', outlineW: 0, effect: 'shadow', anim: 'slide', spacing: 0.12, words: 4, size: 0.9 },
  { id: 'typewriter', name: 'Typewriter', font: 'mono', color: '#ffffff', highlight: '#ffd60a', outlineW: 0, bg: 'box', bgColor: '#111111', anim: 'type', upper: false, words: 4, size: 0.8 },
  { id: 'outline', name: 'Hollow', font: 'anton', color: 'transparent', highlight: '#ffd60a', outline: '#ffffff', outlineW: 0.06, anim: 'karaoke', words: 2 },
];

// kept for older code that imports CAPTION_STYLES
export const CAPTION_STYLES = CAPTION_PRESETS.map(({ id, name }) => ({ id, name }));

const POS_Y = { low: 0.78, mid: 0.55, high: 0.2 };

/** A preset's full values, merged over the defaults. */
export function presetValues(id) {
  const p = CAPTION_PRESETS.find((x) => x.id === id) || CAPTION_PRESETS[0];
  const { name, id: presetId, ...rest } = p;
  return { ...BASE, size: 1, ...rest, preset: presetId };
}

/** Fill in anything missing (older projects only stored a few fields). */
export function resolveCaptionStyle(cs = {}) {
  const base = presetValues(cs.preset || 'bold');
  const out = { ...base };
  Object.entries(cs).forEach(([k, v]) => { if (v != null) out[k] = v; });
  if (cs.x == null) out.x = 0.5;
  if (cs.y == null) out.y = POS_Y[cs.pos || 'low'] ?? 0.78;
  return out;
}

const fontCss = (font, px) => {
  const f = CAPTION_FONTS[font] || CAPTION_FONTS.montserrat;
  return `${f.weight} ${px}px ${f.family}`;
};

/** Ask the browser to load a caption font so the canvas can use it. */
export function loadCaptionFonts(fonts = Object.keys(CAPTION_FONTS)) {
  if (!document.fonts?.load) return Promise.resolve();
  return Promise.all(fonts.map((k) => document.fonts.load(fontCss(k, 40)).catch(() => {}))).then(() => {});
}

export function captionPages(words, maxWords = 3) {
  const pages = [];
  let cur = [];
  const maxChars = maxWords <= 1 ? 99 : maxWords * 7;
  const flush = () => { if (cur.length) pages.push(cur); cur = []; };
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (cur.length && (cur.length >= maxWords || (prev && w.s - prev.e > 0.45) || cur.map((x) => x.w).join(' ').length > maxChars)) flush();
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

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const ease = (k) => 1 - (1 - Math.min(1, Math.max(0, k))) ** 3;

/** Readable text colour on top of a coloured box. */
function onColour(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#000';
  const n = parseInt(m[1], 16);
  const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.6 ? '#000000' : '#ffffff';
}

/**
 * Draw the caption for time t. Returns its box in canvas pixels (for dragging),
 * or null when nothing is on screen.
 */
export function drawCaptions(ctx, W, H, pages, t, styleIn) {
  const page = pages.find((p) => t >= p.start && t < p.end);
  if (!page) return null;
  const s = resolveCaptionStyle(styleIn);
  return drawPage(ctx, W, H, page, t, s);
}

function drawPage(ctx, W, H, page, t, s, baseSize = 0) {
  const portrait = H > W;
  const f = CAPTION_FONTS[s.font] || CAPTION_FONTS.montserrat;
  const fs = Math.round((baseSize || (portrait ? W * 0.084 : H * 0.07)) * (s.size || 1) * (f.scale || 1));
  ctx.save();
  ctx.font = fontCss(s.font, fs);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(s.spacing || 0) * fs}px`;
  const fmt = (w) => (s.upper ? w.toUpperCase() : w).replace(/[,.]$/, '');
  const words = page.words.map((w, i) => ({
    text: fmt(w.w), s: w.s, e: page.words[i + 1]?.s ?? page.end, w: 0,
  }));
  words.forEach((w) => { w.w = ctx.measureText(w.text).width; });
  const space = ctx.measureText(' ').width + (s.bg === 'pill' ? fs * 0.3 : 0);

  // wrap onto up to two lines instead of shrinking tiny
  const maxW = W * 0.84;
  const lines = [[]];
  let lw = 0;
  words.forEach((w) => {
    const add = (lines.at(-1).length ? space : 0) + w.w;
    if (lines.at(-1).length && lw + add > maxW && lines.length < 2) { lines.push([w]); lw = w.w; } else { lines.at(-1).push(w); lw += add; }
  });
  const lineW = lines.map((ln) => ln.reduce((a, w) => a + w.w, 0) + space * (ln.length - 1));
  const widest = Math.max(...lineW);
  const fit = Math.min(1, maxW / widest);
  const lh = fs * 1.22;

  // page entrance
  const age = t - page.start;
  let pageScale = 1, pageY = 0, pageAlpha = 1;
  if (s.anim === 'pop') pageScale = 0.86 + 0.14 * ease(age / 0.14);
  if (s.anim === 'slide') { pageY = (1 - ease(age / 0.22)) * fs * 0.5; pageAlpha = ease(age / 0.18); }
  if (s.anim === 'zoom') pageScale = 1 + 0.45 * (1 - ease(age / 0.16));

  const cx = W * (s.x ?? 0.5), cy = H * (s.y ?? 0.78);
  ctx.translate(cx, cy + pageY);
  if (s.tilt) ctx.rotate((s.tilt * Math.PI) / 180);
  ctx.scale(fit * pageScale, fit * pageScale);
  ctx.globalAlpha = pageAlpha;

  const blockH = lh * lines.length;
  const top = -blockH / 2 + lh / 2;

  // backgrounds behind the whole block
  if (s.bg === 'box' || s.bg === 'bar') {
    ctx.save();
    ctx.fillStyle = s.bgColor; ctx.globalAlpha *= 0.82;
    const padX = fs * 0.5, padY = fs * 0.22;
    if (s.bg === 'box') roundRect(ctx, -widest / 2 - padX, -blockH / 2 - padY, widest + padX * 2, blockH + padY * 2, fs * 0.3);
    else { const full = W / (fit * pageScale); roundRect(ctx, -full / 2, -blockH / 2 - padY, full, blockH + padY * 2, 0); }
    ctx.fill();
    ctx.restore();
  }

  lines.forEach((ln, li) => {
    let x = -lineW[li] / 2;
    const y = top + li * lh;
    ln.forEach((w) => {
      const spoken = t >= w.s;
      const active = t >= w.s && t < w.e;
      if (s.anim === 'type' && !spoken) { x += w.w + space; return; }
      ctx.save();
      ctx.translate(x + w.w / 2, y);
      let sc = 1;
      if (active && ['pop', 'zoom'].includes(s.anim)) sc = 1.08;
      if (active && s.anim === 'bounce') { const k = Math.min(1, (t - w.s) / 0.18); ctx.translate(0, -Math.sin(k * Math.PI) * fs * 0.14); sc = 1.12; }
      if (s.anim === 'type') { const k = ease((t - w.s) / 0.12); ctx.globalAlpha *= k; ctx.translate(0, (1 - k) * fs * 0.2); }
      ctx.scale(sc, sc);

      // per-word backgrounds
      if (s.bg === 'pill' || (s.bg === 'word' && active)) {
        ctx.save();
        ctx.fillStyle = s.bg === 'word' ? s.highlight : (active ? s.highlight : s.bgColor);
        roundRect(ctx, -w.w / 2 - fs * 0.18, -fs * 0.6, w.w + fs * 0.36, fs * 1.2, fs * 0.22);
        ctx.fill();
        ctx.restore();
      }

      let fill = active ? s.highlight : s.color;
      if (s.anim === 'karaoke') fill = spoken && !active ? s.highlight : s.color;
      if ((s.bg === 'word' && active) || (s.bg === 'pill' && active)) fill = onColour(s.highlight);
      if (s.bg === 'pill' && !active) fill = s.color;

      ctx.lineJoin = 'round'; ctx.miterLimit = 2;
      if (s.effect === '3d') {
        const d = Math.max(2, fs * 0.07);
        ctx.fillStyle = s.outline;
        for (let k = d; k > 0; k -= Math.max(1, d / 4)) ctx.fillText(w.text, k * 0.7, k);
      }
      if (s.effect === 'shadow') { ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = fs * 0.3; ctx.shadowOffsetY = fs * 0.06; }
      if (s.effect === 'glow') { ctx.shadowColor = active ? s.highlight : s.outline; ctx.shadowBlur = fs * 0.55; }
      const onBox = (s.bg === 'word' || s.bg === 'pill') && active;
      if (s.outlineW > 0 && !onBox && !(s.bg === 'pill')) {
        ctx.lineWidth = fs * s.outlineW * 2; ctx.strokeStyle = s.outline;
        ctx.strokeText(w.text, 0, 0);
        if (s.effect === 'shadow') { ctx.shadowColor = 'transparent'; }
      }
      if (s.effect === 'gradient' && !(s.bg === 'word' && active)) {
        const g = ctx.createLinearGradient(0, -fs / 2, 0, fs / 2);
        g.addColorStop(0, active ? '#ffffff' : s.highlight); g.addColorStop(1, active ? s.highlight : s.color);
        fill = g;
      }
      if (fill !== 'transparent') { ctx.fillStyle = fill; ctx.fillText(w.text, 0, 0); }
      // karaoke: the word being spoken fills from left to right
      if (s.anim === 'karaoke' && active) {
        const k = Math.min(1, (t - w.s) / Math.max(0.12, w.e - w.s));
        ctx.save();
        ctx.beginPath(); ctx.rect(-w.w / 2 - fs, -fs, (w.w + fs) * k + fs * 0.0, fs * 2); ctx.clip();
        ctx.fillStyle = s.highlight; ctx.fillText(w.text, 0, 0);
        ctx.restore();
      }
      ctx.restore();
      x += w.w + space;
    });
  });
  ctx.restore();

  const bw = Math.min(W, widest * fit * pageScale + fs), bh = blockH * fit * pageScale + fs * 0.5;
  return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
}

/** A tile preview: the real caption drawing over a picture. */
export function drawCaptionSample(ctx, W, H, style, { text = 'This was wild', progress = 0.45, background } = {}) {
  ctx.save();
  if (background) {
    const k = Math.max(W / background.width, H / background.height);
    ctx.drawImage(background, (W - background.width * k) / 2, (H - background.height * k) / 2, background.width * k, background.height * k);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H);
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#2b2d42'); g.addColorStop(1, '#11121a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
  const s = resolveCaptionStyle(style);
  const parts = text.split(' ');
  const n = Math.min(parts.length, Math.max(1, s.words));
  const shown = s.words <= 1 ? [parts[1] || parts[0]] : parts.slice(0, n);
  const page = { start: 0, end: 1, words: shown.map((w, i) => ({ w, s: i / shown.length, e: (i + 1) / shown.length })) };
  const tile = { ...s, x: 0.5, y: 0.5, size: Math.min(1.15, s.size || 1) };
  drawPage(ctx, W, H, page, s.words <= 1 ? 0.6 : progress, tile, W * 0.13);
}
