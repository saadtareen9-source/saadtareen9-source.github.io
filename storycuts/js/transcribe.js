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

export async function decodeAudio(file, sampleRate = 16000) {
  const buf = await file.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC({ sampleRate });
  try {
    const audio = await ac.decodeAudioData(buf);
    if (audio.numberOfChannels === 1) return audio.getChannelData(0);
    const a = audio.getChannelData(0), b = audio.getChannelData(1);
    const mono = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) mono[i] = (a[i] + b[i]) / 2;
    return mono;
  } finally {
    ac.close();
  }
}

export async function transcribeInBrowser(file, { quality = 'fast', language = null, onStatus = () => {} } = {}) {
  onStatus('Loading speech model…');
  const { pipeline, env } = await import(`${TRANSFORMERS}/+esm`);
  env.allowLocalModels = false;
  const progress = {};
  const progress_callback = (p) => {
    if (p.status === 'progress' && p.file) {
      progress[p.file] = [p.loaded || 0, p.total || 0];
      const [l, t] = Object.values(progress).reduce((acc, [a, b]) => [acc[0] + a, acc[1] + b], [0, 0]);
      if (t) onStatus(`Downloading speech model… ${Math.round((l / t) * 100)}% (first time only)`);
    }
  };
  let asr;
  const opts = { progress_callback, dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } };
  try {
    if (!navigator.gpu) throw new Error('no webgpu');
    asr = await pipeline('automatic-speech-recognition', MODELS[quality], { ...opts, device: 'webgpu' });
  } catch {
    asr = await pipeline('automatic-speech-recognition', MODELS[quality], { ...opts, device: 'wasm', dtype: 'q8' });
  }
  onStatus('Reading the audio…');
  const audio = await decodeAudio(file);
  onStatus('Transcribing… (about real-time on most laptops)');
  const out = await asr(audio, {
    return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5, task: 'transcribe', ...(language ? { language } : {}),
  });
  const words = (out.chunks || [])
    .map((c) => ({ w: c.text.trim(), s: c.timestamp[0], e: c.timestamp[1] ?? c.timestamp[0] + 0.3 }))
    .filter((w) => w.w);
  for (let i = 0; i < words.length; i++) {
    if (!Number.isFinite(words[i].e) || words[i].e <= words[i].s) words[i].e = (words[i + 1]?.s ?? words[i].s + 0.4);
  }
  return words;
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
