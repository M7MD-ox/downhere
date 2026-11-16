/**
 * Cloudflare Pages Functions Gateway for DownMe API
 * Proxies `/api/*` requests to a configured backend server,
 * enabling seamless operation of the PWA on downme.pages.dev.
 */

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  // 1. Resolve backend target from Cloudflare Pages Environment Variables or active tunnel
  const backendBase = env.BACKEND_URL || 'https://tops-fcc-alexandria-toronto.trycloudflare.com';

  if (backendBase) {
    try {
      const targetUrl = new URL(url.pathname + url.search, backendBase);
      const headers = new Headers(request.headers);
      headers.set('X-Forwarded-Host', url.host);
      headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));

      const isBodyAllowed = request.method !== 'GET' && request.method !== 'HEAD';
      const modifiedRequest = new Request(targetUrl.toString(), {
        method: request.method,
        headers: headers,
        body: isBodyAllowed ? request.body : undefined,
        redirect: 'follow',
      });

      const response = await fetch(modifiedRequest);
      const newHeaders = new Headers(response.headers);
      newHeaders.set('Access-Control-Allow-Origin', '*');
      newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
      newHeaders.set('Access-Control-Allow-Headers', '*');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Error connecting to backend (${backendBase}): ${err.message}`,
        }),
        {
          status: 502,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }
  }

  // 2. Health check route responds even without backend
  if (url.pathname === '/api/health') {
    return new Response(
      JSON.stringify({
        status: 'online',
        service: 'DownMe Cloudflare Gateway',
        frontend: 'operational',
        backend_configured: false,
        message: 'Cloudflare Pages frontend is active. Set BACKEND_URL in Cloudflare Pages settings to connect the extraction engine.',
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }

  // 3. Fallback when BACKEND_URL is not configured
  return new Response(
    JSON.stringify({
      success: false,
      error:
        'DownMe Backend is not connected. Cloudflare Pages hosts the frontend interface. Please set the BACKEND_URL environment variable in your Cloudflare Pages dashboard (or run a Cloudflare Tunnel), or pass ?backend_url=https://... in your browser.',
      status: 'backend_required',
      hint: 'The media extraction & FFmpeg transcoding engine requires a Python/FFmpeg host.',
    }),
    {
      status: 503,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    }
  );
}
