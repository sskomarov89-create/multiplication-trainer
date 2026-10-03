import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const BASE_URL = process.env.UAT_BASE_URL ?? 'http://127.0.0.1:4173';
const CHROME = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  chromium.executablePath(),
  '/home/hermes/.hermes/tools/chromium-1208/chrome-linux64/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((candidate) => candidate && existsSync(candidate));
const LOCAL_LIBS = process.env.PLAYWRIGHT_LIBRARY_PATH
  ?? '/home/hermes/.hermes/cache/scratch/chrome-libs/root/usr/lib/x86_64-linux-gnu';
const STORAGE_KEY = 'umnozhayka.progress.v1';

if (!CHROME) {
  throw new Error('Chromium not found. Set PLAYWRIGHT_CHROME_PATH to a Chromium executable.');
}
const evidenceDir = new URL('../test-results/', import.meta.url);

await mkdir(evidenceDir, { recursive: true });

const results = [];
const record = (scenario, details = 'PASS') => results.push({ scenario, result: details });

async function currentAnswer(page) {
  const a = Number(await page.locator('#factor-a').textContent());
  const b = Number(await page.locator('#factor-b').textContent());
  return a * b;
}

async function solveCorrect(page, useEnter = false) {
  const answer = await currentAnswer(page);
  await page.locator('#answer-input').fill(String(answer));
  if (useEnter) await page.locator('#answer-input').press('Enter');
  else await page.locator('#check-button').click();
  await page.locator('#feedback.correct').waitFor();
  return answer;
}

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  env: existsSync(LOCAL_LIBS)
    ? { ...process.env, LD_LIBRARY_PATH: LOCAL_LIBS }
    : process.env,
});

