import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

describe('static PWA shell', () => {
  test('page exposes mobile, iOS and install metadata', async () => {
    const html = await read('index.html');
    assert.match(html, /name="viewport"[^>]*viewport-fit=cover/);
    assert.match(html, /name="theme-color"/);
    assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
    assert.match(html, /rel="manifest"/);
    assert.match(html, /rel="apple-touch-icon"/);
    assert.match(html, /lang="ru"/);
  });

  test('answer control is numeric-keyboard friendly and accessible', async () => {
    const html = await read('index.html');
    assert.match(html, /id="answer-input"/);
    assert.match(html, /inputmode="numeric"/);
    assert.match(html, /enterkeyhint="done"/);
    assert.match(html, /aria-live="polite"/);
  });

  test('manifest describes a standalone installable app with icons', async () => {
    const manifest = JSON.parse(await read('manifest.webmanifest'));
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, './');
    assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
    assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512'));
  });

  test('service worker caches the offline shell', async () => {
    const worker = await read('service-worker.js');
    for (const asset of ['./', './index.html', './styles.css', './src/app.js', './src/core.js']) {
      assert.ok(worker.includes(asset), `service worker must cache ${asset}`);
    }
    assert.match(worker, /addEventListener\(['"]fetch['"]/);
  });
});
