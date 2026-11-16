import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

console.log('[DownMe Build] Starting client bundle assembly...');

// 1. Clean and recreate dist/
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

// Helper to copy directory recursively
function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 2. Copy static HTML, CSS, JS
fs.copyFileSync(path.join(rootDir, 'src', 'index.html'), path.join(distDir, 'index.html'));
copyDir(path.join(rootDir, 'src', 'css'), path.join(distDir, 'css'));
copyDir(path.join(rootDir, 'src', 'js'), path.join(distDir, 'js'));

// 3. Copy public assets (fonts, icons, shortcuts, manifest, sw, offline)
copyDir(path.join(rootDir, 'public', 'fonts'), path.join(distDir, 'fonts'));
copyDir(path.join(rootDir, 'public', 'icons'), path.join(distDir, 'icons'));
copyDir(path.join(rootDir, 'public', 'shortcuts'), path.join(distDir, 'shortcuts'));

const rootPublicFiles = ['manifest.webmanifest', 'sw.js', 'offline.html', 'favicon.svg', 'favicon.png'];
for (const file of rootPublicFiles) {
  const p = path.join(rootDir, 'public', file);
  if (fs.existsSync(p)) {
    fs.copyFileSync(p, path.join(distDir, file));
  }
}

// Verify output
const distEntries = fs.readdirSync(distDir);
console.log(`[DownMe Build] Assembly complete! ${distEntries.length} root items in dist/:`, distEntries);
