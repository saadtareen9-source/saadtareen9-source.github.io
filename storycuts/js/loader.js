// Loading screens: a visual, what's happening in plain words, progress and
// an honest time estimate.
//   showWork()   full-screen screen for long jobs; can be sent to the
//                background ("Back to editor") and reopened from a pill
//   showLoader() small inline version for tight spots

const bars = Array.from({ length: 26 }, (_, i) => {
  const h = 16 + Math.round(Math.abs(Math.sin(i * 1.7) * 46 + Math.cos(i * 0.6) * 18));
  return `<rect class="bar" x="${20 + i * 7}" y="${75 - h / 2}" width="4" height="${h}" rx="2" style="animation-delay:${-((i * 0.37) % 1.1).toFixed(2)}s"/>`;
}).join('');

const sketch = (d, delay, cls = 'ink') => `<path class="${cls}" d="${d}" style="animation-delay:${delay}s"/>`;

const VISUALS = {
  // a waveform with a read head moving across it
  listen: `<svg viewBox="0 0 220 150" class="wv wv-listen"><rect class="frame" x="1" y="1" width="218" height="148" rx="14"/>${bars}<g class="head"><line class="acc" x1="20" y1="34" x2="20" y2="116"/></g></svg>`,
  // storyboard frames being laid out, then the edit line
  plan: `<svg viewBox="0 0 220 150" class="wv wv-plan">${[0, 1, 2, 3].map((i) => `<g class="card"><rect class="soft" x="${12 + i * 50}" y="30" width="44" height="62" rx="6"/><path class="ink" d="M${18 + i * 50} 80 l9-12 7 8 6-6 10 10"/><circle class="ink" cx="${44 + i * 50}" cy="44" r="4"/></g>`).join('')}<path class="acc cut" d="M12 116 H206"/><g fill="currentColor">${[0, 1, 2, 3].map((i) => `<rect x="${12 + i * 50}" y="110" width="2" height="12" rx="1" opacity=".5"/>`).join('')}</g></svg>`,
  // an illustration sketching itself inside a frame
  draw: `<svg viewBox="0 0 220 150" class="wv wv-draw"><rect class="frame" x="36" y="10" width="148" height="130" rx="12"/><path class="fill" d="M37 112 Q80 96 110 106 T183 100 V139 H37z"/>${sketch('M37 112 Q80 96 110 106 T183 100', 0)}${sketch('M150 38 m-10 0 a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0', 0.2)}${sketch('M88 58 m-11 0 a11 11 0 1 0 22 0 a11 11 0 1 0 -22 0', 0.4)}${sketch('M88 69 V96 M88 77 L74 88 M88 77 L102 86 M88 96 L78 112 M88 96 L98 112', 0.6)}${sketch('M118 92 h26 v16 h-26z M124 92 v-8 h14 v8', 0.9)}<g class="pen"><path d="M0 0 L14 -14 L19 -9 L5 5 L-2 7z" fill="var(--text)" opacity=".9"/></g></svg>`,
  cast: `<svg viewBox="0 0 220 150" class="wv wv-cast">${[0, 1, 2].map((i) => `<g class="portrait" style="--portrait:${i}"><rect class="soft" x="${12 + i * 68}" y="22" width="60" height="100" rx="12"/><circle class="cast-head-ink" cx="${42 + i * 68}" cy="57" r="13"/><path class="cast-body-ink" d="M${24 + i * 68} 101 Q${25 + i * 68} 80 ${42 + i * 68} 80 Q${59 + i * 68} 80 ${60 + i * 68} 101 M${37 + i * 68} 54v2 M${47 + i * 68} 54v2 M${38 + i * 68} 63q4 4 8 0"/><path class="cast-check" d="M${35 + i * 68} 133l4 4 9-9"/></g>`).join('')}</svg>`,
  // frames rolling past a playhead
  film: `<svg viewBox="0 0 220 150" class="wv wv-film"><defs><clipPath id="wv-clip"><rect x="12" y="34" width="196" height="82" rx="10"/></clipPath></defs><rect class="frame" x="12" y="34" width="196" height="82" rx="10"/><g clip-path="url(#wv-clip)"><g class="roll">${[0, 1, 2, 3, 4, 5].map((i) => `<rect class="soft" x="${18 + i * 60}" y="44" width="52" height="62" rx="5"/><path class="ink" d="M${24 + i * 60} 94 l10-12 7 8 6-6 12 12" stroke-width="1.6"/>`).join('')}</g></g><line class="acc" x1="110" y1="24" x2="110" y2="126"/><circle class="ph" cx="110" cy="22" r="4" fill="var(--accent)"/></svg>`,
};

