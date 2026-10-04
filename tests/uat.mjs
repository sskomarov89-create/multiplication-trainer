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

if (!CHROME) throw new Error('Chromium not found. Set PLAYWRIGHT_CHROME_PATH.');

const evidenceDir = new URL('../test-results/', import.meta.url);
await mkdir(evidenceDir, { recursive: true });
const runId = Date.now().toString().slice(-6);
const names = { masha: `Маша ${runId}`, petya: `Петя ${runId}`, desktop: `Desk ${runId}` };
const results = [];
const record = (scenario) => results.push({ scenario, result: 'PASS' });

async function currentAnswer(page) {
  return Number(await page.locator('#factor-a').textContent()) * Number(await page.locator('#factor-b').textContent());
}

async function solveCorrect(page, useEnter = false) {
  await page.locator('#answer-input').fill(String(await currentAnswer(page)));
  if (useEnter) await page.locator('#answer-input').press('Enter');
  else await page.locator('#check-button').click();
  await page.locator('#feedback.correct').waitFor();
}

async function createPlayer(page, name) {
  await page.locator('#player-name').fill(name);
  await page.locator('#player-submit').click();
  await page.locator('#welcome-screen').waitFor();
}

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  env: existsSync(LOCAL_LIBS) ? { ...process.env, LD_LIBRARY_PATH: LOCAL_LIBS } : process.env,
});

