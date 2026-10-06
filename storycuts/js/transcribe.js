// Transcription with word-level timestamps.
//  - transcribeInBrowser: Whisper running locally via transformers.js
//    (free, private; downloads the model once, then it's cached).
//  - wordsFromText: fallback for a pasted transcript, timed by distributing
//    words across the speech in the audio (silence-aware).

const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';
const MODELS = {
  fast: 'onnx-community/whisper-base_timestamped',
  accurate: 'onnx-community/whisper-small_timestamped',
};

// Read the soundtrack as 16 kHz mono samples. Phones record many formats, so
// this tries the fast way first (decode the file) and, if the browser can't,
// plays the video silently once and records its sound.
export async function decodeAudio(file, sampleRate = 16000, { onStatus = () => {}, capture = true } = {}) {
  try {
    return await decodeWhole(file, sampleRate);
  } catch (e) {
    if (!capture) throw e;
    console.warn('StoryCuts: direct audio decode failed, recording the sound instead.', e?.message || e);
    onStatus('capture');
    return captureAudio(file, sampleRate);
  }
}

async function decodeWhole(file, sampleRate) {
  const buf = await file.arrayBuffer();
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const probe = new OAC(1, 1, 44100);
  const audio = await new Promise((resolve, reject) => {
    const pr = probe.decodeAudioData(buf, resolve, reject);
    if (pr?.then) pr.then(resolve, reject);
  });
  if (!audio || !audio.length) throw new Error('no audio track');
  if (audio.sampleRate === sampleRate && audio.numberOfChannels === 1) return audio.getChannelData(0);
  // mix to mono and resample in one go
  const out = new OAC(1, Math.max(1, Math.ceil(audio.duration * sampleRate)), sampleRate);
  const src = out.createBufferSource();
  src.buffer = audio;
  src.connect(out.destination);
  src.start();
  const rendered = await out.startRendering();
  return rendered.getChannelData(0);
}

/** Slow but works for anything the browser can play: record the sound in real time. */
async function captureAudio(file, sampleRate) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url; video.playsInline = true; video.preload = 'auto';
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  try {
    await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('This video can\'t be played in this browser.')); });
    const src = ac.createMediaElementSource(video);
    const proc = ac.createScriptProcessor(4096, 1, 1);
    const mute = ac.createGain(); mute.gain.value = 0;
    const chunks = [];
    proc.onaudioprocess = (e) => { if (!video.paused) chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
    src.connect(proc); proc.connect(mute); mute.connect(ac.destination);
    if (ac.state === 'suspended') await ac.resume();
    await new Promise((resolve, reject) => {
      video.onended = resolve;
      video.onerror = () => reject(new Error('The video stopped playing.'));
      video.play().catch(reject);
    });
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const raw = new Float32Array(total);
    let o = 0; chunks.forEach((c) => { raw.set(c, o); o += c.length; });
    if (!total) throw new Error('no audio track');
    // resample to the target rate
    const ratio = ac.sampleRate / sampleRate;
    const n = Math.floor(total / ratio);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i * ratio, j = Math.floor(x), f = x - j;
      out[i] = raw[j] * (1 - f) + (raw[j + 1] ?? raw[j]) * f;
    }
    return out;
  } finally {
    video.pause(); video.removeAttribute('src'); video.load();
    URL.revokeObjectURL(url);
    ac.close();
  }
}

/** True if the samples contain something louder than silence. */
export const hasSound = (samples) => {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 97) peak = Math.max(peak, Math.abs(samples[i]));
  return peak > 0.01;
};

let worker = null;
function asrWorker() {
  if (!worker) {
    const url = new URL(`./asr-worker.js${new URL(import.meta.url).search}`, import.meta.url);
    worker = new Worker(url, { type: 'module' });
  }
  return worker;
}
function resetWorker() { worker?.terminate(); worker = null; }

/**
 * Whisper on this device, in a background worker. Gives up (instead of
 * hanging) if the model stalls while loading or takes far too long.
 */
