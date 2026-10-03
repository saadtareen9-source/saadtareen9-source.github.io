// AI illustration: an image model (OpenAI GPT Image by default, or Google
// Gemini "Nano Banana") draws the characters and every scene, using each character's approved design as a reference image so
// they stay consistent. Claude then inspects every image (anatomy, stray text,
// character match, does it show the right moment) and failed images are
// regenerated automatically with the problems spelled out.

import { callClaude } from './planner.js';

// Prices are rough estimates per image for the cost preview.
export const IMAGE_MODELS = [
  { id: 'gpt-image-2', provider: 'openai', quality: 'medium', label: 'OpenAI GPT Image 2: about $0.05 per image', price: 0.05 },
  { id: 'gpt-image-2@high', provider: 'openai', quality: 'high', label: 'OpenAI GPT Image 2, high quality: about $0.15 per image', price: 0.15 },
  { id: 'gemini-2.5-flash-image', provider: 'gemini', label: 'Google Nano Banana: about $0.04 per image', price: 0.039 },
  { id: 'gemini-3-pro-image-preview', provider: 'gemini', label: 'Google Nano Banana Pro: about $0.13 per image', price: 0.134 },
];

export const modelInfo = (id) => IMAGE_MODELS.find((m) => m.id === id) || IMAGE_MODELS[0];

// `tint` colours the style card. To show a real preview image, add it under
// assets/styles/ and set `thumb: 'assets/styles/<id>.jpg'` on the style.
export const STYLES = {
  stick: {
    label: 'Stick figures',
    blurb: 'Funny, simple, made for storytime',
    tint: ['#fde68a', '#fca5a5'],
    avoid: 'realistic anatomy, detailed hands and fingers, shading gradients, 3D rendering, photorealism, anime eyes',
    prompt: 'Charming hand-drawn stick-figure cartoon in the style of popular animated storytime YouTube channels: characters have round white heads with simple expressive faces, thick clean black outlines, simple colored clothing, flat pastel colors, soft simple backgrounds, bright and funny, clean composition.',
  },
  cartoon: {
    label: 'Flat cartoon',
    blurb: 'Bold, bright explainer look',
    tint: ['#93c5fd', '#c4b5fd'],
    avoid: 'photorealism, 3D rendering, sketchy or unfinished lines, muddy colours, anime style',
    prompt: 'Modern flat 2D cartoon illustration, bold clean outlines, rounded friendly character designs with big expressive faces, vibrant flat colors with subtle shading, simple uncluttered backgrounds, like a high-quality animated explainer video.',
  },
  anime: {
    label: 'Anime',
    blurb: 'Expressive, cinematic, cel-shaded',
    tint: ['#f9a8d4', '#a5b4fc'],
    avoid: '3D rendering, photorealism, western cartoon proportions, chibi unless asked, blurry or muddy line art',
    prompt: 'Clean modern anime illustration, crisp line art, cel shading, expressive faces and reactions, vivid colors, cinematic anime background art, high quality key-visual look.',
  },
  '3d': {
    label: '3D animated',
    blurb: 'Feature-film 3D characters',
    tint: ['#67e8f9', '#86efac'],
    avoid: '2D flat illustration, line art outlines, photorealism, uncanny realistic skin, plastic toy look',
    prompt: 'Stylized 3D animated movie still: appealing rounded characters with big expressive eyes, soft global illumination, subsurface skin shading, rich colors, shallow depth of field, like a frame from a modern family animated feature.',
  },
  realistic: {
    label: 'Realistic',
    blurb: 'Cinematic, photo-real scenes',
    tint: ['#cbd5e1', '#fcd34d'],
    avoid: 'cartoon or illustrated look, plastic skin, over-smoothed faces, extra fingers, distorted hands, uncanny eyes, over-saturated HDR',
    prompt: 'Cinematic photorealistic film still, natural lighting, realistic people and places, 35mm lens, shallow depth of field, subtle film grain, emotionally expressive faces.',
  },
  comic: {
    label: 'Comic book',
    blurb: 'Inked lines, punchy colour',
    tint: ['#fdba74', '#f87171'],
    avoid: 'photorealism, 3D rendering, soft airbrushed shading, muddy colours',
    prompt: 'Punchy comic-book illustration, dynamic inked line art, halftone shading, saturated colors, exaggerated funny expressions, cinematic framing.',
  },
  clay: {
    label: 'Claymation',
    blurb: 'Handmade stop-motion charm',
    tint: ['#fcd34d', '#fb923c'],
    avoid: '2D illustration, photorealism, smooth CGI plastic, line art',
    prompt: 'Claymation stop-motion scene: handmade plasticine characters with visible fingerprints and texture, miniature handcrafted sets, soft studio lighting, charming and slightly goofy.',
  },
  sketch: {
    label: 'Sketch',
    blurb: 'Hand-drawn pencil and ink',
    tint: ['#e5e7eb', '#a8a29e'],
    avoid: 'photorealism, 3D rendering, flat vector colour fills, heavy saturated colour',
    prompt: 'Expressive hand-drawn sketch illustration: confident pencil and ink linework with loose cross-hatching, light watercolour wash accents on off-white paper, characterful exaggerated poses, like a talented storyboard artist\'s finished frame.',
  },
  storybook: {
    label: 'Storybook',
    blurb: 'Soft watercolour warmth',
    tint: ['#bbf7d0', '#fde68a'],
    avoid: 'photorealism, 3D rendering, harsh neon colours, hard digital vector look',
    prompt: 'Warm children\'s storybook illustration, soft gouache and watercolor textures, gentle colors, cute rounded characters, cozy detailed backgrounds.',
  },
};

