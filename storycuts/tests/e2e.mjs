// End-to-end check of the whole StoryCuts flow with mocked AI services.
// No API keys or network needed: Claude and OpenAI are faked with fixed replies.
//
//   cd storycuts/tests && npm install && npx playwright install chromium && npm test
//
// Exits non-zero (and says why) if any step breaks or the page logs an error.
// Screenshots of every screen land in tests/out/ for a visual check.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8765;
const URL0 = `http://localhost:${PORT}/index.html`;

// ---------- tiny static server for the site ----------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webm': 'video/webm', '.mp4': 'video/mp4', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(p).pipe(res);
}).listen(PORT);

// ---------- helpers ----------
let failures = 0;
const check = (ok, what, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sdk = fs.readFileSync(path.join(HERE, 'fixtures/anthropic-sdk.mjs'));
const pngs = ['red', 'blue', 'green', 'orange'].map((c) => fs.readFileSync(path.join(HERE, `fixtures/mock_${c}.png`)).toString('base64'));
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const sse = (obj) => {
  const ev = (e, d) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`;
  return ev('message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } } })
    + ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify(obj) } })
    + ev('content_block_stop', { type: 'content_block_stop', index: 0 })
    + ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 300 } })
    + ev('message_stop', { type: 'message_stop' });
};

// ---------- fake AI replies ----------
const sc = (prompt, actors, extra = {}) => ({ image_prompt: prompt, setting: 'kitchen', location_id: 'kitchen', moment: '', offscreen: [], actors: actors.map(([id, x, pose, ex]) => ({ character_id: id, x, pose, expression: ex, facing: x < 0.5 ? 'right' : 'left', speech: '' })), props: [], effects: [], sound_effect: '', ...extra });
const blank = sc('', []);
const PLAN = {
  title: 'Breakfast fire',
  story_summary: 'Me is cooking at home in the kitchen. Jake is at his own house and texts Me. Dad comes home to a smoky kitchen.',
  characters: [
    { id: 'me', name: 'Me', description: 'Teen with messy dark hair, blue hoodie', color: '#2e86de', hair: 'spiky', hairColor: '#2b2b2b', accessory: 'none', height: 1 },
    { id: 'dad', name: 'Dad', description: 'Tall bald dad with a bushy mustache and red polo', color: '#e4572e', hair: 'bald', hairColor: '#6b4423', accessory: 'mustache', height: 1.15 },
    { id: 'jake', name: 'Jake', description: 'Friend with curly hair and green tee', color: '#20bf6b', hair: 'curly', hairColor: '#2b2b2b', accessory: 'none', height: 1 },
  ],
  locations: [{ id: 'kitchen', name: 'Kitchen', description: 'Small sunny kitchen' }],
  segments: [
    { start_word: 0, type: 'face', reason: 'Hook', scene: blank },
    { start_word: 11, type: 'scene', reason: 'Setup', scene: sc('Me in pajamas proudly holding a frying pan in a sunny kitchen.', [['me', 0.5, 'hold', 'happy']]) },
    // deliberately wrong: Jake is texting from home but drawn in the kitchen
    { start_word: 19, sfx: 'phone_buzz', type: 'scene', reason: 'Distraction', scene: sc('Me on the phone while Jake stands next to Me.', [['me', 0.4, 'phone', 'laughing'], ['jake', 0.75, 'phone', 'happy']]) },
    { start_word: 41, type: 'face', reason: 'Beat', scene: blank },
    { start_word: 45, sfx: 'boom', type: 'scene_bubble', reason: 'Fire!', scene: sc('Me bursting into the kitchen, the pan in flames, smoke everywhere.', [['me', 0.4, 'run', 'scared']], { sound_effect: 'WHOOSH!', effects: ['fire'] }) },
    { start_word: 58, type: 'scene', reason: 'Dad freezes', scene: sc('Dad frozen in the doorway of a smoky kitchen.', [['dad', 0.5, 'freeze', 'shocked']]) },
    { start_word: 72, type: 'scene', reason: 'Dialogue', scene: sc('Dad pointing at Me; Me holding a burnt plate.', [['dad', 0.3, 'point', 'angry'], ['me', 0.7, 'hold', 'sad']]) },
    { start_word: 95, type: 'face', reason: 'Punchline', scene: blank },
  ],
};
const REVIEW = {
  fixes: [{
    shot: 2, problem: 'Jake is texting from his house but is drawn in the kitchen',
    actors: ['jake'], offscreen: ['me'], location_id: 'jake_room', moment: 'Jake at home typing', image_prompt: 'Jake on his bed in his bedroom typing on his phone.',
    split: { enabled: true, start_word: 28, actors: ['me'], offscreen: ['jake'], location_id: 'kitchen', moment: 'Me reading the texts', image_prompt: 'Me alone in the kitchen laughing at the phone, pan smoking behind.' },
  }],
};

// ---------- run ----------
const browser = await chromium.launch();
const errors = [];
async function newContext(opts) {
  const ctx = await browser.newContext(opts);
  // Keep the suite offline: use the site's system font fallback in tests.
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
  await ctx.addInitScript(() => {
    localStorage.setItem('storycuts:key', JSON.stringify('sk-ant-test'));
    localStorage.setItem('storycuts:okey', JSON.stringify('sk-openai-test'));
    localStorage.setItem('storycuts:owner', 'true');
  });
  await ctx.route('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk/+esm', (r) => r.fulfill({ body: sdk, contentType: 'application/javascript', headers: cors }));
  let n = 0;
  await ctx.route('https://api.openai.com/**', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    await sleep(600);
    r.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify({ created: 1, data: [{ b64_json: pngs[n++ % pngs.length] }] }) });
  });
  await ctx.route('https://api.anthropic.com/**', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const body = r.request().postDataJSON();
    const sys = typeof body.system === 'string' ? body.system : JSON.stringify(body.system);
    let out;
    if (/art director/.test(sys)) out = { pass: true, score: 8, issues: [], fix_instructions: '' };
    else if (/continuity supervisor/.test(sys)) out = REVIEW;
    else { out = PLAN; await sleep(800); }
    r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse(out) });
  });
  return ctx;
}
const watch = (page, tag) => {
  page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_CERT|fonts\.g/.test(m.text())) errors.push(`${tag} console: ${m.text()}`); });
};
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

try {
  // ===== desktop: the full flow =====
  const ctx = await newContext({ viewport: { width: 1300, height: 1000 } });
  const p = await ctx.newPage();
  watch(p, 'desktop');
  const step = () => p.evaluate(() => document.querySelector('.wizard > .panel.active')?.dataset.step);
  await p.goto(URL0); await sleep(600); await shot(p, '01-landing');
  await p.locator('#nav-plan').click(); await sleep(400);
  await shot(p, '01b-upload');
  const chooser = p.waitForEvent('filechooser');
  await p.locator('#drop').focus(); await p.keyboard.press('Enter');
  check(!!(await chooser), 'upload can be opened with the keyboard');
  await p.click('#cta-demo'); await sleep(900);
  check(await step() === '2', 'demo opens the style step');
  await shot(p, '02-style');
  await p.click('#btn-style-next'); await sleep(800);
  check(await step() === '3', 'continue goes to settings');
  check(await p.getAttribute('#seg-motion button.on', 'data-motion') === 'living', 'living pictures is the default');
  await shot(p, '03-settings');
  await p.click('#panel-settings [data-next="4"]'); await sleep(800);
  check(await step() === '4', 'continue goes to create');
  await shot(p, '04-create');
  await p.click('#btn-create'); await sleep(500);
  check(await p.isVisible('.work'), 'full-screen progress shows while planning');
  await shot(p, '05-planning');
  await p.waitForFunction(() => !document.querySelector('#cast').classList.contains('hidden') && !document.querySelector('#btn-gen-chars').hidden, null, { timeout: 30000 });
  await sleep(500);
  check(!(await p.isVisible('.work')), 'progress screen closes after planning');
  const segs = await p.evaluate(() => window.__storycuts.state.project.segments.filter((s) => s.scene).map((s) => ({ a: s.scene.actors.map((x) => x.character_id).join(','), off: (s.scene.offscreen || []).join(','), loc: s.scene.location_id })));
  check(segs.some((s) => s.a === 'jake' && s.loc === 'jake_room') && segs.some((s) => s.a === 'me' && s.off === 'jake'), 'texting is split into two shots, one per place', JSON.stringify(segs));
  await shot(p, '06-characters');
  await p.click('#btn-add-char');
  check(await p.evaluate(() => document.activeElement?.matches('#chars .char:last-child [data-k=name]')), 'adding a character opens an inline name field');
  await p.locator('#chars .char:last-child [data-k=name]').fill('Grandma');
  await p.locator('#chars .char:last-child [data-k=description]').fill('Gray bob, round glasses, cream cardigan');
  check(await p.evaluate(() => window.__storycuts.state.project.characters.at(-1).name === 'Grandma'), 'character edits save without a dialog');
  await p.locator('#chars .char:last-child [data-del]').click();
  check(await p.evaluate(() => window.__storycuts.state.project.characters.length) === 3, 'inline character can be removed');
  for (let i = 0; i < 6; i++) await p.click('#btn-add-char');
  check(await p.evaluate(() => window.__storycuts.state.project.characters.length) === 8, 'character limit prevents an extra character being silently discarded');
  for (let i = 0; i < 5; i++) await p.locator('#chars .char:last-child [data-del]').click();
  await p.locator('#chars [data-character=dad] [data-k=name]').fill('Dad the cook');
  await p.click('#btn-gen-chars'); await sleep(400);
  check(await p.isVisible('.work'), 'progress screen shows while drawing characters');
  await p.waitForFunction(() => document.querySelectorAll('.char-art img').length === 3, null, { timeout: 30000 });
  await sleep(600);
  const dadKey = await p.evaluate(() => window.__storycuts.state.project.characters.find((c) => c.id === 'dad').image.key);
  await p.locator('#chars [data-character=dad] [data-k=description]').fill('Tall bald dad, bushy mustache, red polo and a cream apron');
  check(await p.evaluate(() => window.__storycuts.state.project.characters.find((c) => c.id === 'dad').image.stale) && !(await p.isVisible('#btn-approve')), 'changing appearance requires a new drawing before approval');
  await shot(p, '07b-character-updated');
  await p.click('#btn-gen-chars');
  await p.waitForFunction((old) => {
    const c = window.__storycuts.state.project.characters.find((c) => c.id === 'dad');
    return c.image?.key !== old && !c.image?.stale && !window.__storycuts.state.charBusy?.size;
  }, dadKey, { timeout: 30000 });
  await sleep(400);
  check(await p.isVisible('#btn-approve'), 'redrawing the updated character restores approval');
  await p.locator('#chars [data-character=dad] [data-k=name]').fill('Dad');
  check(await p.isVisible('#btn-approve'), 'renaming a character keeps its existing drawing');
  await shot(p, '07-characters-drawn');
  await p.click('#btn-approve'); await sleep(800);
  check(await p.isVisible('.work .btn.primary'), 'scene drawing offers "Back to editor"');
  await shot(p, '08-drawing-scenes');
  await p.click('.work .btn.primary'); await sleep(400);
  check(await p.isVisible('.work-pill'), 'background job pill shows in the editor');
  await p.locator('#timeline .clip.scene').first().click();
  await p.locator('#redo-note').fill('Keep this change request while the pictures arrive');
  await shot(p, '08b-background-editor');
  await p.waitForFunction(() => !window.__storycuts.state.genAbort, null, { timeout: 60000 });
  await sleep(600);
  check(await p.locator('#redo-note').inputValue() === 'Keep this change request while the pictures arrive', 'background drawing preserves the inspector draft');
  check(await step() === '5' && await p.evaluate(() => document.body.classList.contains('ed-app')), 'editor opens full-screen on desktop');
  const drawn = await p.evaluate(() => window.__storycuts.state.project.segments.filter((s) => s.type !== 'face' && s.scene).every((s) => s.image?.key));
  check(drawn, 'every scene has a picture');
  // A scene edited while its picture is in flight must still ask for an update.
  await p.route('https://api.openai.com/**', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    await sleep(1800);
    await r.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify({ created: 1, data: [{ b64_json: pngs[0] }] }) });
  });
  const drawingRequest = p.waitForRequest((r) => r.url().startsWith('https://api.openai.com/') && r.method() !== 'OPTIONS');
  await p.click('#inspector [data-act=redraw]'); await drawingRequest;
  await p.click('.work .btn.primary');
  await p.locator('#inspector [data-s=image_prompt]').fill('Me in the kitchen holding a frying pan and wearing a blue apron.');
  await p.locator('#redo-note').focus();
  await p.waitForFunction(() => !window.__storycuts.state.genAbort, null, { timeout: 30000 });
  check(await p.evaluate(() => {
    const st = window.__storycuts.state;
    return st.project.segments.find((s) => s.id === st.selected).image.stale;
  }), 'a scene changed during drawing stays marked for updating');
  await p.unroute('https://api.openai.com/**');
  await p.click('#inspector [data-act=redraw]');
  await p.waitForFunction(() => !window.__storycuts.state.genAbort, null, { timeout: 30000 });
  check(await p.evaluate(() => {
    const st = window.__storycuts.state;
    return !st.project.segments.find((s) => s.id === st.selected).image.stale;
  }), 'redrawing the latest scene clears its update warning');
  await p.locator('#timeline .clip.scene').nth(1).click(); await sleep(400);
  await shot(p, '09-editor');
  // trim
  const before = await p.evaluate(() => { const st = window.__storycuts.state; return st.project.segments.find((x) => x.id === st.selected).start; });
  const h = await p.locator('#timeline .clip.sel .trim.l').boundingBox();
  await p.mouse.move(h.x + 5, h.y + 20); await p.mouse.down(); await p.mouse.move(h.x + 45, h.y + 20, { steps: 6 }); await p.mouse.up();
  const after = await p.evaluate(() => { const st = window.__storycuts.state; return st.project.segments.find((x) => x.id === st.selected).start; });
  check(Math.abs(after - before) > 0.05, 'dragging a trim handle changes the shot', `${before.toFixed(2)} -> ${after.toFixed(2)}`);
  // undo
  await p.click('#btn-undo'); await sleep(300);
  const undone = await p.evaluate(() => { const st = window.__storycuts.state; return st.project.segments.find((x) => x.id === st.selected)?.start; });
  check(Math.abs(undone - before) < 0.05, 'undo restores the trim');
  // tabs
  for (const t of ['sound', 'captions', 'filters', 'trans', 'export', 'shot']) {
    await p.click(`#ed-tabs button[data-tab=${t}]`); await sleep(250);
    check(await p.isVisible(`.ed-panel[data-pane=${t}]`), `editor tab "${t}" opens`);
    if (t !== 'shot') await shot(p, `10-tab-${t}`);
  }
  await p.locator('#ed-tabs [data-tab=shot]').focus();
  await p.keyboard.press('ArrowDown');
  check(await p.isVisible('.ed-panel[data-pane=sound]') && await p.getAttribute('#tab-sound', 'aria-selected') === 'true', 'keyboard navigation selects the next tool tab');
  // sound effect
  await p.click('#ed-tabs button[data-tab=sound]');
  const fx0 = await p.evaluate(() => window.__storycuts.state.project.sfx.length);
  await p.click('.sfx-tile[data-add=ding]'); await sleep(300);
  check(await p.evaluate(() => window.__storycuts.state.project.sfx.length) === fx0 + 1, 'tapping a sound effect adds it');
  // split
  const n0 = await p.evaluate(() => window.__storycuts.state.project.segments.length);
  await p.evaluate(async () => { const st = window.__storycuts.state; const s = st.project.segments.find((x) => x.id === st.selected); await st.media.seek((s.start + s.end) / 2); });
  await p.locator('#btn-split').focus(); await p.keyboard.press('Space'); await sleep(300);
  check(await p.evaluate(() => window.__storycuts.state.project.segments.length) === n0 + 1, 'split adds a shot');
  check(await p.evaluate(() => window.__storycuts.state.media.paused), 'Space activates the focused Split button without starting playback');
  // play
  const t0 = await p.evaluate(() => window.__storycuts.state.media.time);
  await p.click('#btn-play');
  check(await p.getAttribute('#btn-play', 'aria-label') === 'Pause', 'playback control announces Pause while playing');
  await sleep(1200); await p.click('#btn-play');
  check(await p.evaluate(() => window.__storycuts.state.media.time) > t0 + 0.5, 'play moves the playhead');
  // living pictures toggle
  await p.click('#ed-tabs button[data-tab=filters]'); await sleep(200);
  await p.click('label:has(#opt-living)'); await sleep(200);
  check(await p.evaluate(() => window.__storycuts.state.project.settings.sceneMotion) === 'still', 'living pictures switch turns off');
  await p.click('label:has(#opt-living)');
  // export shows the progress screen and can be cancelled
  await p.click('#ed-tabs button[data-tab=export]'); await sleep(200);
  await p.click('#btn-export'); await sleep(1200);
  check(await p.isVisible('.work'), 'export shows the progress screen');
  const exportingShots = await p.evaluate(() => window.__storycuts.state.project.segments.length);
  await p.keyboard.press('s');
  check(await p.evaluate(() => window.__storycuts.state.project.segments.length) === exportingShots, 'loading screen blocks hidden editor shortcuts');
  await p.keyboard.press('Tab');
  check(await p.evaluate(() => !!document.activeElement?.closest('.work')), 'keyboard focus stays inside the loading screen');
  check(await p.getAttribute('.work-bar', 'aria-valuenow') !== null, 'loading progress is exposed to assistive technology');
  await shot(p, '11-exporting');
  await p.click('.work .btn.ghost'); await sleep(1500);
  check(!(await p.isVisible('.work')), 'export can be cancelled');
  // Geometry at a smaller desktop size and in landscape format.
  await p.setViewportSize({ width: 900, height: 700 });
  await p.click('#tab-export');
  await p.click('#seg-aspect [data-aspect=horizontal]'); await sleep(350);
  check(await p.textContent('#preview-spec') === '16:9 · Horizontal', 'preview label follows the chosen export format');
  await shot(p, '12-editor-horizontal');
  await p.click('#seg-aspect [data-aspect=vertical]');
  await p.click('#tab-shot'); await sleep(350);
  const preview = await p.locator('#preview').boundingBox();
  check(preview.x >= 0 && preview.y >= 0 && preview.x + preview.width <= 900 && preview.y + preview.height <= 700, 'preview fits a smaller desktop viewport');
  await p.locator('#pane-shot').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await p.locator('#timeline .clip.sel').focus();
  const selectedBefore = await p.evaluate(() => window.__storycuts.state.selected);
  await p.keyboard.press('ArrowRight');
  check(await p.evaluate(() => window.__storycuts.state.selected) !== selectedBefore, 'timeline shots can be selected with the keyboard');
  check(await p.locator('#pane-shot').evaluate((el) => el.scrollTop === 0), 'selecting another shot returns its inspector to the top');
  await sleep(650);
  await shot(p, '13-editor-small-desktop');
  // missing character pictures are reported honestly
  await p.click('#ed-close'); await sleep(700);
  await p.click('#btn-show-cast');
  await p.locator('#chars [data-character=dad] [data-k=description]').fill('Tall dad in a green sweater');
  check(await p.evaluate(() => window.__storycuts.state.project.segments.filter((s) => s.scene?.actors.some((a) => a.character_id === 'dad') && s.image?.key).every((s) => s.image.stale)), 'a changed character marks its existing scenes for updating');
  await p.evaluate(() => window.__storycuts.state.project.characters.forEach((c) => delete c.image));
  await p.click('#stepper li[data-s="3"] button'); await sleep(300);
  await p.click('#stepper li[data-s="4"] button'); await sleep(800);
  check(await p.isVisible('#btn-gen-chars') && !(await p.isVisible('#ready-card')), 'missing character pictures show the Draw button, not "ready"');
  await ctx.close();

  // ===== phone =====
  const mctx = await newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await mctx.newPage();
  watch(m, 'phone');
  await m.goto(URL0); await sleep(700); await shot(m, 'p01-landing');
  const noSideScroll = async (where) => check(await m.evaluate(() => document.documentElement.scrollWidth) <= 390, `no sideways scroll on phone: ${where}`);
  await noSideScroll('landing');
  await m.click('#cta-demo'); await sleep(900); await shot(m, 'p02-style'); await noSideScroll('style');
  check(await m.locator('#btn-style-next').evaluate((el) => el.scrollWidth <= el.clientWidth), 'style Continue label fits its phone button');
  check(await m.evaluate(() => {
    const card = document.querySelector('.style-card.on').getBoundingClientRect();
    return card.bottom <= document.querySelector('#style-track').getBoundingClientRect().bottom && card.bottom <= document.querySelector('#panel-style .wiz-nav').getBoundingClientRect().top;
  }), 'selected style details stay above the phone footer');
  await m.click('#btn-style-next'); await sleep(800); await shot(m, 'p03-settings'); await noSideScroll('settings');
  await m.click('#panel-settings [data-next="4"]'); await sleep(800); await shot(m, 'p04-create'); await noSideScroll('create');
  check(await m.locator('#btn-create').evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, Math.min(innerHeight - 1, rect.y + rect.height / 2));
    return rect.bottom <= innerHeight && (hit === el || el.contains(hit));
  }), 'Create action is visible above the phone footer');
  await m.click('#btn-create');
  await m.waitForFunction(() => !document.querySelector('#btn-gen-chars').hidden, null, { timeout: 30000 });
  await sleep(500); await shot(m, 'p05-characters'); await noSideScroll('characters');
  await m.click('#btn-gen-chars');
  await m.waitForFunction(() => document.querySelectorAll('.char-art img').length === 3, null, { timeout: 30000 });
  await m.click('#btn-approve'); await sleep(600);
  await m.click('.work .btn.primary');
  await sleep(150); await shot(m, 'p06b-background-editor');
  const pill = await m.locator('.work-pill').boundingBox();
  const mobileStage = await m.locator('#stage').boundingBox();
  check(pill.x >= 0 && pill.x + pill.width <= 390 && pill.y + pill.height <= mobileStage.y, 'background pill fits above the phone preview');
  await m.waitForFunction(() => !window.__storycuts.state.genAbort, null, { timeout: 60000 });
  await sleep(600);
  check(await m.evaluate(() => document.body.classList.contains('ed-full')), 'editor is full-screen on phone');
  await shot(m, 'p06-editor');
  await m.click('#ed-tabs button[data-tab=shot]'); await sleep(600);
  check(await m.evaluate(() => document.querySelector('#ed-sheet').classList.contains('open')), 'phone tool sheet slides up');
  await shot(m, 'p07-sheet');
  await m.click('#sheet-done'); await sleep(500);
  check(await m.evaluate(() => document.activeElement?.id) === 'tab-shot', 'closing the phone sheet returns focus to its tool');
  for (const t of ['sound', 'captions', 'filters', 'trans', 'export']) {
    await m.click(t === 'export' ? '#ed-export' : `#ed-tabs [data-tab=${t}]`); await sleep(350);
    check(await m.isVisible(`.ed-panel[data-pane=${t}]`), `phone tool "${t}" is reachable`);
    await shot(m, `p08-tool-${t}`); await noSideScroll(t);
    if (t === 'sound') {
      const focused = await m.evaluate(() => ({ id: document.activeElement.id, tag: document.activeElement.tagName, inside: !!document.activeElement.closest('#ed-sheet') }));
      check(focused.inside && focused.id === 'sheet-done', 'opening a phone tool moves focus into the sheet');
      await m.keyboard.press('Shift+Tab');
      check(await m.evaluate(() => !!document.activeElement?.closest('#ed-sheet')), 'phone sheet contains keyboard focus');
      await m.keyboard.press('Escape');
    } else await m.click('#sheet-done');
  }
  await m.click('#ed-tabs [data-tab=shot]'); await sleep(350);
  await m.locator('#ed-scrim').click({ position: { x: 8, y: 100 } });
  check(!(await m.evaluate(() => document.body.classList.contains('sheet-open'))), 'tapping outside the phone sheet closes it');
  await noSideScroll('editor');
  await mctx.close();

  // Reduced motion still leaves the landing and progress visuals readable.
  const rctx = await newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const r = await rctx.newPage(); watch(r, 'reduced motion');
  await r.goto(URL0); await sleep(400);
  check(await r.evaluate(() => document.querySelector('#hero-talk').paused), 'reduced motion pauses the autoplay hero');
  await r.evaluate(async () => {
    const { showWork } = await import('./js/loader.js');
    window.testWork = showWork({ kind: 'plan', title: 'Planning your story', tips: ['Finding the moments to bring to life.'], steps: ['Plan the edit', 'Check the scenes'] });
  });
  await shot(r, 'p09-reduced-motion-progress');
  check(await r.isVisible('.work-title') && await r.evaluate(() => getComputedStyle(document.querySelector('.wv-plan .card')).opacity === '1'), 'reduced motion keeps the progress illustration visible');
  await r.evaluate(() => window.testWork.stop());
  await rctx.close();
} catch (e) {
  check(false, 'test run finished', e.message.split('\n')[0]);
}

check(errors.length === 0, 'no errors in the browser console', errors.slice(0, 5).join(' | '));
await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed. Screenshots: tests/out/` : '\nAll checks passed. Screenshots: tests/out/');
process.exit(failures ? 1 : 0);
