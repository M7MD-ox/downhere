import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://downhere.vercel.app';

test.describe('Downhere E2E User Flows', () => {
  test.setTimeout(60000);

  test('YouTube extraction, subtitles, and download confirmations (audio, thumbnail, subtitles, video)', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

    const input = page.locator('#url-input');
    const extractBtn = page.locator('#extract-btn');
    await expect(input).toBeVisible();
    await expect(page.locator('#recent-history-section')).toBeVisible();
    await expect(page.locator('#recent-history-pills')).toContainText('No recent links yet');

    // Extract YouTube video with subtitles
    await input.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await extractBtn.click();

    await expect(page.locator('#media-preview-card')).toBeVisible({ timeout: 25000 });
    await expect(page.locator('#preview-platform-badge')).toContainText(/youtube/i);

    // 1. Audio download confirmation
    await page.locator('.format-tab[data-type="audio"]').click();
    await expect(page.locator('#audio-quality-section')).toBeVisible();
    await page.locator('#download-primary-btn').click();
    await expect(page.locator('#spotlight-status')).toContainText('Audio download started!');
    await expect(page.locator('#download-primary-btn')).toContainText('Download Started');

    // 2. Thumbnail download confirmation
    await page.locator('.format-tab[data-type="photo"]').click();
    await page.locator('#download-primary-btn').click();
    await expect(page.locator('#spotlight-status')).toContainText('Thumbnail download started!');

    // 3. Subtitles options & download confirmation
    const subTab = page.locator('.format-tab[data-type="subtitles"]');
    await expect(subTab).toBeVisible();
    await subTab.click();
    await expect(page.locator('#subtitles-section')).toBeVisible();
    const subOptionsCount = await page.locator('#subtitles-select option').count();
    expect(subOptionsCount).toBeGreaterThan(1);
    await page.locator('#download-primary-btn').click();
    await expect(page.locator('#spotlight-status')).toContainText('Subtitles download started!');

    // 4. Muxed video download confirmation (360p MP4 + Audio)
    await page.locator('.format-tab[data-type="video"]').click();
    await page.locator('#video-quality-pills .quality-pill', { hasText: '360p' }).click();
    await page.locator('#download-primary-btn').click();
    await expect(page.locator('#spotlight-status')).toContainText('Video download started!');
  });

  test('Recent history persist, reopen, and clear to empty state', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

    await page.locator('#url-input').fill('https://www.instagram.com/reel/CDUMkliABpa/');
    await page.locator('#extract-btn').click();
    await expect(page.locator('#media-preview-card')).toBeVisible({ timeout: 25000 });
    await expect(page.locator('#preview-platform-badge')).toContainText(/instagram/i);

    // Recent pill & clear button should be visible
    const recentPill = page.locator('#recent-history-pills .recent-pill').first();
    await expect(recentPill).toBeVisible();
    await expect(page.locator('#recent-clear-btn')).toBeVisible();

    // Clear input, then click recent pill to reopen
    await page.locator('#clear-btn').click();
    await expect(page.locator('#url-input')).toHaveValue('');
    await recentPill.click();
    await expect(page.locator('#url-input')).toHaveValue('https://www.instagram.com/reel/CDUMkliABpa/');
    await expect(page.locator('#media-preview-card')).toBeVisible({ timeout: 25000 });

    // Clear recent history -> empty state
    await page.locator('#recent-clear-btn').click();
    await expect(page.locator('#recent-history-pills')).toContainText('No recent links yet');
    await expect(page.locator('#recent-clear-btn')).toBeHidden();
  });

  test('Facebook video extraction succeeds', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

    await page.locator('#url-input').fill('https://www.facebook.com/watch/?v=10153231379946729');
    await page.locator('#extract-btn').click();

    await expect(page.locator('#media-preview-card')).toBeVisible({ timeout: 25000 });
    await expect(page.locator('#preview-platform-badge')).toContainText(/facebook/i);
  });

  test('Clipboard suggestion on focus return, replace with new link, and accept', async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL });
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

    const firstUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const secondUrl = 'https://www.instagram.com/reel/CDUMkliABpa/';

    // Copy first link and trigger focus
    await page.evaluate(async (url) => {
      await navigator.clipboard.writeText(url);
      window.dispatchEvent(new Event('focus'));
    }, firstUrl);

    await expect(page.locator('#clipboard-banner')).toHaveClass(/active/, { timeout: 5000 });
    await expect(page.locator('#clipboard-url')).toHaveText(firstUrl);

    // Copy second link and trigger focus -> should replace suggestion
    await page.evaluate(async (url) => {
      await navigator.clipboard.writeText(url);
      window.dispatchEvent(new Event('focus'));
    }, secondUrl);

    await expect(page.locator('#clipboard-url')).toHaveText(secondUrl, { timeout: 5000 });

    // Accept clipboard suggestion -> populates input and extracts
    await page.locator('#clipboard-download-btn').click();
    await expect(page.locator('#url-input')).toHaveValue(secondUrl);
    await expect(page.locator('#media-preview-card')).toBeVisible({ timeout: 25000 });
  });
});