/** The full style instruction for a project, including custom styles and extra details. */
export function styleSpec(settings = {}) {
  const custom = settings.style === 'custom';
  const base = custom
    ? { label: 'Custom', prompt: (settings.customStyle || '').trim() || 'Clean, polished, professional illustration.', avoid: '' }
    : STYLES[settings.style] || STYLES.stick;
  const extra = (settings.styleNotes || '').trim();
  const text = `ART STYLE (follow exactly; it must look identical in every image of the series): ${base.prompt}`
    + `${extra ? ` Extra style direction from the creator (takes priority where it differs): ${extra}.` : ''}`
    + `${settings.styleRef?.key || (!custom && base.anchor) ? ' Match the attached style reference image\'s art style, colour palette, line quality, lighting and rendering exactly (not its content or characters).' : ''}`
    + ' Keep the same palette, line weight, lighting and level of detail across the whole series. Polished, professional, finished artwork with a clean readable composition; nothing sloppy, smudged, half-rendered or distorted.'
    + ` ${HANDS}`
    + `${base.avoid ? ` Avoid: ${base.avoid}.` : ''}`;
  return { label: base.label, text };
}

// ---------- baseline style anchors ----------
// Each built-in style can have one official reference image in assets/styles/
// (listed in assets/styles/manifest.json). It is attached to every generation
// for that style, so "Realistic" looks the same for every user, every time.

export const HANDS = 'HANDS: every hand must have correct anatomy with exactly five fingers (or a clean four-finger cartoon hand if the style is very simple), never extra, fused or missing fingers. Prefer poses where hands are relaxed, holding something or partly out of frame rather than spread open toward the viewer.';

export const STYLE_SUBJECT = 'Two friends, a young woman with curly dark hair in a mustard sweater and a tall man with short brown hair and glasses in a blue shirt, laughing together at a kitchen table, each holding a coffee mug with both hands; window light, a potted plant and shelves behind them. Medium-wide shot, faces clearly visible.';

let manifestPromise = null;
export function loadStyleManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(new URL('../assets/styles/manifest.json', import.meta.url), { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then((m) => {
        for (const [id, file] of Object.entries(m.anchors || {})) {
          if (STYLES[id]) {
            STYLES[id].anchor = new URL(`../assets/styles/${file}`, import.meta.url).href;
            STYLES[id].thumb = STYLES[id].thumb || STYLES[id].anchor;
          }
        }
        return m;
      });
  }
  return manifestPromise;
}

