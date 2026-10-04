// Loading screens: a visual, what's happening in plain words, progress and
// an honest time estimate. One component used for every long wait.

const VISUALS = {
  // sound waves for listening to the video
  listen: `<svg viewBox="0 0 120 80" class="ld-svg ld-listen">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => `<rect x="${10 + i * 12}" y="20" width="6" height="40" rx="3" style="animation-delay:${(i % 5) * -0.18}s"/>`).join('')}</svg>`,
  // storyboard frames being laid out
  plan: `<svg viewBox="0 0 120 80" class="ld-svg ld-plan">${[0, 1, 2].map((i) => `<g style="animation-delay:${i * 0.35}s"><rect x="${8 + i * 37}" y="16" width="30" height="40" rx="5"/><path d="M${14 + i * 37} 48 l7-9 6 6 4-4 7 7"/></g>`).join('')}<path class="ld-line" d="M8 66 H112"/></svg>`,
  // a pencil sketching a character
  draw: `<svg viewBox="0 0 120 80" class="ld-svg ld-draw"><circle cx="60" cy="22" r="10"/><path d="M60 32v22M60 38l-13 10M60 38l13 10M60 54l-10 18M60 54l10 18"/><g class="ld-pencil"><path d="M0 0l18-18 5 5-18 18-7 2z"/></g></svg>`,
  // a film strip rolling
  film: `<svg viewBox="0 0 120 80" class="ld-svg ld-film"><rect x="6" y="14" width="108" height="52" rx="6"/><g class="ld-frames">${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${12 + i * 34}" y="24" width="26" height="32" rx="3"/>`).join('')}</g>${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => `<rect class="ld-hole" x="${10 + i * 12}" y="17" width="5" height="4" rx="1"/><rect class="ld-hole" x="${10 + i * 12}" y="59" width="5" height="4" rx="1"/>`).join('')}</svg>`,
};

const fmtLeft = (s) => {
  if (s <= 4) return 'Almost done…';
  if (s < 60) return `About ${Math.max(5, Math.round(s / 5) * 5)} seconds left`;
  const m = Math.round(s / 60);
  return `About ${m} minute${m > 1 ? 's' : ''} left`;
};

/**
 * Show a loader inside `host`.
 *   kind:    listen | plan | draw | film
 *   eta:     expected seconds for the whole job (or per item with `total`)
 *   perItem: seconds per item when counting items; parallel: items at once
 */
export function showLoader(host, { kind = 'draw', title = 'Working…', tips = [], eta = 30, total = 0, perItem = 0, parallel = 1, compact = false } = {}) {
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
  const st = { title, done: 0, total, t0: performance.now(), tLast: performance.now(), tipIdx: 0, tips };
  const expected = () => (st.total && perItem ? Math.ceil(st.total / parallel) * perItem : eta);
  const render = () => {
    const el = (performance.now() - st.t0) / 1000;
    let frac;
    let left;
    if (st.total && perItem) {
      // finished items, plus a share of the batch in progress
      const sinceLast = (performance.now() - st.tLast) / 1000;
      const running = Math.min(parallel, st.total - st.done);
      const partial = running ? Math.min(0.9, sinceLast / perItem) * running : 0;
      frac = (st.done + partial) / st.total;
      left = Math.max(0, Math.ceil((st.total - st.done) / parallel) * perItem - sinceLast);
    } else {
      // ease towards 95% over the expected time, never claiming to be done
      frac = 0.95 * (1 - Math.exp(-el / Math.max(5, expected() * 0.6)));
      left = Math.max(0, expected() - el);
    }
    $('.ld-title').textContent = st.title;
    $('.ld-bar i').style.width = `${Math.max(3, Math.min(99, frac * 100)).toFixed(1)}%`;
    $('.ld-count').textContent = st.total ? `${st.done} of ${st.total} done` : `${Math.round(frac * 100)}%`;
    $('.ld-eta').textContent = el > expected() * 1.6 ? 'Taking a little longer than usual…' : fmtLeft(left);
  };
  const tip = () => {
    if (!st.tips.length) return;
    const p = $('.ld-tip');
    p.classList.add('out');
    setTimeout(() => { p.textContent = st.tips[st.tipIdx++ % st.tips.length]; p.classList.remove('out'); }, 220);
  };
  render(); tip();
  const iv = setInterval(render, 500);
  const tv = setInterval(tip, 4500);
  return {
    update({ title: t, done, total: n, tips: tp } = {}) {
      if (t) st.title = t;
      if (tp) { st.tips = tp; st.tipIdx = 0; tip(); }
      if (n != null) st.total = n;
      if (done != null && done !== st.done) { st.done = done; st.tLast = performance.now(); }
      render();
    },
    stop() { clearInterval(iv); clearInterval(tv); host.innerHTML = ''; host.hidden = true; },
  };
}
