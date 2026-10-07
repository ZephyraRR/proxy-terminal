// Cloudflare Worker: transparent reverse proxy to OpenRouter (streaming preserved).
// Deploy: cd worker && npx wrangler deploy   -> use https://<name>.<account>.workers.dev/api/v1 as BASE_URL.
// Optional: set secret PROXY_TOKEN (wrangler secret put PROXY_TOKEN) and send it as X-Proxy-Token.
export default {
  async fetch(request, env) {
    if (env.PROXY_TOKEN && request.headers.get('X-Proxy-Token') !== env.PROXY_TOKEN) {
      return new Response('Forbidden', { status: 403 });
    }
    const url = new URL(request.url);
    const target = new URL(url.pathname + url.search, 'https://openrouter.ai');
    const headers = new Headers(request.headers);
    for (const h of ['host', 'x-proxy-token', 'cf-connecting-ip', 'x-forwarded-for', 'x-real-ip']) headers.delete(h);
    return fetch(target, { method: request.method, headers, body: request.body, redirect: 'follow' });
  },
};