const anchorCache = new Map();
async function anchorInline(url) {
  if (!anchorCache.has(url)) {
    anchorCache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error('missing'); return r.blob(); }).then((b) => toInline(b, 768)).catch(() => null));
  }
  return anchorCache.get(url);
}

/** The style reference to attach: the user's own example image, else the style's official anchor. */
async function styleRefPart(settings) {
  if (settings?.styleRef?.key) {
    const blob = await getBlob(settings.styleRef.key);
    if (blob) return toInline(blob, 768);
  }
  if (settings?.style !== 'custom') {
    await loadStyleManifest();
    const anchor = (STYLES[settings?.style] || STYLES.stick).anchor;
    if (anchor) return anchorInline(anchor);
  }
  return null;
}

const NO_TEXT = 'Absolutely no text, letters, numbers, captions, speech bubbles, signs with writing, logos or watermarks anywhere in the image.';

// ---------- blob storage (IndexedDB; images are too big for localStorage) ----------

let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('storycuts', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('images');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

// Images that couldn't be written to disk are kept for this session only.
const memBlobs = new Map();
export let storageProblem = null;

export async function putBlob(key, blob) {
  memBlobs.set(key, blob);
  try {
    // Stored as raw bytes: some browsers fail to save Blob objects in IndexedDB.
    const record = { type: blob.type, buf: await blob.arrayBuffer() };
    const d = await db();
    await new Promise((resolve, reject) => {
      const tx = d.transaction('images', 'readwrite');
      tx.objectStore('images').put(record, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Saving was cancelled'));
    });
    memBlobs.delete(key);
  } catch (e) {
    console.warn('StoryCuts: could not save image to browser storage, keeping it for this session only', e);
    storageProblem = e;
  }
}

export async function getBlob(key) {
  if (memBlobs.has(key)) return memBlobs.get(key);
  try {
    const d = await db();
    const rec = await new Promise((resolve, reject) => {
      const req = d.transaction('images').objectStore('images').get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    if (!rec) return null;
    return rec instanceof Blob ? rec : new Blob([rec.buf], { type: rec.type || 'image/png' });
  } catch {
    return null;
  }
}

const bitmaps = new Map();
/** Decoded image for drawing, cached in memory. Returns null until loaded. */
export function bitmapFor(key, onReady) {
  if (!key) return null;
  const hit = bitmaps.get(key);
  if (hit instanceof Promise || hit === undefined) {
    if (hit === undefined) {
      const p = getBlob(key)
        .then((b) => (b ? createImageBitmap(b) : null))
        .then((bmp) => { bitmaps.set(key, bmp); if (bmp && onReady) onReady(); return bmp; })
        .catch(() => { bitmaps.set(key, null); return null; });
      bitmaps.set(key, p);
    }
    return null;
  }
  return hit;
}

export async function preloadBitmap(key) {
  const b = await getBlob(key);
  if (!b) return null;
  const bmp = await createImageBitmap(b);
  bitmaps.set(key, bmp);
  return bmp;
}

// ---------- helpers ----------

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Downscale to keep requests small (and cheap for Claude's vision check). */
async function toInline(blobOrCanvas, max = 1024, type = 'image/jpeg') {
  const src = blobOrCanvas instanceof Blob ? await createImageBitmap(blobOrCanvas) : blobOrCanvas;
  const w = src.width, h = src.height;
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, type, 0.9));
  return { mime: type, data: await blobToBase64(blob) };
}

function b64ToBlob(b64, mime) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime || 'image/png' });
}

// ---------- Gemini ----------

