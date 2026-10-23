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

function isLimited(item) {
  return item.limited === true || Number(item.status_id) === 2 || /лимит/i.test(String(item.status || ''));
}

function groupsOf(item) {
  const groups = new Set(Array.isArray(item.taste_groups) ? item.taste_groups : []);
  for (const tag of Array.isArray(item.tags) ? item.tags : []) {
    if (tag && typeof tag === 'object' && tag.group) groups.add(tag.group);
  }
  return [...groups];
}

function expectedStats() {
  const active = catalog.filter((item) => !isDiscontinued(item));
  return {
    total: catalog.length,
    brands: new Set(catalog.map((item) => item.brand_slug || item.brand)).size,
    active: active.length,
    limited: catalog.filter(isLimited).length,
    withStrength: catalog.filter((item) => String(item.strength || '').trim()).length,
    withImage: catalog.filter((item) => String(item.image_url || '').trim()).length
  };
}

function findImpossibleFilter() {
  const active = catalog.filter((item) => !isDiscontinued(item));
  const brands = [...new Set(active.map((item) => item.brand))];
  const categories = [...new Set(active.flatMap(groupsOf))];
  for (const brand of brands) {
    for (const category of categories) {
      const matches = active.some((item) => item.brand === brand && groupsOf(item).includes(category));
      if (!matches) return { brand, category };
    }
  }
  return null;
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

test('e2e: рулетка, быстрый выбор, коллекция, статистика и PWA-каталог', { skip, timeout: 120000 }, async () => {
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

    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(
      () => {
        const label = document.getElementById('header-catalog-label');
        return label && /вкус/i.test(label.textContent) && !/Загрузка/.test(label.textContent);
      },
      null,
      { timeout: 30000 }
    );

    const stats = expectedStats();
    assert.equal(numericText(await page.textContent('#home-stat-total')), stats.total);
    assert.equal(numericText(await page.textContent('#home-stat-brands')), stats.brands);
    assert.equal(numericText(await page.textContent('#home-stat-active')), stats.active);
    assert.equal(numericText(await page.textContent('#home-stat-limited')), stats.limited);
    assert.equal(numericText(await page.textContent('#home-stat-strength')), stats.withStrength);
    assert.equal(numericText(await page.textContent('#home-stat-images')), stats.withImage);

    const tabCount = await page.locator('.nav-tab').count();
    assert.equal(tabCount, 5);

    fs.mkdirSync(path.join(ROOT, 'debug'), { recursive: true });
    await page.screenshot({ path: path.join(ROOT, 'debug', 'e2e-home.png'), fullPage: true });

    // --- Рулетка: полный цикл на 5 секунд ---
    await page.click('#tab-roulette');
    await page.waitForSelector('#roulette-window', { state: 'visible' });
    await page.evaluate(() => {
      const fast = document.getElementById('roulette-fast');
      if (fast.checked) {
        fast.checked = false;
        fast.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await page.selectOption('#roulette-brand', 'MUSTHAVE');
    await page.waitForFunction(
      () => {
        const text = document.getElementById('roulette-available')?.textContent || '';
        const value = Number(text.replace(/[^\d]/g, ''));
        return value > 0;
      },
      null,
      { timeout: 10000 }
    );

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
    assert.equal(await page.locator('#roulette-result').isVisible(), true);

    await page.screenshot({ path: path.join(ROOT, 'debug', 'e2e-roulette.png'), fullPage: true });

    await page.click('#roulette-wish');
    await page.waitForFunction(
      () => document.querySelector('#roulette-wish')?.textContent.includes('В коллекции'),
      null,
      { timeout: 5000 }
    );
    assert.equal(numericText(await page.textContent('#nav-collection-count')), 1);

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

    // --- Фильтры без результатов ---
    const impossible = findImpossibleFilter();
    assert.ok(impossible, 'не найден пример несовместимых фильтров');
    await page.selectOption('#roulette-brand', impossible.brand);
    await page.selectOption('#roulette-category', impossible.category);
    await page.waitForSelector('#roulette-empty:not(.hidden)', { timeout: 5000 });
    assert.equal(await page.isDisabled('#roulette-spin'), true);
    await page.selectOption('#roulette-brand', 'all');
    await page.selectOption('#roulette-category', 'all');
    await page.waitForFunction(
      () => document.getElementById('roulette-empty')?.classList.contains('hidden'),
      null,
      { timeout: 5000 }
    );

    // --- Коллекция и сохранение после перезагрузки ---
    await page.click('#tab-collection');
    await page.waitForSelector('#collection-list .collection-item', { timeout: 5000 });
    const collectionCount = await page.locator('#collection-list .collection-item').count();
    assert.ok(collectionCount >= 1);
    assert.equal(numericText(await page.textContent('#nav-collection-count')), collectionCount);

    await page.click('#collection-list .collection-item [data-collection-action="tried"]');
    await page.waitForSelector('#collection-list .collection-item.is-tried', { timeout: 5000 });
    await page.screenshot({ path: path.join(ROOT, 'debug', 'e2e-collection.png'), fullPage: true });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => {
        const label = document.getElementById('header-catalog-label');
        return label && /вкус/i.test(label.textContent) && !/Загрузка/.test(label.textContent);
      },
      null,
      { timeout: 30000 }
    );
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
    await page.waitForFunction(
      () => {
        const label = document.getElementById('header-catalog-label');
        return label && /вкус/i.test(label.textContent) && !/Загрузка/.test(label.textContent);
      },
      null,
      { timeout: 30000 }
    );
    await page.click('#tab-collection');
    await page.waitForSelector('#collection-empty:not(.hidden)', { timeout: 5000 });
    assert.equal(await page.locator('#collection-list .collection-item').count(), 0);

    // --- Статистика ---
    await page.click('#tab-stats');
    await page.waitForSelector('#stats-brands .bar-row', { timeout: 5000 });
    assert.ok((await page.locator('#stats-brands .bar-row').count()) > 0);
    assert.ok((await page.locator('#stats-strengths .bar-row').count()) > 0);
    assert.ok((await page.locator('#stats-categories .bar-row').count()) > 0);
    const statusText = await page.textContent('#stats-statuses');
    assert.match(statusText, /Снят с производства/);
    assert.ok(Number(await page.textContent('#user-spins')) >= 2);
    assert.equal(numericText(await page.textContent('#user-collection')), 0);
    await page.screenshot({ path: path.join(ROOT, 'debug', 'e2e-stats.png'), fullPage: true });

    // --- Старый трекер сессий остаётся рабочим ---
    await page.click('#tab-session');
    await page.waitForSelector('#setup-form', { state: 'visible' });
    assert.equal(await page.isVisible('#start-btn'), true);
    await page.click('#toggle-all-steps-btn');
    await page.waitForSelector('#setup-step-3.step-visible', { timeout: 5000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(ROOT, 'debug', 'e2e-session.png'), fullPage: true });

    await page.click('#tab-stats');
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

    // --- Мобильная адаптивность и отсутствие горизонтального переполнения ---
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('#tab-home');
    await page.waitForTimeout(200);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
      false,
      'на главной есть горизонтальное переполнение'
    );

    await page.click('#tab-roulette');
    await page.evaluate(() => {
      const fast = document.getElementById('roulette-fast');
      if (!fast.checked) {
        fast.checked = true;
        fast.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await page.selectOption('#roulette-brand', 'all');
    await page.selectOption('#roulette-strength', 'all');
    await page.selectOption('#roulette-category', 'all');
    await page.click('#roulette-spin');
    await page.waitForSelector('#roulette-result.is-visible', { timeout: 5000 });
    await page.waitForTimeout(200);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
      false,
      'на рулетке есть горизонтальное переполнение'
    );
    await page.screenshot({ path: path.join(ROOT, 'debug', 'e2e-mobile.png'), fullPage: true });

    assert.deepEqual(pageErrors, [], `ошибки страницы: ${pageErrors.join('; ')}`);
    assert.deepEqual(consoleErrors, [], `ошибки консоли: ${consoleErrors.join('; ')}`);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
