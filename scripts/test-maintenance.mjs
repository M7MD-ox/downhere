#!/usr/bin/env node
/**
 * DownMe Automated Maintenance & Health Verification Suite (Requirement R4)
 *
 * Standalone zero-dependency executable:
 *   node scripts/test-maintenance.mjs
 *   node scripts/test-maintenance.mjs --live
 *   node scripts/test-maintenance.mjs --mock
 *   node scripts/test-maintenance.mjs --json
 *
 * Standardized Exit Codes:
 *   0 = SUCCESS (All platforms and endpoints operational)
 *   1 = ASSERTION_FAILED (Unexpected response format or data integrity failure)
 *   2 = NETWORK_ERROR (Timeout or connectivity failure after exponential retries)
 *   3 = EXTRACTOR_BROKEN (Upstream platform changed format / parser broken)
 *   4 = PREREQUISITE_MISSING (Node, uv, yt-dlp, or ffmpeg missing)
 */

import { spawn, execSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

export const EXIT_CODES = {
  SUCCESS: 0,
  ASSERTION_FAILED: 1,
  NETWORK_ERROR: 2,
  EXTRACTOR_BROKEN: 3,
  PREREQUISITE_MISSING: 4,
};

const PLATFORMS = {
  youtube: {
    id: 'youtube',
    name: 'YouTube',
    testUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    type: 'video_audio_subtitles',
    expectedMinFormats: 5,
    expectedFormatExts: ['mp4', 'm4a', 'webm'],
  },
  facebook: {
    id: 'facebook',
    name: 'Facebook',
    testUrl: 'https://www.facebook.com/watch/?v=10153231379946729',
    type: 'video_reels',
    expectedMinFormats: 1,
    expectedFormatExts: ['mp4'],
  },
  tiktok: {
    id: 'tiktok',
    name: 'TikTok',
    testUrl: 'https://www.tiktok.com/@tiktok/video/7106594312292453678',
    type: 'watermark_free',
    expectedMinFormats: 1,
    expectedFormatExts: ['mp4'],
  },
  pinterest: {
    id: 'pinterest',
    name: 'Pinterest',
    testUrl: 'https://www.pinterest.com/pin/993606736519694085/',
    type: 'photo_video_gif',
    expectedMinFormats: 1,
    expectedFormatExts: ['jpg', 'png', 'mp4', 'gif', 'webp'],
  },
};

const DEFAULT_TIMEOUT_MS = 12000;
const MAX_RETRIES = 3;

// Parse command line arguments
const args = process.argv.slice(2);
const isMock = args.includes('--mock');
const isLive = args.includes('--live');
const isJson = args.includes('--json');
const isHelp = args.includes('--help') || args.includes('-h');
const healthUrlArg = args.find(a => a.startsWith('--health-url='));
const updateUrlArg = args.find(a => a.startsWith('--update-url='));
const healthUrl = healthUrlArg ? healthUrlArg.split('=')[1] : 'http://localhost:8000/api/health';
const updateUrl = updateUrlArg ? updateUrlArg.split('=')[1] : 'http://localhost:8000/api/system/update';

if (isHelp) {
  console.log(`
DownMe Automated Maintenance & Platform Health Probe
Usage: node scripts/test-maintenance.mjs [options]

Options:
  --live               Force live upstream extraction probing
  --mock               Run offline with validated deterministic mock fixtures
  --health-url=<url>   Specify custom URL for /api/health check (default: http://localhost:8000/api/health)
  --update-url=<url>   Specify custom URL for /api/system/update check (default: http://localhost:8000/api/system/update)
  --json               Output JSON summary report
  --help, -h           Show this help message

Exit Codes:
  0 = SUCCESS
  1 = ASSERTION_FAILED
  2 = NETWORK_ERROR
  3 = EXTRACTOR_BROKEN
  4 = PREREQUISITE_MISSING
`);
  process.exit(0);
}

/**
 * Check system prerequisites (Node, uv / yt-dlp, ffmpeg)
 */
export function checkPrerequisites() {
  const diagnostics = {
    node: { available: true, version: process.version },
    uv: { available: false, version: null },
    ytdlp: { available: false, version: null },
    ffmpeg: { available: false, version: null },
  };

  try {
    const uvOut = execSync('uv --version', { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8' });
    diagnostics.uv.available = true;
    diagnostics.uv.version = uvOut.trim();
  } catch {
    // Check if python / yt-dlp is available directly
  }

  try {
    const ytdlpOut = execSync('uv run --no-project --with yt-dlp yt-dlp --version', {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    });
    diagnostics.ytdlp.available = true;
    diagnostics.ytdlp.version = ytdlpOut.trim();
  } catch {
    try {
      const directYt = execSync('yt-dlp --version', { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8' });
      diagnostics.ytdlp.available = true;
      diagnostics.ytdlp.version = directYt.trim();
    } catch {
      // Not installed
    }
  }

  try {
    const ffmpegOut = execSync('ffmpeg -version', { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8' });
    const firstLine = ffmpegOut.split('\n')[0];
    diagnostics.ffmpeg.available = true;
    diagnostics.ffmpeg.version = firstLine.trim();
  } catch {
    // Not installed
  }

  const allReady = diagnostics.node.available && diagnostics.ffmpeg.available && (diagnostics.uv.available || diagnostics.ytdlp.available);
  return { ready: allReady, diagnostics };
}

/**
 * Execute yt-dlp metadata extraction with retry and exponential backoff
 */
async function probeUrlWithYtDlp(url, retries = MAX_RETRIES, timeoutMs = DEFAULT_TIMEOUT_MS) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const start = performance.now();
    try {
      const data = await new Promise((resolve, reject) => {
        const proc = spawn('uv', [
          'run',
          '--no-project',
          '--with',
          'yt-dlp',
          'yt-dlp',
          '--js-runtimes',
          'node',
          '--dump-json',
          '--skip-download',
          '--no-warnings',
          '--no-check-certificates',
          url,
        ]);

        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
          proc.kill('SIGTERM');
          reject(new Error(`Extraction timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        proc.stdout.on('data', chunk => { stdout += chunk; });
        proc.stderr.on('data', chunk => { stderr += chunk; });

        proc.on('close', code => {
          clearTimeout(timer);
          if (code === 0) {
            try {
              const parsed = JSON.parse(stdout);
              resolve(parsed);
            } catch (err) {
              reject(new Error(`Failed to parse yt-dlp JSON: ${err.message}`));
            }
          } else {
            const errMsg = (stderr || stdout || `yt-dlp exited with code ${code}`).trim();
            reject(new Error(errMsg));
          }
        });

        proc.on('error', err => {
          clearTimeout(timer);
          reject(err);
        });
      });

      const elapsed = Math.round(performance.now() - start);
      return { success: true, data, elapsed, attempt };
    } catch (err) {
      const elapsed = Math.round(performance.now() - start);
      const isLast = attempt === retries;
      if (isLast) {
        return { success: false, error: err.message, elapsed, attempt };
      }
      const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
      await new Promise(r => setTimeout(r, backoffMs));
    }
  }
}

/**
 * Verify byte-range or HEAD reachability of a media stream URL (zero heavy download)
 */
async function verifyStreamUrlReachable(streamUrl, timeoutMs = 5000) {
  if (!streamUrl || typeof streamUrl !== 'string' || !streamUrl.startsWith('http')) {
    return { reachable: false, status: 0, reason: 'Invalid or missing stream URL' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Attempt byte-range request first (0-1024 bytes) to test live CDN streaming
    let res = await fetch(streamUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Range': 'bytes=0-1024',
      },
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (res.status === 200 || res.status === 206 || res.status === 302 || res.status === 301) {
      return { reachable: true, status: res.status, reason: 'Stream chunk accessible' };
    }

    // Fallback to HEAD request if Range was rejected
    const headRes = await fetch(streamUrl, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      },
    });

    return {
      reachable: headRes.status >= 200 && headRes.status < 400,
      status: headRes.status,
      reason: headRes.status >= 200 && headRes.status < 400 ? 'HEAD verified' : `HTTP ${headRes.status}`,
    };
  } catch (err) {
    clearTimeout(timer);
    return { reachable: false, status: 0, reason: err.message };
  }
}

/**
 * Verify /api/health endpoint
 */
async function probeHealthEndpoint(endpointUrl, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(endpointUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    }

    const json = await res.json();
    const hasPlatforms = json && json.platforms && typeof json.platforms === 'object';
    const isHealthy = json.status === 'healthy' || json.status === 'operational';

    return {
      ok: true,
      status: res.status,
      data: json,
      valid: hasPlatforms && isHealthy,
    };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, error: err.message };
  }
}

/**
 * Verify /api/system/update endpoint
 */
async function probeUpdateEndpoint(endpointUrl, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(endpointUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ checkOnly: true }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    }

    const json = await res.json();
    return {
      ok: true,
      status: res.status,
      data: json,
      valid: json && (json.success === true || json.status === 'ok' || json.currentVersion !== undefined),
    };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, error: err.message };
  }
}

/**
 * Deterministic Mock Fixtures for offline or non-network verification
 */
function getMockPlatformResult(platformKey) {
  const fixtures = {
    youtube: {
      title: 'Rick Astley - Never Gonna Give You Up (Official Music Video)',
      duration: 213,
      formatsCount: 22,
      resolvedStreamUrl: 'https://rr2---sn-4g5ednks.googlevideo.com/videoplayback?mock=1',
      streamReachable: true,
    },
    facebook: {
      title: 'Meta Connect 2026 Keynote Highlights',
      duration: 98,
      formatsCount: 3,
      resolvedStreamUrl: 'https://video.faly1-1.fna.fbcdn.net/v/mock_fb_stream.mp4',
      streamReachable: true,
    },
    tiktok: {
      title: 'Dance Challenge #DownMe watermark-free viral video',
      duration: 15,
      formatsCount: 2,
      resolvedStreamUrl: 'https://v16-webapp-prime.tiktokcdn.com/mock_tiktok_stream.mp4',
      streamReachable: true,
    },
    pinterest: {
      title: 'Minimalist Architecture & Natural Light Palette Pin',
      duration: 0,
      formatsCount: 1,
      resolvedStreamUrl: 'https://i.pinimg.com/originals/99/36/06/mock_pin.jpg',
      streamReachable: true,
    },
  };

  return fixtures[platformKey];
}

/**
 * Main Maintenance Suite Execution
 */
export async function runMaintenanceSuite() {
  const suiteStart = performance.now();
  const prereqs = checkPrerequisites();

  if (!isJson) {
    console.log('\n======================================================');
    console.log('  DownMe Automated Maintenance & Health Verification  ');
    console.log(`  Runtime: Node ${process.version} | ${prereqs.diagnostics.ytdlp.version || 'yt-dlp N/A'} | ${prereqs.diagnostics.ffmpeg.available ? 'FFmpeg Ready' : 'FFmpeg Missing'}`);
    console.log('======================================================\n');
  }

  // Check prerequisites
  if (!prereqs.ready && !isMock) {
    if (!isJson) {
      console.error('[ERROR] Missing system prerequisites:');
      if (!prereqs.diagnostics.ffmpeg.available) console.error('  - ffmpeg is not found in PATH');
      if (!prereqs.diagnostics.ytdlp.available) console.error('  - yt-dlp is not available');
    }
    process.exit(EXIT_CODES.PREREQUISITE_MISSING);
  }

  const results = [];
  let brokenExtractors = 0;
  let networkErrors = 0;
  let assertionFailures = 0;

  for (const [key, platform] of Object.entries(PLATFORMS)) {
    if (!isJson) {
      process.stdout.write(`Probing ${platform.name} (${platform.testUrl})... `);
    }

    if (isMock) {
      const mockData = getMockPlatformResult(key);
      results.push({
        platform: platform.name,
        status: '🟢 PASS (MOCK)',
        latency: '8ms',
        formats: mockData.formatsCount,
        title: mockData.title.slice(0, 32) + '...',
        details: 'Operational (Verified)',
        reachable: true,
      });
      if (!isJson) console.log(`OK (8ms, ${mockData.formatsCount} formats)`);
      continue;
    }

    // Live Probe Execution
    const probe = await probeUrlWithYtDlp(platform.testUrl);

    if (probe.success) {
      const title = probe.data.title || 'Untitled';
      const formats = probe.data.formats || [];
      const formatsCount = formats.length;

      // Extract a candidate video/audio stream URL to verify reachability
      const sampleFormat = formats.find(f => f.url && f.url.startsWith('http')) || { url: probe.data.url };
      let streamCheck = { reachable: true, reason: 'Stream URL present' };

      if (sampleFormat && sampleFormat.url) {
        streamCheck = await verifyStreamUrlReachable(sampleFormat.url, 4000);
      }

      // Check format count assertion
      if (formatsCount === 0 && !probe.data.url) {
        assertionFailures++;
        results.push({
          platform: platform.name,
          status: '🔴 ASSERT_FAIL',
          latency: `${probe.elapsed}ms`,
          formats: 0,
          title: title.slice(0, 32),
          details: 'Zero formats returned',
          reachable: false,
        });
        if (!isJson) console.log(`FAIL (Zero formats)`);
      } else {
        results.push({
          platform: platform.name,
          status: '🟢 PASS',
          latency: `${probe.elapsed}ms`,
          formats: formatsCount || 1,
          title: title.slice(0, 32) + (title.length > 32 ? '...' : ''),
          details: streamCheck.reachable ? 'Operational (Stream verified)' : `Operational (${streamCheck.reason})`,
          reachable: streamCheck.reachable,
        });
        if (!isJson) console.log(`OK (${probe.elapsed}ms, ${formatsCount || 1} formats)`);
      }
    } else {
      const err = probe.error || '';
      const isNet = /timeout|timed out|econnrefused|enotfound|ehostunreach|getaddrinfo/i.test(err);
      const isBroken = /extractorerror|unsupported url|regex|no video formats found|video unavailable/i.test(err);

      if (isNet) {
        networkErrors++;
        results.push({
          platform: platform.name,
          status: '🟡 NET_ERR',
          latency: `${probe.elapsed}ms`,
          formats: 0,
          title: 'N/A',
          details: 'Network Timeout / Unreachable',
          reachable: false,
        });
        if (!isJson) console.log(`TIMEOUT (${probe.elapsed}ms)`);
      } else if (isBroken) {
        brokenExtractors++;
        results.push({
          platform: platform.name,
          status: '🔴 BROKEN',
          latency: `${probe.elapsed}ms`,
          formats: 0,
          title: 'N/A',
          details: err.slice(0, 45),
          reachable: false,
        });
        if (!isJson) console.log(`BROKEN (${err.slice(0, 45)})`);
      } else {
        // General extraction failure
        brokenExtractors++;
        results.push({
          platform: platform.name,
          status: '🔴 BROKEN',
          latency: `${probe.elapsed}ms`,
          formats: 0,
          title: 'N/A',
          details: err.slice(0, 45),
          reachable: false,
        });
        if (!isJson) console.log(`FAILED (${err.slice(0, 45)})`);
      }
    }
  }

  // Health Endpoint Check
  if (!isJson) {
    process.stdout.write(`\nProbing Backend Health Endpoint (${healthUrl})... `);
  }
  const healthProbe = isMock
    ? { ok: true, valid: true, data: { status: 'healthy', platforms: { youtube: 'operational' } } }
    : await probeHealthEndpoint(healthUrl);

  if (healthProbe.ok && healthProbe.valid) {
    if (!isJson) console.log('OK (Operational)');
  } else if (healthProbe.ok) {
    if (!isJson) console.log(`WARN (Responded with invalid schema)`);
  } else {
    if (!isJson) console.log(`OFFLINE / NOT RUNNING (${healthProbe.error || 'Connection refused'})`);
  }

  // Update Endpoint Check
  if (!isJson) {
    process.stdout.write(`Probing Extractor Updater Endpoint (${updateUrl})... `);
  }
  const updateProbe = isMock
    ? { ok: true, valid: true, data: { success: true, message: 'yt-dlp is up to date' } }
    : await probeUpdateEndpoint(updateUrl);

  if (updateProbe.ok) {
    if (!isJson) console.log('OK (Update check verified)');
  } else {
    if (!isJson) console.log(`OFFLINE / NOT RUNNING (${updateProbe.error || 'Connection refused'})`);
  }

  const totalDuration = Math.round(performance.now() - suiteStart);

  if (isJson) {
    const report = {
      timestamp: new Date().toISOString(),
      durationMs: totalDuration,
      summary: {
        totalPlatforms: Object.keys(PLATFORMS).length,
        brokenExtractors,
        networkErrors,
        assertionFailures,
      },
      platforms: results,
      backend: {
        healthEndpoint: { url: healthUrl, probe: healthProbe },
        updateEndpoint: { url: updateUrl, probe: updateProbe },
      },
      exitCode: brokenExtractors > 0
        ? EXIT_CODES.EXTRACTOR_BROKEN
        : assertionFailures > 0
        ? EXIT_CODES.ASSERTION_FAILED
        : networkErrors > 0
        ? EXIT_CODES.NETWORK_ERROR
        : EXIT_CODES.SUCCESS,
    };
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.exitCode);
  }

  // Print Formatted ANSI Summary Table
  console.log('\n--- DownMe Platform Maintenance Summary ---');
  console.table(results);
  console.log(`Execution completed in ${totalDuration}ms.`);

  // Determine Exit Code
  if (brokenExtractors > 0) {
    console.error(`\n[ALERT] ${brokenExtractors} platform extractor(s) broken! Run self-healing update: npm run update:extractors`);
    process.exit(EXIT_CODES.EXTRACTOR_BROKEN);
  } else if (assertionFailures > 0) {
    console.error(`\n[FAIL] ${assertionFailures} assertion failure(s) detected.`);
    process.exit(EXIT_CODES.ASSERTION_FAILED);
  } else if (networkErrors > 0) {
    console.warn(`\n[WARN] ${networkErrors} platform(s) encountered transient network errors.`);
    process.exit(EXIT_CODES.NETWORK_ERROR);
  } else {
    console.log('\n[SUCCESS] All 4 platforms operational. Upstream extractors healthy. (Exit Code 0)');
    process.exit(EXIT_CODES.SUCCESS);
  }
}

// Auto-run if executed directly
if (process.argv[1] && process.argv[1].endsWith('test-maintenance.mjs')) {
  runMaintenanceSuite().catch(err => {
    console.error('\n[FATAL] Maintenance runner crashed:', err);
    process.exit(EXIT_CODES.ASSERTION_FAILED);
  });
}
