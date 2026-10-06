import { drawCaptions, presetValues, loadCaptionFonts } from './captions.js';
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
  const scrub = $('#example-scrub'), button = $('#btn-example-play');
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
      $('#showreel-chapter').textContent = shot.label;
      $$('.hero-mini-tl > span').forEach((el, i) => el.classList.toggle('active-shot', index === i));
    }
    // The canvas uses exactly the same caption renderer as the editor and export.
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (result) drawCaptions(ctx, canvas.width, canvas.height, pages, time, { ...presetValues(preset), x: .5, y: .79, size: 1.08, anim: motion.matches ? 'none' : presetValues(preset).anim });
    if (!motion.matches) {
      const progress = (time - shot.start) / (shot.end - shot.start);
      $('#showreel-art').style.transform = `scale(${1.025 + progress * .035})`;
    } else $('#showreel-art').style.transform = 'none';
    scrub.value = time.toFixed(2);
    $('#example-playhead').style.left = `${time / 8 * 100}%`;
    $('#showreel-time').textContent = `0:0${Math.floor(time)} / 0:08`;
    scrub.setAttribute('aria-valuetext', `${time.toFixed(1)} of 8 seconds, ${shot.label}`);
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
    const style = e.target.closest('[data-demo-caption]');
    if (style) {
      preset = style.dataset.demoCaption;
      $$('#story-showreel [data-demo-caption]').forEach((b) => {
        const on = b === style; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
      });
      render();
    }
    const view = e.target.closest('button[data-demo-view]');
    if (view) {
      reel.dataset.demoView = view.dataset.demoView;
      syncFrames();
      $$('#story-showreel button[data-demo-view]').forEach((b) => {
        const on = b === view; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
      });
      render();
    }
  });
  button.addEventListener('click', () => { playing = !playing; if (time >= 7.99) { time = 0; videos.forEach((v) => seekVideo(v, 0)); } updatePlayback(); });
  scrub.addEventListener('input', () => {
    time = Math.min(7.999, +scrub.value); playing = false;
    videos.forEach((v) => { if (v.preload !== 'auto') { v.preload = 'auto'; if (!v.readyState) v.load(); } seekVideo(v, time); }); updatePlayback();
  });
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
export function initExperience() { initShowreel(); initSettingsPreview(); initChoiceAccessibility(); initPortraitReview(); }
