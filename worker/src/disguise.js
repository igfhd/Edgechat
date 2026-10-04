// @ts-check
/**
 * Edgechat Disguise & Reverse Proxy Module
 *
 * Implements:
 * 1. Route prefix disguise (ROUTE_PREFIX) to conceal chat, admin, API, and WebSocket endpoints.
 * 2. Reverse proxy masking (DISGUISE_HOST) to camouflage the site with a real high-reputation domain or authentic Nginx page.
 */

export const DEFAULT_DISGUISE_SITES = [
  'nginx',
  'fentybeauty.com',
  'studiosashiko.com',
  'wholydose.com',
  '100percentpure.com',
  'kyliecosmetics.com',
  'sephora.com',
  'thrivecausemetics.com'
];

const NGINX_200_HTML = `<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
<style>
body {
    width: 35em;
    margin: 0 auto;
    font-family: Tahoma, Verdana, Arial, sans-serif;
}
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and working.
Further configuration is required.</p>

<p>For online documentation and support please refer to
<a href="http://nginx.org/">nginx.org</a>.</p>

<p>Commercial support is available at
<a href="http://nginx.com/">nginx.com</a>.</p>

<p>Thank you for using nginx.</p>
</body>
</html>`;

const NGINX_404_HTML = `<html>
<head><title>404 Not Found</title></head>
<body>
<center><h1>404 Not Found</h1></center>
<hr><center>nginx</center>
</body>
</html>`;

/**
 * Returns an authentic Nginx default page
 * @param {boolean} isRoot
 * @returns {Response}
 */
export function createNginxResponse(isRoot = true) {
  if (isRoot) {
    return new Response(NGINX_200_HTML, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        Server: 'nginx'
      }
    });
  }
  return new Response(NGINX_404_HTML, {
    status: 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      Server: 'nginx'
    }
  });
}

/**
 * Transparently reverse proxies a request to disguiseHost
 * @param {Request} request
 * @param {string} disguiseHost
 * @returns {Promise<Response>}
 */
export async function proxyToDisguiseHost(request, disguiseHost) {
  try {
    const targetUrl = new URL(request.url);
    targetUrl.hostname = disguiseHost;
    targetUrl.protocol = 'https:';
    targetUrl.port = '';

    const newHeaders = new Headers();
    const passHeaders = [
      'user-agent',
      'accept',
      'accept-language',
      'accept-encoding',
      'cache-control',
      'pragma',
      'sec-ch-ua',
      'sec-ch-ua-mobile',
      'sec-ch-ua-platform',
      'sec-fetch-dest',
      'sec-fetch-mode',
      'sec-fetch-site',
      'sec-fetch-user',
      'upgrade-insecure-requests'
    ];

    for (const [key, val] of request.headers.entries()) {
      if (passHeaders.includes(key.toLowerCase())) {
        newHeaders.set(key, val);
      }
    }
    newHeaders.set('Host', disguiseHost);
    newHeaders.set('Referer', `https://${disguiseHost}/`);

    let body = null;
    if (['POST', 'PUT', 'PATCH'].includes(request.method.toUpperCase())) {
      try {
        body = await request.clone().arrayBuffer();
      } catch {
        body = null;
      }
    }

    const subReq = new Request(targetUrl.toString(), {
      method: request.method,
      headers: newHeaders,
      body: body,
      redirect: 'follow'
    });

    const res = await fetch(subReq);
    const resHeaders = new Headers(res.headers);
    resHeaders.delete('content-security-policy');
    resHeaders.delete('content-security-policy-report-only');
    resHeaders.delete('x-frame-options');

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: resHeaders
    });
  } catch (err) {
    console.error('[disguise] Reverse proxy failed, falling back to Nginx page:', err);
    const url = new URL(request.url);
    const isRoot = url.pathname === '/' || url.pathname === '';
    return createNginxResponse(isRoot);
  }
}