async function gemini(apiKey, model, parts, aspectRatio) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio } },
  };
  let res;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    });
    if (res.status !== 429 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || `HTTP ${res.status}`;
    if (res.status === 400 && /API key/i.test(msg)) throw new Error('Your Gemini API key was rejected. Check it in Settings.');
    throw new Error(`Image model error: ${msg}`);
  }
  if (json.promptFeedback?.blockReason) throw new Error(`The image request was blocked (${json.promptFeedback.blockReason}). Try rewording the scene.`);
  const out = (json.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData || p.inline_data);
  if (!out) {
    const reason = json.candidates?.[0]?.finishReason;
    throw new Error(`No image came back${reason ? ` (${reason})` : ''}. Try again or reword the scene.`);
  }
  const d = out.inlineData || out.inline_data;
  return b64ToBlob(d.data, d.mimeType || d.mime_type);
}

// ---------- OpenAI ----------

const OPENAI_SIZES = { '9:16': '1024x1536', '16:9': '1536x1024', '1:1': '1024x1024' };

/** Gemini-style parts -> one prompt plus numbered input images. */
function partsToPrompt(parts) {
  const texts = [];
  const images = [];
  for (const p of parts) {
    if (p.text) texts.push(p.text);
    const d = p.inlineData;
    if (d) {
      images.push(b64ToBlob(d.data, d.mimeType));
      const n = images.length;
      if (texts.length && /:\s*$/.test(texts[texts.length - 1])) texts[texts.length - 1] = texts[texts.length - 1].replace(/:\s*$/, ` = input image ${n}.`);
      else texts.push(`(Attached photo = input image ${n}.)`);
    }
  }
  return { prompt: texts.join('\n'), images };
}

async function openaiImage(apiKey, modelId, parts, aspectRatio) {
  const info = modelInfo(modelId);
  const model = modelId.split('@')[0];
  const { prompt, images } = partsToPrompt(parts);
  const size = OPENAI_SIZES[aspectRatio] || 'auto';
  let res;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (images.length) {
      // reference images go to the edits endpoint as multipart form data
      const form = new FormData();
      form.append('model', model);
      form.append('prompt', prompt);
      form.append('size', size);
      form.append('quality', info.quality || 'medium');
      images.forEach((b, i) => form.append('image[]', b, `ref${i + 1}.${b.type.includes('png') ? 'png' : 'jpg'}`));
      res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { authorization: `Bearer ${apiKey}` }, body: form });
    } else {
      res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, prompt, size, quality: info.quality || 'medium', n: 1 }),
      });
    }
    if (res.status !== 429 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || `HTTP ${res.status}`;
    if (res.status === 401) throw new Error('Your OpenAI API key was rejected. Check it in Settings.');
    if (/billing|quota|insufficient/i.test(msg)) throw new Error(`OpenAI says: ${msg} (add credit at platform.openai.com → Billing).`);
    if (/verif/i.test(msg)) throw new Error(`OpenAI says: ${msg} (image models may require verifying your organization at platform.openai.com → Settings → Organization).`);
    if (/safety|moderation/i.test(msg)) throw new Error('OpenAI\'s safety filter blocked this image. Try rewording the scene.');
    throw new Error(`Image model error: ${msg}`);
  }
  const item = json.data?.[0];
  if (item?.b64_json) return b64ToBlob(item.b64_json, 'image/png');
  if (item?.url) return (await fetch(item.url)).blob();
  throw new Error('No image came back. Try again or reword the scene.');
}

export async function drawImage(keys, modelId, parts, aspect) {
  const info = modelInfo(modelId);
  try {
    return info.provider === 'gemini'
      ? await gemini(keys.gemini, modelId, parts, aspect)
      : await openaiImage(keys.openai, modelId, parts, aspect);
  } catch (e) {
    if (e instanceof TypeError && /fetch|load|network/i.test(e.message)) {
      throw new Error(`Couldn't reach ${info.provider === 'gemini' ? 'Google' : 'OpenAI'} (${e.message}). Check your internet connection, or try turning off ad blockers for this site.`);
    }
    throw e;
  }
}

// ---------- prompts ----------

export function characterBrief(ch) {
  const bits = [ch.description, ch.hair && ch.hair !== 'none' ? `${ch.hair} hair` : '', ch.accessory && ch.accessory !== 'none' ? `wears ${ch.accessory}` : ''];
  return `${ch.name}: ${bits.filter(Boolean).join('; ')}${ch.height < 0.9 ? '; small/short' : ch.height > 1.1 ? '; tall' : ''}. Signature clothing colour ${ch.color}.`;
}

