// Subscriptions. Everything you'd want to change about plans lives here.
//
// How checkout works (no server needed to start):
//   1. In Stripe, create a Product per plan with a monthly and a yearly price.
//   2. For each price, create a Payment Link. Under "After payment", choose
//      "Don't show confirmation page" and redirect to:
//        https://saadtareen9-source.github.io/storycuts/?checkout=success&plan=<plan id>
//   3. Paste each link into `links` below, and your Customer Portal link into
//      `portalUrl` so subscribers can cancel or change plans.
//
// Until a link is filled in, its button explains that checkout isn't open yet.
// Note: this check runs in the browser, so it keeps honest people on the right
// path but isn't real protection. A small server that checks Stripe (planned
// next) is what makes access airtight.

export const BILLING = {
  enforce: true,
  yearlyDiscount: 0.2,
  portalUrl: '',
  plans: [
    {
      id: 'starter',
      name: 'Starter',
      monthly: 15,
      blurb: 'For trying StoryCuts on a few stories a month.',
      videos: 5,
      features: ['5 videos a month', 'Stories up to 2 minutes', 'All 8 art styles', 'Captions and sound effects', 'HD export, no watermark'],
      links: { monthly: '', yearly: '' },
    },
    {
      id: 'creator',
      name: 'Creator',
      monthly: 35,
      popular: true,
      blurb: 'For creators posting storytimes every week.',
      videos: 15,
      features: ['15 videos a month', 'Stories up to 5 minutes', 'Create your own style', 'Upload your own characters', 'Priority drawing'],
      links: { monthly: '', yearly: '' },
    },
    {
      id: 'studio',
      name: 'Studio',
      monthly: 79,
      blurb: 'For channels and teams with a busy schedule.',
      videos: 40,
      features: ['40 videos a month', 'Stories up to 10 minutes', 'Everything in Creator', 'Commercial use', 'Early access to new styles'],
      links: { monthly: '', yearly: '' },
    },
  ],
};

const KEY = 'storycuts:plan';
const OWNER = 'storycuts:owner';

const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

export const planById = (id) => BILLING.plans.find((p) => p.id === id);

/** Price shown per month for a billing period. */
export function monthlyPrice(plan, period) {
  return String(period === 'yearly' ? Math.round(plan.monthly * (1 - BILLING.yearlyDiscount)) : plan.monthly);
}

export const yearlyTotal = (plan) => Number(monthlyPrice(plan, 'yearly')) * 12;

export function currentPlan() {
  const saved = read(KEY);
  return saved && planById(saved.id) ? { ...saved, plan: planById(saved.id) } : null;
}

export const isOwner = () => !!read(OWNER);
export const hasAccess = () => !BILLING.enforce || !!currentPlan() || isOwner();

export function checkoutUrl(planId, period) {
  return planById(planId)?.links?.[period] || '';
}

export function signOut() { write(KEY, null); write(OWNER, null); }

/**
 * Handle the return from Stripe (?checkout=success&plan=creator) and the
 * owner preview switch (?unlock=owner). Returns a message to show, if any.
 */
export function handleReturn() {
  const q = new URLSearchParams(location.search);
  let msg = '';
  if (q.get('checkout') === 'success' && planById(q.get('plan'))) {
    write(KEY, { id: q.get('plan'), since: Date.now() });
    msg = `Welcome to StoryCuts ${planById(q.get('plan')).name}! You're all set to create.`;
  }
  if (q.get('unlock') === 'owner') { write(OWNER, true); msg = 'Owner access turned on for this browser.'; }
  if (q.has('checkout') || q.has('plan') || q.has('unlock')) {
    ['checkout', 'plan', 'unlock'].forEach((k) => q.delete(k));
    const rest = q.toString();
    history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
  }
  return msg;
}
