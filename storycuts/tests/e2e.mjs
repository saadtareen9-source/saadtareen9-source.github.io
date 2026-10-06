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
const shotStripFits = () => {
  const card = document.querySelector('#story-showreel');
  const style = getComputedStyle(card);
  const strip = document.querySelector('.showreel-timeline').getBoundingClientRect();
  const usableWidth = card.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  return Math.abs(strip.width - usableWidth) < 1 && document.querySelector('#example-scrub').getBoundingClientRect().height >= 40;
};
const sdk = fs.readFileSync(path.join(HERE, 'fixtures/anthropic-sdk.mjs'));
const storyText = fs.readFileSync(path.join(HERE, 'fixtures/story.txt'), 'utf8').trim();
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
async function newContext(opts, { mockListening = false, failListening = false, connectAI = true, owner = true } = {}) {
  const ctx = await browser.newContext(opts);
  ctx.plannerRequests = [];
  ctx.providerRequests = [];
  ctx.on('request', (r) => { if (/https:\/\/api\.(anthropic|openai)\.com\//.test(r.url())) ctx.providerRequests.push(r.url()); });
  // Keep the suite offline: use the site's system font fallback in tests.
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
  await ctx.addInitScript(({ connectAI, owner }) => {
    if (connectAI) {
      localStorage.setItem('storycuts:key', JSON.stringify('sk-ant-test'));
      localStorage.setItem('storycuts:okey', JSON.stringify('sk-openai-test'));
    }
    if (owner) localStorage.setItem('storycuts:owner', 'true');
  }, { connectAI, owner });
  await ctx.route('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk/+esm', (r) => r.fulfill({ body: sdk, contentType: 'application/javascript', headers: cors }));
  // Stub only the downloaded model. Keep transcribeInBrowser, audio decoding,
  // speechSpans, wordsFromText and subtitle parsing as the real site modules.
  if (mockListening) {
    const chunks = storyText.split(/\s+/).map((text, i, all) => ({ text, timestamp: [+(i * 44 / all.length).toFixed(3), +((i + 1) * 44 / all.length).toFixed(3)] }));
    await ctx.route('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/+esm', (r) => r.fulfill({ contentType: 'application/javascript', headers: cors, body: `
      export const env = {};
      export async function pipeline() {
        window.__speechModelLoads = (window.__speechModelLoads || 0) + 1;
        return async () => {
          window.__speechCalls = (window.__speechCalls || 0) + 1;
          await new Promise(resolve => setTimeout(resolve, 650));
          ${failListening ? "throw new Error('Test speech model unavailable');" : `return { chunks: ${JSON.stringify(chunks)} };`}
        };
      }
    ` }));
  }
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
    else { ctx.plannerRequests.push(body); out = PLAN; await sleep(800); }
    r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse(out) });
  });
  return ctx;
}
const watch = (page, tag) => {
  page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_CERT|fonts\.g/.test(m.text())) errors.push(`${tag} console: ${m.text()}`); });
};
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const waitForCast = (page) => page.waitForFunction(() => window.__storycuts.state.project.segments.length && !window.__storycuts.state.busy && !document.querySelector('#cast').classList.contains('hidden'), null, { timeout: 30000 });
async function openStory(page, name = 'story.webm') {
  await page.goto(`${URL0}#studio`);
  if (await page.evaluate(() => !!window.__storycuts?.state.project)) await page.reload();
  if (!(await page.locator('#rights').isChecked())) await page.locator('label:has(#rights)').click();
  await page.locator('#file').setInputFiles({ name, mimeType: 'video/webm', buffer: fs.readFileSync(path.join(HERE, 'fixtures/story.webm')) });
  await page.waitForFunction((name) => window.__storycuts.state.step === 2 && window.__storycuts.state.file?.name === name, name);
  await page.click('#btn-style-next');
  await page.click('#panel-settings [data-next="4"]');
  await page.waitForSelector('#create-start:not(.hidden)');
}
const timedSpeech = (words) => words.length > 100 && words[0].s > .9 && words.at(-1).e <= 43.05 && words.every((w, i) => Number.isFinite(w.s) && Number.isFinite(w.e) && w.e > w.s && (!i || w.s >= words[i - 1].s)) && !words.some((w) => w.s > 20.4 && w.s < 21.7);
async function fitsPhone(page, name) {
  check(await page.evaluate(() => document.documentElement.scrollWidth <= 390 && [...document.querySelectorAll('#panel-create button, #panel-create textarea, #panel-create input, #panel-create .row')].filter((el) => el.getClientRects().length).every((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; })), `story controls fit the phone: ${name}`);
}

