'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');

const E2E = process.env.E2E === '1';
const skip = E2E ? false : 'задайте E2E=1';

const ROOT = path.resolve(__dirname, '..');

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [];
  if (process.platform === 'win32') {
    for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]) {
      if (base) candidates.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser');
  }
  return candidates.find((candidate) => fs.existsSync(candidate));
}

const CHROME = findChrome();
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'flavors.json'), 'utf8'));

function isDiscontinued(item) {
  return item.discontinued === true || Number(item.status_id) === 4 || /снят\s+с\s+производства/i.test(String(item.status || ''));
}

function groupsOf(item) {
  const groups = new Set(Array.isArray(item.taste_groups) ? item.taste_groups : []);
  for (const tag of Array.isArray(item.tags) ? item.tags : []) {
    if (tag && typeof tag === 'object' && tag.group) groups.add(tag.group);
  }
  return [...groups];
}

const activeCatalog = catalog.filter((item) => !isDiscontinued(item));

function findBrandWithoutCategory() {
  const brands = [...new Set(activeCatalog.map((item) => item.brand))].sort((a, b) => a.localeCompare(b, 'ru'));
  const categories = [...new Set(activeCatalog.flatMap(groupsOf))].sort((a, b) => a.localeCompare(b, 'ru'));
  for (const brand of brands) {
    const brandCategories = new Set(activeCatalog.filter((item) => item.brand === brand).flatMap(groupsOf));
    if (brandCategories.size < 2) continue;
    const missing = categories.find((category) => !brandCategories.has(category));
    if (missing) {
      return { brand, missing, available: [...brandCategories].sort((a, b) => a.localeCompare(b, 'ru')) };
    }
  }
  return null;
}

function countFor(brand, category) {
  return activeCatalog.filter(
    (item) => item.brand === brand && groupsOf(item).includes(category)
  ).length;
}

function createStaticServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    const filePath = path.join(ROOT, pathname);
    if (!filePath.startsWith(ROOT)) {
      response.writeHead(403).end('forbidden');
      return;
    }
    fs.readFile(filePath, (error, data) => {
      if (error) {
        response.writeHead(404).end('not found');
        return;
      }
      response.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      response.end(data);
    });
  });
}

function numericText(value) {
  return Number(String(value || '').replace(/[^\d]/g, ''));
}

