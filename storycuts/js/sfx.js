// Sound effects, synthesized in the browser (no audio files to host or
// license). Each effect is rendered once into an AudioBuffer and cached.

import { getBlob } from './images.js';

// Categories shown as filter chips in the editor.
export const SFX_CATS = [
  { id: 'all', name: 'All' },
  { id: 'impact', name: 'Impacts' },
  { id: 'whoosh', name: 'Whooshes' },
  { id: 'comedy', name: 'Comedy' },
  { id: 'reveal', name: 'Reveals' },
  { id: 'real', name: 'Everyday' },
  { id: 'mine', name: 'My sounds' },
];

// `icon` names an SVG symbol in index.html (#i-sfx-<icon>).
export const SFX = [
  { id: 'whoosh', name: 'Whoosh', cat: 'whoosh', icon: 'wind', dur: 0.7 },
  { id: 'swoosh_up', name: 'Swoosh up', cat: 'whoosh', icon: 'up', dur: 0.55 },
  { id: 'glitch', name: 'Glitch', cat: 'whoosh', icon: 'glitch', dur: 0.45 },
  { id: 'boom', name: 'Boom', cat: 'impact', icon: 'burst', dur: 1.8 },
  { id: 'crash', name: 'Crash', cat: 'impact', icon: 'crash', dur: 1.3 },
  { id: 'pop', name: 'Pop', cat: 'impact', icon: 'pop', dur: 0.2 },
  { id: 'boing', name: 'Boing', cat: 'comedy', icon: 'spring', dur: 0.8 },
  { id: 'record_scratch', name: 'Record scratch', cat: 'comedy', icon: 'disc', dur: 0.6 },
  { id: 'sad_trombone', name: 'Sad trombone', cat: 'comedy', icon: 'down', dur: 2.6 },
  { id: 'slide_whistle', name: 'Slide whistle', cat: 'comedy', icon: 'wave', dur: 1.0 },
  { id: 'dun_dun', name: 'Dun dun', cat: 'reveal', icon: 'drama', dur: 1.8 },
  { id: 'ding', name: 'Ding', cat: 'reveal', icon: 'bell', dur: 1.6 },
  { id: 'tada', name: 'Ta-da', cat: 'reveal', icon: 'star', dur: 1.5 },
  { id: 'drumroll', name: 'Drumroll', cat: 'reveal', icon: 'drum', dur: 2.2 },
  { id: 'heartbeat', name: 'Heartbeat', cat: 'reveal', icon: 'heart', dur: 1.3 },
  { id: 'phone_buzz', name: 'Phone buzz', cat: 'real', icon: 'phone', dur: 1.2 },
  { id: 'camera', name: 'Camera click', cat: 'real', icon: 'camera', dur: 0.35 },
  { id: 'typing', name: 'Typing', cat: 'real', icon: 'keys', dur: 1.1 },
];

/** Sounds that come from audio files: built-in packs and the user's uploads. */
const extra = new Map();
export const sfxInfo = (id) => extra.get(id) || SFX.find((s) => s.id === id);
export const allSfx = () => [...[...extra.values()].filter((x) => x.cat !== 'mine'), ...SFX, ...[...extra.values()].filter((x) => x.cat === 'mine')];

export function registerSfx(info) {
  if (!info?.id) return;
  extra.set(info.id, { icon: 'note', cat: 'mine', dur: 1, ...info });
}

/** Built-in sound files listed in assets/sfx/manifest.json (if any). */
export async function loadSfxManifest() {
  try {
    const r = await fetch('assets/sfx/manifest.json', { cache: 'no-cache' });
    if (!r.ok) return;
    const list = await r.json();
    for (const x of list.sounds || list) {
      if (x.id && x.file) registerSfx({ id: x.id, name: x.name || x.id, cat: x.cat || 'impact', icon: x.icon || 'note', dur: x.dur || 1, src: `assets/sfx/${x.file}` });
    }
  } catch { /* no pack installed */ }
}