const fmtLeft = (s) => {
  if (s <= 4) return 'Almost done';
  if (s < 60) return `About ${Math.max(5, Math.round(s / 5) * 5)} seconds left`;
  const m = Math.round(s / 60);
  return `About ${m} minute${m > 1 ? 's' : ''} left`;
};

/** Shared progress maths for both loaders. */
function progressModel({ eta = 30, total = 0, perItem = 0, parallel = 1, countText = null }) {
  const st = { done: 0, total, t0: performance.now(), tLast: performance.now() };
  const expected = () => (st.total && perItem ? Math.ceil(st.total / parallel) * perItem : eta);
  const read = () => {
    const el = (performance.now() - st.t0) / 1000;
    let frac, left;
    if (st.total && perItem) {
      const sinceLast = (performance.now() - st.tLast) / 1000;
      const running = Math.min(parallel, st.total - st.done);
      const partial = running ? Math.min(0.9, sinceLast / perItem) * running : 0;
      frac = (st.done + partial) / st.total;
      left = Math.max(0, Math.ceil((st.total - st.done) / parallel) * perItem - sinceLast);
    } else {
      frac = 0.95 * (1 - Math.exp(-el / Math.max(5, expected() * 0.6)));
      left = Math.max(0, expected() - el);
    }
    return {
      pct: Math.max(3, Math.min(99, frac * 100)),
      count: countText && st.total ? countText(st.done, st.total) : st.total ? `${st.done} of ${st.total} done` : `${Math.round(frac * 100)}%`,
      eta: el > expected() * 1.6 ? 'Taking a little longer than usual' : fmtLeft(left),
    };
  };
  return {
    st, read,
    set({ done, total: n }) {
      if (n != null) st.total = n;
      if (done != null && done !== st.done) { st.done = done; st.tLast = performance.now(); }
    },
  };
}

// ---------- full-screen work screen ----------

const jobs = [];
let overlay = null;
let pill = null;
let ticker = null;
let returnFocus = null;
const inertBackground = new Map();

const shown = () => jobs.filter((j) => !j.minimized).at(-1);
const backgrounded = () => jobs.filter((j) => j.minimized).at(-1);

function buildOverlay(job) {
  overlay?.remove();
  overlay = document.createElement('div');
  overlay.className = 'work';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', `work-title-${job.id}`);
  overlay.setAttribute('aria-describedby', `work-tip-${job.id}`);
  overlay.tabIndex = -1;
  overlay.innerHTML = `
    <div class="work-card">
      <div class="work-brand">StoryCuts studio</div>
      <div class="work-visual">${VISUALS[job.kind] || VISUALS.draw}</div>
      <h2 class="work-title" id="work-title-${job.id}"></h2>
      <p class="work-tip" id="work-tip-${job.id}"></p>
      ${job.steps.length ? `<ol class="work-steps">${job.steps.map((s) => `<li><i></i>${s}</li>`).join('')}</ol>` : ''}
      <div class="work-bar" role="progressbar" aria-label="Job progress" aria-valuemin="0" aria-valuemax="100"><i></i></div>
      <div class="work-meta"><span class="wm-count"></span><span class="wm-eta"></span></div>
      <div class="work-actions"></div>
      <p class="work-note"></p>
    </div>`;
  const actions = overlay.querySelector('.work-actions');
  if (job.background) {
    const b = document.createElement('button');
    b.className = 'btn primary lg';
    b.textContent = job.background;
    b.addEventListener('click', () => { job.minimized = true; render(); });
    actions.append(b);
  }
  job.actions.forEach((a) => {
    const b = document.createElement('button');
    b.className = `btn ${a.primary ? 'primary' : 'ghost'} lg`;
    b.textContent = a.label;
    b.addEventListener('click', () => a.onClick?.(b));
    actions.append(b);
  });
  overlay.querySelector('.work-note').textContent = job.note || '';
  document.body.append(overlay);
  (overlay.querySelector('.work-actions .btn') || overlay).focus({ preventScroll: true });
  job.tipEl = overlay.querySelector('.work-tip');
  job.tipIdx = 0;
  showTip(job, true);
}

