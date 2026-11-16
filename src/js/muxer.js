/**
 * Client-side Browser Media Muxer (FFmpeg WASM single-threaded)
 * Merges YouTube adaptive video-only + M4A audio streams directly in the browser
 * with zero re-encoding (-c copy) and no server-side ffmpeg required.
 */

const FFMPEG_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm';
const CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';

let ffmpegInstance = null;
let ffmpegLoadPromise = null;

async function toBlobUrl(url, mimeType, transform = null) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load muxer asset (${res.status})`);
  if (transform) {
    const text = transform(await res.text());
    return URL.createObjectURL(new Blob([text], { type: mimeType }));
  }
  const buf = await res.arrayBuffer();
  return URL.createObjectURL(new Blob([buf], { type: mimeType }));
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

export async function muxVideoAndAudio({
  videoUrl,
  audioUrl,
  title = 'downhere_video',
  trimStart = null,
  trimEnd = null,
  onProgress = () => {},
}) {
  onProgress('Downloading video & audio streams...');
  const [videoRes, audioRes, ffmpeg] = await Promise.all([
    fetch(videoUrl),
    fetch(audioUrl),
    getFFmpeg(),
  ]);

  if (!videoRes.ok) throw new Error(`Video stream failed (HTTP ${videoRes.status})`);
  if (!audioRes.ok) throw new Error(`Audio stream failed (HTTP ${audioRes.status})`);

  const [videoBuf, audioBuf] = await Promise.all([
    videoRes.arrayBuffer(),
    audioRes.arrayBuffer(),
  ]);

  onProgress('Merging video + audio...');
  const inVideo = 'in_video.mp4';
  const inAudio = 'in_audio.m4a';
  const outFile = 'out_merged.mp4';

  await ffmpeg.writeFile(inVideo, new Uint8Array(videoBuf));
  await ffmpeg.writeFile(inAudio, new Uint8Array(audioBuf));

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