function describeScene(scene, characters) {
  if (scene.image_prompt) return scene.image_prompt;
  const name = (id) => characters.find((c) => c.id === id)?.name || id;
  const who = scene.actors.map((a) => `${name(a.character_id)} (${a.pose.replace(/_/g, ' ')}, ${a.expression} expression)`).join(' and ');
  const props = scene.props.map((p) => p.kind).join(', ');
  return `${who} in a ${scene.setting.replace(/_/g, ' ')}${props ? `, with ${props}` : ''}${scene.effects.length ? `; ${scene.effects.join(', ').replace(/_/g, ' ')}` : ''}.`;
}

export function sceneBrief(project, seg) {
  return describeScene(seg.scene, project.characters);
}

// ---------- quality check (Claude vision) ----------

const QC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pass', 'score', 'issues', 'fix_instructions'],
  properties: {
    pass: { type: 'boolean' },
    score: { type: 'integer', description: '1-10 overall quality and faithfulness' },
    issues: { type: 'array', items: { type: 'string' } },
    fix_instructions: { type: 'string', description: 'Concrete changes for the illustrator to fix the issues; empty if pass' },
  },
};

const QC_SYSTEM = `You are the art director checking AI illustrations for a storytime video before they go out. Be strict about real defects, relaxed about stylisation (it's a cartoon).
Fail the image if any of these are true:
- malformed anatomy: extra or missing limbs, fused or broken hands, warped faces, merged bodies
- wrong finger count: look closely at EVERY visible hand, one at a time, and count the fingers including the thumb. More than five, fewer than four, or fingers that merge or branch is an automatic fail with score 4 or lower, however good the rest is. (A clean four-finger cartoon hand is fine in very simple cartoon styles.)
- any visible text, letters, numbers, captions, speech bubbles, logos or watermarks
- a character doesn't match their reference image (hair, clothing colour, accessories, proportions)
- the wrong cast: a main character missing, or unexplained extra people in focus
- the image doesn't show the moment described in the brief, or the emotion is wrong
- the art style differs from the style described in the brief or from the reference images (palette, line work, rendering, level of detail)
- it looks sloppy: smudged or melted details, unfinished areas, muddy colours, warped perspective, garbled background objects
- a location reference is given and the place looks clearly different (layout, colours, key furniture)
Score 1-10: 9-10 publishable, 7-8 good with minor flaws, 6 or below needs a redraw. Keep issues short and concrete.`;

