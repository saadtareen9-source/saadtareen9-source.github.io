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
    const out = await asr(data.samples, {
      return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5, task: 'transcribe', ...(data.language ? { language: data.language } : {}),
    });
    self.postMessage({ type: 'done', chunks: (out.chunks || []).map((c) => ({ text: c.text, timestamp: c.timestamp })) });
  } catch (e) {
    loading = null;
    self.postMessage({ type: 'error', message: String(e?.message || e) });
  }
};