export async function transcribeInBrowser(file, { quality = 'fast', language = null, onStatus = () => {}, samples = null, signal } = {}) {
  onStatus('Reading the audio…');
  const audio = samples || await decodeAudio(file, 16000, { onStatus: (k) => k === 'capture' && onStatus('Listening along with your video…') });
  if (!hasSound(audio)) throw Object.assign(new Error('This video has no sound we can hear.'), { code: 'silent' });
  onStatus('Loading speech model…');
  const seconds = audio.length / 16000;
  const w = asrWorker();
  const chunks = await new Promise((resolve, reject) => {
    let timer = 0;
    const fail = (msg, code = 'device') => { cleanup(); resetWorker(); reject(Object.assign(new Error(msg), { code })); };
    // no word from the model for this long means it has stalled
    const arm = (ms, msg) => { clearTimeout(timer); timer = setTimeout(() => fail(msg, 'slow'), ms); };
    const onAbort = () => fail('Stopped.', 'stopped');
    const cleanup = () => { clearTimeout(timer); w.removeEventListener('message', onMsg); w.removeEventListener('error', onErr); signal?.removeEventListener('abort', onAbort); };
    const onErr = (e) => { e.preventDefault?.(); fail(e.message || 'The voice reader could not start on this device.'); };
    const onMsg = ({ data }) => {
      if (data.type === 'progress') { onStatus(`Downloading speech model… ${data.percent}% (first time only)`); arm(90000, 'The speech model download stalled.'); }
      if (data.type === 'ready') {
        if (data.fresh) window.__speechModelLoads = (window.__speechModelLoads || 0) + 1;
        onStatus('Transcribing… (about real-time on most laptops)');
        arm(Math.max(120000, seconds * 4000), 'The voice reader is taking too long on this device.');
      }
      if (data.type === 'done') { cleanup(); window.__speechCalls = (window.__speechCalls || 0) + 1; resolve(data.chunks); }
      if (data.type === 'error') fail(data.message);
    };
    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr);
    signal?.addEventListener('abort', onAbort, { once: true });
    arm(90000, 'The voice reader did not start.');
    const copy = audio.slice();
    w.postMessage({ type: 'run', lib: `${TRANSFORMERS}/+esm`, model: MODELS[quality], samples: copy, language }, [copy.buffer]);
  });
  return tidyWords(chunks.map((c) => ({ w: c.text.trim(), s: c.timestamp[0], e: c.timestamp[1] ?? c.timestamp[0] + 0.3 })));
}

/**
 * Line each word up with the actual sound. Speech models often start a word a
 * little early (in the silence before it) or end it late; captions then feel
 * out of sync. This nudges each start to the moment the voice begins and each
 * end to when it stops, within small limits so words never swap places.
 */
export function alignWordsToAudio(words, samples, sampleRate = 16000) {
  if (!words?.length || !samples?.length) return words;
  const hop = Math.round(sampleRate * 0.01);
  const n = Math.floor(samples.length / hop);
  const env = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let e = 0;
    for (let j = k * hop; j < (k + 1) * hop; j++) e += samples[j] * samples[j];
    env[k] = Math.sqrt(e / hop);
  }
  const sorted = Float32Array.from(env).sort();
  const floor = sorted[Math.floor(n * 0.15)] || 0, peak = sorted[Math.floor(n * 0.95)] || 1;
  const thr = floor + (peak - floor) * 0.12;
  const voiced = (t) => { const k = Math.round(t * 100); return k >= 0 && k < n && env[k] > thr; };
  const out = words.map((w) => ({ ...w }));
  const pauseAfter = (from, to) => {
    // the first moment of voice after a real pause (80 ms or more) inside [from, to]
    let quiet = 0;
    for (let t = from; t < to; t += 0.01) {
      if (!voiced(t)) quiet += 0.01;
      else if (quiet >= 0.08) return t;
      else quiet = 0;
    }
    return null;
  };
  // pass 1: starts
  for (let i = 0; i < out.length; i++) {
    const w = out[i], prevStart = i ? out[i - 1].s : -Infinity;
    const limit = Math.min(w.s + 0.4, w.e - 0.05);
    if (!voiced(w.s)) {
      for (let t = w.s; t < limit; t += 0.01) if (voiced(t)) { w.s = t; break; }
    } else {
      // starts in the tail of the previous word: jump to after the pause
      const after = pauseAfter(w.s, limit);
      if (after != null) w.s = after;
      else {
        let t = w.s;
        while (t - 0.01 > Math.max(prevStart + 0.05, w.s - 0.12) && voiced(t - 0.01)) t -= 0.01;
        w.s = t;
      }
    }
    if (w.s < prevStart + 0.02) w.s = prevStart + 0.02;
  }
  // pass 2: ends, now that every start is known
  for (let i = 0; i < out.length; i++) {
    const w = out[i], next = out[i + 1]?.s ?? Infinity;
    let e = Math.min(Math.max(w.e, w.s + 0.08), next);
    if (!voiced(e - 0.01) || e === next) {
      for (let t = e - 0.01; t > w.s + 0.06; t -= 0.01) if (voiced(t)) { e = Math.min(e, t + 0.06); break; }
    }
    w.e = Math.max(w.s + 0.06, e);
    w.s = +w.s.toFixed(3); w.e = +w.e.toFixed(3);
  }
  return out;
}

function tidyWords(list) {
  const words = list.filter((w) => w.w && Number.isFinite(w.s));
  for (let i = 0; i < words.length; i++) {
    if (!Number.isFinite(words[i].e) || words[i].e <= words[i].s) words[i].e = (words[i + 1]?.s ?? words[i].s + 0.4);
  }
  return words;
}