try {
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  });
  const page = await mobile.newPage();
  await page.goto(BASE_URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  assert.equal(await page.locator('#welcome-screen').isVisible(), true);
  assert.equal(await page.locator('#welcome-level').textContent(), '1');
  assert.equal(await page.locator('#welcome-stars').textContent(), '0');
  record('1. Первый запуск без сохранённого прогресса');

  await page.locator('#start-button').click();
  assert.equal(await page.locator('#trainer-screen').isVisible(), true);
  assert.equal(await page.locator('#answer-input').evaluate((element) => document.activeElement === element), true);
  const inputBox = await page.locator('#answer-input').boundingBox();
  assert.ok(inputBox && inputBox.y + inputBox.height <= 844, 'answer input must remain visible in mobile viewport');
  record('2. Начало тренировки и фокус поля');

  await page.locator('#check-button').click();
  await page.locator('#feedback.validation').waitFor();
  assert.match(await page.locator('#feedback').textContent(), /напиши ответ/i);
  assert.equal(await page.locator('#stars-value').textContent(), '0');
  record('5. Пустой ответ не засчитан');

  const correct = await currentAnswer(page);
  const wrong = correct === 100 ? 99 : correct + 1;
  await page.locator('#answer-input').fill(String(wrong));
  await page.locator('#answer-input').press('Enter');
  await page.locator('#feedback.incorrect').waitFor();
  assert.match(await page.locator('#feedback').textContent(), new RegExp(String(correct)));
  assert.equal(await page.locator('#stars-value').textContent(), '0');
  record('4. Неправильный ответ показывает правильный без штрафа');

  await page.locator('#check-button').press('Enter');
  await solveCorrect(page, true);
  assert.equal(await page.locator('#stars-value').textContent(), '1');
  assert.match(await page.locator('#feedback').textContent(), /Верно/);
  record('3. Правильный ответ через Enter');

  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({
    totalSolved: 9, totalCorrect: 9, stars: 9, currentStreak: 4, bestStreak: 4, level: 1, weakPairs: {},
  })), STORAGE_KEY);
  await page.reload();
  await page.locator('#start-button').click();
  await solveCorrect(page, true);
  assert.equal(await page.locator('#level-value').textContent(), '2');
  assert.equal(await page.locator('#streak-value').textContent(), '5');
  assert.match(await page.locator('#feedback').textContent(), /Новый рекорд/);
  assert.match(await page.locator('#celebration-text').textContent(), /Уровень 2.*5 верных/);
  record('7–8. Новый рекорд, серия 5 и повышение уровня');

  for (let i = 0; i < 5; i += 1) {
    await page.locator('#check-button').click();
    await solveCorrect(page);
  }
  assert.equal(await page.locator('#streak-value').textContent(), '10');
  assert.match(await page.locator('#celebration-text').textContent(), /10 верных подряд/);
  record('6. Несколько ответов и длинная серия 10');

  const beforeReload = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
  await page.reload();
  assert.equal(await page.locator('#welcome-stars').textContent(), String(beforeReload.stars));
  assert.equal(beforeReload.currentStreak, 10);
  record('9–10. Reload сохраняет прогресс');

  await page.locator('#progress-button').click();
  assert.equal(await page.locator('#progress-dialog').isVisible(), true);
  assert.equal(await page.locator('#progress-best').textContent(), '10');
  assert.equal(await page.locator('#progress-solved').textContent(), String(beforeReload.totalSolved));
  record('11. Блок «Мой прогресс»');

  await page.locator('#reset-progress').click();
  assert.equal(await page.locator('#confirm-dialog').isVisible(), true);
  await page.locator('#cancel-reset').click();
  assert.equal(await page.locator('#progress-dialog').isVisible(), true);
  assert.equal(await page.locator('#progress-stars').textContent(), String(beforeReload.stars));
  record('13. Отмена сброса сохраняет данные');

  await page.locator('#reset-progress').click();
  await page.locator('#confirm-reset').click();
  const resetState = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
  assert.equal(resetState.totalSolved, 0);
  assert.equal(resetState.stars, 0);
  assert.equal(await page.locator('#welcome-screen').isVisible(), true);
  const bannerBox = await page.locator('#celebration').boundingBox();
  const topbarBox = await page.locator('.topbar').boundingBox();
  assert.ok(
    bannerBox && topbarBox && bannerBox.y >= topbarBox.y + topbarBox.height + 8,
    'celebration banner must not overlap the top navigation',
  );
  record('12. Подтверждённый сброс очищает прогресс');

  const mobileMetrics = await page.evaluate(() => ({
    viewport: [innerWidth, innerHeight],
    bodyWidth: document.body.scrollWidth,
    inputMode: document.querySelector('#answer-input').inputMode,
    enterKeyHint: document.querySelector('#answer-input').enterKeyHint,
  }));
  assert.deepEqual(mobileMetrics.viewport, [390, 844]);
  assert.equal(mobileMetrics.bodyWidth, 390);
  assert.equal(mobileMetrics.inputMode, 'numeric');
  assert.equal(mobileMetrics.enterKeyHint, 'done');
  const smallTargets = await page.locator('button:visible').evaluateAll((buttons) => buttons
    .map((button) => ({ label: button.textContent.trim(), w: button.getBoundingClientRect().width, h: button.getBoundingClientRect().height }))
    .filter((item) => item.w < 44 || item.h < 44));
  assert.deepEqual(smallTargets, []);
  await page.screenshot({ path: new URL('mobile.png', evidenceDir).pathname, fullPage: true });
  record('14. iPhone viewport, touch targets, numeric keyboard metadata');

  const manifestResponse = await page.request.get(`${BASE_URL}/manifest.webmanifest`);
  assert.equal(manifestResponse.ok(), true);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const response = await page.request.get(new URL(icon.src, `${BASE_URL}/`).href);
    assert.equal(response.ok(), true);
  }
  await page.goto(BASE_URL);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await mobile.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await page.locator('#start-button').isVisible(), true);
  await mobile.setOffline(false);
  record('PWA manifest, icons и offline app shell');

  await mobile.close();

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const desktopPage = await desktop.newPage();
  await desktopPage.goto(BASE_URL);
  await desktopPage.evaluate(() => localStorage.clear());
  await desktopPage.reload();
  assert.equal(await desktopPage.locator('#welcome-screen').isVisible(), true);
  assert.equal(await desktopPage.evaluate(() => document.body.scrollWidth <= innerWidth), true);
  await desktopPage.locator('#start-button').click();
  const card = await desktopPage.locator('#practice-card').boundingBox();
  assert.ok(card && card.width <= 620 && card.x > 300, 'practice card should be centered and readable');
  await solveCorrect(desktopPage, true);
  await desktopPage.screenshot({ path: new URL('desktop.png', evidenceDir).pathname, fullPage: true });
  record('15. Desktop viewport и keyboard flow');
  await desktop.close();

  console.log(JSON.stringify({ status: 'PASS', scenarios: results }, null, 2));
} finally {
  await browser.close();
}