function showTip(job, now = false) {
  if (!job.tipEl || !job.tips.length) return;
  const p = job.tipEl;
  const next = job.tips[job.tipIdx++ % job.tips.length];
  if (now) { p.textContent = next; return; }
  p.classList.add('out');
  setTimeout(() => { p.textContent = next; p.classList.remove('out'); }, 250);
}

function buildPill(job) {
  pill?.remove();
  pill = document.createElement('button');
  pill.className = 'work-pill';
  pill.innerHTML = `<svg class="ring" viewBox="0 0 20 20" aria-hidden="true"><circle class="bg" cx="10" cy="10" r="8"/><circle class="fg" cx="10" cy="10" r="8" stroke-dasharray="50.3" stroke-dashoffset="50.3"/></svg><span class="wp-txt"><b></b><em></em></span><span class="wp-open">View progress</span>`;
  pill.addEventListener('click', () => { job.minimized = false; render(); });
  document.body.append(pill);
  pill.dataset.job = job.id;
}

function paint() {
  const j = shown();
  if (j && overlay?.dataset.job === String(j.id)) {
    const r = j.model.read();
    overlay.querySelector('.work-title').textContent = j.title;
    overlay.querySelector('.work-bar i').style.width = `${r.pct.toFixed(1)}%`;
    overlay.querySelector('.work-bar').setAttribute('aria-valuenow', String(Math.round(r.pct)));
    overlay.querySelector('.work-bar').setAttribute('aria-valuetext', `${r.count}. ${r.eta}`);
    overlay.querySelector('.wm-count').textContent = r.count;
    overlay.querySelector('.wm-eta').textContent = r.eta;
    overlay.querySelectorAll('.work-steps li').forEach((li, i) => {
      li.className = i < j.step ? 'done' : i === j.step ? 'on' : '';
    });
  }
  const b = backgrounded();
  if (b && pill?.dataset.job === String(b.id)) {
    const r = b.model.read();
    pill.querySelector('.fg').setAttribute('stroke-dashoffset', (50.3 * (1 - r.pct / 100)).toFixed(1));
    pill.querySelector('.wp-txt b').textContent = b.short || b.title;
    pill.querySelector('.wp-txt em').textContent = b.model.st.total ? `${b.model.st.done}/${b.model.st.total}` : `${Math.round(r.pct)}%`;
    pill.setAttribute('aria-label', `${b.short || b.title}, ${r.count}. View progress`);
  }
}

function render() {
  const j = shown();
  if (j && !returnFocus) returnFocus = document.activeElement;
  if (j) {
    document.querySelectorAll('.nav, .menu-sheet, main, .cta-band, .foot, dialog').forEach((el) => {
      if (!inertBackground.has(el)) inertBackground.set(el, el.inert);
      el.inert = true;
    });
  }
  if (!j) {
    if (overlay) { const o = overlay; overlay = null; o.classList.add('out'); setTimeout(() => o.remove(), 240); }
  } else if (overlay?.dataset.job !== String(j.id)) {
    buildOverlay(j);
    overlay.dataset.job = j.id;
  }
  const b = backgrounded();
  if (!b) { pill?.remove(); pill = null; } else if (pill?.dataset.job !== String(b.id)) buildPill(b);
  document.body.classList.toggle('has-job', !!b);
  document.body.classList.toggle('work-open', !!j);
  if (!j && returnFocus) {
    inertBackground.forEach((wasInert, el) => { el.inert = wasInert; });
    inertBackground.clear();
    const fallback = document.body.classList.contains('sheet-open') ? document.querySelector('#sheet-done') : document.body.classList.contains('ed-app') || document.body.classList.contains('ed-full') ? document.querySelector('#btn-play') : [...document.querySelectorAll('.panel.active .btn.primary:not(:disabled)')].find((el) => el.getClientRects().length);
    const target = returnFocus.isConnected && !returnFocus.disabled && returnFocus.getClientRects().length ? returnFocus : pill || fallback;
    target?.focus({ preventScroll: true });
    returnFocus = null;
  }
  if (jobs.length && !ticker) ticker = setInterval(() => { paint(); jobs.forEach((x) => { if (!x.minimized && performance.now() - x.tipAt > 4800) { x.tipAt = performance.now(); showTip(x); } }); }, 400);
  if (!jobs.length && ticker) { clearInterval(ticker); ticker = null; }
  paint();
}

