// Cloudflare Worker: transparent reverse proxy to OpenRouter (streaming preserved).
// One Worker per account/IP: deploy it twice under different names (see ../deploy-workers.bat).
// Optional vars: UPSTREAM (default https://openrouter.ai, only changed for local tests), PROXY_TOKEN (secret).
export default {
  async fetch(request, env) {
    if (env.PROXY_TOKEN && request.headers.get('X-Proxy-Token') !== env.PROXY_TOKEN) {
      return new Response('Forbidden', { status: 403 });
    }
    const url = new URL(request.url);
    const target = new URL(url.pathname + url.search, env.UPSTREAM || 'https://openrouter.ai');
    const headers = new Headers(request.headers);
    for (const h of ['host', 'x-proxy-token', 'cf-connecting-ip', 'x-forwarded-for', 'x-real-ip']) headers.delete(h);
    if (env.WORKER_NAME) headers.set('X-Worker-Name', env.WORKER_NAME); // only set in local tests
    return fetch(target, { method: request.method, headers, body: request.body, redirect: 'follow' });
  },
};