/**
 * Extracts and normalizes list of allowed route prefixes from env/options.
 * Supports comma, semicolon, pipe, or whitespace-separated strings, or arrays.
 * e.g. "portal, secret2, entry_3" -> ["portal", "secret2", "entry_3"]
 * @param {Record<string, any>|string} [env]
 * @returns {string[]}
 */
export function getRoutePrefixes(env = {}) {
  const raw = typeof env === 'string' ? env : (env?.ROUTE_PREFIX || env?.routePrefix || '');
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map(p => String(p).replace(/^\/+/, '').replace(/\/+$/, '').trim()).filter(Boolean);
  }
  return String(raw)
    .split(/[,;| ]+/)
    .map(p => p.replace(/^\/+/, '').replace(/\/+$/, '').trim())
    .filter(Boolean);
}

/**
 * Disguise routing handler
 * @param {Request} request
 * @param {Record<string, any>} env
 * @param {(req: Request) => Promise<Response>} next
 * @returns {Promise<Response>}
 */
export async function handleDisguiseRouting(request, env, next) {
  const prefixes = getRoutePrefixes(env);
  const disguiseHost = (env?.DISGUISE_HOST || 'nginx').trim();

  // 1. If no route prefix is configured, bypass disguise
  if (prefixes.length === 0) {
    return await next(request);
  }

  const url = new URL(request.url);
  const decodedPath = url.pathname.split('/').map(decodeURIComponent).join('/');
  const normalizedPath = decodedPath.replace(/^\/+/, '');
  const prefixPart = normalizedPath.split('/')[0];

  // 2. Exact match on any allowed prefix without trailing slash -> Redirect to /${prefix}/
  if (prefixes.includes(normalizedPath)) {
    const redirectUrl = new URL(request.url);
    redirectUrl.pathname = `/${normalizedPath}/`;
    return Response.redirect(redirectUrl.toString(), 302);
  }

  // 3. Prefix mismatch (none of the configured prefixes match) -> Proxy to disguise host or Nginx default page
  if (!prefixes.includes(prefixPart)) {
    if (disguiseHost && disguiseHost !== 'nginx') {
      return await proxyToDisguiseHost(request, disguiseHost);
    }
    const isRoot = normalizedPath === '' || normalizedPath === '/';
    return createNginxResponse(isRoot);
  }

  // 4. Prefix matched -> Strip the matched prefix and rewrite request URL
  const matchedPrefix = prefixPart;
  const hasTrailing = decodedPath.endsWith('/');
  const segments = decodedPath.split('/').filter(Boolean);
  let newPath = `/${segments.slice(1).join('/')}`;
  if (hasTrailing && !newPath.endsWith('/')) {
    newPath += '/';
  }

  const rewrittenUrl = new URL(request.url);
  rewrittenUrl.pathname = newPath;

  const rewrittenHeaders = new Headers(request.headers);
  rewrittenHeaders.set('X-Matched-Prefix', matchedPrefix);

  const rewrittenRequest = new Request(rewrittenUrl.toString(), {
    method: request.method,
    headers: rewrittenHeaders,
    body: request.body,
    redirect: request.redirect
  });
  const response = await next(rewrittenRequest);

  // 5. Post-process response (adjust Location redirects to stay within matched prefix)
  const locationHeader = response.headers.get('Location');
  if (
    locationHeader &&
    (response.status === 301 ||
      response.status === 302 ||
      response.status === 303 ||
      response.status === 307 ||
      response.status === 308)
  ) {
    if (locationHeader.startsWith('/') && !locationHeader.startsWith(`/${matchedPrefix}`)) {
      const newHeaders = new Headers(response.headers);
      const newLocation = locationHeader === '/' ? `/${matchedPrefix}/` : `/${matchedPrefix}${locationHeader}`;
      newHeaders.set('Location', newLocation);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      });
    }
  }

  return response;
}