const SR = 44100;
const cache = new Map();

function noise(ctx, seconds) {
  const b = ctx.createBuffer(1, Math.ceil(SR * seconds), SR);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = ctx.createBufferSource();
  s.buffer = b;
  return s;
}

function env(ctx, points) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(points[0][1], points[0][0]);
  for (const [t, v, type] of points.slice(1)) {
    if (type === 'exp') g.gain.exponentialRampToValueAtTime(Math.max(v, 0.0001), t);
    else g.gain.linearRampToValueAtTime(v, t);
  }
  return g;
}

function osc(ctx, type, freq) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  return o;
}

function filter(ctx, type, freq, Q = 0.8) {
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = Q;
  return f;
}

function softClip(ctx, amount = 2) {
  const ws = ctx.createWaveShaper();
  const c = new Float32Array(1024);
  for (let i = 0; i < c.length; i++) { const x = (i / 511.5) - 1; c[i] = Math.tanh(x * amount) / Math.tanh(amount); }
  ws.curve = c;
  return ws;
}

const BUILD = {
  whoosh(ctx, out) {
    const n = noise(ctx, 0.7);
    const f = filter(ctx, 'bandpass', 400, 1.4);
    f.frequency.setValueAtTime(350, 0);
    f.frequency.exponentialRampToValueAtTime(2600, 0.28);
    f.frequency.exponentialRampToValueAtTime(500, 0.68);
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(-0.8, 0); p.pan.linearRampToValueAtTime(0.8, 0.65);
    const g = env(ctx, [[0, 0], [0.26, 0.9], [0.68, 0.0001, 'exp']]);
    n.connect(f).connect(g).connect(p).connect(out);
    n.start(0);
  },
  swoosh_up(ctx, out) {
    const n = noise(ctx, 0.55);
    const f = filter(ctx, 'bandpass', 300, 2);
    f.frequency.exponentialRampToValueAtTime(5000, 0.45);
    const g = env(ctx, [[0, 0], [0.38, 0.8], [0.52, 0.0001, 'exp']]);
    n.connect(f).connect(g).connect(out);
    n.start(0);
  },
  pop(ctx, out) {
    const o = osc(ctx, 'sine', 380);
    o.frequency.exponentialRampToValueAtTime(1100, 0.035);
    o.frequency.exponentialRampToValueAtTime(700, 0.12);
    const g = env(ctx, [[0, 0], [0.004, 0.9], [0.15, 0.0001, 'exp']]);
    o.connect(g).connect(out);
    o.start(0); o.stop(0.2);
  },
  ding(ctx, out) {
    [[1318.5, 0.55], [1318.5 * 2.76, 0.12], [1318.5 * 5.4, 0.05], [659.25, 0.18]].forEach(([fr, a]) => {
      const o = osc(ctx, 'sine', fr);
      const g = env(ctx, [[0, 0], [0.005, a], [1.55, 0.0001, 'exp']]);
      o.connect(g).connect(out);
      o.start(0); o.stop(1.6);
    });
  },
  boing(ctx, out) {
    const o = osc(ctx, 'sine', 160);
    o.frequency.exponentialRampToValueAtTime(520, 0.18);
    o.frequency.exponentialRampToValueAtTime(260, 0.75);
    const lfo = osc(ctx, 'sine', 15);
    const depth = ctx.createGain(); depth.gain.value = 45;
    lfo.connect(depth).connect(o.frequency);
    const g = env(ctx, [[0, 0], [0.01, 0.7], [0.78, 0.0001, 'exp']]);
    o.connect(g).connect(out);
    o.start(0); lfo.start(0); o.stop(0.8); lfo.stop(0.8);
  },
  boom(ctx, out) {
    const o = osc(ctx, 'sine', 110);
    o.frequency.exponentialRampToValueAtTime(32, 1.4);
    const g = env(ctx, [[0, 0], [0.01, 1], [1.7, 0.0001, 'exp']]);
    const sc = softClip(ctx, 3);
    o.connect(g).connect(sc).connect(out);
    o.start(0); o.stop(1.8);
    const n = noise(ctx, 1.2);
    const f = filter(ctx, 'lowpass', 1200);
    f.frequency.exponentialRampToValueAtTime(90, 1.0);
    const gn = env(ctx, [[0, 0], [0.01, 0.8], [1.1, 0.0001, 'exp']]);
    n.connect(f).connect(gn).connect(out);
    n.start(0);
  },
  crash(ctx, out) {
    const n = noise(ctx, 1.3);
    const hp = filter(ctx, 'highpass', 2500);
    const g = env(ctx, [[0, 0], [0.004, 0.8], [1.25, 0.0001, 'exp']]);
    n.connect(hp).connect(g).connect(out);
    const n2 = noise(ctx, 0.4);
    const bp = filter(ctx, 'bandpass', 900, 0.7);
    const g2 = env(ctx, [[0, 0], [0.003, 0.9], [0.35, 0.0001, 'exp']]);
    n2.connect(bp).connect(g2).connect(out);
    n.start(0); n2.start(0);
  },
  dun_dun(ctx, out) {
    [[0, 98], [0.42, 92.5]].forEach(([t, fr], i) => {
      [1, 1.5, 2].forEach((mult, k) => {
        const o = osc(ctx, 'sawtooth', fr * mult);
        const lp = filter(ctx, 'lowpass', 700);
        lp.frequency.setValueAtTime(1400, t); lp.frequency.exponentialRampToValueAtTime(300, t + 1);
        const len = i ? 1.3 : 0.4;
        const g = env(ctx, [[0, 0], [t, 0], [t + 0.02, 0.32 / (k + 1)], [t + len, 0.0001, 'exp']]);
        o.connect(lp).connect(g).connect(out);
        o.start(t); o.stop(t + len + 0.05);
      });
    });
  },
  record_scratch(ctx, out) {
    const n = noise(ctx, 0.6);
    const bp = filter(ctx, 'bandpass', 900, 3);
    bp.frequency.setValueAtTime(500, 0);
    bp.frequency.exponentialRampToValueAtTime(2600, 0.12);
    bp.frequency.exponentialRampToValueAtTime(600, 0.3);
    bp.frequency.exponentialRampToValueAtTime(2000, 0.45);
    const g = env(ctx, [[0, 0], [0.02, 1], [0.3, 0.6], [0.55, 0.0001, 'exp']]);
    n.connect(bp).connect(g).connect(out);
    const o = osc(ctx, 'sawtooth', 180);
    o.frequency.exponentialRampToValueAtTime(420, 0.12);
    o.frequency.exponentialRampToValueAtTime(140, 0.3);
    o.frequency.exponentialRampToValueAtTime(360, 0.45);
    const go = env(ctx, [[0, 0], [0.02, 0.15], [0.5, 0.0001, 'exp']]);
    o.connect(go).connect(out);
    n.start(0); o.start(0); o.stop(0.6);
  },
  sad_trombone(ctx, out) {
    const notes = [[0, 293.66, 0.45], [0.5, 277.18, 0.45], [1.0, 261.63, 0.45], [1.5, 246.94, 1.05]];
    for (const [t, fr, len] of notes) {
      const o = osc(ctx, 'sawtooth', fr);
      if (len > 0.6) {
        const lfo = osc(ctx, 'sine', 6);
        const d = ctx.createGain(); d.gain.value = 6;
        lfo.connect(d).connect(o.frequency);
        lfo.start(t + 0.25); lfo.stop(t + len);
      }
      const lp = filter(ctx, 'lowpass', 500, 4);
      lp.frequency.setValueAtTime(400, t);
      lp.frequency.linearRampToValueAtTime(1400, t + 0.12);
      lp.frequency.linearRampToValueAtTime(600, t + len);
      const g = env(ctx, [[0, 0], [t, 0], [t + 0.04, 0.35], [t + len - 0.05, 0.25], [t + len, 0.0001, 'exp']]);
      o.connect(lp).connect(g).connect(out);
      o.start(t); o.stop(t + len + 0.02);
    }
  },
  tada(ctx, out) {
    const notes = [[0, 523.25], [0.09, 659.25], [0.18, 783.99], [0.3, 1046.5]];
    notes.forEach(([t, fr], i) => {
      const o = osc(ctx, 'triangle', fr);
      const last = i === notes.length - 1;
      const g = env(ctx, [[0, 0], [t, 0], [t + 0.01, 0.35], [t + (last ? 1.15 : 0.35), 0.0001, 'exp']]);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + 1.2);
    });
    [523.25, 659.25, 783.99].forEach((fr) => {
      const o = osc(ctx, 'triangle', fr);
      const g = env(ctx, [[0, 0], [0.3, 0], [0.32, 0.16], [1.45, 0.0001, 'exp']]);
      o.connect(g).connect(out);
      o.start(0.3); o.stop(1.5);
    });
  },
  drumroll(ctx, out) {
    const n = noise(ctx, 2.2);
    const bp = filter(ctx, 'bandpass', 1800, 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, 0);
    for (let t = 0, i = 0; t < 1.7; t += 0.045, i++) {
      const a = 0.12 + (t / 1.7) * 0.5;
      g.gain.setValueAtTime(a * (i % 2 ? 0.75 : 1), t);
      g.gain.exponentialRampToValueAtTime(0.02, t + 0.04);
    }
    g.gain.setValueAtTime(0, 1.72);
    n.connect(bp).connect(g).connect(out);
    n.start(0);
    const c = noise(ctx, 0.6);
    const hp = filter(ctx, 'highpass', 4000);
    const gc = env(ctx, [[0, 0], [1.72, 0], [1.73, 0.7], [2.2, 0.0001, 'exp']]);
    c.connect(hp).connect(gc).connect(out);
    c.start(1.72);
    const k = osc(ctx, 'sine', 90);
    k.frequency.setValueAtTime(90, 1.72); k.frequency.exponentialRampToValueAtTime(45, 1.95);
    const gk = env(ctx, [[0, 0], [1.72, 0], [1.73, 0.8], [2.1, 0.0001, 'exp']]);
    k.connect(gk).connect(out);
    k.start(1.72); k.stop(2.2);
  },
  heartbeat(ctx, out) {
    [0, 0.24, 0.75, 0.99].forEach((t, i) => {
      const o = osc(ctx, 'sine', 70);
      o.frequency.setValueAtTime(70, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
      const a = i % 2 ? 0.6 : 0.9;
      const g = env(ctx, [[0, 0], [t, 0], [t + 0.012, a], [t + 0.2, 0.0001, 'exp']]);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + 0.25);
    });
  },
  slide_whistle(ctx, out) {
    const o = osc(ctx, 'sine', 500);
    o.frequency.exponentialRampToValueAtTime(1700, 0.85);
    const lfo = osc(ctx, 'sine', 7);
    const d = ctx.createGain(); d.gain.value = 18;
    lfo.connect(d).connect(o.frequency);
    const g = env(ctx, [[0, 0], [0.04, 0.4], [0.85, 0.35], [0.98, 0.0001, 'exp']]);
    o.connect(g).connect(out);
    o.start(0); lfo.start(0); o.stop(1); lfo.stop(1);
  },
  phone_buzz(ctx, out) {
    const o = osc(ctx, 'square', 150);
    const lp = filter(ctx, 'lowpass', 700);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, 0);
    for (const [a, b] of [[0, 0.38], [0.6, 0.98]]) {
      g.gain.setValueAtTime(0.35, a);
      g.gain.setValueAtTime(0, b);
    }
    const trem = osc(ctx, 'sine', 32);
    const tg = ctx.createGain(); tg.gain.value = 0.15;
    trem.connect(tg).connect(g.gain);
    o.connect(lp).connect(g).connect(out);
    o.start(0); trem.start(0); o.stop(1.2); trem.stop(1.2);
  },
  camera(ctx, out) {
    [0, 0.09].forEach((t, i) => {
      const n = noise(ctx, 0.06);
      const hp = filter(ctx, i ? 'bandpass' : 'highpass', i ? 2200 : 3000, 1);
      const g = env(ctx, [[0, 0], [t, 0], [t + 0.002, i ? 0.6 : 0.9], [t + 0.05, 0.0001, 'exp']]);
      n.connect(hp).connect(g).connect(out);
      n.start(t);
    });
  },
  typing(ctx, out) {
    let t = 0.02;
    for (let i = 0; i < 9; i++) {
      const n = noise(ctx, 0.04);
      const bp = filter(ctx, 'bandpass', 2500 + Math.random() * 1500, 2);
      const g = env(ctx, [[0, 0], [t, 0], [t + 0.002, 0.5 + Math.random() * 0.3], [t + 0.035, 0.0001, 'exp']]);
      n.connect(bp).connect(g).connect(out);
      n.start(t);
      t += 0.07 + Math.random() * 0.06;
    }
  },
  glitch(ctx, out) {
    const o = osc(ctx, 'square', 300);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, 0);
    for (let t = 0; t < 0.42; t += 0.03) {
      o.frequency.setValueAtTime(120 + Math.random() * 1600, t);
      g.gain.setValueAtTime(Math.random() > 0.3 ? 0.18 : 0, t);
    }
    g.gain.setValueAtTime(0, 0.43);
    const n = noise(ctx, 0.45);
    const gn = ctx.createGain(); gn.gain.value = 0.08;
    o.connect(g).connect(out);
    n.connect(gn).connect(g);
    o.start(0); n.start(0); o.stop(0.45);
  },
};

