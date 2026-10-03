// The AI editor. Two planners produce the same plan shape:
//  - planWithClaude: Claude reads the word-timed transcript and makes editorial
//    decisions (face / scene / scene + face bubble) and writes each scene.
//  - heuristicPlan: an offline keyword planner, so the app works with no key.

import {
  SEGMENT_TYPES, SETTINGS, POSES, EXPRESSIONS, HAIR, ACCESSORIES, PROPS, EFFECTS, FACINGS, COLORS,
} from './constants.js';
import { newId, slug } from './qc.js';

export const DEFAULT_MODEL = 'claude-opus-5-5';
// $ per million tokens (input, output) for the cost preview.
const PRICES = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-4-5': [1, 5],
};

let sdkPromise = null;
async function loadSDK() {
  if (!sdkPromise) {
    sdkPromise = import('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk/+esm')
      .catch(() => import('https://esm.sh/@anthropic-ai/sdk'))
      .then((m) => m.default || m.Anthropic);
  }
  return sdkPromise;
}

async function client(apiKey) {
  const Anthropic = await loadSDK();
  // The key stays in this browser and goes straight to api.anthropic.com.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

// ---------- schema ----------

const sceneSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['image_prompt', 'location_id', 'setting', 'actors', 'props', 'effects', 'sound_effect'],
  properties: {
    location_id: { type: 'string', description: 'id of the location (from "locations") where this scene happens' },
    image_prompt: {
      type: 'string',
      description: 'What the illustration shows, for an illustrator: who (by character name) is where, doing what, with what expressions, key props, camera framing. 2-4 sentences. No text, captions or speech bubbles in the image.',
    },
    setting: { type: 'string', enum: SETTINGS },
    actors: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['character_id', 'x', 'pose', 'expression', 'facing', 'speech'],
        properties: {
          character_id: { type: 'string' },
          x: { type: 'number', description: '0 = left edge, 1 = right edge' },
          pose: { type: 'string', enum: POSES },
          expression: { type: 'string', enum: EXPRESSIONS },
          facing: { type: 'string', enum: FACINGS },
          speech: { type: 'string', description: 'Short speech bubble (max ~8 words) or empty string' },
        },
      },
    },
    props: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['kind', 'x'],
        properties: { kind: { type: 'string', enum: PROPS }, x: { type: 'number' } },
      },
    },
    effects: { type: 'array', items: { type: 'string', enum: EFFECTS } },
    sound_effect: { type: 'string', description: 'Comic sound effect like BOOM or CRASH, usually empty' },
  },
};

const characterSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'description', 'color', 'hair', 'hairColor', 'accessory', 'height'],
  properties: {
    id: { type: 'string', description: 'short snake_case id; the storyteller is always "me"' },
    name: { type: 'string' },
    description: { type: 'string', description: 'Visual design for the illustrator: age, build, hair, clothing, one or two signature details. One sentence.' },
    color: { type: 'string', enum: COLORS, description: 'shirt colour, unique per character' },
    hair: { type: 'string', enum: HAIR },
    hairColor: { type: 'string', enum: ['#2b2b2b', '#6b4423', '#c8a165', '#d35400', '#9e9e9e', '#e84393'] },
    accessory: { type: 'string', enum: ACCESSORIES },
    height: { type: 'number', description: '0.8 (child) to 1.2 (tall adult); 1 = average' },
  },
};

const planSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'characters', 'locations', 'segments'],
  properties: {
    title: { type: 'string' },
    locations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'description'],
        properties: {
          id: { type: 'string', description: 'short snake_case id' },
          name: { type: 'string' },
          description: { type: 'string', description: 'Fixed visual description so the place looks identical in every scene: layout, colours, key furniture/props, time of day, lighting. 1-2 sentences.' },
        },
      },
    },
    characters: { type: 'array', items: characterSchema },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['start_word', 'type', 'reason', 'scene'],
        properties: {
          start_word: { type: 'integer', description: 'index of the first word of this shot' },
          type: { type: 'string', enum: SEGMENT_TYPES },
          reason: { type: 'string', description: 'one short line: why this shot' },
          scene: sceneSchema,
        },
      },
    },
  },
};

