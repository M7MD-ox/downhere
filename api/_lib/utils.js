export const VR_UA =
  'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip';
export const ANDROID_UA = 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip';
export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export function formatSrtTime(ms) {
  const total = Math.max(0, Math.round(ms));
  const hours = String(Math.floor(total / 3600000)).padStart(2, '0');
  const mins = String(Math.floor((total % 3600000) / 60000)).padStart(2, '0');
  const secs = String(Math.floor((total % 60000) / 1000)).padStart(2, '0');
  const millis = String(total % 1000).padStart(3, '0');
  return `${hours}:${mins}:${secs},${millis}`;
}

export function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function timedTextXmlToSrt(xml) {
  const blocks = [];
  const regex = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let idx = 1;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const attrs = match[1];
    const startMs = Number(attrs.match(/\bt="(\d+)"/)?.[1] || 0);
    const durMs = Number(attrs.match(/\bd="(\d+)"/)?.[1] || 2000);
    const rawText = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, '').trim());
    if (!rawText) continue;
    blocks.push(`${idx++}\n${formatSrtTime(startMs)} --> ${formatSrtTime(startMs + durMs)}\n${rawText}`);
  }
  return blocks.join('\n\n') + '\n';
}

export function extractMetaTags(html, property) {
  if (!html) return [];
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const results = [];
  const re1 = new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'gi');
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["']`, 'gi');
  let m;
  while ((m = re1.exec(html)) !== null) results.push(decodeHtmlEntities(m[1]));
  while ((m = re2.exec(html)) !== null) {
    const val = decodeHtmlEntities(m[1]);
    if (!results.includes(val)) results.push(val);
  }
  return results;
}

export function extractMetaTag(html, property) {
  return extractMetaTags(html, property)[0] || '';
}

export function unescapeJsonString(raw) {
  if (!raw) return '';
  try {
    return JSON.parse(`"${raw.replace(/"/g, '\\"')}"`);
  } catch {
    return raw.replace(/\\\//g, '/');
  }
}
