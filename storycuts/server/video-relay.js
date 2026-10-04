// StoryCuts video relay (v3): a Cloudflare Worker that passes animation
// requests from the StoryCuts site to OpenAI's video API, adding the browser
// (CORS) headers OpenAI's video endpoints don't send.
//
// Deploy (free): dash.cloudflare.com → Workers & Pages → Create → Worker →
// "Hello World" → Edit code → replace everything with this file → Deploy.
// Check it: open the worker's address in a browser tab. You should see
// {"ok":true,"relay":"storycuts","version":3}. Then paste the address into
// StoryCuts → API keys → More options → "Video relay address" → Test.
//
// It only forwards video requests, only for the StoryCuts site, and never
// stores anything. Each user's own OpenAI key passes straight through.

const ALLOWED_ORIGINS = ['https://saadtareen9-source.github.io'];
const VERSION = 3;

const cors = (origin) => ({
  'access-control-allow-origin': origin || '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-expose-headers': 'x-storycuts-relay',
  'access-control-max-age': '86400',
  vary: 'origin',
});

const json = (body, status, origin) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors(origin) } });
const fail = (message, status, origin) => json({ error: { message: `StoryCuts relay: ${message}` } }, status, origin);

export default {
  async fetch(request) {
    const origin = request.headers.get('origin') || '';
    const url = new URL(request.url);
    // find the video API part of the path, wherever the address points
    const at = url.pathname.indexOf('/videos');
    const isVideo = at !== -1;

    // health check: open the worker's address in a tab, or the Test button
    if (!isVideo && request.method === 'GET') return json({ ok: true, relay: 'storycuts', version: VERSION }, 200, origin);

    const allowed = !origin || ALLOWED_ORIGINS.includes(origin) || origin.startsWith('http://localhost');
    if (!allowed) return fail(`requests from ${origin} are not allowed.`, 403, origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (!isVideo) return fail(`only video requests are passed on (got ${url.pathname}).`, 404, origin);

    const path = `/v1${url.pathname.slice(at)}${url.search}`;
    let upstream;
    try {
      upstream = await fetch(`https://api.openai.com${path}`, {
        method: request.method,
        headers: {
          authorization: request.headers.get('authorization') || '',
          ...(request.headers.get('content-type') ? { 'content-type': request.headers.get('content-type') } : {}),
        },
        body: request.method === 'GET' ? undefined : request.body,
        redirect: 'follow',
      });
    } catch (e) {
      return fail(`couldn't reach OpenAI (${e.message}).`, 502, origin);
    }
    const headers = new Headers(upstream.headers);
    Object.entries(cors(origin)).forEach(([k, v]) => headers.set(k, v));
    headers.set('x-storycuts-relay', String(VERSION));
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
