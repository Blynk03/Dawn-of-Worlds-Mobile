// Runs after `expo export --platform web`. Prepares dist/ for GitHub Pages:
// - adds home-screen ("install as app") tags to every page
// - copies the not-found page to 404.html, which GitHub Pages serves for unknown URLs
// - adds .nojekyll so folders starting with "_" (like _expo/) are served
//   node scripts/prepare-web-deploy.mjs [distDir]
import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2] ?? 'dist';
const base = (process.env.EXPO_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');

const headTags = [
  '<link rel="manifest" href="' + base + '/manifest.json">',
  '<meta name="theme-color" content="#121120">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-title" content="Dawn of Worlds">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
  '<link rel="apple-touch-icon" href="' + base + '/icons/icon-180.png">',
].join('');

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return htmlFiles(path);
    return name.endsWith('.html') ? [path] : [];
  });
}

let count = 0;
for (const file of htmlFiles(dist)) {
  let html = readFileSync(file, 'utf8');
  if (html.includes('rel="manifest"')) continue;
  html = html
    .replace('</head>', headTags + '</head>')
    .replace(/<title>[^<]*<\/title>/, '<title>Dawn of Worlds</title>');
  writeFileSync(file, html);
  count++;
}

const notFound = join(dist, '+not-found.html');
if (existsSync(notFound)) copyFileSync(notFound, join(dist, '404.html'));
writeFileSync(join(dist, '.nojekyll'), '');

console.log(`Prepared ${count} pages in ${dist} (base path: ${base || '/'})`);