/** 16-bit mono WAV, small enough to send (about 2 MB a minute at 16 kHz). */
export function encodeWav(samples, sampleRate = 16000) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Blob([buf], { type: 'audio/wav' });
}

/**
 * Backup when the on-device listener can't run: OpenAI's speech-to-text.
 * Only the sound is sent (never the video), and only after the creator agrees.
 */
export async function transcribeWithOpenAI(samples, key, { signal } = {}) {
  const maxSamples = 16000 * 60 * 12; // about 24 MB, under the 25 MB limit
  const parts = [];
  for (let i = 0; i < samples.length; i += maxSamples) parts.push([i / 16000, samples.subarray(i, i + maxSamples)]);
  const words = [];
  for (const [offset, part] of parts) {
    const form = new FormData();
    form.append('file', encodeWav(part), 'story.wav');
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal });
    if (!res.ok) {
      let msg = `OpenAI couldn't transcribe the audio (${res.status}).`;
      try { msg = (await res.json()).error?.message || msg; } catch { /* keep the status message */ }
      throw new Error(msg);
    }
    const data = await res.json();
    // the word list has no punctuation; borrow it from the full text so captions break naturally
    const toks = String(data.text || '').trim().split(/\s+/).filter(Boolean);
    const norm = (x) => x.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
    let k = 0;
    (data.words || []).forEach((w) => {
      let text = String(w.word || '').trim();
      for (let j = k; j < Math.min(toks.length, k + 4); j++) if (norm(toks[j]) === norm(text)) { text = toks[j]; k = j + 1; break; }
      words.push({ w: text, s: offset + w.start, e: offset + w.end });
    });
  }
  return tidyWords(words);
}

/** Find spans of speech in the audio using a simple energy gate. */
export function speechSpans(samples, sampleRate = 16000) {
  const win = Math.round(sampleRate * 0.03);
  const energies = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let e = 0;
    for (let j = i; j < i + win; j++) e += samples[j] * samples[j];
    energies.push(Math.sqrt(e / win));
  }
  const sorted = [...energies].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.15)] || 0;
  const peak = sorted[Math.floor(sorted.length * 0.95)] || 1;
  const thr = floor + (peak - floor) * 0.18;
  const spans = [];
  let start = -1, quiet = 0;
  energies.forEach((e, k) => {
    const t = (k * win) / sampleRate;
    if (e > thr) { if (start < 0) start = t; quiet = 0; }
    else if (start >= 0 && ++quiet > 8) { spans.push([start, t - quiet * 0.03]); start = -1; quiet = 0; }
  });
  if (start >= 0) spans.push([start, energies.length * 0.03]);
  return spans.filter(([a, b]) => b - a > 0.1);
}

/** Time a pasted transcript: spread words over detected speech, weighted by length. */
export function wordsFromText(text, duration, spans = null) {
  const tokens = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!tokens.length) return [];
  const sp = spans && spans.length ? spans : [[0, duration]];
  const total = sp.reduce((a, [s, e]) => a + (e - s), 0);
  const weights = tokens.map((t) => 1 + t.replace(/[^\w]/g, '').length * 0.35 + (/[.?!,]$/.test(t) ? 1.2 : 0));
  const wsum = weights.reduce((a, b) => a + b, 0);
  // map cumulative "speech time" to real time through the spans
  const toReal = (x) => {
    let acc = 0;
    for (const [s, e] of sp) { if (x <= acc + (e - s)) return s + (x - acc); acc += e - s; }
    return sp[sp.length - 1][1];
  };
  let cum = 0;
  return tokens.map((w, i) => {
    const a = (cum / wsum) * total;
    cum += weights[i];
    const b = (cum / wsum) * total;
    return { w, s: +toReal(a).toFixed(3), e: +toReal(b - 0.02).toFixed(3) };
  });
}

/**
 * Parse an SRT or WebVTT subtitle file into timed words (each cue's time is
 * spread across its words by length). Returns null if it isn't subtitles.
 */
export function wordsFromSubtitles(text) {
  if (!/-->/.test(text)) return null;
  const ts = (t) => {
    const m = t.trim().replace(',', '.').match(/(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)/);
    return m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) : NaN;
  };
  const words = [];
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((l) => l.trim());
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split('-->');
    const s = ts(a), e = ts(b.split(/\s/).filter(Boolean)[0] || '');
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
    const tokens = lines.slice(ti + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\{[^}]+\}/g, '').split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const weights = tokens.map((t) => 1 + t.length * 0.35);
    const total = weights.reduce((x, y) => x + y, 0);
    let cum = 0;
    tokens.forEach((w, i) => {
      const ws = s + ((e - s) * cum) / total;
      cum += weights[i];
      words.push({ w, s: +ws.toFixed(3), e: +(s + ((e - s) * cum) / total - 0.02).toFixed(3) });
    });
  }
  return words.length ? words : null;
}