test('e2e: случайные предложения, пустая граммовка, время истории и зум только PWA', { skip, timeout: 60000 }, async () => {
  const { chromium } = require('playwright');
  const server = createStaticServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: CHROME || undefined });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      if (localStorage.getItem('fixes-seeded')) return;
      localStorage.setItem('fixes-seeded', '1');
      localStorage.setItem('hookah_bowls', JSON.stringify(['Test bowl']));
      localStorage.setItem('hookah_custom_bowls_only_v1', '1');
      localStorage.setItem('hookah_sessions', JSON.stringify([{
        id: 12345, date: '29.10.2026', bowl: 'Test bowl',
        mix: [{ brand: 'MUSTHAVE', flavor: 'Earl Grey', weight: 25 }],
        placement: '2 + 1', coalsUsed: 3, actualWarmupDuration: 307,
        smokeDuration: 3611, rating: 4.5
      }]));
    });
    const url = `http://127.0.0.1:${server.address().port}/`;
    await page.goto(url);
    await waitCatalog(page);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => document.fonts.check('16px Underdog', 'Привет')), true);
    assert.match(await page.evaluate(() => getComputedStyle(document.body).fontFamily), /Underdog/);
    assert.doesNotMatch(await page.getAttribute('meta[name="viewport"]', 'content'), /user-scalable=no/);
    assert.equal(await page.evaluate(() => !document.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, cancelable: true }))), false);
    const previous = await page.locator('#home-products [data-save-product]').evaluateAll(buttons => buttons.map(button => button.dataset.saveProduct));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const next = await page.locator('#home-products [data-save-product]').evaluateAll(buttons => buttons.map(button => button.dataset.saveProduct));
    assert.equal(next.length, 4);
    assert.equal(next.some(slug => previous.includes(slug)), false);
    assert.equal(await page.inputValue('#solo-tobacco-weight'), '');
    await page.fill('#solo-tobacco-weight', '18');
    await page.selectOption('#solo-tobacco-brand', 'DARKSIDE');
    assert.equal(await page.inputValue('#solo-tobacco-weight'), '');
    await page.fill('#solo-tobacco-weight', '12');
    await page.selectOption('#solo-tobacco-flavor', { index: 1 });
    assert.equal(await page.inputValue('#solo-tobacco-weight'), '');
    await page.click('button[onclick="addTobaccoToMix()"]');
    assert.deepEqual(await page.locator('.mix-weight-input').evaluateAll(inputs => inputs.map(input => input.value)), ['', '']);
    assert.equal(await page.locator('#coal-placement, #edit-placement, #manual-placement-select').count(), 0);
    assert.doesNotMatch(await page.textContent('#history-list'), /2 \+ 1/);
    await page.click('button[onclick="openEditModal(12345)"]');
    await page.waitForSelector('#edit-modal:not(.hidden)');
    assert.equal(await page.inputValue('#edit-warmup-seconds'), '7');
    assert.equal(await page.inputValue('#edit-smoke-seconds'), '11');
    await page.fill('#edit-warmup-minutes', '7');
    await page.fill('#edit-warmup-seconds', '60');
    await page.click('button[onclick="saveEditedSession()"]');
    assert.equal(await page.isVisible('#edit-modal'), true, 'invalid seconds must not save');
    await page.fill('#edit-warmup-seconds', '30');
    await page.fill('#edit-smoke-minutes', '95');
    await page.fill('#edit-smoke-seconds', '15');
    await page.screenshot({ path: path.join(ROOT, 'debug', 'comics-edit-durations.png') });
    await page.click('button[onclick="saveEditedSession()"]');
    await page.waitForFunction(() => document.getElementById('edit-modal').classList.contains('hidden'));
    await page.reload();
    await waitCatalog(page);
    assert.match(await page.textContent('#history-list'), /7 мин 30 сек/);
    assert.match(await page.textContent('#history-list'), /95 мин 15 сек/);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('hookah_sessions'))[0]);
    assert.equal(saved.actualWarmupDuration, 450);
    assert.equal(saved.smokeDuration, 5715);
    assert.equal(saved.placement, '2 + 1', 'legacy data is retained without displaying placement');
    await page.evaluate(() => localStorage.setItem('hookah_active_session', JSON.stringify({
      stage: 'warmup', targetTimestamp: Date.now() + 300000, stepStartTime: Date.now(),
      activeCoalsUsed: 3, mix: [{ brand: 'MUSTHAVE', flavor: 'Earl Grey', weight: 22 }]
    })));
    await page.reload();
    await waitCatalog(page);
    assert.equal(await page.inputValue('#solo-tobacco-weight'), '22', 'active session restores its actual weight');
    await page.selectOption('#solo-tobacco-brand', 'DARKSIDE');
    assert.equal(await page.inputValue('#solo-tobacco-weight'), '22', 'active weight is not cleared');

    const pwa = await browser.newPage();
    await pwa.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
    await pwa.goto(url);
    await waitCatalog(pwa);
    assert.match(await pwa.getAttribute('meta[name="viewport"]', 'content'), /maximum-scale=1.0, user-scalable=no/);
    assert.equal(await pwa.evaluate(() => document.documentElement.classList.contains('is-pwa')), true);
    assert.equal(await pwa.evaluate(() => !document.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, cancelable: true }))), true);
    assert.equal(await pwa.evaluate(() => {
      const event = new Event('touchmove', { cancelable: true });
      Object.defineProperty(event, 'touches', { value: [{}, {}] });
      return !document.dispatchEvent(event);
    }), true);
    assert.equal(await pwa.locator('#solo-tobacco-weight').evaluate(input => getComputedStyle(input).fontSize), '16px');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

async function waitCatalog(page) {
  await page.waitForFunction(
    () => {
      const label = document.getElementById('header-catalog-label');
      return label && /вкус/i.test(label.textContent) && !/Загрузка/.test(label.textContent);
    },
    null,
    { timeout: 30000 }
  );
}

async function optionLabels(page, selector) {
  return page.$$eval(`${selector} option`, (options) =>
    options.slice(1).map((option) => option.textContent.trim())
  );
}

async function optionValues(page, selector) {
  return page.$$eval(`${selector} option`, (options) =>
    options.slice(1).map((option) => option.value)
  );
}

