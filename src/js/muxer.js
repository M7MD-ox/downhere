/**
 * Client-side Browser Media Muxer (FFmpeg WASM single-threaded)
 * Merges YouTube adaptive video-only + M4A audio streams directly in the browser
 * with zero re-encoding (-c copy) and no server-side ffmpeg required.
 */

const FFMPEG_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm';
const CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';

let ffmpegInstance = null;
let ffmpegLoadPromise = null;

const FFMPEG_CACHE_NAME = 'downhere-ffmpeg-v1';

async function fetchWithCache(url) {
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(FFMPEG_CACHE_NAME);
      const cached = await cache.match(url);
      if (cached) return cached;
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        await cache.put(url, res.clone());
      }
      return res;
    } catch {
      // Fall back to direct fetch if Cache API is restricted
    }
  }
  return fetch(url, { signal: AbortSignal.timeout(15000) });
}

async function toBlobUrl(url, mimeType, transform = null) {
  const res = await fetchWithCache(url);
  if (!res.ok) throw new Error(`Failed to load muxer asset (${res.status})`);
  if (transform) {
    const text = transform(await res.text());
    return URL.createObjectURL(new Blob([text], { type: mimeType }));
  }
  const buf = await res.arrayBuffer();
  return URL.createObjectURL(new Blob([buf], { type: mimeType }));
}

export function isFFmpegReady() {
  return Boolean(ffmpegInstance);
}

export function preloadFFmpeg() {
  if (!ffmpegInstance && !ffmpegLoadPromise) {
    getFFmpeg().catch(() => {});
  }
}

async function getFFmpeg() {
  if (ffmpegInstance) return ffmpegInstance;
  if (ffmpegLoadPromise) return ffmpegLoadPromise;

  ffmpegLoadPromise = (async () => {
    const { FFmpeg } = await import(`${FFMPEG_BASE}/index.js`);
    const ffmpeg = new FFmpeg();

    const [classWorkerURL, coreURL, wasmURL] = await Promise.all([
      toBlobUrl(`${FFMPEG_BASE}/worker.js`, 'text/javascript', (src) =>
        src
          .replace(/from\s*["']\.\/const\.js["']/g, `from "${FFMPEG_BASE}/const.js"`)
          .replace(/from\s*["']\.\/errors\.js["']/g, `from "${FFMPEG_BASE}/errors.js"`)
      ),
      toBlobUrl(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
      toBlobUrl(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
    ]);

    await ffmpeg.load({ classWorkerURL, coreURL, wasmURL });
    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await ffmpegLoadPromise;
  } catch (err) {
    ffmpegLoadPromise = null;
    throw err;
  }
}

export function sanitizeDownloadFilename(title, ext = 'mp4') {
  const clean = String(title || 'downhere_video')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return `${clean || 'downhere_video'}.${ext}`;
}

const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB chunks avoid Vercel 504 & YouTube 1x throttle

async function fetchStreamChunked(url) {
  const firstRes = await fetch(url, {
    headers: { Range: `bytes=0-${CHUNK_SIZE - 1}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!firstRes.ok && firstRes.status !== 206) {
    throw new Error(`Stream failed (HTTP ${firstRes.status})`);
  }

  const firstBuf = new Uint8Array(await firstRes.arrayBuffer());
  const contentRange = firstRes.headers.get('content-range');
  const totalMatch = contentRange?.match(/\/(\d+)$/);
  if (firstRes.status !== 206 || !totalMatch) {
    return firstBuf;
  }

  const totalSize = Number(totalMatch[1]);
  if (firstBuf.length >= totalSize) {
    return firstBuf;
  }

  const out = new Uint8Array(totalSize);
  out.set(firstBuf, 0);

  const ranges = [];
  for (let start = firstBuf.length; start < totalSize; start += CHUNK_SIZE) {
    ranges.push([start, Math.min(start + CHUNK_SIZE - 1, totalSize - 1)]);
  }

  // Fetch up to 3 chunks concurrently
  let cursor = 0;
  async function worker() {
    while (cursor < ranges.length) {
      const idx = cursor++;
      const [start, end] = ranges[idx];
      const r = await fetch(url, {
        headers: { Range: `bytes=${start}-${end}` },
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok && r.status !== 206) {
        throw new Error(`Chunk ${idx} failed (HTTP ${r.status})`);
      }
      const chunk = new Uint8Array(await r.arrayBuffer());
      out.set(chunk, start);
    }
  }

  await Promise.all(Array.from({ length: Math.min(3, ranges.length) }, () => worker()));
  return out;
}

export async function muxVideoAndAudio({
  videoUrl,
  audioUrl,
  title = 'downhere_video',
  trimStart = null,
  trimEnd = null,
  onProgress = () => {},
}) {
  onProgress('Downloading video & audio streams...');
  const ffmpegPromise = getFFmpeg();
  const [videoBytes, audioBytes] = await Promise.all([
    fetchStreamChunked(videoUrl),
    fetchStreamChunked(audioUrl),
  ]);
  const ffmpeg = await ffmpegPromise;

  onProgress('Merging video + audio...');
  const inVideo = 'in_video.mp4';
  const inAudio = 'in_audio.m4a';
  const outFile = 'out_merged.mp4';

  await ffmpeg.writeFile(inVideo, videoBytes);
  await ffmpeg.writeFile(inAudio, audioBytes);

  const args = [];
  if (trimStart !== null && trimStart !== undefined && trimStart !== '') {
    args.push('-ss', String(trimStart));
  }
  if (trimEnd !== null && trimEnd !== undefined && trimEnd !== '') {
    args.push('-to', String(trimEnd));
  }
  args.push('-i', inVideo, '-i', inAudio, '-c', 'copy', '-movflags', '+faststart', '-shortest', outFile);

  await ffmpeg.exec(args);
  const data = await ffmpeg.readFile(outFile);

  // Clean up virtual FS
  await Promise.allSettled([
    ffmpeg.deleteFile(inVideo),
    ffmpeg.deleteFile(inAudio),
    ffmpeg.deleteFile(outFile),
  ]);

  const blob = new Blob([data.buffer], { type: 'video/mp4' });
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = sanitizeDownloadFilename(title, 'mp4');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
}