// a short, soft room so synthesized sounds feel produced rather than raw
function roomImpulse(ctx, seconds = 0.9) {
  const len = Math.ceil(SR * seconds);
  const b = ctx.createBuffer(2, len, SR);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  return b;
}

async function decodeFile(info) {
  const data = info.src ? await (await fetch(info.src)).arrayBuffer() : await (await getBlob(info.key))?.arrayBuffer();
  if (!data) return null;
  const ctx = new OfflineAudioContext(2, SR, SR);
  const buf = await new Promise((res, rej) => { const pr = ctx.decodeAudioData(data, res, rej); if (pr?.then) pr.then(res, rej); });
  info.dur = buf.duration;
  return buf;
}

/** Render an effect to an AudioBuffer (cached). */
export function sfxBuffer(id) {
  if (!cache.has(id)) {
    const info = sfxInfo(id);
    if (!info) return Promise.resolve(null);
    if (info.src || info.key) {
      cache.set(id, decodeFile(info).catch(() => null));
      return cache.get(id);
    }
    if (!BUILD[id]) return Promise.resolve(null);
    const ctx = new OfflineAudioContext(2, Math.ceil(SR * (info.dur + 0.4)), SR);
    const master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.2;
    const verb = ctx.createConvolver();
    verb.buffer = roomImpulse(ctx);
    const wet = ctx.createGain(); wet.gain.value = 0.16;
    const lowcut = ctx.createBiquadFilter(); lowcut.type = 'highpass'; lowcut.frequency.value = 30;
    master.connect(lowcut);
    lowcut.connect(comp);
    lowcut.connect(verb).connect(wet).connect(comp);
    comp.connect(ctx.destination);
    BUILD[id](ctx, master);
    cache.set(id, ctx.startRendering());
  }
  return cache.get(id);
}

