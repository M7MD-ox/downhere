import { Readable } from 'node:stream';

export const config = {
  maxDuration: 60,
};

const VR_UA =
  'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip';
const ANDROID_UA = 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Warm-instance cache to speed up immediate /api/download after /api/extract
const extractCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, Content-Range');
}

function sanitizeFilename(name, fallback = 'downhere_Media') {
  const cleaned = String(name || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
  return cleaned || fallback;
}

function asciiFilename(name) {
  return name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'") || 'downhere_Media';
}

function setDownloadHeaders(res, filename, contentType, inline = false) {
  const safeAscii = asciiFilename(filename);
  const encoded = encodeURIComponent(filename);
  const disp = inline ? 'inline' : 'attachment';
  if (contentType) res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Content-Disposition',
    `${disp}; filename="${safeAscii}"; filename*=UTF-8''${encoded}`
  );
}

function validatePublicUrl(rawUrl) {
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
  const host = (parsed.hostname || '').toLowerCase();
  if (!host || !host.includes('.')) {
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
  if (blockedHosts.has(host)) {
    throw new Error('Local or private network addresses are not permitted.');
  }
  // Reject dotted-quad private/loopback IPv4 literals
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) {
      throw new Error('Private IP addresses are not permitted.');
    }
  }
  return trimmed;
}

