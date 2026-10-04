// StoryCuts video relay: a Cloudflare Worker that passes animation requests
// from the StoryCuts site to OpenAI's video API, adding the browser (CORS)
// headers OpenAI's video endpoints don't send.
//
// Deploy (free): dash.cloudflare.com → Workers & Pages → Create → Worker →
// "Hello World" → Edit code → paste this file → Deploy. Copy the worker's
// address (https://<name>.<you>.workers.dev) into StoryCuts → API keys →
// More options → "Video relay address".
//
// It only forwards /v1/videos requests, only for the StoryCuts site, and
// never stores anything. Each user's own OpenAI key passes straight through.

const ALLOWED_ORIGINS = ['https://saadtareen9-source.github.io'];

const cors = (origin) => ({
  'access-control-allow-origin': origin,
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
  vary: 'origin',
});

export default {
  async fetch(request) {
    const origin = request.headers.get('origin') || '';
    const ok = ALLOWED_ORIGINS.includes(origin) || origin.startsWith('http://localhost');
    if (!ok) return new Response('Not allowed', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/v1/videos')) return new Response('Not found', { status: 404, headers: cors(origin) });
    const upstream = await fetch(`https://api.openai.com${url.pathname}${url.search}`, {
      method: request.method,
      headers: { authorization: request.headers.get('authorization') || '', ...(request.headers.get('content-type') ? { 'content-type': request.headers.get('content-type') } : {}) },
      body: request.method === 'GET' ? undefined : request.body,
      redirect: 'follow',
    });
    const headers = new Headers(upstream.headers);
    Object.entries(cors(origin)).forEach(([k, v]) => headers.set(k, v));
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
