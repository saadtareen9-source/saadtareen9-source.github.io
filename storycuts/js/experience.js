// Presentation only. Examples use local licensed media and original artwork.
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STORIES = {
  airport: { clip: 'assets/hero/talk', poster: 'assets/hero/talk.jpg', art: 'assets/examples/airport.jpg', alt: 'A suitcase mix-up at an airport, with an unexpected orange cat', caption: 'THIS WASN’T<br><b>MY SUITCASE.</b>' },
  rain: { clip: 'assets/examples/man', poster: 'assets/examples/man.jpg', art: 'assets/examples/rain.jpg', alt: 'A young man meets a corgi carrying an umbrella on a rainy street', caption: 'AND THEN<br><b>HE FOUND ME.</b>' },
  breakfast: { clip: 'assets/examples/creator', poster: 'assets/examples/creator.jpg', art: 'assets/examples/breakfast.jpg', alt: 'A burnt pancake and a dad’s surprised reaction in the kitchen', caption: 'BREAKFAST WAS<br><b>A BAD IDEA.</b>' },
};
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
export function syncCastNavigation(characters) {
  const host = $('#cast-jump');
  const active = document.activeElement?.closest('[data-cast-jump]')?.dataset.castJump;
  host.innerHTML = characters.map((c) => {
    const drawn = c.image?.key && !c.image.stale;
    return `<button data-cast-jump="${esc(c.id)}" class="${drawn ? 'drawn' : ''}" aria-label="Edit ${esc(c.name)}"><i aria-hidden="true">${drawn ? '<svg><use href="#i-check"/></svg>' : esc([...String(c.name ?? "").trim()][0] || '?')}</i>${esc(c.name)}</button>`;
  }).join('');
  if (active) host.querySelector(`[data-cast-jump="${CSS.escape(active)}"]`)?.focus({ preventScroll: true });
}
function initShowreel() {
  const reel = $('#story-showreel');
  const screen = reel.querySelector('.phone-screen');
  const videos = [$('#hero-talk'), $('#example-original')];
  const scrub = $('#example-scrub');
  const button = $('#btn-example-play');
  let playing = !motion.matches && !navigator.connection?.saveData;
  let visible = false, time = 0, start = 0, frame = 0, current = 'airport';
  let userSelectedView = false;
  let renderedPlaying, renderedSecond = -1;
  function render() {
    const result = reel.dataset.demoView === 'result';
    screen.classList.toggle('cut', result && (userSelectedView || time < 5 || time >= 7));
    scrub.value = time.toFixed(2);
    $('#example-playhead').style.left = `${time / 8 * 100}%`;
    const second = Math.min(8, Math.floor(time));
    if (renderedSecond !== second) {
      renderedSecond = second;
      $('#showreel-time').textContent = `0:0${second} / 0:08`;
      scrub.setAttribute('aria-valuetext', `${second} of 8 seconds`);
    }
    if (renderedPlaying !== playing) {
      renderedPlaying = playing;
      button.setAttribute('aria-label', playing ? 'Pause example' : 'Play example');
      button.innerHTML = `<svg><use href="#i-${playing ? 'pause' : 'play'}"/></svg>`;
    }
    reel.dataset.playing = String(playing && visible && !document.hidden);
  }
  function syncFrames() {
    const story = STORIES[current];
    $$('#story-showreel [data-showreel-frame]').forEach((img) => {
      img.src = img.dataset.showreelFrame === 'face' || reel.dataset.demoView === 'original' ? story.poster : story.art;
    });
  }
  function tick(now) {
    frame = 0;
    if (!playing || !visible || document.hidden) return;
    time = ((now - start) / 1000) % 8;
    if (time < 0) time += 8;
    render();
    frame = requestAnimationFrame(tick);
  }
  function updatePlayback() {
    cancelAnimationFrame(frame); frame = 0;
    if (playing && visible && !document.hidden) {
      start = performance.now() - time * 1000;
      videos.forEach((v) => v.play().catch(() => {}));
      frame = requestAnimationFrame(tick);
    } else videos.forEach((v) => v.pause());
    render();
  }
  function choose(id) {
    const story = STORIES[id];
    if (!story || current === id) return;
    current = id; time = 0; userSelectedView = false;
    reel.dataset.demoStory = id;
    $('#showreel-art').src = story.art; $('#showreel-art').alt = story.alt;
    $('#showreel-bubble').src = story.poster;
    $('#showreel-caption').innerHTML = story.caption;
    syncFrames();
    videos.forEach((v) => {
      v.pause(); v.poster = story.poster;
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
    const view = e.target.closest('button[data-demo-view]');
    if (view) {
      reel.dataset.demoView = view.dataset.demoView; userSelectedView = true;
      syncFrames();
      $$('#story-showreel button[data-demo-view]').forEach((b) => {
        const on = b === view; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
      });
      render();
    }
  });
  button.addEventListener('click', () => { playing = !playing; userSelectedView = false; updatePlayback(); });
  scrub.addEventListener('input', () => {
    time = +scrub.value; playing = false; userSelectedView = false;
    videos.forEach((v) => { if (Number.isFinite(v.duration) && v.duration > 0) v.currentTime = Math.min(v.duration - .1, time); });
    updatePlayback();
  });
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; updatePlayback(); }, { threshold: .05 }).observe(reel);
  document.addEventListener('visibilitychange', updatePlayback);
  motion.addEventListener('change', () => { if (motion.matches) { playing = false; updatePlayback(); } });
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
    const card = document.querySelector(`#chars [data-character="${CSS.escape(b.dataset.castJump)}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: motion.matches ? 'auto' : 'smooth', block: 'center' });
    card.querySelector('[data-k=name]')?.focus({ preventScroll: true });
    card.classList.add('focus-flash');
    clearTimeout(card.flashTimer); card.flashTimer = setTimeout(() => card.classList.remove('focus-flash'), 1100);
  });
}
export function initExperience() { initShowreel(); initSettingsPreview(); initChoiceAccessibility(); initPortraitReview(); }
