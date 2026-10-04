// Quality control: validates and auto-fixes an edit plan before anything is
// rendered. This is StoryCuts' equivalent of "check every image for broken
// hands and characters that don't match": because scenes are structured data,
// every check is deterministic and every fix is free.

import {
  SEGMENT_TYPES, SETTINGS, POSES, EXPRESSIONS, HAIR, ACCESSORIES, PROPS, EFFECTS, FACINGS, COLORS,
} from './constants.js';

const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);
const clamp = (v, a, b) => Math.min(b, Math.max(a, Number.isFinite(+v) ? +v : (a + b) / 2));
let idCounter = 0;
export const newId = () => `s${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'char';
}

export function normalizeCharacters(chars, report = []) {
  const out = [];
  const seen = new Set();
  (chars || []).slice(0, 8).forEach((c, i) => {
    let id = slug(c.id || c.name);
    while (seen.has(id)) id += '_';
    seen.add(id);
    const color = /^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : COLORS[i % COLORS.length];
    out.push({
      id,
      name: String(c.name || id).slice(0, 24),
      description: String(c.description || '').slice(0, 140),
      color,
      hair: pick(c.hair, HAIR, 'short'),
      hairColor: /^#[0-9a-f]{6}$/i.test(c.hairColor || '') ? c.hairColor : '#2b2b2b',
      accessory: pick(c.accessory, ACCESSORIES, 'none'),
      height: clamp(c.height ?? 1, 0.75, 1.25),
      ...(c.image ? { image: c.image } : {}),
      ...(c.useVideoLook != null ? { useVideoLook: !!c.useVideoLook } : {}),
    });
  });
  if (!out.some((c) => c.id === 'me')) {
    out.unshift({ id: 'me', name: 'Me', description: 'The storyteller', color: '#2e86de', hair: 'spiky', hairColor: '#2b2b2b', accessory: 'none', height: 1 });
    report.push({ seg: null, check: 'narrator', fix: 'Added a stick-figure version of you ("Me").' });
  }
  // Two characters with an identical look are confusing: nudge the colour.
  const looks = new Map();
  out.forEach((c, i) => {
    const key = `${c.color}|${c.hair}|${c.accessory}`;
    if (looks.has(key)) {
      c.color = COLORS[(COLORS.indexOf(c.color) + 3 + i) % COLORS.length];
      report.push({ seg: null, check: 'distinct-characters', fix: `${c.name} looked identical to ${looks.get(key)}; changed shirt colour.` });
    }
    looks.set(`${c.color}|${c.hair}|${c.accessory}`, c.name);
  });
  return out;
}

export function normalizeScene(scene, characters, report = [], segIndex = null) {
  const s = scene || {};
  const ids = characters.map((c) => c.id);
  const note = (check, fix) => report.push({ seg: segIndex, check, fix });

  const setting = pick(s.setting, SETTINGS, 'blank');
  if (s.setting && setting !== s.setting) note('setting', `Unknown setting "${s.setting}" replaced with a plain background.`);

  let actors = (s.actors || []).slice(0, 4).map((a) => {
    let cid = a.character_id;
    if (!ids.includes(cid)) {
      const guess = ids.find((id) => slug(cid).includes(id) || id.includes(slug(cid)));
      note('character-match', `Actor "${cid}" isn't an approved character; used ${guess || ids[0]}.`);
      cid = guess || ids[0];
    }
    let speech = String(a.speech || '').trim();
    if (speech.length > 60) {
      speech = speech.slice(0, 57).replace(/\s+\S*$/, '') + '…';
      note('speech-length', 'Shortened a speech bubble so it stays readable.');
    }
    return {
      character_id: cid,
      x: clamp(a.x ?? 0.5, 0.1, 0.9),
      pose: pick(a.pose, POSES, 'stand'),
      expression: pick(a.expression, EXPRESSIONS, 'neutral'),
      facing: pick(a.facing, FACINGS, 'right'),
      speech,
    };
  });
  // duplicates of the same character in one shot
  const seenC = new Set();
  const before = actors.length;
  actors = actors.filter((a) => (seenC.has(a.character_id) ? false : seenC.add(a.character_id)));
  if (actors.length < before) note('duplicate-character', 'Removed a duplicate of the same character in one scene.');
  if (!actors.length) {
    actors = [{ character_id: ids[0], x: 0.5, pose: 'stand', expression: 'neutral', facing: 'right', speech: '' }];
    note('empty-scene', 'Scene had nobody in it; added the narrator.');
  }
  // spacing: keep figures from overlapping
  // (sorted copy: the first actor stays the focus for effects like "!" or sweat)
  const order = [...actors].sort((a, b) => a.x - b.x);
  const minGap = order.length > 3 ? 0.2 : 0.26;
  let spaced = false;
  for (let i = 1; i < order.length; i++) {
    if (order[i].x - order[i - 1].x < minGap) { order[i].x = order[i - 1].x + minGap; spaced = true; }
  }
  const overflow = order[order.length - 1].x - 0.9;
  if (overflow > 0) {
    order.forEach((a) => { a.x -= overflow; });
    if (order[0].x < 0.1) {
      const n = order.length;
      order.forEach((a, i) => { a.x = n === 1 ? 0.5 : 0.15 + (0.7 * i) / (n - 1); });
    }
  }
  if (spaced) note('overlap', 'Spread out overlapping characters.');
  // two people talking should face each other unless told otherwise
  if (order.length === 2 && order[0].facing === 'left' && order[1].facing === 'right' && !s.keepFacing) {
    order[0].facing = 'right'; order[1].facing = 'left';
    note('facing', 'Turned the two characters to face each other.');
  }

  const props = (s.props || [])
    .filter((p) => PROPS.includes(p.kind))
    .slice(0, 3)
    .map((p) => ({ kind: p.kind, x: clamp(p.x ?? 0.85, 0.05, 0.95) }));
  const effects = [...new Set((s.effects || []).filter((e) => EFFECTS.includes(e)))].slice(0, 3);
  let sfx = String(s.sound_effect || '').trim().replace(/[^\p{L}\p{N}!?' -]/gu, '');
  if (sfx.length > 12) { sfx = sfx.split(/\s+/)[0].slice(0, 12); note('sfx', 'Trimmed a long sound effect.'); }

  const image_prompt = String(s.image_prompt || '').trim().slice(0, 1200);
  const location_id = slug(s.location_id || '') === 'char' ? '' : slug(s.location_id || '');
  const moment = String(s.moment || '').trim().slice(0, 400);
  // someone can't be both in the room and somewhere else: being elsewhere wins
  let offscreen = [...new Set((s.offscreen || []).filter((id) => ids.includes(id)))];
  if (offscreen.length) {
    const kept = actors.filter((a) => !offscreen.includes(a.character_id));
    if (kept.length && kept.length < actors.length) { actors = kept; note('presence', 'Removed someone from a scene they are not physically in.'); }
    const inFrame = new Set(actors.map((a) => a.character_id));
    offscreen = offscreen.filter((id) => !inFrame.has(id));
  }
  return { moment, image_prompt, location_id, offscreen, setting, actors, props, effects, sound_effect: sfx };
}

/**
 * Turn a plan into contiguous, time-based segments that cover [0, duration],
 * applying editorial rules along the way.
 */
export function normalizeSegments(segments, characters, duration, report = [], { pacing = 'mostly', cutbacks = false } = {}) {
  let segs = (segments || [])
    .filter((s) => Number.isFinite(s.start))
    .map((s) => ({
      id: s.id || newId(),
      start: clamp(s.start, 0, duration),
      end: Number.isFinite(s.end) ? clamp(s.end, 0, duration) : null,
      type: pick(s.type, SEGMENT_TYPES, 'face'),
      reason: String(s.reason || '').slice(0, 200),
      scene: s.scene ? normalizeScene(s.scene, characters, report, null) : null,
      ...(s.image ? { image: s.image } : {}),
    }))
    .sort((a, b) => a.start - b.start);

  if (!segs.length) segs = [{ id: newId(), start: 0, end: duration, type: 'face', reason: 'Whole video', scene: null }];
  segs[0].start = 0;
  for (let i = 0; i < segs.length; i++) segs[i].end = i + 1 < segs.length ? segs[i + 1].start : duration;

  // merge segments that are too short to read
  const MIN = 1.0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.end - s.start < MIN && segs.length > 1) {
      const into = i > 0 ? i - 1 : 1;
      if (into < i) segs[into].end = s.end; else segs[into].start = s.start;
      segs.splice(i, 1); i--;
      report.push({ seg: null, check: 'min-duration', fix: 'Merged a shot shorter than 1s into its neighbour.' });
    }
  }

  // the hook: open on the creator's face (unless the creator chose story-only)
  if (pacing !== 'story' && segs[0].type !== 'face') {
    if (segs[0].end - segs[0].start > 3) {
      const hook = { id: newId(), start: 0, end: 1.5, type: 'face', reason: 'Hook: open on your face.', scene: null };
      segs[0].start = 1.5;
      segs.unshift(hook);
    } else {
      segs[0].type = 'face';
    }
    report.push({ seg: 0, check: 'hook', fix: 'Video now opens on your face for the hook.' });
  }
  // the ending/punchline: land on the face
  const last = segs[segs.length - 1];
  if (pacing === 'bookends' && segs.length > 1 && last.type !== 'face') {
    if (last.end - last.start > 4) {
      const outro = { id: newId(), start: last.end - 2.2, end: last.end, type: 'face', reason: 'Outro: end on your face.', scene: null };
      last.end = outro.start;
      segs.push(outro);
    } else Object.assign(last, { type: 'face', reason: 'Outro: end on your face.', scene: null });
    report.push({ seg: segs.length - 1, check: 'ending', fix: 'Video now ends on your face.' });
  } else if (pacing !== 'story' && segs.length > 1 && last.type === 'scene') {
    last.type = 'scene_bubble';
    report.push({ seg: segs.length - 1, check: 'ending', fix: 'Last shot now keeps your face in a bubble for the reaction.' });
  }
  // cut back to the creator during the story, not just at the start and end
  const MAX_RUN = { mostly: 10, balanced: 6 }[pacing];
  if (cutbacks && MAX_RUN) {
    for (let guard = 0; guard < 40; guard++) {
      // find the first run of illustrations longer than the limit
      let runStart = -1, run = 0, found = null;
      for (let i = 0; i < segs.length; i++) {
        if (segs[i].type === 'face') { runStart = -1; run = 0; continue; }
        if (runStart < 0) runStart = i;
        run += segs[i].end - segs[i].start;
        if (run > MAX_RUN) { found = [runStart, i]; break; }
      }
      if (!found) break;
      const [a, b] = found;
      // prefer turning a short middle shot into a face cut; otherwise split the longest one
      const inner = segs.slice(a, b + 1).map((sg, k) => ({ sg, k: a + k })).filter(({ k }) => k > a || b === a);
      const short = inner.filter(({ sg }) => sg.end - sg.start <= 3.5).sort((x, y) => (x.sg.end - x.sg.start) - (y.sg.end - y.sg.start))[0];
      if (short && short.k > a) {
        Object.assign(short.sg, { type: 'face', reason: 'Cut back to you mid-story.', scene: null });
        delete short.sg.image;
      } else {
        const long = segs.slice(a, b + 1).reduce((x, y) => (y.end - y.start > x.end - x.start ? y : x));
        const len = long.end - long.start;
        const faceLen = Math.min(2, len * 0.35);
        if (len < 2.2) break;
        const cut = { id: newId(), start: long.end - faceLen, end: long.end, type: 'face', reason: 'Cut back to you mid-story.', scene: null };
        long.end = cut.start;
        segs.splice(segs.indexOf(long) + 1, 0, cut);
      }
      report.push({ seg: null, check: 'cutback', fix: 'Added a cut back to your face in the middle of the story.' });
    }
  }
  // back-to-back face shots read as one shot
  for (let i = segs.length - 1; i > 0; i--) {
    if (segs[i].type === 'face' && segs[i - 1].type === 'face') { segs[i - 1].end = segs[i].end; segs.splice(i, 1); }
  }
  segs.forEach((s, i) => {
    if (s.type !== 'face' && !s.scene) {
      s.scene = normalizeScene({}, characters, report, i);
    }
    if (s.scene) s.scene = normalizeScene(s.scene, characters, [], i);
  });
  return segs;
}

export function runQC(project) {
  const report = [];
  project.characters = normalizeCharacters(project.characters, report);
  project.segments = normalizeSegments(project.segments, project.characters, project.duration, report, { pacing: project.settings?.pacing, cutbacks: true });
  const scenes = project.segments.filter((s) => s.type !== 'face').length;
  const checks = project.segments.length * 6 + project.characters.length * 2;
  return { report, checks, scenes };
}

export function wordsIn(words, start, end) {
  return words.filter((w) => w.s >= start - 0.01 && w.s < end - 0.01);
}
