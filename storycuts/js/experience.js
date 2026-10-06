import { drawCaptions, presetValues, loadCaptionFonts, CAPTION_PRESETS } from './captions.js';
// Presentation only. Examples use local licensed media and original artwork.
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Every shot, phrase, caption and thumbnail uses this same eight-second edit.
const SHOTS = [
  { start: 0, end: 2, type: 'face', label: 'The hook' },
  { start: 2, end: 5, type: 'scene', label: 'The reveal' },
  { start: 5, end: 6.4, type: 'face', label: 'The reaction' },
  { start: 6.4, end: 8, type: 'scene', label: 'The payoff' },
];
const STORIES = {
  airport: { clip: 'assets/hero/talk', poster: 'assets/hero/talk.jpg', art: 'assets/examples/airport.jpg', alt: 'A suitcase mix-up at an airport, with an unexpected orange cat', lines: ['I grabbed my suitcase.', 'There was a CAT inside.', 'Wait a second.', 'Definitely not my suitcase.'] },
  rain: { clip: 'assets/examples/man', poster: 'assets/examples/man.jpg', art: 'assets/examples/rain.jpg', alt: 'A young man meets a corgi carrying an umbrella on a rainy street', lines: ['I forgot my umbrella.', 'Then a CORGI found me.', 'I was speechless.', 'My new favorite neighbor.'] },
  breakfast: { clip: 'assets/examples/creator', poster: 'assets/examples/creator.jpg', art: 'assets/examples/breakfast.jpg', alt: 'Her little brother holds up a burnt pancake while their dad watches from the doorway', lines: ['My brother tried cooking.', 'Breakfast was a little BURNT.', 'Then Dad walked in.', 'We ordered breakfast instead.'] },
};
const storyPages = (story) => SHOTS.map((shot, i) => {
  const words = story.lines[i].split(' ');
  const step = (shot.end - shot.start) / words.length;
  return { start: shot.start, end: shot.end, words: words.map((w, j) => ({ w, s: shot.start + j * step, e: shot.start + (j + 1) * step })) };
});
export function exampleSceneForStyle(style, fallback) {
  return ({ stick: 'assets/examples/airport-doodle.jpg', cartoon: 'assets/examples/airport.jpg', anime: 'assets/examples/rain.jpg', comic: 'assets/examples/breakfast.jpg' })[style] || fallback;
}
export function syncStyleShowcase(style) {
  if (!style || !$('#style-hero-art')) return;
  const src = style.thumb || 'assets/examples/airport-doodle.jpg';
  const img = $('#style-hero-art');
  if (img.getAttribute('src') !== src) img.src = src;
  img.alt = `Example of ${style.label}`;
  $('#style-hero-title').textContent = style.label;
  $('#style-hero-description').textContent = style.blurb || 'Describe a world of your own, or bring a reference image.';
}
let activeCastId = null, activeCastIndex = 0;
export function selectCastCharacter(id, { focus = false, scroll = false } = {}) {
  const cards = $$('#chars .char');
  const index = cards.findIndex((c) => c.dataset.character === id);
  if (index < 0) return;
  activeCastId = id; activeCastIndex = index;
  cards.forEach((card, i) => { card.hidden = i !== index; });
  $$('#cast-jump [data-cast-jump]').forEach((button) => {
    const selected = button.dataset.castJump === id;
    button.classList.toggle('on', selected);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  $('#cast-position').textContent = `Character ${index + 1} of ${cards.length}`;
  $('#btn-cast-prev').disabled = index === 0;
  $('#btn-cast-next').disabled = index === cards.length - 1;
  const card = cards[index];
  if (scroll) card.scrollIntoView({ behavior: motion.matches ? 'auto' : 'smooth', block: 'nearest' });
  if (focus) card.querySelector('[data-k=name]')?.focus({ preventScroll: true });
}
export function syncCastNavigation(characters) {
  const host = $('#cast-jump');
  const focused = document.activeElement?.closest('[data-cast-jump]')?.dataset.castJump;
  if (!characters.some((c) => c.id === activeCastId)) activeCastId = characters[Math.min(activeCastIndex, characters.length - 1)]?.id;
  host.innerHTML = characters.map((c) => {
    const drawn = c.image?.key && !c.image.stale;
    const src = c.image?.key ? $(`#chars .char[data-character="${CSS.escape(c.id)}"] .char-art img`)?.getAttribute('src') : '';
    const thumb = c.image?.key ? `<img alt=""${src ? ` src="${esc(src)}"` : ''}>` : esc([...String(c.name ?? '').trim()][0] || '?');
    return `<button id="cast-tab-${esc(c.id)}" role="tab" aria-controls="cast-card-${esc(c.id)}" data-cast-jump="${esc(c.id)}" class="${drawn ? 'drawn' : ''}" aria-label="Edit ${esc(c.name)}"><i aria-hidden="true">${thumb}${drawn ? '<b class="tick"><svg><use href="#i-check"/></svg></b>' : ''}</i><span>${esc(c.name)}</span></button>`;
  }).join('');
  $$('#chars .char').forEach((card) => {
    card.id = `cast-card-${card.dataset.character}`;
    card.setAttribute('role', 'tabpanel');
    card.setAttribute('aria-labelledby', `cast-tab-${card.dataset.character}`);
  });
  selectCastCharacter(activeCastId);
  if (focused) host.querySelector(`[data-cast-jump="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
}
function initShowreel() {
  const reel = $('#story-showreel');
  const screen = reel.querySelector('.phone-screen');
  const master = $('#example-original'), output = $('#hero-talk');
  const videos = [master, output];
  const button = $('#btn-example-play');
  const canvas = $('#showreel-captions'), ctx = canvas.getContext('2d');
  let playing = !motion.matches && !navigator.connection?.saveData;
  let visible = false, time = 2.15, frame = 0, current = 'airport';
  let preset = 'bold', pages = storyPages(STORIES.airport), lastShot = -1, lastSync = 0;
  let playAttempt = 0;
  const initialized = new WeakSet();
  const active = () => playing && visible && !document.hidden;
  const mediaScale = (v) => Number.isFinite(v.duration) && v.duration > 0 ? Math.min(8, v.duration) / 8 : 1;
  const seekVideo = (v, t) => {
    if (v.readyState && Number.isFinite(v.duration)) v.currentTime = Math.min(Math.max(0, v.duration - .01), t * mediaScale(v));
  };
  function render() {
    const index = Math.max(0, SHOTS.findIndex((s) => time >= s.start && time < s.end));
    const shot = SHOTS[index], result = reel.dataset.demoView === 'result';
    screen.classList.toggle('cut', result && shot.type === 'scene');
    reel.dataset.shot = String(index);
    $('#showreel-shot-label').textContent = result && shot.type === 'scene' ? 'Illustrated scene' : 'You on camera';
    reel.dataset.playing = String(active() && !master.paused && !master.seeking);
    if (lastShot !== index) {
      lastShot = index;
      $('#showreel-caption').textContent = STORIES[current].lines[index];
    }
    // The canvas uses exactly the same caption renderer as the editor and export.
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (result) drawCaptions(ctx, canvas.width, canvas.height, pages, time, { ...presetValues(preset), x: .5, y: .79, size: 1.08, anim: motion.matches ? 'none' : presetValues(preset).anim });
    if (!motion.matches) {
      const progress = (time - shot.start) / (shot.end - shot.start);
      $('#showreel-art').style.transform = `scale(${1.025 + progress * .035})`;
    } else $('#showreel-art').style.transform = 'none';
    const label = playing ? 'Pause example' : 'Play example';
    if (button.getAttribute('aria-label') !== label) {
      button.setAttribute('aria-label', label);
      button.innerHTML = `<svg><use href="#i-${playing ? 'pause' : 'play'}"/></svg>`;
    }
  }
  function syncFrames() {
    const story = STORIES[current];
    $$('#story-showreel [data-showreel-frame]').forEach((img) => {
      img.src = img.dataset.showreelFrame === 'face' || reel.dataset.demoView === 'original' ? story.poster : story.art;
    });
  }
  function tick(now) {
    frame = 0;
    if (!active()) return;
    // Media time is authoritative: buffering, seeking and tab changes cannot
    // send the captions ahead of the footage. No independent animation clock.
    if (initialized.has(master) && !master.seeking && master.readyState >= 2) {
      time = Math.min(7.999, master.currentTime / mediaScale(master));
      if (master.currentTime >= 8) { time = 0; videos.forEach((v) => seekVideo(v, 0)); }
      if (now - lastSync > 300 && Math.abs(output.currentTime / mediaScale(output) - time) > .12 && !output.seeking) {
        seekVideo(output, time); lastSync = now;
      }
    }
    render(); frame = requestAnimationFrame(tick);
  }
  function updatePlayback() {
    cancelAnimationFrame(frame); frame = 0;
    const attempt = ++playAttempt;
    if (active()) {
      master.play().catch(() => { if (attempt !== playAttempt) return; playing = false; updatePlayback(); });
      output.play().catch(() => {});
      frame = requestAnimationFrame(tick);
    } else videos.forEach((v) => v.pause());
    render();
  }
  function choose(id) {
    const story = STORIES[id];
    if (!story || current === id) return;
    ++playAttempt;
    current = id; time = 2.15; lastShot = -1; pages = storyPages(story);
    reel.dataset.demoStory = id;
    $('#showreel-art').src = story.art; $('#showreel-art').alt = story.alt;
    $('#showreel-bubble').src = story.poster;
    syncFrames();
    videos.forEach((v) => {
      initialized.delete(v); v.pause(); v.preload = 'auto'; v.poster = story.poster;
      v.src = `${story.clip}.${v.canPlayType('video/webm; codecs="vp9"') ? 'webm' : 'mp4'}`;
      v.load();
    });
    $$('#story-showreel [data-showcase]').forEach((b) => {
      const on = b.dataset.showcase === id;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    });
    updatePlayback();
  }
  reel.addEventListener('click', (e) => {
    const story = e.target.closest('[data-showcase]');
    if (story) choose(story.dataset.showcase);
  });
  button.addEventListener('click', () => { playing = !playing; if (time >= 7.99) { time = 0; videos.forEach((v) => seekVideo(v, 0)); } updatePlayback(); });
  videos.forEach((v) => {
    v.addEventListener('loadedmetadata', () => { v.playbackRate = mediaScale(v); });
    v.addEventListener('loadeddata', () => { if (!initialized.has(v)) { initialized.add(v); seekVideo(v, time); } render(); });
  });
  master.addEventListener('waiting', () => { reel.dataset.buffering = 'true'; });
  master.addEventListener('playing', () => { reel.dataset.buffering = 'false'; });
  master.addEventListener('error', () => { playing = false; reel.dataset.buffering = 'false'; updatePlayback(); });
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; updatePlayback(); }, { threshold: .05 }).observe(reel);
  document.addEventListener('visibilitychange', updatePlayback);
  motion.addEventListener('change', () => { if (motion.matches) playing = false; updatePlayback(); });
  loadCaptionFonts(['montserrat', 'inter', 'poppins']).then(render);
  render();
}
function initSettingsPreview() {
  const panel = $('#panel-settings');
  const button = $('#btn-settings-preview');
  let paused = motion.matches || !!navigator.connection?.saveData;
  const render = () => {
    panel.dataset.previewPaused = String(paused || motion.matches);
    button.disabled = motion.matches;
    button.setAttribute('aria-label', motion.matches ? 'Example motion is off in your device settings' : paused ? 'Play settings example' : 'Pause settings example');
    button.innerHTML = `<svg><use href="#i-${paused || motion.matches ? 'play' : 'pause'}"/></svg><span>${motion.matches ? 'Motion paused' : paused ? 'Play example' : 'Pause example'}</span>`;
  };
  button.addEventListener('click', () => { paused = !paused; render(); });
  motion.addEventListener('change', () => { if (motion.matches) paused = true; render(); });
  render();
}
function initChoiceAccessibility() {
  const groups = $$('#seg-format, #seg-pacing, #seg-motion, #seg-face');
  const sync = () => groups.forEach((group) => group.querySelectorAll('button').forEach((button) => {
    const pressed = String(button.classList.contains('on'));
    if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
  }));
  groups.forEach((group) => new MutationObserver(sync).observe(group, { subtree: true, attributes: true, attributeFilter: ['class'] }));
  sync();
}
function initPortraitReview() {
  const dialog = $('#character-preview');
  let opener = null;
  const close = () => dialog.close();
  $('#btn-portrait-close').addEventListener('click', close);
  $('#btn-portrait-done').addEventListener('click', close);
  dialog.addEventListener('click', (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
  });
  dialog.addEventListener('close', () => { $('#portrait-preview-image').removeAttribute('src'); if (opener?.isConnected) opener.focus({ preventScroll: true }); });
  $('#chars').addEventListener('click', (e) => {
    const b = e.target.closest('[data-character-preview]');
    if (!b) return;
    const card = b.closest('.char');
    const img = card.querySelector('.char-art > img');
    if (!img?.getAttribute('src')) return;
    opener = b;
    $('#portrait-preview-title').textContent = card.querySelector('.char-name').textContent;
    $('#portrait-preview-image').src = img.src;
    $('#portrait-preview-image').alt = img.alt;
    dialog.showModal();
  });
  $('#cast-jump').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cast-jump]');
    if (!b) return;
    selectCastCharacter(b.dataset.castJump, { focus: true, scroll: true });
  });
  $('#cast-jump').addEventListener('keydown', (e) => {
    const buttons = $$('#cast-jump [data-cast-jump]');
    const index = buttons.indexOf(e.target);
    if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    selectCastCharacter(buttons[next].dataset.castJump);
    buttons[next].focus({ preventScroll: true });
  });
  const move = (direction) => {
    const cards = $$('#chars .char');
    const card = cards[activeCastIndex + direction];
    if (card) selectCastCharacter(card.dataset.character, { focus: true, scroll: true });
  };
  $('#btn-cast-prev').addEventListener('click', () => move(-1));
  $('#btn-cast-next').addEventListener('click', () => move(1));
}

// A small, separate sneak peek of the editor tools: no project, no editor, no AI.
const PEEK_SHOTS = [
  { id: 'hook', label: 'Hook', note: 'You, on camera', src: 'assets/hero/talk.jpg', face: true, line: 'So I grabbed my suitcase', dur: 2.2 },
  { id: 'reveal', label: 'Reveal', note: 'The drawing takes over', src: 'assets/examples/airport.jpg', line: 'and there was a CAT inside', dur: 2.6 },
  { id: 'reaction', label: 'Reaction', note: 'Back to your face', src: 'assets/hero/talk.jpg', face: true, line: 'I just stared at it', dur: 1.8 },
  { id: 'payoff', label: 'Payoff', note: 'The punchline, drawn', src: 'assets/examples/airport-doodle.jpg', line: 'Definitely not my suitcase', dur: 2.4 },
];
const PEEK_STYLES = ['bold', 'viral', 'pop', 'karaoke', 'oneword', 'comic', 'bubbly', 'boxed', 'pills', 'neon', 'marker', 'cinema'];
const PEEK_SOUNDS = [['record_scratch', 'Record scratch', 'disc'], ['boing', 'Boing', 'spring'], ['dun_dun', 'Dun dun', 'drama'], ['tada', 'Ta-da', 'star'], ['whoosh', 'Whoosh', 'wind'], ['pop', 'Pop', 'pop'], ['sad_trombone', 'Sad trombone', 'down'], ['ding', 'Ding', 'bell']];
function initPeek() {
  const dialog = $('#peek');
  if (!dialog) return;
  const canvas = $('#peek-canvas'), ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const images = new Map();
  const img = (src) => {
    if (!images.has(src)) { const im = new Image(); im.src = src; im.onload = () => draw(); images.set(src, im); }
    return images.get(src);
  };
  let tab = 'captions', style = 'bold', shot = 0, t0 = 0, frame = 0, opener = null, ac = null, sound = null;
  const total = PEEK_SHOTS.reduce((a, x) => a + x.dur, 0);
  const pagesFor = (line, dur) => {
    const words = line.split(' '), step = (dur - 0.3) / words.length;
    return [{ start: 0, end: dur, words: words.map((w, i) => ({ w, s: i * step, e: (i + 1) * step })) }];
  };
  // Pictures are fitted inside the frame (never cut off): a soft blurred copy fills the rest.
  function picture(src, k, face) {
    const im = img(src);
    ctx.fillStyle = '#16131c'; ctx.fillRect(0, 0, W, H);
    if (!im.complete || !im.naturalWidth) return;
    const iw = im.naturalWidth, ih = im.naturalHeight;
    const cover = Math.max(W / iw, H / ih), zoom = motion.matches ? 1 : 1 + 0.04 * k;
    if (face) {
      // camera footage fills the frame, framed on the face
      const sc = cover * zoom;
      ctx.drawImage(im, (W - iw * sc) / 2, Math.min(0, (H - ih * sc) * 0.3), iw * sc, ih * sc);
      return;
    }
    ctx.save(); ctx.filter = 'blur(18px) brightness(.7)';
    ctx.drawImage(im, (W - iw * cover) / 2, (H - ih * cover) / 2, iw * cover, ih * cover);
    ctx.restore();
    const fit = Math.min(W / iw, H / ih) * zoom;
    ctx.drawImage(im, (W - iw * fit) / 2, (H - ih * fit) / 2, iw * fit, ih * fit);
  }
  function draw(now = performance.now()) {
    const elapsed = motion.matches ? 1.2 : ((now - t0) / 1000);
    let local, cur;
    if (tab === 'timeline') {
      if (!motion.matches) {
        let e = elapsed % total; shot = 0;
        while (e > PEEK_SHOTS[shot].dur) { e -= PEEK_SHOTS[shot].dur; shot++; }
        local = e;
      } else local = 1.2;
      cur = PEEK_SHOTS[shot];
      $$('#peek-shots button').forEach((b, i) => { b.classList.toggle('on', i === shot); b.style.setProperty('--p', i === shot ? String(local / cur.dur) : i < shot ? '1' : '0'); });
    } else {
      cur = tab === 'sound' ? PEEK_SHOTS[3] : PEEK_SHOTS[1];
      local = motion.matches ? 1.4 : elapsed % (cur.dur + 0.8);
    }
    picture(cur.src, local / cur.dur, cur.face);
    const cs = { ...presetValues(tab === 'captions' ? style : 'bold'), x: 0.5, y: 0.8 };
    if (motion.matches) cs.anim = 'none';
    drawCaptions(ctx, W, H, pagesFor(cur.line, cur.dur + 0.8), Math.min(local, cur.dur + 0.7), cs);
    if (sound && now - sound.at < 1400) {
      const k = (now - sound.at) / 1400, a = Math.min(1, (1 - k) * 3);
      ctx.save(); ctx.globalAlpha = a;
      ctx.fillStyle = '#ffffffee';
      const label = sound.name, fs = 30;
      ctx.font = `800 ${fs}px Inter, sans-serif`;
      const w = ctx.measureText(label).width + 70;
      const y = H * 0.12 - (1 - Math.min(1, k * 4)) * 20;
      ctx.beginPath(); ctx.roundRect((W - w) / 2, y, w, 60, 30); ctx.fill();
      ctx.fillStyle = '#5e43be'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      ctx.fillText(`♪  ${label}`, W / 2, y + 31);
      ctx.restore();
    }
    if (dialog.open && !motion.matches) frame = requestAnimationFrame(draw);
  }
  function restart() { cancelAnimationFrame(frame); t0 = performance.now(); draw(); }
  function show(name) {
    tab = name;
    $$('#peek-tabs [data-peek]').forEach((b) => { const on = b.dataset.peek === name; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    $$('#peek [data-peek-pane]').forEach((p) => { p.hidden = p.dataset.peekPane !== name; });
    $('#peek-canvas').setAttribute('aria-label', name === 'timeline' ? 'Example edit playing shot by shot' : name === 'sound' ? 'Example scene with a sound effect' : 'Example scene with captions');
    restart();
  }
  $('#peek-cap-styles').innerHTML = PEEK_STYLES.map((id) => {
    const p = CAPTION_PRESETS.find((x) => x.id === id);
    return `<button data-peek-style="${id}" aria-pressed="${id === style}" class="${id === style ? 'on' : ''}">${esc(p?.name || id)}</button>`;
  }).join('');
  $('#peek-shots').innerHTML = PEEK_SHOTS.map((x, i) => `<button data-peek-shot="${i}" style="flex:${x.dur}"><img src="${x.src}" alt=""><span><b>${x.label}</b><small>${x.note}</small></span><i></i></button>`).join('');
  $('#peek-sounds').innerHTML = PEEK_SOUNDS.map(([id, name, ic]) => `<button data-peek-sound="${id}"><svg><use href="#i-sfx-${ic}"/></svg>${esc(name)}</button>`).join('');
  dialog.addEventListener('click', async (e) => {
    if (e.target === dialog) { dialog.close(); return; }
    const t = e.target.closest('[data-peek]');
    if (t) show(t.dataset.peek);
    const st = e.target.closest('[data-peek-style]');
    if (st) {
      style = st.dataset.peekStyle;
      $$('#peek-cap-styles button').forEach((b) => { const on = b === st; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      loadCaptionFonts([presetValues(style).font]).then(() => draw());
      restart();
    }
    const sh = e.target.closest('[data-peek-shot]');
    if (sh) {
      const i = +sh.dataset.peekShot;
      t0 = performance.now() - PEEK_SHOTS.slice(0, i).reduce((a, x) => a + x.dur, 0) * 1000 - 50;
      shot = i; if (motion.matches) draw();
    }
    const so = e.target.closest('[data-peek-sound]');
    if (so) {
      $$('#peek-sounds button').forEach((b) => b.classList.toggle('on', b === so));
      sound = { name: so.textContent.trim(), at: performance.now() };
      try {
        ac ||= new AudioContext();
        if (ac.state === 'suspended') await ac.resume();
        const { sfxBuffer } = await import('./sfx.js');
        const buf = await sfxBuffer(so.dataset.peekSound);
        if (buf) { const src = ac.createBufferSource(); src.buffer = buf; src.connect(ac.destination); src.start(); }
      } catch { /* sound is a bonus; the preview still shows it */ }
      if (motion.matches) draw();
    }
    if (e.target.closest('#peek-start')) dialog.close();
  });
  dialog.addEventListener('close', () => { cancelAnimationFrame(frame); if (opener?.isConnected) opener.focus({ preventScroll: true }); });
  $$('[data-peek-open]').forEach((b) => b.addEventListener('click', () => {
    opener = b;
    dialog.showModal();
    loadCaptionFonts(['montserrat', 'anton', 'poppins', 'bangers', 'luckiest', 'marker', 'bebas']).then(() => draw());
    show(b.dataset.peekOpen);
  }));
}
export function initExperience() { initPeek(); initShowreel(); initSettingsPreview(); initChoiceAccessibility(); initPortraitReview(); }