const SYSTEM = `You are StoryCuts, a professional short-form video editor. A creator filmed themselves telling a story to camera. You plan the edit: when to stay on their face and when to cut to a stick-figure scene that acts out what they're saying.

Shot types:
- "face": the creator on camera. Use for the hook (the first line), punchlines, reactions, opinions, asides, and anything where their delivery is the point.
- "scene": a full-screen stick-figure illustration acting out what is being described right now.
- "scene_bubble": the illustration with the creator's face in a corner bubble. Use when both the action and the creator's live reaction matter.

Editing rules:
- Open on "face" for the hook. End on "face" (or "scene_bubble") for the punchline or sign-off.
- Cut to scenes when the creator describes events, places, people doing things, or dialogue. Aim for roughly 40-65% of runtime illustrated.
- Shots usually last 1.5-5 seconds; cut on natural phrase boundaries. Never make a shot shorter than 1 second.
- Scenes must act out the story in order, literally and specifically (who is where doing what), not generic keyword decoration.
- Consecutive scenes in the same place keep the same setting. Characters keep the same look throughout: only use character ids you define.
- Define every person (or pet) in the story as a character, including the storyteller (id "me") when "I" appear in the story. Give characters distinct, fitting looks (e.g. dad: bald + mustache; grandma: bun + glasses) and unique shirt colours, and a one-sentence visual description.
- Each scene is drawn by an AI illustrator from "image_prompt" plus reference images of the characters. Write image_prompt as a specific, visual description of the single moment: who (by name) is where, doing what, with which expressions and props, and the framing (wide shot, close-up...). Exaggerate emotions for comedy. Never ask for text, signs, captions or speech bubbles in the image.
- Define every recurring place as a location with a fixed visual description (e.g. "Dad's small kitchen: yellow walls, white cabinets, old gas stove by a window, morning light") and set each scene's location_id. Scenes in the same place must use the same location so it looks identical across shots.
- Also fill the structured fields (setting, actors, poses...) to match.
- Put reported dialogue in short speech bubbles (max ~8 words). Use sound effects sparingly, only for big moments.
- Place actors with x between 0.15 and 0.85, at least 0.25 apart; characters interacting should face each other.
- For "face" shots, still fill "scene" with a simple placeholder (setting "blank", no actors); it is ignored.
- Segments are given by start_word (index into the transcript); each runs until the next segment starts. The first segment starts at word 0.`;

function transcriptForPrompt(words) {
  // "0|So 1|my 2|dad ..." with a timestamped line break at sentence ends and pauses.
  const lines = [];
  let line = [];
  words.forEach((w, i) => {
    if (!line.length) line.push(`[${w.s.toFixed(1)}s]`);
    line.push(`${i}|${w.w}`);
    const next = words[i + 1];
    if (/[.?!]$/.test(w.w) || (next && next.s - w.e > 0.6) || line.length > 24) { lines.push(line.join(' ')); line = []; }
  });
  if (line.length) lines.push(line.join(' '));
  return lines.join('\n');
}

export function estimateCost(words, model = DEFAULT_MODEL) {
  const [pin, pout] = PRICES[model] || PRICES[DEFAULT_MODEL];
  const inTok = 2500 + words.length * 4;
  const shots = Math.max(4, Math.round(words.length / 9));
  const outTok = 1500 + shots * 260; // includes some thinking
  const usd = (inTok * pin + outTok * pout) / 1e6;
  return { inTok, outTok, usd, shots };
}