document.addEventListener('keydown', (e) => {
  const job = shown();
  if (!job || !overlay) return;
  if (e.key === 'Escape' && job.background) { e.preventDefault(); job.minimized = true; render(); return; }
  if (e.key !== 'Tab') return;
  const controls = [...overlay.querySelectorAll('button:not(:disabled)')];
  if (!controls.length) { e.preventDefault(); overlay.focus(); return; }
  const first = controls[0], last = controls.at(-1);
  if (!overlay.contains(document.activeElement) || (e.shiftKey && document.activeElement === first)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

let nextId = 1;
/**
 * Full-screen progress for a long job.
 *   kind        listen | plan | draw | film
 *   steps       optional list of stage names; update({ step }) moves along
 *   background  label for a button that hides the screen while the job keeps
 *               running (e.g. "Back to editor"); a pill brings it back
 *   actions     [{ label, onClick, primary }] such as Stop or Cancel
 *   short       short label for the background pill
 */
export function showWork({ kind = 'draw', title = 'Working', short = '', tips = [], steps = [], eta = 30, total = 0, perItem = 0, parallel = 1, background = '', actions = [], note = '', countText = null } = {}) {
  const job = { id: nextId++, kind, title, short, tips, steps, step: 0, background, actions, note, minimized: false, tipAt: performance.now(), model: progressModel({ eta, total, perItem, parallel, countText }) };
  jobs.push(job);
  render();
  return {
    update({ title: t, short: s, done, total: n, tips: tp, step, kind: k, eta: e } = {}) {
      if (k && k !== job.kind) {
        job.kind = k;
        const vis = overlay?.dataset.job === String(job.id) && overlay.querySelector('.work-visual');
        if (vis) vis.innerHTML = VISUALS[k] || VISUALS.draw;
      }
      if (e) job.model = progressModel({ eta: e });
      if (t) job.title = t;
      if (s) job.short = s;
      if (step != null) job.step = step;
      if (tp) { job.tips = tp; job.tipIdx = 0; showTip(job); }
      job.model.set({ done, total: n });
      paint();
    },
    minimize() { job.minimized = true; render(); },
    open() { job.minimized = false; render(); },
    get minimized() { return job.minimized; },
    stop() {
      const i = jobs.indexOf(job);
      if (i >= 0) jobs.splice(i, 1);
      if (overlay?.dataset.job === String(job.id)) overlay.dataset.job = '';
      render();
    },
  };
}

// ---------- small inline loader ----------

/** Inline loader inside `host` (kept for compact spots). */
export function showLoader(host, { kind = 'draw', title = 'Working', tips = [], eta = 30, total = 0, perItem = 0, parallel = 1, compact = false } = {}) {
  if (!host) return { update() {}, stop() {} };
  host.innerHTML = `
    <div class="loader ${compact ? 'compact' : ''}" role="status" aria-live="polite">
      <div class="ld-visual">${VISUALS[kind] || VISUALS.draw}</div>
      <div class="ld-body">
        <b class="ld-title"></b>
        <p class="ld-tip"></p>
        <div class="ld-bar"><i></i></div>
        <div class="ld-meta"><span class="ld-count"></span><span class="ld-eta"></span></div>
      </div>
    </div>`;
  host.hidden = false;
  const $ = (s) => host.querySelector(s);
  const m = progressModel({ eta, total, perItem, parallel });
  let ttl = title, tipIdx = 0, tipList = tips;
  const render = () => {
    const r = m.read();
    $('.ld-title').textContent = ttl;
    $('.ld-bar i').style.width = `${r.pct.toFixed(1)}%`;
    $('.ld-count').textContent = r.count;
    $('.ld-eta').textContent = r.eta;
  };
  const tip = () => {
    if (!tipList.length) return;
    const p = $('.ld-tip');
    p.classList.add('out');
    setTimeout(() => { p.textContent = tipList[tipIdx++ % tipList.length]; p.classList.remove('out'); }, 220);
  };
  render(); tip();
  const iv = setInterval(render, 500);
  const tv = setInterval(tip, 4500);
  return {
    update({ title: t, done, total: n, tips: tp } = {}) {
      if (t) ttl = t;
      if (tp) { tipList = tp; tipIdx = 0; tip(); }
      m.set({ done, total: n });
      render();
    },
    stop() { clearInterval(iv); clearInterval(tv); host.innerHTML = ''; host.hidden = true; },
  };
}