export async function checkImage(claudeKey, model, blob, brief, refs) {
  const content = [{ type: 'text', text: `Brief for this illustration:\n${brief}` }];
  for (const r of refs) {
    content.push({ type: 'text', text: `Reference for ${r.name}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: r.inline.mime, data: r.inline.data } });
  }
  const img = await toInline(blob, 1280, 'image/png');
  content.push({ type: 'text', text: 'Image to check:' });
  content.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.data } });
  const { data } = await callClaude(claudeKey, {
    model, system: QC_SYSTEM, user: content, schema: QC_SCHEMA, effort: 'low', maxTokens: 4000,
  });
  return data;
}

// ---------- generation ----------

async function refFor(ch) {
  if (!ch.image?.key) return null;
  const blob = await getBlob(ch.image.key);
  return blob ? { name: ch.name, inline: await toInline(blob, 768) } : null;
}

async function generateChecked({ keys, opts, buildParts, brief, refs, aspect, onStatus, store }) {
  const maxTries = keys.claude && opts.qc !== false ? 3 : 1;
  let best = null;
  let hints = '';
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    onStatus?.(attempt === 1 ? 'Drawing…' : `Redrawing (attempt ${attempt}): ${hints.slice(0, 80)}`);
    let blob;
    try {
      blob = await drawImage(keys, opts.imageModel, buildParts(hints), aspect);
    } catch (e) {
      if (best) break; // keep the earlier attempt rather than failing outright
      throw e;
    }
    let qc = null;
    if (maxTries > 1) {
      onStatus?.('Checking the image…');
      try {
        qc = await checkImage(keys.claude, opts.claudeModel, blob, brief, refs);
      } catch (e) {
        qc = { pass: true, score: 0, issues: [`Quality check unavailable: ${e.message}`], fix_instructions: '' };
      }
    }
    if (qc && qc.score > 0 && qc.score < 7) qc.pass = false;
    const score = qc ? qc.score : 0;
    if (!best || score > best.score) best = { blob, qc, score, attempts: attempt };
    best.attempts = attempt;
    if (!qc || qc.pass) break;
    hints = `${qc.fix_instructions} Avoid: ${qc.issues.join('; ')}`;
  }
  const key = `${store}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await putBlob(key, best.blob);
  try {
    await preloadBitmap(key);
  } catch (e) {
    throw new Error(`The image came back but your browser couldn't open it (${e.name}: ${e.message}).`);
  }
  return { key, aspect, qc: best.qc, attempts: best.attempts, at: Date.now() };
}

/**
 * Character design sheet. For "Me", a frame from the creator's own video can
 * be passed so the cartoon resembles them.
 */
export async function generateCharacterImage(project, ch, { keys, opts, projectKey, selfFrame, onStatus }) {
  await loadStyleManifest();
  const style = styleSpec(project.settings);
  const brief = `Character design for ${characterBrief(ch)} One character only, full body, standing, friendly neutral pose, facing slightly to the side, centered on a plain light background. This image is the master reference for this character in every future scene, so make the design clear, appealing and distinctive.`;
  const selfRef = ch.id === 'me' && selfFrame ? await toInline(selfFrame, 768) : null;
  const styleRef = await styleRefPart(project.settings);
  const buildParts = (hints) => {
    const parts = [{ text: `${style.text}\n\n${brief}${selfRef ? '\nBase this character on the person in the attached photo: keep their hairstyle, hair colour, skin tone, glasses/facial hair and clothing colours, translated into the art style.' : ''}\n${NO_TEXT}${hints ? `\nFix these problems from a previous attempt: ${hints}` : ''}` }];
    if (selfRef) { parts.push({ text: 'Photo of the person:' }); parts.push({ inlineData: { mimeType: selfRef.mime, data: selfRef.data } }); }
    if (styleRef) { parts.push({ text: 'Style reference image (copy the art style only):' }); parts.push({ inlineData: { mimeType: styleRef.mime, data: styleRef.data } }); }
    return parts;
  };
  const qcRefs = styleRef ? [{ name: 'the art style (style reference)', inline: styleRef }] : [];
  return generateChecked({
    keys, opts, buildParts, brief: `${style.text}\n${brief}`, refs: qcRefs, aspect: '1:1', onStatus, store: `${projectKey}/char/${ch.id}`,
  });
}

/**
 * Everyone who appears in a scene: its listed actors plus any character named
 * in the scene description, so nobody is drawn without their reference image.
 */
export function sceneCast(project, seg, note = '') {
  const text = `${seg.scene?.image_prompt || ''} ${note}`;
  const named = project.characters.filter((c) => {
    const n = (c.name || '').trim();
    if (!n) return false;
    const re = new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}('s)?\\b`, 'i');
    return re.test(text);
  }).map((c) => c.id);
  const ids = [...new Set([...(seg.scene?.actors || []).map((a) => a.character_id), ...named])];
  return ids.map((id) => project.characters.find((c) => c.id === id)).filter(Boolean);
}

/** The best already-drawn image of the same location, to keep places consistent. */
function locationAnchor(project, seg) {
  const loc = seg.scene?.location_id;
  if (!loc) return null;
  return project.segments.find((o) => o !== seg && o.scene?.location_id === loc && o.image?.key && !o.image.stale && o.image.qc?.pass !== false) || null;
}

export async function generateSceneImage(project, seg, { keys, opts, projectKey, aspect, note = '', onStatus }) {
  await loadStyleManifest();
  const style = styleSpec(project.settings);
  const cast = sceneCast(project, seg, note);
  const refs = (await Promise.all(cast.slice(0, 5).map(refFor))).filter(Boolean);
  const loc = (project.locations || []).find((l) => l.id === seg.scene.location_id);
  const anchor = locationAnchor(project, seg);
  const anchorBlob = anchor ? await getBlob(anchor.image.key) : null;
  const locRef = anchorBlob ? { name: `the location "${loc?.name || 'this place'}" (location reference)`, inline: await toInline(anchorBlob, 768) } : null;
  const styleRef = await styleRefPart(project.settings);
  const bubbleNote = seg.type === 'scene_bubble' && project.settings.faceMode === 'bubble'
    ? `Keep the ${project.settings.bubbleSide === 'left' ? 'top-left' : 'top-right'} corner free of important detail (a face overlay goes there).` : '';
  const brief = `${sceneBrief(project, seg)}${loc ? ` Location: ${loc.name}: ${loc.description}` : ''}${note ? ` Creator's request: ${note}` : ''}${cast.length ? ` Characters who must appear and match their reference images exactly: ${cast.map((c) => c.name).join(', ')}.` : ''}`;
  const buildParts = (hints) => {
    const parts = [{
      text: `${style.text}\n\nScene: ${brief}\n\nCharacters in this scene: ${cast.map(characterBrief).join(' ')}\n`
        + `${refs.length ? 'Each character must match their reference image exactly: same face, hair, body shape, clothing colours and accessories, and the same art style. ' : ''}`
        + `${locRef ? 'The location reference shows this same place in an earlier shot: keep its layout, colours, furniture and lighting consistent (a new camera angle is fine; do not copy the characters or composition). ' : ''}`
        + `\nFrame it as a single clear moment that reads instantly on a phone screen; main characters large in frame with clear, exaggerated expressions. ${bubbleNote}\n${NO_TEXT}${hints ? `\nFix these problems from a previous attempt: ${hints}` : ''}`,
    }];
    for (const r of refs) {
      parts.push({ text: `Reference image for ${r.name}:` });
      parts.push({ inlineData: { mimeType: r.inline.mime, data: r.inline.data } });
    }
    if (locRef) { parts.push({ text: 'Location reference image:' }); parts.push({ inlineData: { mimeType: locRef.inline.mime, data: locRef.inline.data } }); }
    if (styleRef) { parts.push({ text: 'Style reference image (copy the art style only):' }); parts.push({ inlineData: { mimeType: styleRef.mime, data: styleRef.data } }); }
    return parts;
  };
  const qcRefs = [...refs, ...(locRef ? [locRef] : []), ...(styleRef ? [{ name: 'the art style (style reference)', inline: styleRef }] : [])];
  return generateChecked({
    keys, opts, buildParts, brief: `${style.text}\nScene: ${brief}`, refs: qcRefs, aspect, onStatus, store: `${projectKey}/scene/${seg.id}`,
  });
}

/** Order scenes so the first shot of each location is drawn before the rest reuse it. */
export function orderForConsistency(project, list) {
  const anchors = [];
  const seen = new Set();
  for (const sg of list) {
    const loc = sg.scene?.location_id;
    if (!loc || seen.has(loc)) continue;
    seen.add(loc);
    if (!locationAnchor(project, sg) || list.includes(locationAnchor(project, sg))) anchors.push(sg);
  }
  return [anchors, list.filter((sg) => !anchors.includes(sg))];
}

export function estimateImageCost(nImages, opts, withQC) {
  const m = modelInfo(opts.imageModel);
  const retries = withQC ? 1.3 : 1; // expect ~30% regenerations
  const qc = withQC ? 0.02 * retries : 0;
  return nImages * (m.price * retries + qc);
}

/** Run async jobs with limited concurrency. */
export async function pool(items, n, fn) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try { results[k] = { ok: true, value: await fn(items[k], k) }; } catch (e) { results[k] = { ok: false, error: e }; }
    }
  });
  await Promise.all(workers);
  return results;
}