/** Loudness envelope for drawing a little waveform (n bars, 0..1). */
export async function sfxPeaks(id, n = 28) {
  const buf = await sfxBuffer(id);
  if (!buf) return [];
  const d = buf.getChannelData(0);
  const step = Math.max(1, Math.floor(d.length / n));
  const out = [];
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = i * step; j < Math.min(d.length, (i + 1) * step); j += 16) m = Math.max(m, Math.abs(d[j]));
    out.push(m);
  }
  const top = Math.max(...out, 0.001);
  return out.map((v) => Math.sqrt(v / top));
}

/** Background music: one looping track under the whole video. */
export class MusicPlayer {
  constructor() { this.buffers = new Map(); }

  async buffer(graph, music) {
    if (!this.buffers.has(music.key)) {
      this.buffers.set(music.key, (async () => {
        const blob = await getBlob(music.key);
        if (!blob) return null;
        const data = await blob.arrayBuffer();
        return new Promise((res, rej) => { const pr = graph.ac.decodeAudioData(data, res, rej); if (pr?.then) pr.then(res, rej); });
      })().catch(() => null));
    }
    return this.buffers.get(music.key);
  }

  async start(graph, music, from, duration) {
    this.stop();
    if (!music?.key) return;
    const token = (this.token = Symbol('run'));
    const buf = await this.buffer(graph, music);
    if (!buf || this.token !== token) return;
    const ac = graph.ac;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ac.createGain();
    const now = ac.currentTime;
    const fadeIn = music.fade !== false ? 1.2 : 0.02;
    const fadeOut = music.fade !== false ? 2 : 0.05;
    const level = (t) => Math.min(1, t / fadeIn, Math.max(0, (duration - t) / fadeOut));
    g.gain.setValueAtTime(level(from), now);
    if (from < fadeIn) g.gain.linearRampToValueAtTime(1, now + (fadeIn - from));
    const outAt = duration - fadeOut;
    if (outAt > from) { g.gain.setValueAtTime(1, now + (outAt - from)); g.gain.linearRampToValueAtTime(0, now + (duration - from)); }
    src.connect(g).connect(graph.music);
    src.start(now, ((music.offset || 0) + from) % buf.duration);
    this.src = src;
  }