function assertAlphabetical(labels) {
  const sorted = [...labels].sort((a, b) => a.localeCompare(b, 'ru'));
  assert.deepEqual(labels, sorted, `ожидалась алфавитная сортировка: ${labels.join(', ')}`);
}

function assertNoCounts(labels) {
  for (const label of labels) {
    assert.doesNotMatch(label, /\s·\s\d+$/, `в подписи фильтра остался счётчик: ${label}`);
  }
}

test('e2e: навигация PWA, каталог, каскадные фильтры, рулетка, коллекция и трекер', { skip, timeout: 150000 }, async () => {
  const { chromium } = require('playwright');
  const server = createStaticServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: CHROME || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const pageErrors = [];
    const consoleErrors = [];

    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      if (/Failed to load resource|net::ERR|ERR_FAILED/i.test(message.text())) return;
      consoleErrors.push(message.text());
    });

    await page.addInitScript(() => {
      localStorage.setItem('hookah_bowls', JSON.stringify(['E2E Bowl']));
      localStorage.setItem('hookah_custom_bowls_only_v1', '1');
      const now = Date.now();
      const sessions = Array.from({ length: 7 }, (_, index) => ({
        id: now - index,
        date: `0${index + 1}.10.2026`,
        bowl: 'E2E Bowl',
        mix: [{
          brand: 'MUSTHAVE',
          flavor: index === 0 ? 'Earl Grey' : `Old Flavor ${7 - index}`,
          weight: index === 0 ? 25 : 18
        }],
        placement: '2 + 1',
        coalsUsed: 3,
        actualWarmupDuration: 300,
        smokeDuration: 3600,
        rating: index === 0 ? 4.5 : 4,
        sessionCost: 100
      }));
      localStorage.setItem('hookah_sessions', JSON.stringify(sessions));
    });
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitCatalog(page);

    assert.equal(numericText(await page.textContent('#header-catalog-label')), catalog.length);
    assert.equal(await page.locator('.nav-tab').count(), 4);
    assert.equal(await page.isVisible('#setup-form'), true);
    assert.equal(await page.isVisible('#analytics-card'), true);
    assert.equal(await page.locator('#history-list').count(), 1);

    const swState = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return null;
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((resolve) => setTimeout(() => resolve(null), 5000))
      ]);
      if (!registration) return { active: false, caches: [] };
      return { active: Boolean(registration.active), caches: await caches.keys() };
    });
    if (swState) {
      assert.equal(swState.active, true);
      assert.equal(swState.caches.some((name) => name.includes('dimhookah-pwa-v20-polish')), true);
    }

    fs.mkdirSync(path.join(ROOT, 'debug'), { recursive: true });
    await page.screenshot({ path: path.join(ROOT, 'debug', 'e2e-home.png'), fullPage: true });

    assert.equal(await page.locator('#history-list .history-item').count(), 5);
    assert.match(await page.textContent('#history-list .history-more-row'), /Показать ещё 5/);
    assert.equal(await page.locator('#solo-tobacco-brand').inputValue(), 'MUSTHAVE');
    assert.equal(await page.locator('#solo-tobacco-flavor').inputValue(), 'Earl Grey');
    assert.equal(await page.locator('#solo-tobacco-weight').inputValue(), '');

    assert.match(await page.getAttribute('#app-logo', 'src'), /app-icon-v20-192\.png$/);
    assert.equal(await page.getAttribute('#app-manifest', 'href'), 'manifest-light.json');
    await page.evaluate(() => setThemeMode('light'));
    assert.match(await page.getAttribute('#app-logo', 'src'), /app-icon-v20-192\.png$/);
    assert.equal(await page.getAttribute('#app-manifest', 'href'), 'manifest-light.json');
    assert.equal(await page.getAttribute('#app-touch-icon', 'href'), 'assets/icons/app-icon-v20-192.png');
    assert.equal(await page.getAttribute('#theme-color-meta', 'content'), '#f8f5ec');
    await page.evaluate(() => setThemeMode('dark'));
    assert.match(await page.getAttribute('#app-logo', 'src'), /app-icon-v20-192\.png$/);

    await page.fill('#search-input', 'Old Flavor 1');
    await page.waitForFunction(
      () => document.querySelectorAll('#history-list .history-item').length === 1,
      null,
      { timeout: 5000 }
    );
    assert.match(await page.textContent('#history-list .history-item'), /Old Flavor 1/);
    await page.fill('#search-input', '');
    await page.waitForFunction(
      () => document.querySelectorAll('#history-list .history-item').length === 5,
      null,
      { timeout: 5000 }
    );

    // --- Прогрев можно начать до заполнения и менять данные по ходу ---
    const sessionBrands = await page.$$eval('#solo-tobacco-brand option', (options) => options.map((option) => option.textContent.trim()));
    const sessionFlavors = await page.$$eval('#solo-tobacco-flavor option', (options) => options.map((option) => option.textContent.trim()));
    assertAlphabetical(sessionBrands);
    assertAlphabetical(sessionFlavors);
    assert.equal(sessionBrands.includes('__custom__'), false);
    assert.equal(await page.locator('#solo-tobacco-flavor').evaluate((node) => node.tagName), 'SELECT');
    const flavorValues = await page.$$eval('#solo-tobacco-flavor option', (options) => options.map((option) => option.value));
    assert.ok(flavorValues.length > 1, 'в селекте вкуса должен быть список вкусов бренда');
    await page.click('#start-btn');
    await page.waitForSelector('#active-session:not(.hidden)', { timeout: 5000 });
    assert.equal(await page.isVisible('#setup-form'), true);
    await page.selectOption('#solo-tobacco-flavor', flavorValues[1]);
    await page.waitForTimeout(150);
    const activeMixText = (await page.textContent('#active-mix-label')) || '';
    assert.ok(activeMixText.trim().length > 0, 'активная сессия должна обновлять данные из формы');
    assert.equal((await page.textContent('#start-btn')).trim(), '💾 Сохранить');
    assert.equal(await page.isDisabled('#start-btn'), false);
    await page.screenshot({ path: path.join(ROOT, 'debug', 'e2e-active.png'), fullPage: true });
    await page.click('#start-btn');
    await page.waitForFunction(
      () => (document.getElementById('start-btn')?.textContent || '').includes('Сессия идёт'),
      null,
      { timeout: 5000 }
    );

    await page.click('button[onclick="startSmokingFromWarmup()"]');
    await page.waitForSelector('#smoking-controls:not(.hidden)', { timeout: 5000 });
    await page.click('button[onclick="finishSmokingSession()"]');
    await page.waitForSelector('#rating-form:not(.hidden)', { timeout: 5000 });
    await page.evaluate(() => setCurrentRating(4.5));
    assert.equal(await page.textContent('#rating-value'), '4.5');
    await page.click('button[onclick="saveCompletedSession()"]');
    await page.waitForSelector('#active-session.hidden', { state: 'attached', timeout: 5000 });
    await page.waitForFunction(
      (flavor) => (document.getElementById('history-list')?.textContent || '').includes(flavor),
      flavorValues[1],
      { timeout: 5000 }
    );
    const playbackState = await page.evaluate(() => 'mediaSession' in navigator ? navigator.mediaSession.playbackState : 'unsupported');
    if (playbackState !== 'unsupported') assert.equal(playbackState, 'none');

    assert.equal(await page.locator('#history-list .history-item').count(), 5);
    assert.match(await page.textContent('#history-list .history-more-row'), /Показать ещё 5/);
    await page.click('#history-list .history-more-row button');
    assert.equal(await page.locator('#history-list .history-item').count(), 8);
    assert.equal(await page.locator('#mode-toggle-btn').count(), 0);
    await page.click('.add-tobacco-btn');
    await page.waitForSelector('#mix-container:not(.hidden)', { timeout: 5000 });
    assert.equal(await page.locator('#mix-rows-list .tobacco-card-box').count(), 2);

    // --- Каскадные фильтры ---
    await page.click('#tab-roulette');
    await page.waitForSelector('#roulette-window', { state: 'visible' });

    const brandCase = findBrandWithoutCategory();
    assert.ok(brandCase, 'не найден бренд без одного из направлений');

    const initialBrandLabels = await optionLabels(page, '#roulette-brand');
    const initialCategoryLabels = await optionLabels(page, '#roulette-category');
    assertAlphabetical(initialBrandLabels);
    assertNoCounts(initialBrandLabels);
    assertAlphabetical(initialCategoryLabels);
    assertNoCounts(initialCategoryLabels);

    await page.selectOption('#roulette-brand', brandCase.brand);
    await page.waitForFunction(
      (missing) =>
        ![...document.querySelectorAll('#roulette-category option')].some((option) => option.value === missing),
      brandCase.missing,
      { timeout: 5000 }
    );

    const categoryLabels = await optionLabels(page, '#roulette-category');
    const categoryValues = await optionValues(page, '#roulette-category');
    assertAlphabetical(categoryLabels);
    assertNoCounts(categoryLabels);
    assert.equal(categoryValues.includes(brandCase.missing), false, `у ${brandCase.brand} не должно быть «${brandCase.missing}»`);

    const chosenCategory = categoryValues.find((value) => value !== 'all' && value !== '__none__');
    assert.ok(chosenCategory);
    await page.selectOption('#roulette-category', chosenCategory);
    await page.waitForFunction(
      (expected) => {
        const text = document.getElementById('roulette-available')?.textContent || '';
        return Number(text.replace(/[^\d]/g, '')) === expected;
      },
      countFor(brandCase.brand, chosenCategory),
      { timeout: 5000 }
    );

    const expectedCount = countFor(brandCase.brand, chosenCategory);
    assert.equal(numericText(await page.textContent('#roulette-available')), expectedCount);
    assert.equal(expectedCount > 0, true);

    const strengthLabels = await optionLabels(page, '#roulette-strength');
    const ratingLabels = await optionLabels(page, '#roulette-rating');
    assertAlphabetical(strengthLabels);
    assertNoCounts(strengthLabels);
    assertAlphabetical(ratingLabels);
    assertNoCounts(ratingLabels);

    await page.selectOption('#roulette-brand', 'all');
    await page.selectOption('#roulette-category', 'all');
    await page.selectOption('#roulette-strength', 'all');
    await page.selectOption('#roulette-rating', 'all');

    // --- Полная рулетка на 5 секунд ---
    await page.evaluate(() => {
      const fast = document.getElementById('roulette-fast');
      if (fast.checked) {
        fast.checked = false;
        fast.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await page.selectOption('#roulette-brand', 'MUSTHAVE');

    const fullStart = Date.now();
    await page.click('#roulette-spin');
    await page.waitForSelector('#roulette-result.is-visible', { timeout: 12000 });
    const fullElapsed = Date.now() - fullStart;
    assert.ok(fullElapsed >= 4500 && fullElapsed <= 7200, `полная рулетка заняла ${fullElapsed} мс`);

    const resultText = await page.textContent('#roulette-result');
    assert.match(resultText, /MUSTHAVE/);
    const winnerSlug = await page.getAttribute('.reel-card.is-winner', 'data-slug');
    assert.ok(winnerSlug, 'должна быть карточка-победитель');
    const resultLink = await page.getAttribute('#roulette-result a[target="_blank"]', 'href');
    assert.ok(resultLink && resultLink.endsWith(`/${winnerSlug}`), `${resultLink} не заканчивается на /${winnerSlug}`);

    await page.screenshot({ path: path.join(ROOT, 'debug', 'e2e-roulette.png'), fullPage: true });

    const resultBrand = ((await page.textContent('#roulette-result .result-kicker')) || '').split('·')[0].trim();
    const resultName = (await page.textContent('#roulette-result .result-name') || '').trim();
    await page.evaluate(({ brand, name }) => {
      window.DimHookahHistory = { sessions: [{ mix: [{ brand, flavor: name }] }] };
      window.dispatchEvent(new CustomEvent('dimhookah:history-ready'));
    }, { brand: resultBrand, name: resultName });
    await page.waitForSelector('#roulette-result .chip-history', { timeout: 5000 });
    assert.match(await page.textContent('#roulette-result .chip-history'), /истори/i);

    await page.click('#roulette-wish');
    await page.waitForFunction(
      () => document.querySelector('#roulette-wish')?.textContent.includes('В коллекции'),
      null,
      { timeout: 5000 }
    );
    assert.equal(await page.locator('#roulette-result .chip-state.chip-wish').count(), 1);
    assert.equal(numericText(await page.textContent('#user-collection')), 1);
    assert.equal(await page.locator('#collection-list .collection-item').count(), 1);
    await page.screenshot({ path: path.join(ROOT, 'debug', 'e2e-roulette-result.png'), fullPage: true });

    await page.click('#tab-collection');
    await page.click('#collection-list [data-collection-action="fill"]');
    await page.waitForFunction(
      () => document.getElementById('panel-home')?.classList.contains('is-active'),
      null,
      { timeout: 5000 }
    );
    assert.equal(await page.locator('#solo-tobacco-brand').inputValue(), resultBrand);
    assert.equal(await page.locator('#solo-tobacco-flavor').inputValue(), resultName);
    await page.click('#tab-roulette');
    await page.waitForSelector('#roulette-window', { state: 'visible' });

    // --- Быстрый выбор ---
    await page.evaluate(() => {
      const fast = document.getElementById('roulette-fast');
      if (!fast.checked) {
        fast.checked = true;
        fast.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await page.selectOption('#roulette-brand', 'MUSTHAVE');
    await page.selectOption('#roulette-strength', 'Средняя');

    const quickStart = Date.now();
    await page.click('#roulette-spin');
    await page.waitForSelector('#roulette-result.is-visible', { timeout: 5000 });
    const quickElapsed = Date.now() - quickStart;
    assert.ok(quickElapsed < 1500, `быстрый выбор занял ${quickElapsed} мс`);
    const quickText = await page.textContent('#roulette-result');
    assert.match(quickText, /MUSTHAVE/);
    assert.match(quickText, /Средняя/);

    const beforeDuplicate = await page.evaluate(() => window.DimHookahUI.getState().collection.length);
    await page.evaluate(() => window.DimHookahUI.addWinnerToCollection());
    const afterFirst = await page.evaluate(() => window.DimHookahUI.getState().collection.length);
    await page.evaluate(() => window.DimHookahUI.addWinnerToCollection());
    const afterSecond = await page.evaluate(() => window.DimHookahUI.getState().collection.length);
    assert.ok(afterFirst === beforeDuplicate || afterFirst === beforeDuplicate + 1);
    assert.equal(afterSecond, afterFirst, 'повторное добавление не должно создавать дубликат');

    // --- Коллекция и сохранение после перезагрузки ---
    await page.click('#tab-collection');
    const collectionCount = await page.locator('#collection-list .collection-item').count();
    assert.ok(collectionCount >= 1);
    await page.click('#collection-list .collection-item [data-collection-action="tried"]');
    await page.waitForSelector('#collection-list .collection-item.is-tried', { timeout: 5000 });
    await page.screenshot({ path: path.join(ROOT, 'debug', 'e2e-collection.png'), fullPage: true });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitCatalog(page);
    await page.click('#tab-roulette');
    await page.click('#tab-collection');
    await page.waitForSelector('#collection-list .collection-item', { timeout: 5000 });
    assert.equal(await page.locator('#collection-list .collection-item').count(), collectionCount);
    assert.equal(await page.locator('#collection-list .collection-item.is-tried').count() > 0, true);
    assert.equal(await page.evaluate(() => localStorage.getItem('hookah_roulette_fast')), '1');
    assert.equal(await page.evaluate(() => document.getElementById('roulette-fast')?.checked), true);

    while ((await page.locator('#collection-list .collection-item').count()) > 0) {
      await page.click('#collection-list .collection-item [data-collection-action="remove"]');
      await page.waitForTimeout(100);
    }
    await page.waitForSelector('#collection-empty:not(.hidden)', { timeout: 5000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitCatalog(page);
    await page.click('#tab-roulette');
    await page.click('#tab-collection');
    await page.waitForSelector('#collection-empty:not(.hidden)', { timeout: 5000 });
    assert.equal(await page.locator('#collection-list .collection-item').count(), 0);

    // --- Действия в приложении и трекер на главной ---
    assert.ok(Number(await page.textContent('#user-spins')) >= 2);
    assert.equal(numericText(await page.textContent('#user-collection')), 0);

    await page.click('#clear-user-stats');
    await page.waitForSelector('#confirm-modal:not(.hidden)', { timeout: 5000 });
    await page.click('#confirm-ok-btn');
    await page.waitForTimeout(250);
    assert.equal(numericText(await page.textContent('#user-spins')), 0);
    assert.equal(numericText(await page.textContent('#user-collection')), 0);

    await page.click('#tab-home');
    await page.waitForSelector('#setup-form', { state: 'visible' });
    assert.equal(await page.isVisible('#start-btn'), true);
    assert.equal(await page.isVisible('#setup-step-3'), true);
    assert.equal(await page.locator('#toggle-all-steps-btn').count(), 0);
    assert.equal(await page.locator('#solo-tobacco-flavor option').count() > 0, true);
    await page.evaluate(() => setCurrentRating(4.5));
    assert.equal(await page.textContent('#rating-value'), '4.5');
    assert.equal(await page.locator('.star.half').count(), 1);
    await page.evaluate(() => setCurrentRating(0));
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(ROOT, 'debug', 'e2e-session.png'), fullPage: true });

    await page.click('button[onclick="openManualAddModal()"]');
    await page.waitForFunction(
      () => !document.getElementById('manual-add-modal')?.classList.contains('hidden'),
      null,
      { timeout: 5000 }
    );
    await page.click('#manual-add-modal .btn-secondary');
    await page.waitForFunction(
      () => document.getElementById('manual-add-modal')?.classList.contains('hidden'),
      null,
      { timeout: 5000 }
    );

    // --- Мобильная адаптивность ---
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    await page.evaluate(() => window.scrollTo(0, 400));
    assert.equal(await page.evaluate(() => window.scrollY > 0), true, 'вертикальный скролл должен работать');
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
      false,
      'на главной есть горизонтальное переполнение'
    );

    await page.click('#tab-roulette');
    await page.waitForTimeout(200);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
      false,
      'на рулетке есть горизонтальное переполнение'
    );
    await page.screenshot({ path: path.join(ROOT, 'debug', 'e2e-mobile.png'), fullPage: true });

    // Catalog search, pagination, original images, details and persistent saves.
    await page.click('#tab-catalog');
    assert.equal(await page.locator('#catalog-products .product-card').count(), 24);
    await page.click('#catalog-more');
    assert.equal(await page.locator('#catalog-products .product-card').count(), 48);
    await page.fill('#catalog-search', 'Pinkman');
    assert.ok(await page.locator('#catalog-products .product-card').count() > 0);
    await page.selectOption('#catalog-brand', 'MUSTHAVE');
    const expectedImage = catalog.find(item => item.brand === 'MUSTHAVE' && item.name === 'Pinkman').image_url;
    assert.equal(await page.locator('#catalog-products .comic-photo img').first().getAttribute('src'), expectedImage);
    await page.locator('#catalog-products .product-open').first().click();
    await page.waitForSelector('#product-detail[open]');
    await page.click('#product-detail .btn-primary');
    await page.click('#product-detail .detail-close');
    assert.equal(await page.locator('#catalog-products .product-save').first().getAttribute('aria-pressed'), 'true');
    await page.fill('#catalog-search', 'this-flavor-does-not-exist-123');
    assert.match(await page.textContent('#catalog-products'), /Ничего не найдено/);
    await page.click('#tab-collection');
    assert.equal(await page.locator('#collection-list .collection-item').count(), 1);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitCatalog(page);
    assert.equal(await page.locator('#collection-list .collection-item').count(), 1);
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => setThemeMode(theme), theme);
        for (const tab of ['home', 'catalog', 'roulette', 'collection']) {
          await page.click(`#tab-${tab}`);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${theme}/${tab}: overflow at ${width}px`);
          if (tab === 'home') {
            assert.deepEqual(await page.locator('.pack-field input').evaluateAll(inputs => inputs.filter(input => input.checkVisibility()).flatMap(input => {
              const field = input.closest('.pack-field').getBoundingClientRect();
              const rect = input.getBoundingClientRect();
              return rect.left < field.left + 8 || rect.right > field.right - 8 ? [input.id || input.className] : [];
            })), [], `pack fields must keep inner padding at ${width}px`);
            assert.equal(await page.locator('.btn-buy-coal').evaluate(button => getComputedStyle(button).color), 'rgb(23, 23, 25)');
          }
        }
      }
    }
    assert.deepEqual(pageErrors, [], `ошибки страницы: ${pageErrors.join('; ')}`);
    assert.deepEqual(consoleErrors, [], `ошибки консоли: ${consoleErrors.join('; ')}`);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
