// The voice reader runs here, off the main page, so the screen never freezes
// while Whisper works. It loads once and is reused for every video.

let asr = null;
let loading = null;

async function load({ lib, model }) {
  const { pipeline, env } = await import(lib);
  env.allowLocalModels = false;
  const progress = {};
  const progress_callback = (p) => {
    if (p.status === 'progress' && p.file) {
      progress[p.file] = [p.loaded || 0, p.total || 0];
      const [l, t] = Object.values(progress).reduce((acc, [a, b]) => [acc[0] + a, acc[1] + b], [0, 0]);
      if (t) self.postMessage({ type: 'progress', percent: Math.round((l / t) * 100) });
    }
  };
  const opts = { progress_callback, dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } };
  try {
    if (!self.navigator?.gpu) throw new Error('no webgpu');
    return await pipeline('automatic-speech-recognition', model, { ...opts, device: 'webgpu' });
  } catch {
    return pipeline('automatic-speech-recognition', model, { ...opts, device: 'wasm', dtype: 'q8' });
  }
}

self.onmessage = async ({ data }) => {
  if (data.type !== 'run') return;
  try {
    if (!asr) {
      loading ||= load(data);
      asr = await loading;
      self.postMessage({ type: 'ready', fresh: true });
    } else self.postMessage({ type: 'ready', fresh: false });
    // Each piece is under 30 s and starts at a pause, so word times stay exact
    // (letting the model stitch long audio itself makes timings drift).
    const chunks = [];
    for (let i = 0; i < data.pieces.length; i++) {
      const [offset, samples] = data.pieces[i];
      self.postMessage({ type: 'piece', index: i, total: data.pieces.length });
      const out = await asr(samples, { return_timestamps: 'word', task: 'transcribe', ...(data.language ? { language: data.language } : {}) });
      (out.chunks || []).forEach((c) => chunks.push({ text: c.text, timestamp: [c.timestamp[0] + offset, (c.timestamp[1] ?? c.timestamp[0] + 0.3) + offset] }));
    }
    self.postMessage({ type: 'done', chunks });
  } catch (e) {
    loading = null;
    self.postMessage({ type: 'error', message: String(e?.message || e) });
  }
};