function parseYouTubeId(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    if (host.includes('youtu.be')) {
      const seg = u.pathname.split('/').filter(Boolean)[0];
      if (seg && /^[A-Za-z0-9_-]{11}$/.test(seg)) return seg;
    }
    if (host.includes('youtube.com') || host.includes('youtube-nocookie.com')) {
      const v = u.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      const parts = u.pathname.split('/').filter(Boolean);
      for (const prefix of ['shorts', 'embed', 'live', 'v']) {
        const idx = parts.indexOf(prefix);
        if (idx !== -1 && parts[idx + 1] && /^[A-Za-z0-9_-]{11}$/.test(parts[idx + 1])) {
          return parts[idx + 1];
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

function detectPlatform(rawUrl) {
  const host = new URL(rawUrl).hostname.toLowerCase();
  if (host.includes('youtube.com') || host.includes('youtu.be') || host.includes('music.youtube.com')) {
    return 'youtube';
  }
  if (host.includes('tiktok.com')) return 'tiktok';
  if (host.includes('pinterest.') || host.includes('pin.it')) return 'pinterest';
  if (host.includes('facebook.com') || host.includes('fb.watch') || host.includes('fb.com')) {
    return 'facebook';
  }
  if (host.includes('instagram.com')) return 'instagram';
  if (
    host === 'x.com' ||
    host.endsWith('.x.com') ||
    host.includes('twitter.com') ||
    host.includes('fxtwitter.com') ||
    host.includes('vxtwitter.com')
  ) {
    return 'twitter';
  }
  return 'universal';
}

async function fetchInnertubePlayer(videoId, clientConfig, userAgent) {
  const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': userAgent,
    },
    body: JSON.stringify({
      videoId,
      context: { client: clientConfig },
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return res.json();
}

async function extractYouTube(rawUrl) {
  const videoId = parseYouTubeId(rawUrl);
  if (!videoId) {
    throw new Error('Could not extract a valid YouTube video ID from this URL.');
  }

  const [vrData, androidData] = await Promise.all([
    fetchInnertubePlayer(
      videoId,
      {
        clientName: 'ANDROID_VR',
        clientVersion: '1.65.10',
        deviceMake: 'Oculus',
        deviceModel: 'Quest 3',
        androidSdkVersion: 32,
        osName: 'Android',
        osVersion: '12L',
      },
      VR_UA
    ).catch(() => null),
    fetchInnertubePlayer(
      videoId,
      {
        clientName: 'ANDROID',
        clientVersion: '20.10.38',
        androidSdkVersion: 30,
        osName: 'Android',
        osVersion: '11',
      },
      ANDROID_UA
    ).catch(() => null),
  ]);

  const primary =
    vrData?.playabilityStatus?.status === 'OK'
      ? vrData
      : androidData?.playabilityStatus?.status === 'OK'
        ? androidData
        : vrData || androidData;

  const details = primary?.videoDetails || {};
  let title = details.title || '';
  let author = details.author || '';
  const duration = details.lengthSeconds ? Number(details.lengthSeconds) : null;

  if (!title) {
    try {
      const oe = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (oe.ok) {
        const oj = await oe.json();
        title = oj.title || title;
        author = oj.author_name || author;
      }
    } catch {
      // Ignore oembed fallback errors
    }
  }

  const thumbnail = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

  // Progressive muxed stream (has both audio + video) from ANDROID client
  const androidProg = (androidData?.streamingData?.formats || []).find((f) => f.url);
  const vrProg = (vrData?.streamingData?.formats || []).find((f) => f.url);
  const adaptiveFormats = primary?.streamingData?.adaptiveFormats || [];

  // Map video formats per height, preferring H.264 mp4 for broad compatibility
  const byHeight = new Map();
  for (const f of adaptiveFormats) {
    if (!f.url || !f.mimeType?.startsWith('video/') || !f.height) continue;
    const h = Number(f.height);
    if (![2160, 1440, 1080, 720, 480, 360].includes(h)) continue;
    const isMp4 = f.mimeType.startsWith('video/mp4');
    const isAvc = f.mimeType.includes('avc1');
    const score = (isAvc ? 30 : isMp4 ? 20 : 10) + (f.fps >= 50 ? 2 : 0);
    const existing = byHeight.get(h);
    if (!existing || score > existing._score) {
      byHeight.set(h, {
        format_id: String(f.itag),
        quality: `${h}p`,
        label: h >= 2160 ? '4K (2160p)' : `${h}p`,
        ext: isMp4 ? 'mp4' : 'webm',
        filesize: f.contentLength ? Number(f.contentLength) : null,
        url: f.url,
        ua: primary === androidData ? ANDROID_UA : VR_UA,
        muxed: false,
        default: false,
        _score: score,
      });
    }
  }

  // Ensure 360p progressive MP4 (with audio) is represented nicely
  if (androidProg?.url) {
    byHeight.set(360, {
      format_id: String(androidProg.itag || 18),
      quality: '360p',
      label: '360p (MP4 + Audio)',
      ext: 'mp4',
      filesize: androidProg.contentLength ? Number(androidProg.contentLength) : null,
      url: androidProg.url,
      ua: ANDROID_UA,
      muxed: true,
      default: false,
      _score: 100,
    });
  } else if (vrProg?.url && !byHeight.has(360)) {
    byHeight.set(360, {
      format_id: String(vrProg.itag || 18),
      quality: '360p',
      label: '360p',
      ext: 'mp4',
      filesize: vrProg.contentLength ? Number(vrProg.contentLength) : null,
      url: vrProg.url,
      ua: VR_UA,
      muxed: true,
      default: false,
      _score: 90,
    });
  }

  const videoFormats = Array.from(byHeight.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([, v]) => {
      const { _score, ...clean } = v;
      return clean;
    });

  // Mark default quality = 1080p if present, else highest <= 1080p
  if (videoFormats.length > 0) {
    const exact1080 = videoFormats.find((v) => v.quality === '1080p');
    const under1080 = videoFormats.find((v) => parseInt(v.quality, 10) <= 1080);
    (exact1080 || under1080 || videoFormats[0]).default = true;
  }

  // Audio formats: prefer ANDROID adaptive streams (support un-ranged 200 GET), fallback to primary
  const androidAdaptive =
    androidData?.playabilityStatus?.status === 'OK' ? androidData?.streamingData?.adaptiveFormats || [] : [];
  const audioPool = androidAdaptive.some((f) => f.url && f.mimeType?.startsWith('audio/'))
    ? androidAdaptive
    : adaptiveFormats;
  const audioUa = audioPool === androidAdaptive ? ANDROID_UA : primary === androidData ? ANDROID_UA : VR_UA;

  const audioFormats = [];
  const audioMp4High = audioPool
    .filter((f) => f.url && f.mimeType?.startsWith('audio/mp4'))
    .sort((a, b) => (b.averageBitrate || 0) - (a.averageBitrate || 0))[0];
  const audioWebmHigh = audioPool
    .filter((f) => f.url && f.mimeType?.startsWith('audio/webm'))
    .sort((a, b) => (b.averageBitrate || 0) - (a.averageBitrate || 0))[0];

  if (audioMp4High) {
    audioFormats.push({
      format_id: String(audioMp4High.itag || 140),
      quality: 'Audio M4A',
      label: 'Audio M4A (128k)',
      ext: 'm4a',
      bitrate: `${Math.round((audioMp4High.averageBitrate || 128000) / 1000)}k`,
      filesize: audioMp4High.contentLength ? Number(audioMp4High.contentLength) : null,
      url: audioMp4High.url,
      ua: audioUa,
      default: true,
    });
  }
  if (audioWebmHigh) {
    audioFormats.push({
      format_id: String(audioWebmHigh.itag || 251),
      quality: 'Audio WebM',
      label: 'Audio Opus',
      ext: 'webm',
      bitrate: `${Math.round((audioWebmHigh.averageBitrate || 128000) / 1000)}k`,
      filesize: audioWebmHigh.contentLength ? Number(audioWebmHigh.contentLength) : null,
      url: audioWebmHigh.url,
      ua: audioUa,
      default: !audioMp4High,
    });
  }

  // Subtitles
  const tracks = primary?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const seenLangs = new Set();
  const subtitles = [];
  for (const t of tracks) {
    const lang = t.languageCode;
    if (!lang || seenLangs.has(lang) || !t.baseUrl) continue;
    seenLangs.add(lang);
    const label = t.name?.simpleText || t.name?.runs?.[0]?.text || lang;
    subtitles.push({
      lang,
      label,
      ext: 'srt',
      url: t.baseUrl,
    });
  }

async function fetchYouTubeCliptoFallback(rawUrl, videoId) {
  const res = await fetch('https://www.clipto.com/api/youtube', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': BROWSER_UA },
    body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${videoId}` }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data?.success || !Array.isArray(data.medias) || data.medias.length === 0) return null;

  const byHeight = new Map();
  for (const m of data.medias) {
    if (m.type !== 'video' || !m.url) continue;
    const qMatch = String(m.quality || '').match(/(\d{3,4})p/);
    const h = qMatch ? Number(qMatch[1]) : m.height ? Number(m.height) : null;
    if (!h || ![2160, 1440, 1080, 720, 480, 360].includes(h)) continue;
    const isMuxed = Boolean(m.is_audio);
    const isMp4 = String(m.quality || '').toLowerCase().includes('mp4') || isMuxed;
    const isAvc = String(m.quality || '').toLowerCase().includes('avc1') || isMuxed;
    const score = (isMuxed ? 100 : 0) + (isAvc ? 30 : isMp4 ? 20 : 10);
    const existing = byHeight.get(h);
    if (!existing || score > existing._score) {
      byHeight.set(h, {
        format_id: `clipto-${h}-${isMuxed ? 'muxed' : 'vid'}`,
        quality: `${h}p`,
        label: isMuxed ? `${h}p (MP4 + Audio)` : h >= 2160 ? '4K (2160p)' : `${h}p`,
        ext: isMp4 ? 'mp4' : 'webm',
        filesize: null,
        url: m.url,
        ua: BROWSER_UA,
        muxed: isMuxed,
        default: false,
        _score: score,
      });
    }
  }

  const videoFormats = Array.from(byHeight.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([, v]) => {
      const { _score, ...clean } = v;
      return clean;
    });
  if (videoFormats.length > 0) {
    const exact1080 = videoFormats.find((v) => v.quality === '1080p');
    const under1080 = videoFormats.find((v) => parseInt(v.quality, 10) <= 1080);
    (exact1080 || under1080 || videoFormats[0]).default = true;
  }

  const audioFormats = [];
  const bestM4a = data.medias.find((m) => m.type === 'audio' && String(m.quality || '').includes('m4a') && !String(m.quality).includes('DRC') && m.url)
    || data.medias.find((m) => m.type === 'audio' && String(m.quality || '').includes('m4a') && m.url);
  const bestOpus = data.medias.find((m) => m.type === 'audio' && String(m.quality || '').includes('opus') && !String(m.quality).includes('DRC') && m.url);
  if (bestM4a) {
    audioFormats.push({
      format_id: 'clipto-m4a',
      quality: 'Audio M4A',
      label: 'Audio M4A (128k)',
      ext: 'm4a',
      bitrate: '128k',
      filesize: null,
      url: bestM4a.url,
      ua: BROWSER_UA,
      default: true,
    });
  }
  if (bestOpus) {
    audioFormats.push({
      format_id: 'clipto-opus',
      quality: 'Audio WebM',
      label: 'Audio Opus',
      ext: 'webm',
      bitrate: '128k',
      filesize: null,
      url: bestOpus.url,
      ua: BROWSER_UA,
      default: !bestM4a,
    });
  }

  if (videoFormats.length === 0 && audioFormats.length === 0) return null;

  const previewFmtId = videoFormats.find((v) => v.muxed)?.format_id || videoFormats[0]?.format_id;
  const previewUrl = previewFmtId
    ? `/api/download?url=${encodeURIComponent(rawUrl)}&media_type=video&format_id=${encodeURIComponent(previewFmtId)}&inline=1`
    : null;

  return {
    status: 'success',
    platform: 'youtube',
    type: 'video',
    title: data.title || `YouTube Video (${videoId})`,
    author: data.author || 'YouTube',
    thumbnail: data.thumbnail || `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    duration: data.duration ? Number(data.duration) : null,
    previewUrl,
    formats: { video: videoFormats, audio: audioFormats },
    photos: [],
    subtitles: [],
    capabilities: { canTrim: false, canSelectQuality: videoFormats.length > 1, hasSubtitles: false },
  };
}

  const playStatus = primary?.playabilityStatus?.status;
  if (videoFormats.length === 0 && audioFormats.length === 0) {
    const cliptoResult = await fetchYouTubeCliptoFallback(rawUrl, videoId);
    if (cliptoResult) return cliptoResult;

    const reason =
      primary?.playabilityStatus?.reason ||
      (playStatus ? `YouTube status: ${playStatus}` : 'YouTube stream extraction blocked by upstream.');
    throw new Error(reason);
  }

  // Use same-origin proxy for YouTube preview so googlevideo IP lock works from any phone
  const previewFmtId = androidProg?.itag || videoFormats.find((v) => v.muxed)?.format_id || videoFormats[0]?.format_id;
  const previewUrl = previewFmtId
    ? `/api/download?url=${encodeURIComponent(rawUrl)}&media_type=video&format_id=${encodeURIComponent(previewFmtId)}&inline=1`
    : null;

  return {
    status: 'success',
    platform: 'youtube',
    type: 'video',
    title: title || `YouTube Video (${videoId})`,
    author: author || 'YouTube',
    thumbnail,
    duration,
    previewUrl,
    formats: {
      video: videoFormats,
      audio: audioFormats,
    },
    photos: [],
    subtitles,
    capabilities: {
      canTrim: false,
      canSelectQuality: videoFormats.length > 0,
      hasSubtitles: subtitles.length > 0,
    },
    _internal: {
      videoId,
      fallbackThumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      progressiveFallback: androidProg
        ? { url: androidProg.url, ua: ANDROID_UA, ext: 'mp4' }
        : null,
    },
  };
}

async function extractTikTok(rawUrl) {
  const apiRes = await fetch(
    `https://www.tikwm.com/api/?url=${encodeURIComponent(rawUrl)}&hd=1`,
    {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(12000),
    }
  );
  if (!apiRes.ok) {
    throw new Error(`TikTok extractor returned HTTP ${apiRes.status}.`);
  }
  const json = await apiRes.json();
  if (json?.code !== 0 || !json?.data) {
    throw new Error(json?.msg || 'Could not extract this TikTok link.');
  }
  const d = json.data;
  const title = (d.title || '').trim() || `TikTok by ${d.author?.nickname || d.author?.unique_id || 'Creator'}`;
  const author = d.author?.nickname || d.author?.unique_id || 'TikTok';
  const thumbnail = d.origin_cover || d.cover || '';
  const duration = d.duration ? Number(d.duration) : null;

  const audioFormats = [];
  if (d.music) {
    audioFormats.push({
      format_id: 'mp3',
      quality: 'Audio MP3',
      label: 'Original Sound (MP3)',
      ext: 'mp3',
      bitrate: '128k',
      url: d.music,
      ua: BROWSER_UA,
      default: true,
    });
  }

  // Photo slideshow / carousel
  if (Array.isArray(d.images) && d.images.length > 0) {
    const photos = d.images.map((imgUrl, idx) => ({
      index: idx,
      url: imgUrl,
      ext: 'jpg',
      label: `Photo ${idx + 1}`,
    }));
    return {
      status: 'success',
      platform: 'tiktok',
      type: photos.length > 1 ? 'album' : 'photo',
      title,
      author,
      thumbnail: thumbnail || photos[0].url,
      duration,
      previewUrl: null,
      formats: {
        video: [],
        audio: audioFormats,
      },
      photos,
      subtitles: [],
      capabilities: {
        canTrim: false,
        canSelectQuality: false,
        hasSubtitles: false,
      },
    };
  }

  // Watermark-free video streams ONLY (never wmplay)
  const videoFormats = [];
  if (d.hdplay) {
    videoFormats.push({
      format_id: 'hdplay',
      quality: '1080p',
      label: '1080p HD (No Watermark)',
      ext: 'mp4',
      filesize: d.hd_size ? Number(d.hd_size) : null,
      url: d.hdplay,
      ua: BROWSER_UA,
      default: true,
      watermarkFree: true,
    });
  }
  if (d.play && d.play !== d.hdplay) {
    videoFormats.push({
      format_id: 'play',
      quality: '720p',
      label: '720p (No Watermark)',
      ext: 'mp4',
      filesize: d.size ? Number(d.size) : null,
      url: d.play,
      ua: BROWSER_UA,
      default: videoFormats.length === 0,
      watermarkFree: true,
    });
  }

  if (videoFormats.length === 0) {
    throw new Error('No watermark-free video stream found for this TikTok post.');
  }

  return {
    status: 'success',
    platform: 'tiktok',
    type: 'video',
    title,
    author,
    thumbnail,
    duration,
    previewUrl: d.play || d.hdplay,
    formats: {
      video: videoFormats,
      audio: audioFormats,
    },
    photos: [],
    subtitles: [],
    capabilities: {
      canTrim: false,
      canSelectQuality: videoFormats.length > 1,
      hasSubtitles: false,
    },
  };
}

async function extractPinterest(rawUrl) {
  const res = await fetch(rawUrl, {
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    throw new Error(`Pinterest returned HTTP ${res.status}.`);
  }
  const html = await res.text();
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = (titleMatch?.[1] || 'Pinterest Pin').replace(/\s*\|\s*Pinterest.*$/i, '').trim();

  // Check for pin video first
  const mp4Matches = html.match(/https:\/\/v1\.pinimg\.com\/videos\/[^"'\s\\]+\.mp4/g);
  if (mp4Matches && mp4Matches.length > 0) {
    const mp4Url = mp4Matches[0].replace(/\\u002F/g, '/');
    const thumbMatch = html.match(/https:\/\/i\.pinimg\.com\/[^"'\s\\]+\.(?:jpg|jpeg|png|webp)/i);
    return {
      status: 'success',
      platform: 'pinterest',
      type: 'video',
      title,
      author: 'Pinterest',
      thumbnail: thumbMatch ? thumbMatch[0] : '',
      duration: null,
      previewUrl: mp4Url,
      formats: {
        video: [
          {
            format_id: 'best',
            quality: '1080p',
            label: 'Original MP4',
            ext: 'mp4',
            url: mp4Url,
            ua: BROWSER_UA,
            default: true,
          },
        ],
        audio: [],
      },
      photos: [],
      subtitles: [],
      capabilities: {
        canTrim: false,
        canSelectQuality: false,
        hasSubtitles: false,
      },
    };
  }

  // Check for GIF or high-resolution original image
  const origMatches = html.match(/https:\/\/i\.pinimg\.com\/originals\/[^"'\s\\)]+\.(?:gif|jpg|jpeg|png|webp)/gi);
  let bestImg = origMatches?.[0];
  if (!bestImg) {
    const sized = html.match(/https:\/\/i\.pinimg\.com\/(?:736x|564x|474x)\/[^"'\s\\)]+\.(?:gif|jpg|jpeg|png|webp)/i);
    if (sized) {
      bestImg = sized[0].replace(/\/(?:736x|564x|474x)\//, '/originals/');
    }
  }
  if (!bestImg) {
    const ogImg = html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    bestImg = ogImg?.[1];
  }

  if (!bestImg) {
    throw new Error('Could not find downloadable media on this Pinterest pin.');
  }

  const extMatch = bestImg.match(/\.([a-z0-9]{3,4})(?:\?|$)/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
  const isGif = ext === 'gif';

  if (isGif) {
    return {
      status: 'success',
      platform: 'pinterest',
      type: 'gif',
      title,
      author: 'Pinterest',
      thumbnail: bestImg,
      duration: null,
      previewUrl: bestImg,
      formats: {
        video: [
          {
            format_id: 'gif',
            quality: 'Original GIF',
            label: 'Original GIF',
            ext: 'gif',
            url: bestImg,
            ua: BROWSER_UA,
            default: true,
          },
        ],
        audio: [],
      },
      photos: [{ index: 0, url: bestImg, ext: 'gif', label: 'Original GIF' }],
      subtitles: [],
      capabilities: { canTrim: false, canSelectQuality: false, hasSubtitles: false },
    };
  }

  return {
    status: 'success',
    platform: 'pinterest',
    type: 'photo',
    title,
    author: 'Pinterest',
    thumbnail: bestImg,
    duration: null,
    previewUrl: null,
    formats: { video: [], audio: [] },
    photos: [{ index: 0, url: bestImg, ext, label: `Original ${ext.toUpperCase()}` }],
    subtitles: [],
    capabilities: { canTrim: false, canSelectQuality: false, hasSubtitles: false },
  };
}

async function extractGeneric(rawUrl) {
  let res = await fetch(rawUrl, {
    method: 'HEAD',
    headers: { 'User-Agent': BROWSER_UA },
    redirect: 'follow',
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);

  if (!res || !res.ok) {
    res = await fetch(rawUrl, {
      method: 'GET',
      headers: { 'User-Agent': BROWSER_UA },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });
  }

  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const host = new URL(rawUrl).hostname;
  const baseName = decodeURIComponent(new URL(rawUrl).pathname.split('/').pop() || host);

  if (ct.startsWith('image/')) {
    const ext = ct.split('/')[1]?.split(';')[0]?.replace('jpeg', 'jpg') || 'jpg';
    return {
      status: 'success',
      platform: 'universal',
      type: 'photo',
      title: baseName,
      author: host,
      thumbnail: rawUrl,
      duration: null,
      previewUrl: null,
      formats: { video: [], audio: [] },
      photos: [{ index: 0, url: rawUrl, ext, label: `Original ${ext.toUpperCase()}` }],
      subtitles: [],
      capabilities: { canTrim: false, canSelectQuality: false, hasSubtitles: false },
    };
  }

  if (ct.startsWith('audio/')) {
    const ext = ct.includes('mpeg') ? 'mp3' : ct.includes('mp4') ? 'm4a' : 'mp3';
    return {
      status: 'success',
      platform: 'universal',
      type: 'audio',
      title: baseName,
      author: host,
      thumbnail: '',
      duration: null,
      previewUrl: rawUrl,
      formats: {
        video: [],
        audio: [{ format_id: ext, quality: `Audio ${ext.toUpperCase()}`, ext, url: rawUrl, ua: BROWSER_UA, default: true }],
      },
      photos: [],
      subtitles: [],
      capabilities: { canTrim: false, canSelectQuality: false, hasSubtitles: false },
    };
  }

  if (ct.startsWith('video/')) {
    const ext = ct.includes('webm') ? 'webm' : 'mp4';
    return {
      status: 'success',
      platform: 'universal',
      type: 'video',
      title: baseName,
      author: host,
      thumbnail: '',
      duration: null,
      previewUrl: rawUrl,
      formats: {
        video: [{ format_id: 'best', quality: 'Original', ext, url: rawUrl, ua: BROWSER_UA, default: true }],
        audio: [],
      },
      photos: [],
      subtitles: [],
      capabilities: { canTrim: false, canSelectQuality: false, hasSubtitles: false },
    };
  }

  if (ct.includes('text/html')) {
    const html = await res.text();
    const ogTitle = html.match(/property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
    const ogVideo = html.match(/property=["']og:video(?::secure_url|:url)?["'][^>]+content=["']([^"']+)["']/i)?.[1];
    const ogImg = html.match(/property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i)?.[1];
    if (ogVideo) {
      return {
        status: 'success',
        platform: 'universal',
        type: 'video',
        title: ogTitle || host,
        author: host,
        thumbnail: ogImg || '',
        duration: null,
        previewUrl: ogVideo,
        formats: {
          video: [{ format_id: 'best', quality: 'Original', ext: 'mp4', url: ogVideo, ua: BROWSER_UA, default: true }],
          audio: [],
        },
        photos: [],
        subtitles: [],
        capabilities: { canTrim: false, canSelectQuality: false, hasSubtitles: false },
      };
    }
    if (ogImg) {
      return {
        status: 'success',
        platform: 'universal',
        type: 'photo',
        title: ogTitle || host,
        author: host,
        thumbnail: ogImg,
        duration: null,
        previewUrl: null,
        formats: { video: [], audio: [] },
        photos: [{ index: 0, url: ogImg, ext: 'jpg', label: 'Original Image' }],
        subtitles: [],
        capabilities: { canTrim: false, canSelectQuality: false, hasSubtitles: false },
      };
    }
  }

  throw new Error('Could not find direct video, audio, or image media on that URL.');
}

function extractMetaTags(html, property) {
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

function extractMetaTag(html, property) {
  return extractMetaTags(html, property)[0] || '';
}

function unescapeJsonString(raw) {
  if (!raw) return '';
  try {
    return JSON.parse(`"${raw.replace(/"/g, '\\"')}"`);
  } catch {
    return raw.replace(/\\\//g, '/');
  }
}

async function extractFacebook(rawUrl) {
  const [navRes, botRes] = await Promise.allSettled([
    fetch(rawUrl, {
      method: 'GET',
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    }).then((r) => (r.ok ? r.text() : '')),
    fetch(rawUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    }).then((r) => (r.ok ? r.text() : '')),
  ]);

  const navHtml = navRes.status === 'fulfilled' ? navRes.value : '';
  const botHtml = botRes.status === 'fulfilled' ? botRes.value : '';

  const hdRaw =
    navHtml.match(/"browser_native_hd_url":"([^"]+)"/)?.[1] ||
    navHtml.match(/"playable_url_quality_hd":"([^"]+)"/)?.[1];
  const sdRaw =
    navHtml.match(/"browser_native_sd_url":"([^"]+)"/)?.[1] ||
    navHtml.match(/"playable_url":"([^"]+)"/)?.[1];

  const hdUrl = unescapeJsonString(hdRaw);
  const sdUrl = unescapeJsonString(sdRaw);
  const ogVid = extractMetaTag(botHtml, 'og:video:secure_url') || extractMetaTag(botHtml, 'og:video');
  const ogImg = extractMetaTag(botHtml, 'og:image') || extractMetaTag(navHtml, 'og:image');
  const rawTitle = extractMetaTag(botHtml, 'og:title') || extractMetaTag(navHtml, 'og:title');
  const title = rawTitle && rawTitle !== 'Facebook' ? rawTitle : 'Facebook Video';

  const videoFormats = [];
  if (hdUrl) {
    videoFormats.push({
      format_id: 'hd',
      quality: '1080p',
      label: '1080p HD (MP4)',
      ext: 'mp4',
      url: hdUrl,
      ua: BROWSER_UA,
      default: true,
    });
  }
  if (sdUrl && sdUrl !== hdUrl) {
    videoFormats.push({
      format_id: 'sd',
      quality: '720p',
      label: 'SD (MP4)',
      ext: 'mp4',
      url: sdUrl,
      ua: BROWSER_UA,
      default: videoFormats.length === 0,
    });
  }
  if (videoFormats.length === 0 && ogVid) {
    videoFormats.push({
      format_id: 'best',
      quality: 'Original',
      label: 'Original MP4',
      ext: 'mp4',
      url: ogVid,
      ua: BROWSER_UA,
      default: true,
    });
  }

  if (videoFormats.length > 0) {
    return {
      status: 'success',
      platform: 'facebook',
      type: 'video',
      title,
      author: 'Facebook',
      thumbnail: ogImg,
      duration: null,
      previewUrl: videoFormats[0].url,
      formats: { video: videoFormats, audio: [] },
      photos: [],
      subtitles: [],
      capabilities: { canTrim: false, canSelectQuality: videoFormats.length > 1, hasSubtitles: false },
    };
  }

  if (ogImg) {
    return {
      status: 'success',
      platform: 'facebook',
      type: 'photo',
      title,
      author: 'Facebook',
      thumbnail: ogImg,
      duration: null,
      previewUrl: null,
      formats: { video: [], audio: [] },
      photos: [{ index: 0, url: ogImg, ext: 'jpg', label: 'Original Image' }],
      subtitles: [],
      capabilities: { canTrim: false, canSelectQuality: false, hasSubtitles: false },
    };
  }

  throw new Error('Facebook blocked unauthenticated cloud extraction for this link.');
}

async function extractTwitter(rawUrl) {
  let targetUrl = rawUrl;
  let match = targetUrl.match(/(?:x|twitter|fxtwitter|vxtwitter)\.com\/(?:[^/]+)\/status(?:es)?\/(\d+)/i);

  if (!match) {
    const redirRes = await fetch(rawUrl, {
      method: 'GET',
      headers: { 'User-Agent': BROWSER_UA },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (redirRes?.url) {
      targetUrl = redirRes.url;
      match = targetUrl.match(/(?:x|twitter|fxtwitter|vxtwitter)\.com\/(?:[^/]+)\/status(?:es)?\/(\d+)/i);
    }
  }

  if (!match) {
    throw new Error('Could not find a valid X / Twitter post ID in this URL.');
  }

  const tweetId = match[1];
  const [fxRes, synRes] = await Promise.allSettled([
    fetch(`https://api.fxtwitter.com/status/${tweetId}`, {
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(9000),
    }).then((r) => (r.ok ? r.json() : null)),
    fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&token=4f3a1`, {
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(8000),
    }).then((r) => (r.ok ? r.json() : null)),
  ]);

  const fxTweet = fxRes.status === 'fulfilled' ? fxRes.value?.tweet : null;
  const synTweet = synRes.status === 'fulfilled' ? synRes.value : null;

  const author =
    fxTweet?.author?.name ||
    (fxTweet?.author?.screen_name ? `@${fxTweet.author.screen_name}` : '') ||
    synTweet?.user?.name ||
    'X / Twitter';
  const rawText = fxTweet?.text || synTweet?.text || '';
  const title = rawText ? rawText.replace(/\s+/g, ' ').trim().slice(0, 140) : `X Post ${tweetId}`;

  // 1. Videos / GIFs from fxtwitter
  const fxVideos = fxTweet?.media?.videos || [];
  if (fxVideos.length > 0) {
    const firstVid = fxVideos[0];
    const variants = (firstVid.variants || [])
      .filter((v) => v.url && (!v.content_type || v.content_type.includes('mp4')))
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

    const videoFormats = variants.map((v, idx) => {
      const resMatch = v.url.match(/\/vid\/(?:avc1\/)?(\d+)x(\d+)\//);
      const height = resMatch ? Math.min(Number(resMatch[1]), Number(resMatch[2])) : null;
      const qLabel = height ? `${height}p` : idx === 0 ? 'Best MP4' : `Option ${idx + 1}`;
      return {
        format_id: `v${idx}`,
        quality: qLabel,
        label: `${qLabel} (MP4)`,
        ext: 'mp4',
        url: v.url,
        ua: BROWSER_UA,
        default: idx === 0,
      };
    });

    if (videoFormats.length === 0 && firstVid.url) {
      videoFormats.push({
        format_id: 'best',
        quality: 'Original',
        label: 'Original MP4',
        ext: 'mp4',
        url: firstVid.url,
        ua: BROWSER_UA,
        default: true,
      });
    }

    const isGif = firstVid.type === 'gif';
    return {
      status: 'success',
      platform: 'twitter',
      type: isGif ? 'gif' : 'video',
      title,
      author,
      thumbnail: firstVid.thumbnail_url || '',
      duration: firstVid.duration || null,
      previewUrl: videoFormats[0].url,
      formats: { video: videoFormats, audio: [] },
      photos: [],
      subtitles: [],
      capabilities: { canTrim: false, canSelectQuality: videoFormats.length > 1, hasSubtitles: false },
    };
  }

  // 2. Photos from fxtwitter
  const fxPhotos = fxTweet?.media?.photos || [];
  if (fxPhotos.length > 0) {
    const photos = fxPhotos.map((p, idx) => ({
      index: idx,
      url: p.url,
      ext: 'jpg',
      label: `Photo ${idx + 1}`,
    }));
    return {
      status: 'success',
      platform: 'twitter',
      type: photos.length > 1 ? 'album' : 'photo',
      title,
      author,
      thumbnail: photos[0].url,
      duration: null,
      previewUrl: null,
      formats: { video: [], audio: [] },
      photos,
      subtitles: [],
      capabilities: { canTrim: false, canSelectQuality: false, hasSubtitles: false },
    };
  }

  // 3. Fallback to Twitter syndication API
  const synMedia = synTweet?.mediaDetails || [];
  const synVid = synMedia.find((m) => m.type === 'video' || m.type === 'animated_gif');
  if (synVid?.video_info?.variants) {
    const variants = synVid.video_info.variants
      .filter((v) => v.url && v.content_type === 'video/mp4')
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    if (variants.length > 0) {
      const videoFormats = variants.map((v, idx) => ({
        format_id: `v${idx}`,
        quality: idx === 0 ? 'Best' : `SD ${idx}`,
        label: idx === 0 ? 'Best MP4' : `Option ${idx + 1}`,
        ext: 'mp4',
        url: v.url,
        ua: BROWSER_UA,
        default: idx === 0,
      }));
      return {
        status: 'success',
        platform: 'twitter',
        type: synVid.type === 'animated_gif' ? 'gif' : 'video',
        title,
        author,
        thumbnail: synVid.media_url_https || '',
        duration: null,
        previewUrl: videoFormats[0].url,
        formats: { video: videoFormats, audio: [] },
        photos: [],
        subtitles: [],
        capabilities: { canTrim: false, canSelectQuality: videoFormats.length > 1, hasSubtitles: false },
      };
    }
  }

  const synPhotos = synMedia.filter((m) => m.type === 'photo' && m.media_url_https);
  if (synPhotos.length > 0) {
    const photos = synPhotos.map((p, idx) => ({
      index: idx,
      url: p.media_url_https,
      ext: 'jpg',
      label: `Photo ${idx + 1}`,
    }));
    return {
      status: 'success',
      platform: 'twitter',
      type: photos.length > 1 ? 'album' : 'photo',
      title,
      author,
      thumbnail: photos[0].url,
      duration: null,
      previewUrl: null,
      formats: { video: [], audio: [] },
      photos,
      subtitles: [],
      capabilities: { canTrim: false, canSelectQuality: false, hasSubtitles: false },
    };
  }

  throw new Error('Could not find downloadable video or image in this X / Twitter post.');
}

async function extractInstagram(rawUrl) {
  let targetUrl = rawUrl;
  let match = targetUrl.match(/instagram\.com\/(?:[^/]+\/)?(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);

  // Resolve /share/... or short redirect URLs
  if (!match) {
    const redirRes = await fetch(rawUrl, {
      method: 'GET',
      headers: { 'User-Agent': BROWSER_UA },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (redirRes?.url) {
      targetUrl = redirRes.url;
      match = targetUrl.match(/instagram\.com\/(?:[^/]+\/)?(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
    }
  }

  if (!match) {
    throw new Error('Could not find a valid Instagram post or reel ID in this URL.');
  }

  const kind = match[1].toLowerCase() === 'reels' ? 'reel' : match[1].toLowerCase();
  const shortcode = match[2];

  const [vxRes, fbRes, ddRes] = await Promise.allSettled([
    fetch(`https://vxinstagram.com/${kind}/${shortcode}/`, {
      headers: { 'User-Agent': 'TelegramBot (like TwitterBot)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    }).then((r) => (r.ok ? r.text() : '')),
    fetch(`https://www.instagram.com/${kind}/${shortcode}/`, {
      headers: { 'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    }).then((r) => (r.ok ? r.text() : '')),
    fetch(`https://d.ddinstagram.com/${kind}/${shortcode}/`, {
      headers: { 'User-Agent': 'TelegramBot (like TwitterBot)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    }).then((r) => (r.ok ? r.text() : '')),
  ]);

  const vxHtml = vxRes.status === 'fulfilled' ? vxRes.value : '';
  const fbHtml = fbRes.status === 'fulfilled' ? fbRes.value : '';
  const ddHtml = ddRes.status === 'fulfilled' ? ddRes.value : '';

  const vxVideo = extractMetaTag(vxHtml, 'og:video:secure_url') || extractMetaTag(vxHtml, 'og:video');
  const ddVideo = extractMetaTag(ddHtml, 'og:video:secure_url') || extractMetaTag(ddHtml, 'og:video');
  const fbVideo = extractMetaTag(fbHtml, 'og:video:secure_url') || extractMetaTag(fbHtml, 'og:video');
  let videoUrl = vxVideo || ddVideo || fbVideo;

  const fbImgs = extractMetaTags(fbHtml, 'og:image');
  const vxImgs = extractMetaTags(vxHtml, 'og:image').filter((u) => !/\.mp4(?:\?|$)/i.test(u));
  const ddImgs = extractMetaTags(ddHtml, 'og:image').filter((u) => !/\.mp4(?:\?|$)/i.test(u));
  const allImgs = [...new Set([...(vxImgs.length > 1 ? vxImgs : []), ...fbImgs, ...vxImgs, ...ddImgs])];
  const thumbnail = allImgs[0] || '';

  const rawTitle = extractMetaTag(fbHtml, 'og:title') || extractMetaTag(vxHtml, 'og:title') || extractMetaTag(ddHtml, 'og:title');
  const title = rawTitle && rawTitle !== 'vxinstagram' && rawTitle !== 'Instagram'
    ? rawTitle
    : `Instagram ${kind === 'reel' ? 'Reel' : 'Post'} ${shortcode}`;
  const authorMatch = rawTitle.match(/^(.+?)\s+on Instagram/i);
  const author = authorMatch ? authorMatch[1].trim() : 'Instagram';

  if (videoUrl) {
    // Resolve vxinstagram /offload/ 302 redirect to direct fbcdn.net MP4 if available
    if (videoUrl.includes('vxinstagram.com/offload/')) {
      const headOrGet = await fetch(videoUrl, {
        method: 'GET',
        headers: { Range: 'bytes=0-1023' },
        redirect: 'manual',
        signal: AbortSignal.timeout(6000),
      }).catch(() => null);
      const loc = headOrGet?.headers?.get('location');
      if (loc && /^https?:\/\//i.test(loc)) {
        videoUrl = loc;
      }
    }

    return {
      status: 'success',
      platform: 'instagram',
      type: 'video',
      title,
      author,
      thumbnail,
      duration: null,
      previewUrl: videoUrl,
      formats: {
        video: [
          {
            format_id: 'best',
            quality: 'Original',
            label: 'Original MP4',
            ext: 'mp4',
            url: videoUrl,
            ua: BROWSER_UA,
            default: true,
          },
        ],
        audio: [],
      },
      photos: [],
      subtitles: [],
      capabilities: { canTrim: false, canSelectQuality: false, hasSubtitles: false },
    };
  }

  if (allImgs.length > 0) {
    const photoList = (vxImgs.length > 1 ? vxImgs : ddImgs.length > 1 ? ddImgs : [thumbnail]).map((imgUrl, idx) => ({
      index: idx,
      url: imgUrl,
      ext: 'jpg',
      label: `Photo ${idx + 1}`,
    }));
    return {
      status: 'success',
      platform: 'instagram',
      type: photoList.length > 1 ? 'album' : 'photo',
      title,
      author,
      thumbnail,
      duration: null,
      previewUrl: null,
      formats: { video: [], audio: [] },
      photos: photoList,
      subtitles: [],
      capabilities: { canTrim: false, canSelectQuality: false, hasSubtitles: false },
    };
  }

  throw new Error('Instagram blocked unauthenticated cloud extraction for this link.');
}

async function performExtraction(rawUrl) {
  const validUrl = validatePublicUrl(rawUrl);
  const cached = extractCache.get(validUrl);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  const platform = detectPlatform(validUrl);
  let result;
  if (platform === 'youtube') {
    result = await extractYouTube(validUrl);
  } else if (platform === 'tiktok') {
    result = await extractTikTok(validUrl);
  } else if (platform === 'pinterest') {
    result = await extractPinterest(validUrl);
  } else if (platform === 'instagram') {
    result = await extractInstagram(validUrl);
  } else if (platform === 'facebook') {
    result = await extractFacebook(validUrl);
  } else if (platform === 'twitter') {
    result = await extractTwitter(validUrl);
  } else {
    result = await extractGeneric(validUrl);
  }

  extractCache.set(validUrl, { ts: Date.now(), data: result });
  if (extractCache.size > 50) {
    const firstKey = extractCache.keys().next().value;
    extractCache.delete(firstKey);
  }
  return result;
}

function stripInternal(data) {
  const clean = { ...data };
  delete clean._internal;
  clean.mediaType = data.mediaType || data.type || 'video';
  clean.items = (data.items || data.photos || []).map((p, idx) => ({
    index: p.index ?? idx,
    url: p.url,
    thumbnail: p.thumbnail || p.url,
    ext: p.ext || 'jpg',
    filename: p.filename || `photo_${String(idx + 1).padStart(2, '0')}.${p.ext || 'jpg'}`,
    label: p.label || `Photo ${idx + 1}`,
  }));
  clean.formats = {
    video: (data.formats?.video || []).map(({ url, ua, format_id, filesize, default: isDef, ...rest }) => ({
      ...rest,
      formatId: rest.formatId || format_id || rest.quality,
      filesizeApprox: rest.filesizeApprox ?? filesize ?? null,
      isDefault: Boolean(rest.isDefault ?? isDef),
    })),
    audio: (data.formats?.audio || []).map(({ url, ua, format_id, filesize, default: isDef, ...rest }) => ({
      ...rest,
      formatId: rest.formatId || format_id || rest.ext,
      filesizeApprox: rest.filesizeApprox ?? filesize ?? null,
      isDefault: Boolean(rest.isDefault ?? isDef),
    })),
  };
  clean.subtitles = (data.subtitles || []).map(({ url, ...rest }) => rest);
  return clean;
}

function formatSrtTime(ms) {
  const total = Math.max(0, Math.round(ms));
  const hours = String(Math.floor(total / 3600000)).padStart(2, '0');
  const mins = String(Math.floor((total % 3600000) / 60000)).padStart(2, '0');
  const secs = String(Math.floor((total % 60000) / 1000)).padStart(2, '0');
  const millis = String(total % 1000).padStart(3, '0');
  return `${hours}:${mins}:${secs},${millis}`;
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function timedTextXmlToSrt(xml) {
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

function buildStoreZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  // Compute CRC32 table once
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[i] = c >>> 0;
  }
  const crc32 = (buf) => {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8); // STORE
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

async function handleDownload(req, res, searchParams) {
  const rawUrl = searchParams.get('url');
  const mediaType = (searchParams.get('media_type') || searchParams.get('mediaType') || 'video').toLowerCase();
  const formatId = searchParams.get('format_id') || searchParams.get('formatId') || '';
  const itemIndex = Number(searchParams.get('item_index') || searchParams.get('itemIndex') || 0);
  const subLang = searchParams.get('subtitle_lang') || searchParams.get('subtitleLang') || '';
  const subExt = (searchParams.get('subtitle_ext') || searchParams.get('subtitleExt') || 'srt').toLowerCase();
  const inline = searchParams.get('inline') === '1';

  const info = await performExtraction(rawUrl);
  const baseName = sanitizeFilename(info.title, 'downhere_Media');

  // 1. Subtitles download
  if (mediaType === 'subtitles') {
    const subs = info.subtitles || [];
    if (subs.length === 0) {
      return res.status(404).json({ detail: 'No subtitles available for this link.' });
    }
    const track = (subLang ? subs.find((s) => s.lang === subLang) : null) || subs[0];
    const fmt = subExt === 'vtt' ? 'vtt' : 'srt';
    const subUrl = new URL(track.url);
    subUrl.searchParams.set('fmt', fmt);

    const subRes = await fetch(subUrl, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(10000) });
    if (!subRes.ok) {
      return res.status(502).json({ detail: `Failed to fetch subtitles (HTTP ${subRes.status}).` });
    }
    let bodyText = await subRes.text();
    if (bodyText.trimStart().startsWith('<?xml') || bodyText.includes('<timedtext')) {
      bodyText = timedTextXmlToSrt(bodyText);
    }
    setDownloadHeaders(res, `${baseName}_${track.lang}.${fmt}`, 'text/plain; charset=utf-8', inline);
    return res.status(200).send(bodyText);
  }

  // 2. Photo or Thumbnail download
  if (mediaType === 'photo' || mediaType === 'thumbnail') {
    const photoList = info.photos?.length ? info.photos : info.items || [];
    let imgUrl = '';
    if (mediaType === 'thumbnail') {
      imgUrl = info.thumbnail || photoList[0]?.url || '';
    } else {
      imgUrl = photoList[itemIndex]?.url || info.thumbnail || '';
    }
    if (!imgUrl) {
      return res.status(404).json({ detail: 'No downloadable image or thumbnail found.' });
    }

    let imgRes = await fetch(imgUrl, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(12000) });
    if (!imgRes.ok && info._internal?.fallbackThumbnail && imgUrl !== info._internal.fallbackThumbnail) {
      imgRes = await fetch(info._internal.fallbackThumbnail, {
        headers: { 'User-Agent': BROWSER_UA },
        signal: AbortSignal.timeout(12000),
      });
    }
    if (!imgRes.ok) {
      return res.status(502).json({ detail: `Failed to download image (HTTP ${imgRes.status}).` });
    }

    const ct = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0].trim().toLowerCase();
    const ext =
      ct === 'image/png'
        ? 'png'
        : ct === 'image/gif'
          ? 'gif'
          : ct === 'image/webp'
            ? 'webp'
            : 'jpg';
    const suffix = mediaType === 'thumbnail' ? '_thumbnail' : itemIndex > 0 ? `_${itemIndex + 1}` : '';
    const buf = Buffer.from(await imgRes.arrayBuffer());
    setDownloadHeaders(res, `${baseName}${suffix}.${ext}`, ct.startsWith('image/') ? ct : 'image/jpeg', inline);
    res.setHeader('Content-Length', String(buf.length));
    return res.status(200).send(buf);
  }

  // 3. Audio download
  if (mediaType === 'audio') {
    const audios = info.formats?.audio || [];
    const target =
      (formatId ? audios.find((a) => a.format_id === formatId || a.ext === formatId) : null) ||
      audios.find((a) => a.default) ||
      audios[0];
    if (!target?.url) {
      return res.status(404).json({ detail: 'No audio stream available for this link.' });
    }
    const headers = { 'User-Agent': target.ua || BROWSER_UA };
    if (req.headers.range) headers.Range = req.headers.range;

    let up = await fetch(target.url, { headers, signal: AbortSignal.timeout(25000) });
    if (up.status === 403 && !req.headers.range && target.filesize) {
      up = await fetch(target.url, {
        headers: { ...headers, Range: `bytes=0-${Number(target.filesize) - 1}` },
        signal: AbortSignal.timeout(25000),
      });
    }
    if (!up.ok && up.status !== 206) {
      return res.status(502).json({ detail: `Upstream audio returned HTTP ${up.status}.` });
    }
    const ext = target.ext || 'm4a';
    const mime = ext === 'mp3' ? 'audio/mpeg' : ext === 'webm' ? 'audio/webm' : 'audio/mp4';
    res.status(req.headers.range ? up.status : 200);
    setDownloadHeaders(res, `${baseName}.${ext}`, mime, inline || Boolean(req.headers.range));
    if (up.headers.get('content-length')) res.setHeader('Content-Length', up.headers.get('content-length'));
    if (req.headers.range && up.headers.get('content-range')) {
      res.setHeader('Content-Range', up.headers.get('content-range'));
    }
    res.setHeader('Accept-Ranges', 'bytes');

    return Readable.fromWeb(up.body).pipe(res);
  }

  // 4. Video (or GIF) download — auto-fallback to photo if link has only images (e.g. Apple Shortcut)
  const videos = info.formats?.video || [];
  if (videos.length === 0 && (formatId === 'auto' || formatId === 'hd')) {
    const photoList = info.photos?.length ? info.photos : info.items || [];
    const autoImgUrl = photoList[itemIndex]?.url || info.thumbnail || '';
    if (autoImgUrl) {
      const imgRes = await fetch(autoImgUrl, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(12000) });
      if (imgRes.ok) {
        const ct = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0].trim().toLowerCase();
        const ext = ct === 'image/png' ? 'png' : ct === 'image/gif' ? 'gif' : ct === 'image/webp' ? 'webp' : 'jpg';
        const buf = Buffer.from(await imgRes.arrayBuffer());
        setDownloadHeaders(res, `${baseName}.${ext}`, ct.startsWith('image/') ? ct : 'image/jpeg', inline);
        res.setHeader('Content-Length', String(buf.length));
        return res.status(200).send(buf);
      }
    }
  }
  let target =
    (formatId ? videos.find((v) => v.format_id === formatId || v.quality === formatId) : null) ||
    videos.find((v) => v.default) ||
    videos[0];
  if (!target?.url) {
    return res.status(404).json({ detail: 'No video stream available for this link.' });
  }

  const headers = { 'User-Agent': target.ua || BROWSER_UA };
  if (req.headers.range) headers.Range = req.headers.range;

  let up = await fetch(target.url, { headers, signal: AbortSignal.timeout(25000) });
  if (!up.ok && up.status !== 206 && info._internal?.progressiveFallback?.url) {
    const fb = info._internal.progressiveFallback;
    const fbHeaders = { 'User-Agent': fb.ua || ANDROID_UA };
    if (req.headers.range) fbHeaders.Range = req.headers.range;
    up = await fetch(fb.url, { headers: fbHeaders, signal: AbortSignal.timeout(25000) });
    target = { ...target, ext: fb.ext || 'mp4' };
  }

  if (!up.ok && up.status !== 206) {
    return res.status(502).json({ detail: `Upstream video returned HTTP ${up.status}.` });
  }

  const ext = target.ext || 'mp4';
  const mime = ext === 'gif' ? 'image/gif' : ext === 'webm' ? 'video/webm' : 'video/mp4';
  res.status(up.status);
  setDownloadHeaders(res, `${baseName}.${ext}`, mime, inline || Boolean(req.headers.range));
  if (up.headers.get('content-length')) res.setHeader('Content-Length', up.headers.get('content-length'));
  if (up.headers.get('content-range')) res.setHeader('Content-Range', up.headers.get('content-range'));
  res.setHeader('Accept-Ranges', 'bytes');

  return Readable.fromWeb(up.body).pipe(res);
}

async function handleZipDownload(req, res, searchParams, bodyObj) {
  let photos = [];
  let albumTitle = 'downhere_Album';

  if (req.method === 'POST' && Array.isArray(bodyObj?.items) && bodyObj.items.length > 0) {
    albumTitle = bodyObj.albumTitle || albumTitle;
    photos = bodyObj.items.map((item, idx) => ({
      url: validatePublicUrl(item.url),
      filename: item.filename || `photo_${String(idx + 1).padStart(2, '0')}.jpg`,
      ext: 'jpg',
    }));
  } else {
    const rawUrl = searchParams.get('url');
    const info = await performExtraction(rawUrl);
    albumTitle = info.title || albumTitle;
    photos = info.items || info.photos || [];
  }

  if (photos.length === 0) {
    return res.status(404).json({ detail: 'No album photos available to archive.' });
  }

  const baseName = sanitizeFilename(albumTitle, 'downhere_Album');
  const entries = [];
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    const r = await fetch(p.url, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) continue;
    const ct = (r.headers.get('content-type') || 'image/jpeg').split(';')[0].trim().toLowerCase();
    const detectedExt =
      ct === 'image/png' ? 'png' : ct === 'image/gif' ? 'gif' : ct === 'image/webp' ? 'webp' : p.ext || 'jpg';
    const rawEntryName = p.filename
      ? sanitizeFilename(p.filename.replace(/\.[^.]+$/, ''), `photo_${i + 1}`) + `.${detectedExt}`
      : `${baseName}_${i + 1}.${detectedExt}`;
    const buf = Buffer.from(await r.arrayBuffer());
    entries.push({ name: rawEntryName, data: buf });
  }
  if (entries.length === 0) {
    return res.status(502).json({ detail: 'Failed to download album images.' });
  }
  const zipBuf = buildStoreZip(entries);
  setDownloadHeaders(res, `${baseName}.zip`, 'application/zip', false);
  res.setHeader('Content-Length', String(zipBuf.length));
  return res.status(200).send(zipBuf);
}

async function parseJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

async function tryForwardToBackend(req, res, url, rawBodyObj) {
  const backendBase = (process.env.BACKEND_URL || '').trim().replace(/\/$/, '');
  if (!backendBase) return false;

  const targetUrl = `${backendBase}${url.pathname}${url.search}`;
  const forwardHeaders = {};
  for (const key of ['content-type', 'accept', 'range', 'user-agent']) {
    if (req.headers[key]) forwardHeaders[key] = req.headers[key];
  }
  const init = {
    method: req.method,
    headers: forwardHeaders,
    redirect: 'follow',
    signal: AbortSignal.timeout(5000),
  };
  if (req.method !== 'GET' && req.method !== 'HEAD' && rawBodyObj) {
    init.body = JSON.stringify(rawBodyObj);
    init.headers['content-type'] = 'application/json';
  }

  try {
    const upstream = await fetch(targetUrl, init);
    if (upstream.status >= 500) return false;
    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (!['content-encoding', 'transfer-encoding', 'connection'].includes(lower)) {
        res.setHeader(key, value);
      }
    });
    if (upstream.body) {
      Readable.fromWeb(upstream.body).pipe(res);
    } else {
      res.end();
    }
    return true;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const url = new URL(req.url, `https://${req.headers.host || 'downme.vercel.app'}`);
  const path = url.pathname;
  const bodyObj = req.method !== 'GET' && req.method !== 'HEAD' ? await parseJsonBody(req) : null;

  // Optional custom backend if explicitly configured via env var and healthy
  if (await tryForwardToBackend(req, res, url, bodyObj)) {
    return;
  }

  try {
    if (path === '/api/health' || path === '/api/status') {
      return res.status(200).json({
        status: 'healthy',
        service: 'downhere',
        mode: 'vercel-cloud',
      });
    }

    if (path === '/api/extract') {
      const rawUrl = req.method === 'POST' ? bodyObj?.url : url.searchParams.get('url');
      if (!rawUrl || !String(rawUrl).trim()) {
        return res.status(422).json({ detail: 'URL is required.' });
      }
      const data = await performExtraction(rawUrl);
      return res.status(200).json(stripInternal(data));
    }

    if (path === '/api/download') {
      return await handleDownload(req, res, url.searchParams);
    }

    if (path === '/api/download/zip') {
      return await handleZipDownload(req, res, url.searchParams, bodyObj);
    }

    return res.status(404).json({ detail: `Endpoint not found: ${path}` });
  } catch (err) {
    const msg = err?.message || 'Unexpected cloud extraction error.';
    const status = /invalid url|only http|public domain|not permitted|required/i.test(msg) ? 422 : 400;
    return res.status(status).json({ detail: msg });
  }
}