export async function callClaude(apiKey, { model, system, user, schema, effort = 'medium', maxTokens = 32000 }) {
  const anthropic = await client(apiKey);
  const base = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort, format: { type: 'json_schema', schema } },
  };
  let msg;
  try {
    // Server-side fallback re-runs a declined request on a suitable model.
    msg = await anthropic.beta.messages
      .stream({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      .finalMessage();
  } catch (err) {
    if (err?.status === 400 && /fallback/i.test(err?.message || '')) {
      msg = await anthropic.messages.stream(base).finalMessage();
    } else throw err;
  }
  if (msg.stop_reason === 'refusal') {
    throw new Error(`Claude declined this request${msg.stop_details?.explanation ? `: ${msg.stop_details.explanation}` : '.'}`);
  }
  if (msg.stop_reason === 'max_tokens') throw new Error('The plan was cut off (too long). Try a shorter video.');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { data: JSON.parse(text), usage: msg.usage, model: msg.model };
}

/** Convert word-indexed segments to time-based ones. */
function segmentsFromWordIndices(raw, words) {
  const segs = [];
  const sorted = [...raw].sort((a, b) => a.start_word - b.start_word);
  for (const s of sorted) {
    const i = Math.max(0, Math.min(words.length - 1, s.start_word | 0));
    if (segs.length && words[i].s <= segs[segs.length - 1].start) continue;
    segs.push({ id: newId(), start: segs.length ? words[i].s : 0, type: s.type, reason: s.reason, scene: s.type === 'face' ? null : s.scene });
  }
  return segs;
}

export async function planWithClaude(apiKey, words, duration, { model = DEFAULT_MODEL, notes = '' } = {}) {
  const user = `Video length: ${duration.toFixed(1)}s. ${words.length} words.
${notes ? `Creator's notes: ${notes}\n` : ''}
Transcript (index|word, with start times):
${transcriptForPrompt(words)}

Plan the edit.`;
  const { data, usage, model: served } = await callClaude(apiKey, { model, system: SYSTEM, user, schema: planSchema, effort: 'medium' });
  return {
    title: data.title,
    characters: data.characters,
    locations: data.locations || [],
    segments: segmentsFromWordIndices(data.segments, words),
    usage,
    served,
  };
}

export async function redoSceneWithClaude(apiKey, project, seg, note, { model = DEFAULT_MODEL } = {}) {
  const said = project.words.filter((w) => w.s >= seg.start - 0.01 && w.s < seg.end).map((w) => w.w).join(' ');
  const idx = project.segments.indexOf(seg);
  const ctx = project.segments.slice(Math.max(0, idx - 2), idx + 3).map((s) => {
    const t = project.words.filter((w) => w.s >= s.start - 0.01 && w.s < s.end).map((w) => w.w).join(' ');
    return `${s === seg ? '>> ' : ''}[${s.type}] ${t}`;
  }).join('\n');
  const user = `Locations (reuse one of these ids when the scene is in one of these places):
${JSON.stringify((project.locations || []).map(({ id, name }) => ({ id, name })))}

Characters (use only these ids):
${JSON.stringify(project.characters.map(({ id, name, description }) => ({ id, name, description })))}

Surrounding shots (>> marks the one to redo):
${ctx}

Current scene for this shot:
${JSON.stringify(seg.scene)}

Words spoken during this shot: "${said}"
${note ? `Creator's request: ${note}` : 'Make a different, better take on this scene.'}

Return only the new scene.`;
  const { data } = await callClaude(apiKey, {
    model, system: SYSTEM, user, schema: sceneSchema, effort: 'low', maxTokens: 8000,
  });
  return data;
}

// ---------- offline heuristic planner ----------

const RELATIONS = {
  dad: { hair: 'bald', accessory: 'mustache', height: 1.1, hairColor: '#6b4423' },
  father: { hair: 'bald', accessory: 'mustache', height: 1.1, hairColor: '#6b4423' },
  mom: { hair: 'long', accessory: 'none', height: 1.0, hairColor: '#6b4423' },
  mother: { hair: 'long', accessory: 'none', height: 1.0, hairColor: '#6b4423' },
  brother: { hair: 'spiky', accessory: 'cap', height: 0.95 },
  sister: { hair: 'ponytail', accessory: 'bow', height: 0.92 },
  friend: { hair: 'curly', accessory: 'none', height: 1.0 },
  boss: { hair: 'short', accessory: 'tie', height: 1.08 },
  manager: { hair: 'short', accessory: 'tie', height: 1.05 },
  teacher: { hair: 'bun', accessory: 'glasses', height: 1.05 },
  grandma: { hair: 'bun', accessory: 'glasses', height: 0.88, hairColor: '#9e9e9e' },
  grandpa: { hair: 'bald', accessory: 'glasses', height: 0.92, hairColor: '#9e9e9e' },
  wife: { hair: 'long', accessory: 'none', height: 0.97 },
  husband: { hair: 'short', accessory: 'beard', height: 1.05 },
  girlfriend: { hair: 'ponytail', accessory: 'none', height: 0.95 },
  boyfriend: { hair: 'short', accessory: 'none', height: 1.05 },
  roommate: { hair: 'curly', accessory: 'headphones', height: 1.0 },
  neighbor: { hair: 'short', accessory: 'hat', height: 1.0 },
  cousin: { hair: 'spiky', accessory: 'none', height: 0.97 },
  uncle: { hair: 'short', accessory: 'beard', height: 1.1 },
  aunt: { hair: 'curly', accessory: 'glasses', height: 0.97 },
  doctor: { hair: 'short', accessory: 'glasses', height: 1.05 },
  cop: { hair: 'short', accessory: 'cap', height: 1.1 },
  coworker: { hair: 'ponytail', accessory: 'glasses', height: 1.0 },
  kid: { hair: 'spiky', accessory: 'none', height: 0.8 },
  son: { hair: 'spiky', accessory: 'none', height: 0.82 },
  daughter: { hair: 'ponytail', accessory: 'bow', height: 0.8 },
  waiter: { hair: 'short', accessory: 'tie', height: 1.0 },
};

const SETTING_WORDS = [
  ['kitchen', /\b(kitchen|cook\w*|stove|oven|fridge|breakfast|microwave|toast)\b/],
  ['bathroom', /\b(bathroom|shower|toilet|sink|bath)\b/],
  ['bedroom', /\b(bedroom|bed|slept|sleep\w*|woke|nap)\b/],
  ['living_room', /\b(living room|couch|sofa|tv|television|netflix)\b/],
  ['school', /\b(school|class\w*|teacher|homework|exam|test|lecture|campus)\b/],
  ['office', /\b(office|work|job|boss|meeting|desk|interview|coworker)\b/],
  ['store', /\b(store|shop\w*|mall|walmart|target|costco|grocer\w*|cashier)\b/],
  ['restaurant', /\b(restaurant|dinner|waiter|menu|cafe|mcdonald'?s|ordered)\b/],
  ['car', /\b(car|driv\w*|drove|uber|traffic|highway)\b/],
  ['beach', /\b(beach|ocean|sea|sand|waves|pool)\b/],
  ['park', /\b(park|outside|garden|yard|forest|hike|hiking)\b/],
  ['street', /\b(street|road|sidewalk|downtown|city|crosswalk)\b/],
  ['party', /\b(party|club|wedding|birthday|concert|dance)\b/],
  ['hospital', /\b(hospital|doctor|nurse|er|clinic|ambulance)\b/],
  ['night', /\b(night|midnight|dark|3 ?am|2 ?am)\b/],
];

const POSE_WORDS = [
  ['run', /\b(run|ran|running|sprint\w*|chas\w*|rush\w*|bolted)\b/],
  ['fall', /\b(fell|fall\w*|slipp\w*|trip\w*|collaps\w*|passed out)\b/],
  ['freeze', /\b(froze|freez\w*|stood there|stopped)\b/],
  ['arms_up', /\b(scream\w*|yell\w*|shout\w*|celebrat\w*|cheer\w*|won)\b/],
  ['phone', /\b(call\w*|phone|text\w*|facetime)\b/],
  ['point', /\b(point\w*|look at|showed|see that)\b/],
  ['walk', /\b(walk\w*|went|came|go|goes|going|enter\w*|left|leaves)\b/],
  ['sit', /\b(sat|sit\w*|seated)\b/],
  ['cower', /\b(hid|hide|hiding|terrified|scared)\b/],
  ['facepalm', /\b(embarrass\w*|cringe|facepalm|can'?t believe|couldn'?t believe)\b/],
  ['shrug', /\b(shrug\w*|whatever|no idea|idk)\b/],
  ['dance', /\b(danc\w*)\b/],
  ['wave', /\b(wav\w*|hello|hi|hey|bye)\b/],
  ['hold', /\b(hold\w*|held|carr\w*|grab\w*|brought|holding)\b/],
];

const EXPR_WORDS = [
  ['laughing', /\b(laugh\w*|lol|hilarious|funny|cracking up)\b/],
  ['scared', /\b(scared|terrified|afraid|panic\w*|horror)\b/],
  ['angry', /\b(angry|mad|furious|yell\w*|pissed|annoyed)\b/],
  ['crying', /\b(cr(y|ied|ying)|tears|sobb\w*)\b/],
  ['sad', /\b(sad|upset|depress\w*|miss\w*)\b/],
  ['shocked', /\b(shock\w*|froze|what\??|wait|omg|oh my god|surpris\w*|couldn'?t believe)\b/],
  ['confused', /\b(confus\w*|weird|strange|why|huh)\b/],
  ['happy', /\b(happy|love\w*|excit\w*|great|amazing|awesome)\b/],
  ['smug', /\b(proud|smug|told you|obviously)\b/],
];

const EFFECT_WORDS = [
  ['smoke', /\b(smoke|smok\w*|burn\w*)\b/],
  ['fire', /\b(fire|flames?|burning)\b/],
  ['rain', /\b(rain\w*|storm)\b/],
  ['hearts', /\b(love|crush|date|kiss\w*)\b/],
  ['zzz', /\b(sleep\w*|asleep|nap|tired)\b/],
  ['sweat', /\b(nervous|sweat\w*|awkward|anxious)\b/],
  ['question', /\b(confus\w*|why|huh|what\?)\b/],
  ['exclamation', /\b(suddenly|shock\w*|omg|froze|wait)\b/],
  ['anger', /\b(angry|mad|furious|pissed)\b/],
  ['stars', /\b(hit|bonk\w*|dizzy|bump\w*)\b/],
  ['sparkles', /\b(amazing|magic\w*|beautiful|shiny)\b/],
];

const PROP_WORDS = [
  ['dog', /\b(dog|puppy)\b/], ['cat', /\b(cat|kitten)\b/], ['car', /\b(car|truck)\b/],
  ['phone', /\b(phone|text\w*)\b/], ['cake', /\b(cake|birthday)\b/], ['door', /\b(door|knock\w*)\b/],
  ['pan', /\b(pan|cook\w*|fry\w*)\b/], ['laptop', /\b(laptop|computer)\b/], ['money', /\b(money|cash|paid|dollars?)\b/],
  ['gift', /\b(gift|present)\b/], ['tv', /\b(tv|television)\b/], ['ball', /\b(ball|soccer|basketball|football)\b/],
  ['book', /\b(book|homework|notes)\b/], ['cup', /\b(coffee|tea|cup|drink)\b/], ['bag', /\b(bag|backpack|purse)\b/],
];

const SFX = { boom: 'BOOM!', crash: 'CRASH!', bang: 'BANG!', slam: 'SLAM!', explod: 'KABOOM!', smash: 'SMASH!' };

const ACTION = /\b(walk\w*|ran|run\w*|went|came|grab\w*|threw|fell|jump\w*|open\w*|drove|look\w*|saw|sees|turn\w*|knock\w*|cook\w*|call\w*|yell\w*|scream\w*|froze|hit|push\w*|pull\w*|dropp\w*|start\w*|tried|said|says|goes|told|asked|walks|comes|gets|got)\b/;

function sentences(words) {
  const out = [];
  let cur = [];
  words.forEach((w, i) => {
    cur.push(i);
    const next = words[i + 1];
    const words5 = cur.length;
    if (/[.?!]$/.test(w.w) || (next && next.s - w.e > 0.7) || words5 >= 16 || (words5 >= 9 && /,$/.test(w.w))) { out.push(cur); cur = []; }
  });
  if (cur.length) out.push(cur);
  return out;
}

const NOT_NAMES = new Set(('monday tuesday wednesday thursday friday saturday sunday january february march april may june july '
  + 'august september october november december okay ok the and but so then like god omg yeah yes no anyway well oh hey '
  + 'christmas easter halloween thanksgiving instagram tiktok youtube google iphone netflix uber amazon walmart target costco '
  + 'mcdonalds starbucks this that what when where why how just also because after before').split(' '));

const firstMatch = (table, text, fallback) => (table.find(([, re]) => re.test(text)) || [fallback])[0];

export function heuristicPlan(words, duration) {
  const characters = [{ id: 'me', name: 'Me', description: 'The storyteller', color: COLORS[1], hair: 'spiky', accessory: 'none', height: 1 }];
  const ensureChar = (key, name, relation = key) => {
    const id = slug(key);
    if (!characters.some((c) => c.id === id) && characters.length < 6) {
      const look = RELATIONS[relation] || { hair: HAIR[(characters.length * 3) % HAIR.length], accessory: 'none', height: 1 };
      characters.push({ id, name, description: '', color: COLORS[(characters.length * 3) % COLORS.length], hairColor: '#2b2b2b', ...look });
    }
    return characters.some((c) => c.id === id) ? id : null;
  };

  const sents = sentences(words);
  const segs = [];
  let lastSetting = 'blank';
  let lastChars = ['me'];
  let sceneRun = 0;

  sents.forEach((idxs, si) => {
    const raw = idxs.map((i) => words[i].w).join(' ');
    const text = raw.toLowerCase();
    // who's in this sentence
    const who = [];
    const toks = idxs.map((i) => words[i].w.replace(/[^A-Za-z']/g, ''));
    const rel = (w) => { const l = (w || '').toLowerCase(); return RELATIONS[l] ? l : RELATIONS[l.replace(/s$/, '')] ? l.replace(/s$/, '') : null; };
    toks.forEach((tok, k) => {
      const low = rel(tok);
      const next = toks[k + 1] || '';
      const isName = (w) => /^[A-Z][a-z]{2,}$/.test(w) && !NOT_NAMES.has(w.toLowerCase());
      let id = null;
      if (low) {
        // "my friend Jake" -> one character called Jake with the friend look
        id = isName(next) ? ensureChar(next.toLowerCase(), next, low) : ensureChar(low, low[0].toUpperCase() + low.slice(1));
      } else if (k > 0 && isName(tok) && !rel(toks[k - 1])) {
        id = ensureChar(tok.toLowerCase(), tok);
      }
      if (id && !who.includes(id)) who.push(id);
    });
    if (/\b(i|me|my|we)\b/.test(text) && !who.includes('me')) who.push('me');

    const setting = firstMatch(SETTING_WORDS, text, null);
    if (setting) lastSetting = setting;
    const isAction = ACTION.test(text) || who.some((c) => c !== 'me') || !!setting;
    const emotional = EXPR_WORDS.some(([, re]) => re.test(text));
    const isFirst = si === 0, isLast = si === sents.length - 1;

    let type = 'face';
    if (!isFirst && !isLast && isAction) type = emotional && who.includes('me') ? 'scene_bubble' : 'scene';
    if (type !== 'face' && sceneRun >= 2) type = 'scene_bubble';
    if (type === 'face' && !isFirst && !isLast && sceneRun === 0 && si % 3 === 2 && idxs.length > 4) type = 'scene_bubble';
    sceneRun = type === 'face' ? 0 : sceneRun + 1;

    const cast = (who.length ? who : lastChars).slice(0, 3);
    if (who.length) lastChars = who;
    const pose = firstMatch(POSE_WORDS, text, 'stand');
    const expression = firstMatch(EXPR_WORDS, text, 'neutral');
    // speech: words after "said"/"goes"/"like"
    let speech = '';
    const m = raw.match(/\b(?:said|says|goes|went|yelled|screamed|asked|told me)\b,?\s+(.{3,})$/i);
    if (m) speech = m[1].split(/\s+/).slice(0, 7).join(' ').replace(/[,.]$/, '');
    const n = cast.length;
    const actors = cast.map((cid, k) => ({
      character_id: cid,
      x: n === 1 ? 0.5 : 0.25 + (0.5 * k) / (n - 1),
      pose: k === 0 ? pose : (expression === 'shocked' ? 'freeze' : 'stand'),
      expression: k === 0 ? expression : (expression === 'angry' ? 'scared' : 'neutral'),
      facing: n === 1 ? (si % 2 ? 'left' : 'right') : k === 0 ? 'right' : 'left',
      speech: k === 0 ? speech : '',
    }));
    const props = PROP_WORDS.filter(([, re]) => re.test(text)).slice(0, 2).map(([kind], k) => ({ kind, x: k ? 0.12 : 0.86 }));
    const effects = EFFECT_WORDS.filter(([, re]) => re.test(text)).map(([e]) => e).slice(0, 2);
    if (pose === 'run' && !effects.includes('motion_lines')) effects.push('motion_lines');
    const loud = /\b(boom|crash|bang|slam\w*|explod\w*|smash\w*)\b/.exec(text);

    segs.push({
      id: newId(),
      start: si === 0 ? 0 : words[idxs[0]].s,
      type,
      reason: type === 'face' ? (isFirst ? 'Hook on your face.' : isLast ? 'Punchline on your face.' : 'Commentary: stay on you.')
        : type === 'scene' ? 'Describes an action: show it.' : 'Action plus your reaction.',
      scene: type === 'face' ? null : { setting: lastSetting, actors, props, effects, sound_effect: loud ? SFX[Object.keys(SFX).find((k) => loud[1].startsWith(k))] : '' },
    });
  });
  return { title: 'My story', characters, segments: segs };
}

/** Local "surprise me": reroll pose/expression/framing without an API call. */
export function remixScene(scene) {
  const r = (list) => list[Math.floor(Math.random() * list.length)];
  const s = JSON.parse(JSON.stringify(scene));
  s.actors.forEach((a, i) => {
    if (i === 0 || Math.random() < 0.5) a.pose = r(POSES.filter((p) => p !== 'fall' || Math.random() < 0.3));
    if (Math.random() < 0.6) a.expression = r(EXPRESSIONS);
  });
  if (s.actors.length === 1) s.actors[0].x = r([0.35, 0.5, 0.65]);
  if (Math.random() < 0.4) s.effects = [r(EFFECTS)];
  s.keepFacing = false;
  return s;
}