  stop() {
    this.token = null;
    try { this.src?.stop(); } catch { /* not started */ }
    this.src = null;
  }
}

/** Schedules sound-effect clips in sync with playback. */
export class SfxPlayer {
  constructor() { this.live = new Set(); }

  /** Play every clip that should sound from media time `from` onwards. */
  async start(graph, clips, from) {
    this.stop();
    const token = (this.token = Symbol('run'));
    const now = graph.ac.currentTime;
    for (const c of clips) {
      const info = sfxInfo(c.type);
      if (!info || c.t + info.dur <= from) continue;
      const buf = await sfxBuffer(c.type);
      if (!buf || this.token !== token) return;
      const src = graph.ac.createBufferSource();
      src.buffer = buf;
      const g = graph.ac.createGain();
      g.gain.value = c.vol ?? 1;
      src.connect(g).connect(graph.sfx);
      const delay = c.t - from - (graph.ac.currentTime - now);
      if (delay >= 0) src.start(graph.ac.currentTime + delay);
      else src.start(graph.ac.currentTime, Math.min(buf.duration, -delay));
      this.live.add(src);
      src.onended = () => this.live.delete(src);
    }
  }

  stop() {
    this.token = null;
    for (const s of this.live) { try { s.stop(); } catch { /* already stopped */ } }
    this.live.clear();
  }

  async preview(graph, type, vol = 1) {
    const buf = await sfxBuffer(type);
    if (!buf) return;
    const src = graph.ac.createBufferSource();
    src.buffer = buf;
    const g = graph.ac.createGain();
    g.gain.value = vol;
    src.connect(g).connect(graph.sfx);
    src.start();
  }
}