try {
  // ===== first visit: useful editor and honest plan previews, no accounts =====
  for (const phone of [false, true]) {
    const tag = phone ? 'phone sample' : 'desktop sample';
    const sampleCtx = await newContext({ viewport: { width: phone ? 390 : 1300, height: phone ? 844 : 1000 }, isMobile: phone, hasTouch: phone, acceptDownloads: true }, { connectAI: false, owner: false });
    const s = await sampleCtx.newPage(); watch(s, tag);
    await s.goto(URL0);
    await s.locator('.plan [data-plan=creator]').click();
    check(await s.locator('#paywall').evaluate((el) => el.open) && /Subscriptions open soon/.test(await s.locator('#pay-selection').textContent()), `${tag}: an unavailable plan opens a clear preview instead of a dead end`);
    await s.click('#pay-period [data-period=yearly]');
    check(await s.getAttribute('#pay-plans [data-plan=creator]', 'aria-pressed') === 'true' && /\$432 billed yearly/.test(await s.locator('#pay-selection').textContent()), `${tag}: selected plan and billing period remain clear without taking a payment`);
    check(await s.locator('#paywall').evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth && [...dialog.querySelectorAll('button, .modal-head, .pay-selection')].every((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && el.scrollWidth <= el.clientWidth + 1; })), `${tag}: plan descriptions and buttons fit without clipped text or sideways scrolling`);
    await shot(s, phone ? 'p14-plan-preview' : '14-plan-preview');
    await s.click('#pay-demo');
    await s.waitForFunction(() => window.__storycuts.state.step === 5 && window.__storycuts.state.sampleEditor && window.__storycuts.state.project.approved, null, { timeout: 15000 });
    await s.waitForFunction(() => document.querySelector('#timeline .clip.scene .thumbs')?.style.backgroundImage.includes('url('));
    await sleep(400);
    check(await s.isVisible('#sample-editor-note') && !(await s.locator('#settings').evaluate((el) => el.open)) && await s.locator('#timeline .clip').count() === 4, `${tag}: a ready-made sample opens the full editor without keys or a subscription`);
    check(await s.locator('#cast-guide > .complete').count() === 3 && await s.locator('#cast-guide > .current').count() === 0 && await s.locator('#cast-guide > div:last-child b').textContent() === 'Cast ready', `${tag}: an approved cast shows a completed workflow instead of another approval task`);
    check(await s.evaluate(() => { const st = window.__storycuts.state; return st.project.segments.find((seg) => seg.id === st.selected).start <= st.media.time && st.project.segments.find((seg) => seg.id === st.selected).end > st.media.time; }), `${tag}: the opening sample preview and shot inspector show the same shot`);
    check(sampleCtx.providerRequests.length === 0 && await s.evaluate(() => !localStorage.getItem('storycuts:key') && !localStorage.getItem('storycuts:okey') && !localStorage.getItem('storycuts:owner')), `${tag}: exploring the sample makes no provider requests and does not grant paid access`);
    await shot(s, phone ? 'p15-sample-editor' : '15-sample-editor');
    const start = await s.evaluate(() => window.__storycuts.state.media.time);
    await s.click('#btn-play'); await sleep(700); await s.click('#btn-play');
    check(await s.evaluate(() => window.__storycuts.state.media.time) > start + .4, `${tag}: sample playback advances the real editor playhead`);
    await s.click('#ed-tabs [data-tab=captions]');
    await s.locator('label:has(#opt-captions)').click();
    check(await s.evaluate(() => !window.__storycuts.state.project.settings.captions), `${tag}: sample caption controls change the project`);
    if (phone) await s.click('#sheet-done');
    await s.click('#btn-undo');
    check(await s.evaluate(() => window.__storycuts.state.project.settings.captions), `${tag}: sample edits use the existing undo history`);
    await s.click('#ed-tabs [data-tab=filters]');
    await s.click('#filter-grid [data-filter=warm]');
    const beforeSlider = await s.evaluate(() => window.__storycuts.state.history.length);
    await s.locator('#filter-amt').evaluate((input) => {
      for (const value of [.8, .6, .4]) { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    check(await s.evaluate(() => window.__storycuts.state.history.length) === beforeSlider + 1, `${tag}: a continuous settings adjustment makes one undo entry`);
    if (phone) await s.click('#sheet-done');
    await s.click('#btn-undo');
    check(await s.evaluate(() => window.__storycuts.state.project.settings.filter === 'warm' && window.__storycuts.state.project.settings.filterAmt === 1) && await s.locator('#filter-amt').inputValue() === '1', `${tag}: undo restores both the picture setting and its control`);
    await s.click('#btn-undo');
    check(await s.evaluate(() => window.__storycuts.state.project.settings.filter === 'none') && await s.getAttribute('#filter-grid [data-filter=none]', 'class') === 'filter-tile on', `${tag}: filter choices can be undone and the selected tile follows`);
    if (!phone) {
      await s.click('#ed-export');
      const download = s.waitForEvent('download', { timeout: 45000 });
      await s.click('#btn-export');
      const exported = await download;
      check(/storycuts-vertical\.(webm|mp4)$/.test(exported.suggestedFilename()) && fs.statSync(await exported.path()).size > 10000, 'the sample exports a real video using the existing renderer');
    }
    check(await s.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tag}: the sample editor has no sideways page scrolling`);
    await s.click('#btn-sample-start'); await s.click('#btn-demo');
    check(await s.evaluate(() => !window.__storycuts.state.sampleEditor && window.__storycuts.state.project.duration === 44 && !window.__storycuts.state.project.approved), `${tag}: starting the guided demo keeps sample edits separate`);
    await sampleCtx.close();
  }

  // Subscription only: own AI keys without a plan can't create, the key setup
  // is hidden from the public, and a hand-typed checkout return can't unlock it.
  const byokCtx = await newContext({ viewport: { width: 1300, height: 1000 } }, { mockListening: true, owner: false });
  const byok = await byokCtx.newPage(); watch(byok, 'subscription lock');
  await byok.goto(URL0); await sleep(300);
  check(!(await byok.isVisible('#btn-keys')), 'the public site has no AI key setup button');
  await openStory(byok);
  await byok.click('#btn-create'); await sleep(400);
  check(await byok.locator('#paywall').evaluate((el) => el.open) && !(await byok.isVisible('#btn-advanced-preview')), 'creating without a subscription opens the plans, with no own-keys option');
  check(byokCtx.plannerRequests.length === 0 && byokCtx.providerRequests.length === 0, 'no AI requests happen without a subscription, even with keys in the browser');
  await byok.goto(`${URL0}?checkout=success&plan=studio`); await sleep(400);
  check(await byok.evaluate(() => !localStorage.getItem('storycuts:plan')), 'a hand-typed checkout return does not unlock creating while checkout is closed');
  await byokCtx.close();

  // ===== desktop: the full flow =====
  const ctx = await newContext({ viewport: { width: 1300, height: 1000 } });
  const p = await ctx.newPage();
  watch(p, 'desktop');
  const step = () => p.evaluate(() => document.querySelector('.wizard > .panel.active')?.dataset.step);
  await p.goto(URL0); await sleep(600); await shot(p, '01-landing');
  check(await p.evaluate(shotStripFits), 'the desktop shot strip fills its preview card and is easy to scrub');
  check(!(await p.isVisible('#studio')), 'landing keeps the creation workspace focused and separate');
  check(await p.evaluate(() => document.querySelector('#showreel-art').naturalWidth > 0 && document.querySelector('#story-showreel .phone-screen').classList.contains('cut')), 'the landing immediately shows the illustrated result');
  await p.click('#btn-example-play');
  await p.click('[data-showcase=rain]');
  check(await p.getAttribute('#story-showreel', 'data-demo-story') === 'rain' && (await p.getAttribute('#example-original', 'poster')).endsWith('man.jpg') && (await p.getAttribute('#showreel-art', 'src')).endsWith('rain.jpg'), 'choosing another story changes both the creator footage and illustration');
  check(await p.evaluate(() => [...document.querySelectorAll('[data-showreel-frame]')].every((img) => img.getAttribute('src').endsWith(img.dataset.showreelFrame === 'face' ? 'man.jpg' : 'rain.jpg'))), 'the landing shot strip shows the footage and artwork for the selected story');
  await p.click('button[data-demo-view=original]');
  check(!(await p.locator('#story-showreel .phone-screen').evaluate((el) => el.classList.contains('cut'))) && await p.getAttribute('button[data-demo-view=original]', 'aria-pressed') === 'true', 'Original shows camera footage and marks the comparison choice');
  check(await p.evaluate(() => [...document.querySelectorAll('[data-showreel-frame]')].every((img) => img.getAttribute('src').endsWith('man.jpg'))), 'the Original comparison also shows original footage in the shot strip');
  await p.click('button[data-demo-view=result]');
  check(await p.locator('#story-showreel .phone-screen').evaluate((el) => el.classList.contains('cut')), 'StoryCuts shows the illustrated comparison');
  await p.locator('#example-scrub').evaluate((el) => { el.value = '6.2'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  check(await p.getAttribute('#btn-example-play', 'aria-label') === 'Play example' && !(await p.locator('#story-showreel .phone-screen').evaluate((el) => el.classList.contains('cut'))) && (await p.locator('#showreel-time').textContent()).startsWith('0:06'), 'scrubbing pauses the example at the camera shot and updates its time');
  await p.locator('#example-scrub').evaluate((el) => { el.value = '1.2'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  check(await p.locator('#story-showreel .phone-screen').evaluate((el) => el.classList.contains('cut')), 'scrubbing back reaches the illustrated shot');
  await p.click('[data-showcase=breakfast]'); await sleep(250); await shot(p, '01j-story-example');
  check((await p.getAttribute('#example-original', 'poster')).endsWith('creator.jpg') && await p.getAttribute('[data-showcase=breakfast]', 'aria-pressed') === 'true', 'the third example uses another licensed camera-facing creator');
  await p.click('[data-showcase=airport]'); await p.click('#btn-example-play');
  for (const [selector, name] of [['#styles', '01c-landing-styles'], ['#how', '01d-landing-how'], ['.story-showcase', '01e-landing-showcase'], ['#pricing', '01f-landing-pricing'], ['#faq', '01g-landing-faq'], ['.cta-band', '01h-landing-footer']]) {
    await p.locator(selector).scrollIntoViewIfNeeded(); await sleep(450); await shot(p, name);
  }
  check(await p.evaluate(() => ['#hero-talk', '#example-original'].every((s) => document.querySelector(s).paused) && document.querySelector('#story-showreel').dataset.playing === 'false'), 'both example videos stop playing when the landing preview is offscreen');
  await p.locator('#nav-plan').click(); await sleep(400);
  await p.click('#btn-keys'); await sleep(200); await shot(p, '01i-connections');
  await p.keyboard.press('Escape');
  check(await p.isVisible('#panel-upload') && !(await p.isVisible('.hero')), 'Open studio shows the upload journey');
  check(await p.getAttribute('#stepper [data-s="1"] button', 'aria-current') === 'step' && await p.isDisabled('#stepper [data-s="2"] button'), 'journey marks the current step and guards unavailable steps');
  await p.click('.studio-home'); await sleep(350);
  await p.goBack(); await sleep(350);
  check(await p.isVisible('#panel-upload') && !(await p.isVisible('.hero')), 'browser Back restores the studio');
  await p.goForward(); await sleep(350);
  check(await p.isVisible('.hero') && !(await p.isVisible('#studio')), 'browser Forward restores the landing');
  await p.locator('#nav-plan').click(); await sleep(350);
  await shot(p, '01b-upload');
  const chooser = p.waitForEvent('filechooser');
  await p.locator('#drop').focus(); await p.keyboard.press('Enter');
  check(!!(await chooser), 'upload can be opened with the keyboard');
  await p.locator('#file').setInputFiles(path.join(HERE, 'fixtures/upload.webm'));
  check(await step() === '1' && await p.isVisible('#upload-rights-note') && await p.evaluate(() => document.activeElement?.id === 'rights'), 'video upload puts its permission reminder beside the checkbox and focuses the correction');
  await p.locator('label:has(#rights)').click();
  check(!(await p.isVisible('#upload-rights-note')) && await p.getAttribute('#rights', 'aria-invalid') === null, 'confirming video permission clears the inline reminder');
  await p.locator('#file').setInputFiles(path.join(HERE, 'fixtures/upload.webm'));
  await p.waitForFunction(() => window.__storycuts.state.step === 2);
  check(await p.evaluate(() => window.__storycuts.state.file?.name === 'upload.webm' && document.querySelector('#video').src.startsWith('blob:')), 'a real local video opens the style step without uploading the video');
  await p.click('#stepper [data-s="1"] button');
  await p.click('#btn-demo'); await sleep(900);
  check(await step() === '2', 'demo opens the style step');
  check(await p.locator('#style-track .style-card:visible').count() === 9, 'all nine art choices are available in the gallery');
  await p.locator('#style-track [data-style=anime]').click();
  await p.locator('#style-track [data-style=anime]').click();
  check(await step() === '2', 'selecting a style waits for the explicit Continue action');
  check(await p.evaluate(() => document.querySelector('#style-hero-art').src === document.querySelector('#style-track [data-style=anime] img').src && document.querySelector('#style-hero-title').textContent.includes('Anime')), 'the larger style preview follows the selected art direction');
  await p.locator('#style-track [data-style=anime]').focus(); await p.keyboard.press('End');
  check(await p.getAttribute('#style-track [data-style=custom]', 'aria-selected') === 'true' && await p.isVisible('#custom-style'), 'gallery keyboard navigation reaches the custom style');
  await p.keyboard.press('Home');
  check(await p.getAttribute('#style-track [data-style=stick]', 'aria-selected') === 'true', 'gallery keyboard navigation returns to the first style');
  await p.click('.studio-home'); await p.locator('#nav-plan').click(); await sleep(350);
  check(await step() === '2', 'returning to the studio preserves the current story and step');
  await shot(p, '02-style');
  check(await p.locator('#btn-style-next').evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight), 'style Continue stays visible while browsing the desktop gallery');
  await p.click('#btn-style-next'); await sleep(800);
  check(await step() === '3', 'continue goes to settings');
  check(!(await p.locator('#setup-details').evaluate((el) => el.open)) && !(await p.isVisible('#seg-motion')) && await p.isVisible('#seg-pacing'), 'video setup starts with the two main choices and keeps extra controls optional');
  check(await p.getAttribute('#seg-motion button.on', 'data-motion') === 'living', 'living pictures is the default');
  await shot(p, '03-settings');
  check(await p.evaluate(() => [...document.querySelectorAll('#seg-pacing .cut-example i')].every((el) => getComputedStyle(el).backgroundImage.includes('url(') && el.getBoundingClientRect().height >= 40)), 'all pacing choices show actual photo and illustration previews instead of color bars');
  await p.click('#btn-settings-preview');
  check(await p.evaluate(() => [...document.querySelectorAll('.example-player img, .option-preview img')].every((img) => getComputedStyle(img).animationPlayState === 'paused')) && await p.getAttribute('#btn-settings-preview', 'aria-label') === 'Play settings example', 'Pause example stops all settings preview motion');
  await p.click('#btn-settings-preview');
  check(await p.getAttribute('#panel-settings', 'data-preview-paused') === 'false' && await p.getAttribute('#btn-settings-preview', 'aria-label') === 'Pause settings example', 'Play example resumes the settings previews');
  await p.click('#seg-pacing [data-pacing=bookends]');
  check(await p.getAttribute('#example-player', 'data-pacing') === 'bookends' && await p.locator('#example-sequence .face').count() === 2, 'pacing choice shows an intro-and-outro shot example');
  check(await p.getAttribute('#seg-pacing [data-pacing=bookends]', 'aria-pressed') === 'true' && await p.getAttribute('#seg-pacing [data-pacing=mostly]', 'aria-pressed') === 'false', 'settings choices announce the selected option to assistive technology');
  await p.click('#setup-details > summary');
  await p.click('#seg-format [data-aspect=horizontal]'); await p.click('#seg-face [data-face=bubble]'); await p.click('#seg-motion [data-motion=still]');
  check(await p.locator('#setup-detail-summary').textContent() === 'Still pictures · face bubble', 'the optional setup summary reflects the current camera and motion choices');
  check(await p.getAttribute('#example-player', 'data-format') === 'horizontal' && await p.getAttribute('#example-player', 'data-face') === 'bubble' && await p.getAttribute('#example-player', 'data-motion') === 'still', 'settings preview follows format, face bubble and motion choices');
  await p.locator('#settings-example').scrollIntoViewIfNeeded(); await sleep(400); await shot(p, '03b-settings-example');
  await p.locator('#seg-motion').scrollIntoViewIfNeeded(); await shot(p, '03c-motion-examples');
  await p.locator('#seg-face').scrollIntoViewIfNeeded(); await shot(p, '03d-face-examples');
  await p.click('#btn-reset-setup');
  check(await p.evaluate(() => { const s = window.__storycuts.state.project.settings; return s.aspect === 'vertical' && s.pacing === 'mostly' && s.faceMode === 'full' && s.sceneMotion === 'living'; }), 'one-click recommended settings restores the existing defaults');
  await p.click('#panel-settings [data-next="4"]'); await sleep(800);
  check(await step() === '4', 'continue goes to create');
  await shot(p, '04-create');
  await p.click('#btn-create');
  await p.waitForSelector('#transcript-review:not(.hidden)'); await sleep(300); await shot(p, '04b-check-transcript');
  check(ctx.plannerRequests.length === 0, 'default flow checks the words before sending them to the planner');
  await p.click('#btn-review-continue'); await sleep(500);
  check(await p.isVisible('.work'), 'full-screen progress shows while planning');
  await shot(p, '05-planning');
  await p.waitForFunction(() => !document.querySelector('#cast').classList.contains('hidden') && !document.querySelector('#btn-gen-chars').hidden, null, { timeout: 30000 });
  await sleep(500);
  check(!(await p.isVisible('.work')), 'progress screen closes after planning');
  const segs = await p.evaluate(() => window.__storycuts.state.project.segments.filter((s) => s.scene).map((s) => ({ a: s.scene.actors.map((x) => x.character_id).join(','), off: (s.scene.offscreen || []).join(','), loc: s.scene.location_id })));
  check(segs.some((s) => s.a === 'jake' && s.loc === 'jake_room') && segs.some((s) => s.a === 'me' && s.off === 'jake'), 'texting is split into two shots, one per place', JSON.stringify(segs));
  await shot(p, '06-characters');
  check(await p.locator('#chars .char:visible').count() === 1 && await p.locator('#cast-position').textContent() === 'Character 1 of 3', 'character review shows one focused card with its position in the cast');
  await p.locator('#cast-jump [data-cast-jump=me]').focus(); await p.keyboard.press('ArrowRight');
  check(await p.getAttribute('#cast-jump [data-cast-jump=dad]', 'aria-selected') === 'true' && await p.isVisible('#chars [data-character=dad]'), 'character tabs support arrow-key navigation');
  await p.keyboard.press('Home');
  check(await p.getAttribute('#cast-jump [data-cast-jump=me]', 'tabindex') === '0' && await p.getAttribute('#cast-jump [data-cast-jump=dad]', 'tabindex') === '-1', 'only the selected character tab is in the keyboard tab order');
  await p.click('#btn-add-char');
  check(await p.evaluate(() => document.activeElement?.matches('#chars .char:last-child [data-k=name]')), 'adding a character opens an inline name field');
  await p.locator('#chars .char:last-child [data-k=name]').fill('Grandma');
  await p.locator('#chars .char:last-child [data-k=description]').fill('Gray bob, round glasses, cream cardigan');
  check(await p.evaluate(() => window.__storycuts.state.project.characters.at(-1).name === 'Grandma'), 'character edits save without a dialog');
  check(await p.locator('#chars .char:last-child .avatar').textContent() === 'G', 'editing a character name updates its undrawn portrait label');
  await p.locator('#chars .char:last-child [data-del]').click();
  check(await p.evaluate(() => window.__storycuts.state.project.characters.length) === 3, 'inline character can be removed');
  check(await p.evaluate(() => document.activeElement?.matches('#chars .char:not([hidden]) [data-k=name]')), 'removing the active character returns focus to the next available character');
  for (let i = 0; i < 6; i++) await p.click('#btn-add-char');
  check(await p.evaluate(() => window.__storycuts.state.project.characters.length) === 8, 'character limit prevents an extra character being silently discarded');
  for (let i = 0; i < 5; i++) await p.locator('#chars .char:last-child [data-del]').click();
  await p.click('#cast-jump [data-cast-jump=dad]');
  await p.locator('#chars [data-character=dad] [data-k=name]').fill('Dad the cook');
  check(await p.getAttribute('#chars [data-character=dad] [data-redraw]', 'aria-label') === 'Draw Dad the cook', 'renaming a character also updates its accessible drawing button label');
  check(await p.getAttribute('#cast-jump [data-cast-jump=dad]', 'aria-label') === 'Edit Dad the cook', 'renaming a character updates its cast navigation label');
  await p.click('#cast-jump [data-cast-jump=jake]');
  check(await p.evaluate(() => document.activeElement?.matches('#chars [data-character=jake] [data-k=name]')), 'cast navigation takes the creator directly to the chosen name field');
  await p.click('#btn-gen-chars'); await sleep(400);
  check(await p.isVisible('.work'), 'progress screen shows while drawing characters');
  await shot(p, '06b-drawing-cast');
  await p.waitForFunction(() => document.querySelectorAll('.char-art img').length === 3, null, { timeout: 30000 });
  await sleep(600);
  const dadKey = await p.evaluate(() => window.__storycuts.state.project.characters.find((c) => c.id === 'dad').image.key);
  await p.click('#cast-jump [data-cast-jump=dad]');
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
  await p.locator('#chars [data-character=dad] [data-character-preview]').click();
  check(await p.locator('#character-preview').evaluate((el) => el.open) && await p.locator('#portrait-preview-title').textContent() === 'Dad' && await p.evaluate(() => document.querySelector('#portrait-preview-image').src === document.querySelector('#chars [data-character=dad] .char-art > img').src), 'character review opens the current drawing with the current name');
  await shot(p, '07c-character-review');
  await p.keyboard.press('Escape');
  check(await p.evaluate(() => !document.querySelector('#character-preview').open && document.activeElement?.matches('#chars [data-character=dad] [data-character-preview]')), 'closing character review returns keyboard focus to its preview button');
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
  const editorOrder = () => document.querySelector('#stage').getBoundingClientRect().bottom <= document.querySelector('.tl').getBoundingClientRect().top + 1 && document.querySelector('.tl').getBoundingClientRect().bottom <= document.querySelector('.transport').getBoundingClientRect().top + 1 && document.querySelector('.transport').getBoundingClientRect().bottom <= document.querySelector('#ed-tabs').getBoundingClientRect().top + 1;
  check(await p.evaluate(editorOrder), 'desktop editor places the timeline, playback controls, and tools below the video');
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
  const zoomWidth = await p.locator('#timeline .clip').first().evaluate((el) => el.getBoundingClientRect().width);
  const zoomTime = await p.evaluate(() => window.__storycuts.state.media.time);
  await p.click('#zoom-in');
  check(await p.locator('#timeline .clip').first().evaluate((el) => el.getBoundingClientRect().width) > zoomWidth && await p.evaluate((time) => Math.abs(window.__storycuts.state.media.time - time) < .03, zoomTime), 'desktop timeline zoom increases detail without moving the video position');
  await p.click('#zoom-out');
  check(Math.abs(await p.locator('#timeline .clip').first().evaluate((el) => el.getBoundingClientRect().width) - zoomWidth) < 1, 'desktop zoom out restores the previous timeline scale');
  await p.locator('#timeline .clip.face').first().click(); await sleep(400); await shot(p, '09b-editor-demo');
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
  await p.click('#cast-jump [data-cast-jump=dad]');
  await p.locator('#chars [data-character=dad] [data-k=description]').fill('Tall dad in a green sweater');
  check(await p.evaluate(() => window.__storycuts.state.project.segments.filter((s) => s.scene?.actors.some((a) => a.character_id === 'dad') && s.image?.key).every((s) => s.image.stale)), 'a changed character marks its existing scenes for updating');
  await p.evaluate(() => window.__storycuts.state.project.characters.forEach((c) => delete c.image));
  await p.click('#stepper li[data-s="3"] button'); await sleep(300);
  await p.click('#stepper li[data-s="4"] button'); await sleep(800);
  check(await p.isVisible('#btn-gen-chars') && !(await p.isVisible('#ready-card')), 'missing character pictures show the Draw button, not "ready"');
  await p.evaluate(() => {
    const st = window.__storycuts.state;
    st.project.characters.forEach((c) => { c.image = { key: 'test/current' }; });
    st.project.segments.forEach((s) => { if (s.scene && s.type !== 'face') s.image = { key: 'test/current' }; });
  });
  await p.click('#stepper [data-s="2"] button');
  await p.click('#style-track [data-style=anime]');
  check(await p.evaluate(() => {
    const p = window.__storycuts.state.project;
    return p.characters.every((c) => c.image.stale) && p.segments.filter((s) => s.type !== 'face' && s.scene).every((s) => s.image.stale);
  }), 'changing the art style marks both cast and scenes for updating');
  await ctx.close();

  // ===== phone =====
  const mctx = await newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await mctx.newPage();
  watch(m, 'phone');
  await m.goto(URL0); await sleep(700); await shot(m, 'p01-landing');
  check(await m.evaluate(shotStripFits), 'the phone shot strip fills its preview card and is easy to scrub');
  const noSideScroll = async (where) => check(await m.evaluate(() => document.documentElement.scrollWidth) <= 390, `no sideways scroll on phone: ${where}`);
  await noSideScroll('landing');
  await m.click('[data-showcase=rain]');
  await m.click('button[data-demo-view=original]');
  await m.click('button[data-demo-view=result]');
  check(await m.getAttribute('[data-showcase=rain]', 'aria-pressed') === 'true' && await m.locator('#story-showreel .phone-screen').evaluate((el) => el.classList.contains('cut')), 'phone story and comparison controls show the selected illustrated example');
  await shot(m, 'p01i-story-example'); await noSideScroll('interactive example');
  for (const [selector, name] of [['#styles', 'p01b-landing-styles'], ['#how', 'p01c-landing-how'], ['.story-showcase', 'p01d-landing-showcase'], ['#pricing', 'p01e-landing-pricing'], ['#faq', 'p01f-landing-faq'], ['.cta-band', 'p01g-landing-footer']]) {
    await m.locator(selector).scrollIntoViewIfNeeded(); await sleep(350); await shot(m, name); await noSideScroll(name);
  }
  await m.click('#btn-keys'); await sleep(200); await shot(m, 'p01h-connections');
  await m.keyboard.press('Escape');
  await m.click('#cta-demo'); await sleep(900); await shot(m, 'p02-style'); await noSideScroll('style');
  check(await m.locator('#btn-style-next').evaluate((el) => el.innerText.trim() === 'Set up video' && el.scrollWidth <= el.clientWidth), 'the style action names the next step and fits its phone button');
  check(await m.evaluate(() => {
    const card = document.querySelector('.style-card.on').getBoundingClientRect();
    return card.bottom <= document.querySelector('#style-track').getBoundingClientRect().bottom && card.bottom <= document.querySelector('#panel-style .wiz-nav').getBoundingClientRect().top;
  }), 'selected style details stay above the phone footer');
  await m.click('#btn-style-next'); await sleep(800); await shot(m, 'p03-settings'); await noSideScroll('settings');
  await m.click('#btn-settings-preview');
  check(await m.getAttribute('#panel-settings', 'data-preview-paused') === 'true', 'phone creators can pause the settings example');
  await m.click('#btn-settings-preview');
  await m.click('#setup-details > summary');
  await m.click('#seg-pacing [data-pacing=story]'); await m.click('#seg-face [data-face=bubble]');
  await m.locator('#settings-example').scrollIntoViewIfNeeded(); await sleep(300); await shot(m, 'p03b-settings-example'); await noSideScroll('settings example');
  await m.locator('#seg-motion').scrollIntoViewIfNeeded(); await shot(m, 'p03c-motion-examples'); await noSideScroll('motion examples');
  await m.locator('#seg-face button').last().scrollIntoViewIfNeeded(); await sleep(300); await shot(m, 'p03d-face-examples'); await noSideScroll('face examples');
  await m.click('#seg-pacing [data-pacing=mostly]'); await m.click('#seg-face [data-face=full]');
  await m.click('#panel-settings [data-next="4"]'); await sleep(800); await shot(m, 'p04-create'); await noSideScroll('create');
  await m.locator('#btn-create').scrollIntoViewIfNeeded();
  check(await m.locator('#btn-create').evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, Math.min(innerHeight - 1, rect.y + rect.height / 2));
    return rect.bottom <= innerHeight && (hit === el || el.contains(hit));
  }), 'Create action is visible above the phone footer');
  await m.click('#btn-create');
  await m.waitForSelector('#transcript-review:not(.hidden)'); await sleep(300); await shot(m, 'p04b-check-transcript'); await noSideScroll('transcript check');
  await m.click('#btn-review-edit');
  await m.locator('#review-text').fill(storyText.replace('friend Jake', 'cousin Jake'));
  await m.click('#btn-review-continue');
  await m.waitForFunction(() => !document.querySelector('#btn-gen-chars').hidden, null, { timeout: 30000 });
  await sleep(500); await shot(m, 'p05-characters'); await noSideScroll('characters');
  check(await m.locator('#btn-add-char').evaluate((el) => el.innerText.trim() === 'Add' && el.getBoundingClientRect().width >= 60) && await m.locator('#cast-bar').evaluate((el) => el.getBoundingClientRect().height < 120), 'phone cast has a labelled Add action and a compact drawing dock');
  await m.click('#btn-gen-chars');
  await sleep(400); await shot(m, 'p05c-drawing-cast');
  await m.waitForFunction(() => document.querySelectorAll('.char-art img').length === 3, null, { timeout: 30000 });
  await sleep(350); await shot(m, 'p05b-characters-drawn');
  await m.locator('#chars [data-character=me] [data-character-preview]').click();
  check(await m.locator('#character-preview').evaluate((el) => { const r = el.getBoundingClientRect(); return el.open && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }), 'the character review dialog fits the phone screen');
  await shot(m, 'p05d-character-review'); await noSideScroll('character review');
  await m.click('#btn-portrait-done');
  await m.click('#btn-approve'); await sleep(600);
  await m.click('.work .btn.primary');
  await sleep(150); await shot(m, 'p06b-background-editor');
  const pill = await m.locator('.work-pill').boundingBox();
  const mobileStage = await m.locator('#stage').boundingBox();
  check(pill.x >= 0 && pill.x + pill.width <= 390 && pill.y + pill.height <= mobileStage.y, 'background pill fits above the phone preview');
  await m.waitForFunction(() => !window.__storycuts.state.genAbort, null, { timeout: 60000 });
  await sleep(600);
  check(await m.evaluate(() => document.body.classList.contains('ed-full')), 'editor is full-screen on phone');
  check(await m.evaluate(editorOrder), 'phone editor keeps the timeline, playback controls, and tools below the video');
  await shot(m, 'p06-editor');
  check(await m.isVisible('#zoom-in') && await m.isVisible('#zoom-out') && await m.locator('#zoom-in').evaluate((el) => { const r = el.getBoundingClientRect(); return r.right <= innerWidth && r.bottom <= innerHeight; }), 'timeline zoom controls are reachable on the phone');
  const phoneZoomWidth = await m.locator('#timeline .clip').first().evaluate((el) => el.getBoundingClientRect().width);
  await m.click('#zoom-in');
  check(await m.locator('#timeline .clip').first().evaluate((el) => el.getBoundingClientRect().width) > phoneZoomWidth, 'phone Zoom in shows more shot detail');
  await m.click('#zoom-out');
  check(Math.abs(await m.locator('#timeline .clip').first().evaluate((el) => el.getBoundingClientRect().width) - phoneZoomWidth) < 1, 'phone Zoom out restores the timeline scale');
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

  // ===== creator transcripts: real local audio and real timing helpers =====
  for (const phone of [false, true]) {
    const tag = phone ? 'phone transcript' : 'desktop transcript';
    const tctx = await newContext({ viewport: { width: phone ? 390 : 1300, height: phone ? 844 : 1000 }, isMobile: phone, hasTouch: phone }, { mockListening: true });
    const t = await tctx.newPage(); watch(t, tag);
    await openStory(t);
    check(await t.getAttribute('#seg-story [data-story-mode=auto]', 'aria-pressed') === 'true' && !(await t.getAttribute('#extras', 'open')), `${tag}: automatic listening is the default and story guidance is optional`);
    await t.click('#seg-story [data-story-mode=transcript]');
    check(await t.isVisible('#prep-transcript') && !(await t.isVisible('#create-action')), `${tag}: choosing a transcript makes adding words the next action`);
    await t.locator('#story-input').scrollIntoViewIfNeeded(); await sleep(250); await shot(t, phone ? 'p10-transcript-choice' : '20-transcript-choice');
    if (phone) await fitsPhone(t, 'transcript choice');
    await t.click('#btn-paste-open');
    await t.locator('#paste-text').fill(storyText);
    await shot(t, phone ? 'p11-paste-transcript' : '21-paste-transcript');
    if (phone) await fitsPhone(t, 'pasting');
    await t.click('#btn-use-paste');
    await t.waitForFunction(() => !window.__storycuts.state.transcriptBusy && window.__storycuts.state.project.transcriptSource === 'text');
    const pasted = await t.evaluate(() => window.__storycuts.state.project.words);
    check(timedSpeech(pasted), `${tag}: pasted text gets timed words across the real audio's speech and pauses`);
    check(await t.evaluate(() => {
      const { file, project } = window.__storycuts.state;
      const saved = JSON.parse(localStorage.getItem(`storycuts:${file.name}:${file.size}`));
      return saved.transcriptSource === 'text' && saved.transcriptReviewed && saved.settings.storyMode === 'transcript' && saved.words.length === project.words.length;
    }), `${tag}: saving keeps the transcript source, review state and story choice`);
    check(await t.locator('#create-summary').textContent().then((s) => s.includes(`Your transcript, ${pasted.length} words`)), `${tag}: summary shows the chosen transcript and word count`);
    await t.click('#create-summary [data-story-change]');
    await t.waitForFunction(() => document.activeElement.id === 'story-input-title');
    check(await t.evaluate(() => document.activeElement.id) === 'story-input-title', `${tag}: summary Change returns focus to the story choice`);
    await t.click('#seg-story [data-story-mode=auto]');
    check(await t.evaluate(() => !window.__storycuts.state.project.words.length), `${tag}: switching to automatic doesn't reuse manual words as automatic speech`);
    await t.click('#seg-story [data-story-mode=transcript]');
    check(await t.evaluate(() => window.__storycuts.state.project.words.length) === pasted.length, `${tag}: switching back keeps the creator's transcript`);
    await t.click('#extras > summary');
    await t.click('#btn-cast-pre-add');
    await t.locator('#cast-pre [data-k=name]').fill('Jake');
    await t.locator('#cast-pre [data-k=description]').fill('Curly hair, glasses and a green hoodie');
    await t.click('#btn-cast-pre-add');
    await t.locator('#cast-pre .row').last().locator('[data-k=name]').fill('Biscuit');
    await t.locator('#cast-pre .row').last().locator('[data-k=description]').fill('Golden puppy with a blue collar');
    await t.click('#btn-cast-pre-add');
    await t.locator('#cast-pre .row').last().locator('[data-del]').click();
    check(await t.locator('#cast-pre .row').count() === 2 && await t.evaluate(() => window.__storycuts.state.project.settings.castHints.length) === 2, `${tag}: removing a hint updates the visible fields and saved cast together`);
    await t.locator('#plan-notes').fill('Jake is my cousin, not my friend. This happens at school.');
    await t.locator('#extras').scrollIntoViewIfNeeded(); await sleep(250); await shot(t, phone ? 'p12-story-guidance' : '22-story-guidance');
    if (phone) await fitsPhone(t, 'people, pets and notes');
    await openStory(t);
    check(await t.evaluate(() => {
      const p = window.__storycuts.state.project;
      return p.settings.storyMode === 'transcript' && p.transcriptSource === 'text' && p.words.length > 100 && p.settings.castHints.length === 2 && p.settings.planNotes.includes('This happens at school.');
    }) && !(await t.isDisabled('#btn-create')), `${tag}: reopening the video restores its ready transcript, cast hints and notes`);
    await t.click('#btn-create'); await waitForCast(t);
    const request = JSON.stringify(tctx.plannerRequests[0]?.messages);
    check(request?.includes('Jake: Curly hair, glasses and a green hoodie') && request?.includes('Biscuit: Golden puppy with a blue collar') && request?.includes('Jake is my cousin, not my friend. This happens at school.'), `${tag}: people, pets and story notes reach the actual Anthropic planner request`);
    check(await t.evaluate(() => !(window.__speechCalls || window.__speechModelLoads)) && tctx.plannerRequests.length === 1 && !(await t.isVisible('#transcript-review')), `${tag}: creator transcript skips automatic transcription and goes straight to planning`);
    if (phone) { await sleep(650); await fitsPhone(t, 'character cards for a real video'); await shot(t, 'p14-video-characters'); }
    await tctx.close();
  }

  const sctx = await newContext({ viewport: { width: 1300, height: 1000 } }, { mockListening: true });
  const s = await sctx.newPage(); watch(s, 'subtitle import');
  await openStory(s);
  await s.click('#seg-story [data-story-mode=transcript]');
  const subtitleChooser = s.waitForEvent('filechooser');
  await s.locator('#btn-transcript-upload').focus(); await s.keyboard.press('Enter');
  check(!!(await subtitleChooser), 'subtitle upload is reachable with the keyboard');
  await s.locator('#transcript-file').setInputFiles(path.join(HERE, 'fixtures/story.srt'));
  await s.waitForFunction(() => !window.__storycuts.state.transcriptBusy && window.__storycuts.state.project.transcriptSource === 'subtitles');
  const subtitles = await s.evaluate(() => window.__storycuts.state.project.words);
  check(subtitles[0].s === 2 && [14, 26, 37].every((time) => subtitles.some((w) => w.s === time)) && subtitles.at(-1).e === 42.98, 'subtitle file keeps all four cue boundaries instead of retiming across the video');
  await s.locator('#prep-transcript').scrollIntoViewIfNeeded(); await shot(s, '23-subtitle-timing');
  await s.click('#btn-create'); await waitForCast(s);
  check(await s.evaluate(() => !window.__speechCalls && window.__storycuts.state.project.transcriptSource === 'subtitles'), 'subtitle import skips automatic transcription through planning');
  await openStory(s, 'plain-text-story.webm'); await s.click('#seg-story [data-story-mode=transcript]');
  await s.locator('#transcript-file').setInputFiles(path.join(HERE, 'fixtures/story.txt'));
  await s.waitForFunction(() => !window.__storycuts.state.transcriptBusy && window.__storycuts.state.project.transcriptSource === 'text');
  check(timedSpeech(await s.evaluate(() => window.__storycuts.state.project.words)), 'plain text file upload uses the same real speech timing as pasted text');
  await openStory(s, 'webvtt-story.webm'); await s.click('#seg-story [data-story-mode=transcript]');
  await s.locator('#transcript-file').setInputFiles({ name: 'story.vtt', mimeType: 'text/vtt', buffer: Buffer.from('WEBVTT\n\n' + fs.readFileSync(path.join(HERE, 'fixtures/story.srt'), 'utf8').replace(/,(\d{3})/g, '.$1')) });
  await s.waitForFunction(() => !window.__storycuts.state.transcriptBusy && window.__storycuts.state.project.transcriptSource === 'subtitles');
  check(await s.evaluate(() => window.__storycuts.state.project.words[0].s === 2 && window.__storycuts.state.project.words.at(-1).e === 42.98), 'WebVTT subtitle uploads also keep the creator\'s caption timing');
  await sctx.close();

  // ===== automatic listening: review, correct, then plan; skip is remembered =====
  const actx = await newContext({ viewport: { width: 1300, height: 1000 } }, { mockListening: true });
  const a = await actx.newPage(); watch(a, 'automatic transcript');
  await openStory(a);
  await a.click('#extras > summary'); await a.click('#btn-cast-pre-add');
  await a.locator('#cast-pre [data-k=name]').fill('Jake');
  await a.locator('#cast-pre [data-k=description]').fill('Short curly hair and a green jacket');
  await a.locator('#plan-notes').fill('Jake is my cousin. We are at school.');
  await a.click('#btn-create'); await sleep(250); await shot(a, '24-listening');
  await a.waitForSelector('#transcript-review:not(.hidden)');
  check(await a.evaluate(() => window.__speechCalls) === 1 && actx.plannerRequests.length === 0, 'automatic transcription pauses for review before Claude sees the words');
  await a.click('#btn-review-edit');
  await a.locator('#review-text').fill(''); await a.click('#btn-review-continue');
  check(await a.isVisible('#transcript-review') && actx.plannerRequests.length === 0 && await a.locator('#review-status').textContent().then((x) => x.includes('Add')), 'an empty transcript stays editable and cannot start planning');
  const fixedText = storyText.replace('friend Jake', 'cousin Jay');
  await a.locator('#review-text').fill(fixedText);
  await a.locator('label:has(#skip-transcript-review)').click();
  await shot(a, '25-fix-transcript');
  await a.click('#btn-review-continue'); await waitForCast(a);
  const edited = await a.evaluate(() => ({ words: window.__storycuts.state.project.words, source: window.__storycuts.state.project.transcriptSource, reviewed: window.__storycuts.state.project.transcriptReviewed }));
  check(edited.source === 'text' && edited.reviewed && timedSpeech(edited.words) && edited.words.some((w) => w.w === 'Jay'), 'corrected transcript reuses real speech spans, gets new timings and records text as its source');
  const autoRequest = JSON.stringify(actx.plannerRequests[0]?.messages);
  check(autoRequest?.includes('Jay') && !autoRequest?.includes('|friend') && autoRequest?.includes('Jake: Short curly hair and a green jacket') && autoRequest?.includes('Jake is my cousin. We are at school.'), "corrected words and optional story guidance reach the automatic path's planner request");
  check(await a.evaluate(() => JSON.parse(localStorage.getItem('storycuts:skip-transcript-review')) === true), 'skip checks next time is saved on this device');
  await openStory(a, 'next-story.webm');
  await a.click('#btn-create'); await waitForCast(a);
  check(await a.evaluate(() => window.__speechCalls) === 1 && actx.plannerRequests.length === 2 && !(await a.isVisible('#transcript-review')), 'the next video uses automatic listening and honors the saved skip preference');
  await actx.close();

  const fctx = await newContext({ viewport: { width: 390, height: 844 } }, { mockListening: true, failListening: true });
  const f = await fctx.newPage(); watch(f, 'listening fallback');
  await openStory(f); await f.click('#btn-create');
  await f.waitForSelector('#story-input-status.err');
  check(await f.isVisible('#prep-transcript') && !(await f.isDisabled('#btn-paste-open')) && !(await f.isDisabled('#transcript-file')), 'listening failure opens usable upload and paste controls instead of leaving them disabled');
  await f.click('#btn-paste-open'); await f.locator('#paste-text').fill(storyText); await f.click('#btn-use-paste');
  await f.waitForFunction(() => !window.__storycuts.state.transcriptBusy && window.__storycuts.state.project.words.length);
  await f.click('#btn-create'); await waitForCast(f);
  check(fctx.plannerRequests.length === 1, 'a creator can finish planning with pasted words after listening fails');
  await fctx.close();

  // Reduced motion still leaves the landing and progress visuals readable.
  const rctx = await newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const r = await rctx.newPage(); watch(r, 'reduced motion');
  await r.goto(URL0); await sleep(400);
  check(await r.evaluate(() => document.querySelector('#hero-talk').paused && document.querySelector('#example-original').paused && document.querySelector('#story-showreel').dataset.playing === 'false'), 'reduced motion pauses both autoplay examples');
  await r.evaluate(async () => {
    const { showWork } = await import('./js/loader.js');
    window.testWork = showWork({ kind: 'plan', title: 'Planning your story', tips: ['Finding the moments to bring to life.'], steps: ['Plan the edit', 'Check the scenes'] });
  });
  await shot(r, 'p09-reduced-motion-progress');
  check(await r.isVisible('.work-title') && await r.evaluate(() => getComputedStyle(document.querySelector('.wv-plan .card')).opacity === '1'), 'reduced motion keeps the progress illustration visible');
  await r.evaluate(() => window.testWork.stop());
  await r.click('#cta-demo'); await r.click('#btn-style-next');
  check(await r.evaluate(() => getComputedStyle(document.querySelector('.example-scene')).animationName === 'none'), 'settings examples respect reduced motion');
  check(await r.isDisabled('#btn-settings-preview') && await r.getAttribute('#panel-settings', 'data-preview-paused') === 'true', 'the settings motion control honors the device reduced-motion preference');
  await r.evaluate(async () => { const { showWork } = await import('./js/loader.js'); window.testWork = showWork({ kind: 'cast', title: 'Drawing your cast' }); });
  check(await r.evaluate(() => getComputedStyle(document.querySelector('.cast-head-ink')).opacity === '1' && getComputedStyle(document.querySelector('.cast-check')).opacity === '1'), 'reduced motion leaves the character drawing illustration complete and readable');
  await shot(r, 'p13-reduced-motion-cast');
  await r.evaluate(() => window.testWork.stop());
  await rctx.close();
  const dctx = await newContext({ viewport: { width: 390, height: 844 } });
  const d = await dctx.newPage(); watch(d, 'studio deep link');
  await d.goto(`${URL0}#studio`); await sleep(400);
  check(await d.isVisible('#panel-upload') && !(await d.isVisible('.hero')), 'a direct studio link opens the upload workspace');
  await dctx.close();
} catch (e) {
  check(false, 'test run finished', e.message);
}

check(errors.length === 0, 'no errors in the browser console', errors.slice(0, 5).join(' | '));
await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed. Screenshots: tests/out/` : '\nAll checks passed. Screenshots: tests/out/');
process.exit(failures ? 1 : 0);
