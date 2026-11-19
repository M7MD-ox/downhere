import dns from 'node:dns/promises';
import net from 'node:net';

export const MAX_JSON_BYTES = 64 * 1024;
export const MAX_ZIP_ITEMS = 25;
export const MAX_ZIP_ITEM_BYTES = 15 * 1024 * 1024;
export const MAX_ZIP_TOTAL_BYTES = 45 * 1024 * 1024;

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 60;
const rateBuckets = new Map();

export function getClientIp(req) {
  const xff = req?.headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return req?.socket?.remoteAddress || 'unknown';
}

export function checkRateLimit(req, res) {
  const ip = getClientIp(req);
  if (ip === 'unknown' || ip === '127.0.0.1' || ip === '::1') return true;

  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    bucket = { windowStart: now, count: 0 };
    rateBuckets.set(ip, bucket);
  }
  bucket.count += 1;

  if (rateBuckets.size > 1000) {
    for (const [k, v] of rateBuckets) {
      if (now - v.windowStart >= RATE_LIMIT_WINDOW_MS) rateBuckets.delete(k);
    }
  }

  if (bucket.count > RATE_LIMIT_MAX_REQUESTS) {
    res.setHeader('Retry-After', '60');
    res.status(429).json({ detail: 'Too many requests. Please wait a minute and try again.' });
    return false;
  }
  return true;
}

export function isAllowedOrigin(origin) {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    const host = u.hostname.toLowerCase();
    return (
      host === 'downhere.vercel.app' ||
      host === 'downme.vercel.app' ||
      /^downme-[a-z0-9-]+\.vercel\.app$/.test(host) ||
      host === 'localhost' ||
      host === '127.0.0.1'
    );
  } catch {
    return false;
  }
}

export function setCors(req, res) {
  const origin = req?.headers?.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, Content-Range');
}

export function sanitizeFilename(name, fallback = 'downhere_Media') {
  const cleaned = String(name || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
  return cleaned || fallback;
}

export function asciiFilename(name) {
  return name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'") || 'downhere_Media';
}

export function setDownloadHeaders(res, filename, contentType, inline = false) {
  const safeAscii = asciiFilename(filename);
  const encoded = encodeURIComponent(filename);
  const disp = inline ? 'inline' : 'attachment';
  if (contentType) res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Content-Disposition',
    `${disp}; filename="${safeAscii}"; filename*=UTF-8''${encoded}`
  );
}

export function isPrivateIp(ip) {
  const clean = String(ip || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!clean) return true;
  if (clean.startsWith('::ffff:')) {
    const mapped = clean.slice(7);
    if (mapped.includes(':')) {
      const parts = mapped.split(':');
      if (parts.length === 2) {
        const hi = parseInt(parts[0], 16);
        const lo = parseInt(parts[1], 16);
        if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
          return isPrivateIp(`${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`);
        }
      }
    }
    return isPrivateIp(mapped);
  }
  if (net.isIPv4(clean)) {
    const [a, b] = clean.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (net.isIPv6(clean)) {
    if (clean === '::' || clean === '::1') return true;
    if (clean.startsWith('fc') || clean.startsWith('fd')) return true;
    if (/^fe[89ab]/.test(clean)) return true;
    return false;
  }
  return false;
}

export function validatePublicUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Missing URL parameter.');
  }
  const trimmed = rawUrl.trim();
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Invalid URL format. Please provide an http:// or https:// URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http:// and https:// URLs are supported.');
  }
  const host = (parsed.hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || (!net.isIP(host) && !host.includes('.'))) {
    throw new Error('URL must contain a valid public domain.');
  }
  const blockedHosts = new Set([
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '169.254.169.254',
    '::1',
    'metadata.google.internal',
  ]);
  if (blockedHosts.has(host) || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Local or private network addresses are not permitted.');
  }
  if (net.isIP(host) && isPrivateIp(host)) {
    throw new Error('Private IP addresses are not permitted.');
  }
  return trimmed;
}

export async function assertSafeRemoteUrl(rawUrl) {
  const valid = validatePublicUrl(rawUrl);
  const host = new URL(valid).hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('Private IP addresses are not permitted.');
    return valid;
  }
  const records = await dns.lookup(host, { all: true }).catch(() => []);
  for (const rec of records) {
    if (isPrivateIp(rec.address)) {
      throw new Error('URL resolved to a private or internal IP address.');
    }
  }
  return valid;
}

export async function safeFetch(rawUrl, init = {}, maxRedirects = 5) {
  let currentUrl = await assertSafeRemoteUrl(rawUrl);
  for (let i = 0; i <= maxRedirects; i++) {
    const res = await fetch(currentUrl, { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      currentUrl = await assertSafeRemoteUrl(new URL(loc, currentUrl).toString());
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects.');
}