try {
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  });
  const page = await mobile.newPage();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  assert.equal(await page.locator('#login-screen').isVisible(), true);
  assert.equal(await page.locator('#welcome-screen').isHidden(), true);
  record('1. Первый запуск просит выбрать имя');

  await page.locator('#player-name').fill('А');
  await page.locator('#player-submit').click();
  await page.locator('#name-feedback.error').waitFor();
  assert.match(await page.locator('#name-feedback').textContent(), /2 до 20/);
  record('2. Некорректное имя не регистрируется');

  await createPlayer(page, names.masha);
  assert.equal(await page.locator('#welcome-name').textContent(), names.masha);
  assert.equal(await page.locator('#welcome-stars').textContent(), '0');
  record('3. Регистрация уникального имени');

  await page.locator('#start-button').click();
  assert.equal(await page.locator('#round-number').textContent(), '1');
  assert.equal(await page.locator('#round-count').textContent(), '0 из 10');
  assert.equal(await page.locator('#answer-input').evaluate((element) => document.activeElement === element), true);
  record('4. Раунд явно начинается с 0 из 10');

  await page.locator('#check-button').click();
  await page.locator('#feedback.validation').waitFor();
  assert.match(await page.locator('#feedback').textContent(), /напиши ответ/i);
  assert.equal(await page.locator('#round-count').textContent(), '0 из 10');
  record('5. Пустой ответ не засчитывается в раунд');

  const correct = await currentAnswer(page);
  await page.locator('#answer-input').fill(String(correct === 100 ? 99 : correct + 1));
  await page.locator('#answer-input').press('Enter');
  await page.locator('#feedback.incorrect').waitFor();
  assert.match(await page.locator('#feedback').textContent(), new RegExp(String(correct)));
  assert.equal(await page.locator('#round-count').textContent(), '1 из 10');
  assert.equal(await page.locator('#answer-result').textContent(), String(correct));
  const incorrectVisual = await page.locator('#practice-card').evaluate((element) => ({
    animationName: getComputedStyle(element).animationName,
    answerSize: Number.parseFloat(getComputedStyle(document.querySelector('#answer-result')).fontSize),
    feedbackSize: Number.parseFloat(getComputedStyle(document.querySelector('#feedback')).fontSize),
  }));
  assert.equal(incorrectVisual.animationName, 'incorrect-flash');
  assert.ok(incorrectVisual.answerSize > incorrectVisual.feedbackSize * 2);
  await page.locator('#practice-card').evaluate((element) => new Promise((resolve) => {
    element.addEventListener('animationend', resolve, { once: true });
  }));
  assert.deepEqual(await page.locator('#practice-card').evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.backgroundColor, style.borderTopColor];
  }), ['rgb(253, 235, 237)', 'rgb(232, 160, 167)']);
  record('6. Ошибка показывает ответ и двигает раунд');

  await page.locator('#check-button').click();
  assert.equal(await page.locator('#answer-result').textContent(), '?');
  await solveCorrect(page, true);
  assert.equal(await page.locator('#round-count').textContent(), '2 из 10');
  assert.equal(await page.locator('#stars-value').textContent(), '1');
  assert.equal(await page.locator('#answer-result').textContent(), String(await currentAnswer(page)));
  assert.deepEqual(await page.locator('#practice-card').evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.backgroundColor, style.borderTopColor];
  }), ['rgb(232, 248, 241)', 'rgb(131, 210, 182)']);
  record('7. Правильный ответ через Enter сохраняется');

  for (let answered = 2; answered < 10; answered += 1) {
    await page.locator('#check-button').click();
    await solveCorrect(page);
  }
  assert.equal(await page.locator('#check-button').textContent(), 'Итоги раунда →');
  assert.equal(await page.locator('#round-count').textContent(), '10 из 10');
  await page.locator('#check-button').click();
  await page.locator('#round-dialog').waitFor();
  assert.equal(await page.locator('#round-score').textContent(), '9 из 10');
  await page.screenshot({ path: new URL('mobile-round.png', evidenceDir).pathname, fullPage: true });
  record('8. После десятого примера показан заметный итог 9 из 10');

  await page.locator('#next-round').click();
  assert.equal(await page.locator('#round-number').textContent(), '2');
  assert.equal(await page.locator('#round-count').textContent(), '0 из 10');
  record('9. Следующий раунд начинается отдельно');

  await solveCorrect(page);
  assert.equal(await page.locator('#stars-value').textContent(), '10');
  assert.equal(await page.locator('#grade-name').textContent(), 'Знаток');
  assert.match(await page.locator('#celebration-text').textContent(), /Новый статус: Знаток/);
  record('10. Десятая рейтинговая звезда повышает статус');

  await page.locator('#back-to-welcome').click();
  await page.reload();
  await page.locator('#welcome-screen').waitFor();
  assert.equal(await page.locator('#welcome-round').textContent(), '2');
  assert.equal(await page.locator('#welcome-stars').textContent(), '10');
  assert.equal(await page.locator('#grade-name').textContent(), 'Знаток');
  record('11. Имя, статус и прогресс сохраняются после reload');

  await page.locator('#switch-player').click();
  assert.equal(await page.locator('#login-screen').isVisible(), true);
  assert.equal(await page.locator('.known-player-button').textContent(), names.masha);
  await page.locator('.known-player-button').click();
  await page.locator('#welcome-screen').waitFor();
  assert.equal(await page.locator('#welcome-stars').textContent(), '10');
  record('12. Смена и возврат к локально известному игроку');

  const secondDevice = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const secondPage = await secondDevice.newPage();
  await secondPage.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await secondPage.locator('#player-name').fill(names.masha.toLocaleLowerCase('ru'));
  await secondPage.locator('#player-submit').click();
  await secondPage.locator('#welcome-screen').waitFor();
  assert.equal(await secondPage.locator('#welcome-name').textContent(), names.masha);
  assert.equal(await secondPage.locator('#welcome-stars').textContent(), '10');
  record('13. То же имя открывает общий прогресс в другом браузере');

  await secondPage.locator('#start-button').click();
  await solveCorrect(secondPage);
  assert.equal(await secondPage.locator('#stars-value').textContent(), '11');
  await page.reload();
  await page.locator('#welcome-screen').waitFor();
  assert.equal(await page.locator('#welcome-stars').textContent(), '11');
  record('14. Ответ из второго браузера виден в первом');

  await secondPage.locator('#back-to-welcome').click();
  await secondPage.locator('#switch-player').click();
  await createPlayer(secondPage, names.petya);
  assert.equal(await secondPage.locator('#welcome-stars').textContent(), '0');
  await secondPage.locator('#start-button').click();
  await solveCorrect(secondPage);
  assert.equal(await secondPage.locator('#stars-value').textContent(), '1');
  assert.equal(await page.locator('#welcome-stars').textContent(), '11');
  record('15. Прогресс разных игроков остаётся изолирован');
  await secondDevice.close();

  await page.locator('#rewards-button').click();
  await page.locator('#leaderboard-list .leaderboard-row').first().waitFor();
  assert.equal(await page.locator('#rewards-grade-name').textContent(), 'Знаток');
  assert.equal(await page.locator('#badges-count').textContent(), '5 из 6');
  const ownTopRows = await page.locator('#leaderboard-list .leaderboard-row.is-me').count();
  const ownSeparateRow = await page.locator('#my-rank-row').isVisible();
  assert.ok(ownTopRows === 1 || ownSeparateRow);
  assert.match(await page.locator('#personal-rank').textContent(), /^#\d+$/);
  await page.screenshot({ path: new URL('mobile-rewards.png', evidenceDir).pathname, fullPage: true });
  await page.locator('#close-rewards').click();
  record('16. Значки, статус и личное место видны в общем рейтинге');

  await page.locator('#progress-button').click();
  assert.equal(await page.locator('#progress-rounds').textContent(), '1');
  await page.locator('#reset-progress').click();
  await page.locator('#cancel-reset').click();
  assert.equal(await page.locator('#progress-stars').textContent(), '11');
  await page.locator('#reset-progress').click();
  await page.locator('#confirm-reset').click();
  await page.locator('#confirm-dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#welcome-screen').isVisible(), true);
  assert.equal(await page.locator('#welcome-stars').textContent(), '0');
  assert.equal(await page.locator('#welcome-round').textContent(), '1');
  assert.equal(await page.locator('#grade-name').textContent(), 'Искатель');
  record('17. Сброс требует подтверждения и очищает награды текущего игрока');

  const metrics = await page.evaluate(() => ({
    viewport: [innerWidth, innerHeight], bodyWidth: document.body.scrollWidth,
    inputMode: document.querySelector('#answer-input').inputMode,
  }));
  assert.ok(metrics.viewport[0] >= 375 && metrics.viewport[0] <= 430);
  assert.ok(metrics.viewport[1] >= 800);
  assert.equal(metrics.bodyWidth, metrics.viewport[0]);
  assert.equal(metrics.inputMode, 'numeric');
  const smallTargets = await page.locator('button:visible').evaluateAll((buttons) => buttons
    .map((button) => ({ label: button.textContent.trim(), w: button.getBoundingClientRect().width, h: button.getBoundingClientRect().height }))
    .filter((item) => item.w < 44 || item.h < 44));
  assert.deepEqual(smallTargets, []);
  await page.screenshot({ path: new URL('mobile-profile.png', evidenceDir).pathname, fullPage: true });
  record('18. iPhone viewport, touch targets и отсутствие overflow');

  const manifestResponse = await page.request.get(`${BASE_URL}/manifest.webmanifest`);
  assert.equal(manifestResponse.ok(), true);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await mobile.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await page.locator('#login-screen').isVisible(), true);
  await mobile.setOffline(false);
  record('19. PWA shell открывается без сети и не подменяет API кэшем');
  await mobile.close();

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const desktopPage = await desktop.newPage();
  await desktopPage.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await createPlayer(desktopPage, names.desktop);
  await desktopPage.locator('#start-button').click();
  const card = await desktopPage.locator('#practice-card').boundingBox();
  assert.ok(card && card.width <= 620 && card.x > 300);
  await solveCorrect(desktopPage, true);
  await desktopPage.screenshot({ path: new URL('desktop.png', evidenceDir).pathname, fullPage: true });
  record('20. Desktop layout и keyboard flow');
  await desktop.close();

  console.log(JSON.stringify({ status: 'PASS', scenarios: results }, null, 2));
} finally {
  await browser.close();
}
