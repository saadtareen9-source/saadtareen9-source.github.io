// Auto framing: find the speaker's face through the video, on this device,
// so every format (vertical, horizontal, face bubble) keeps them in frame.
// Nothing is uploaded: frames are read from the local video and only the
// face positions are kept.

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = new URL('../assets/models/blaze_face_short_range.tflite', import.meta.url).href; // Apache 2.0, Google MediaPipe

let detectorPromise = null;
async function makeDetector() {
  try {
    const { FaceDetector, FilesetResolver } = await import(`${MP}/vision_bundle.mjs`);
    const files = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
    const create = (delegate) => FaceDetector.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'IMAGE', minDetectionConfidence: 0.45 });
    let det;
    try { det = await create('GPU'); } catch { det = await create('CPU'); }
    return { detect: async (canvas) => det.detect(canvas).detections.map((d) => ({ x: d.boundingBox.originX, y: d.boundingBox.originY, width: d.boundingBox.width, height: d.boundingBox.height })) };
  } catch (e) {
    // the browser's own detector, where it exists
    if (!('FaceDetector' in window)) throw e;
    const native = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 3 });
    return { detect: async (canvas) => (await native.detect(canvas)).map((f) => f.boundingBox) };
  }
}
const detector = () => (detectorPromise ||= makeDetector().catch((e) => { detectorPromise = null; throw e; }));

const seek = (v, t) => new Promise((resolve) => {
  const done = () => { v.removeEventListener('seeked', done); resolve(); };
  v.addEventListener('seeked', done);
  v.currentTime = t;
  setTimeout(done, 1500);
});

/**
 * Scan the video and return a smooth face track:
 * { v: 1, step, pts: [[t, x, y, size], ...] } with x, y the face centre and
 * size the face height, all as fractions of the frame. Null if no face found.
 */
export async function trackFaces(url, duration, { onProgress = () => {}, signal } = {}) {
  const det = await detector();
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto'; video.src = url;
  await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = () => reject(new Error('video')); });
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const W = 360, H = Math.round((W * vh) / vw);
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const step = Math.min(1.5, Math.max(0.4, duration / 180));
  const raw = [];
  try {
    for (let t = Math.min(0.1, duration / 2); t < duration; t += step) {
      if (signal?.aborted) return null;
      await seek(video, t);
      ctx.drawImage(video, 0, 0, W, H);
      let faces = [];
      try { faces = await det.detect(canvas); } catch { faces = []; }
      // the speaker is usually the biggest face, so follow that one
      const best = faces.sort((a, b) => b.width * b.height - a.width * a.height)[0];
      raw.push(best ? [t, (best.x + best.width / 2) / W, (best.y + best.height / 2) / H, best.height / H] : [t, null, null, null]);
      onProgress(t / duration);
      // let the page breathe between frames
      if (raw.length % 8 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    video.removeAttribute('src'); video.load();
  }
  const found = raw.filter((p) => p[1] != null).length;
  if (found < Math.max(2, raw.length * 0.15)) return null;
  return { v: 1, step, pts: smooth(fill(raw), step) };
}

// Gaps (a turned head, a hand in front) keep the last good position.
function fill(raw) {
  const firstGood = raw.find((p) => p[1] != null);
  let last = firstGood;
  return raw.map((p) => { if (p[1] != null) { last = p; return p; } return [p[0], last[1], last[2], last[3]]; });
}

// A calm virtual camera: ignore jitter, then glide (about a 2 second window).
function smooth(pts, step) {
  const r = Math.max(1, Math.round(1 / step));
  const avg = pts.map((p, i) => {
    let sx = 0, sy = 0, ss = 0, sw = 0;
    for (let k = -r; k <= r; k++) {
      const q = pts[Math.min(pts.length - 1, Math.max(0, i + k))];
      const w = 1 - Math.abs(k) / (r + 1);
      sx += q[1] * w; sy += q[2] * w; ss += q[3] * w; sw += w;
    }
    return [p[0], sx / sw, sy / sw, ss / sw];
  });
  // dead zone: small drifts don't move the camera at all
  let cx = avg[0][1], cy = avg[0][2];
  return avg.map(([t, x, y, s]) => {
    if (Math.abs(x - cx) > 0.04) cx += (x - cx) * 0.6;
    if (Math.abs(y - cy) > 0.04) cy += (y - cy) * 0.6;
    return [+t.toFixed(2), +cx.toFixed(3), +cy.toFixed(3), +s.toFixed(3)];
  });
}

/** The face position at time t (linear between samples), or null. */
export function faceAt(track, t) {
  const pts = track?.pts;
  if (!pts?.length) return null;
  if (t <= pts[0][0]) return { x: pts[0][1], y: pts[0][2], s: pts[0][3] };
  const last = pts[pts.length - 1];
  if (t >= last[0]) return { x: last[1], y: last[2], s: last[3] };
  const i = Math.min(pts.length - 2, Math.max(0, Math.floor((t - pts[0][0]) / track.step)));
  let a = pts[i], b = pts[i + 1];
  if (t < a[0] || t > b[0]) { const j = pts.findIndex((p) => p[0] > t); a = pts[j - 1]; b = pts[j]; }
  const k = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
  return { x: a[1] + (b[1] - a[1]) * k, y: a[2] + (b[2] - a[2]) * k, s: a[3] + (b[3] - a[3]) * k };
}
