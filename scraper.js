
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const TARGET_URL = 'https://htreviews.org/tobaccos';
const OUTPUT_FILE = path.join(__dirname, 'flavors.json');
const DEBUG_FILE = path.join(__dirname, 'htreviews-debug.html');

const MIN_RATING = 0; // 0 = сохранять все рейтинги
const MAX_PAGES = 100;
const PAGE_DELAY_MS = 1200;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalize(value = '') {
    return String(value).replace(/\s+/g, ' ').trim();
}

function keyOf(item) {
    return `${normalize(item.brand).toLowerCase()}::${normalize(item.name).toLowerCase()}`;
}

function parseJsonFile() {
    if (!fs.existsSync(OUTPUT_FILE)) return [];

    try {
        const data = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));

        if (!Array.isArray(data)) {
            throw new Error('В корне flavors.json должен быть массив.');
        }

        return data;
    } catch (error) {
        throw new Error(`Не удалось прочитать flavors.json: ${error.message}`);
    }
}

async function extractPage(page) {
    return page.evaluate(() => {
        const clean = value =>
            (value || '').replace(/\s+/g, ' ').trim();

        const anchors = [...document.querySelectorAll('a[href]')];

        // Ищем ссылки на вкусы и анализируем их ближайшие контейнеры.
        // Селекторы карточек здесь намеренно не предполагаются заранее.
        const results = [];
        const seen = new Set();

        for (const anchor of anchors) {
            const name = clean(anchor.innerText);

            if (!name || name.length > 120) continue;
            if (!anchor.querySelector('img') && name.length < 2) continue;

            let node = anchor;
            let best = null;

            for (let level = 0; level < 7 && node; level++, node = node.parentElement) {
                const text = clean(node.innerText);

                if (text.length > 1500) break;

                const links = [...node.querySelectorAll('a[href]')];
                const distinctLinks = [...new Map(
                    links.map(a => [
                        a.href,
                        { text: clean(a.innerText), href: a.href }
                    ])
                ).values()].filter(a => a.text);

                const hasOtherLinks = distinctLinks.some(a =>
                    a.href !== anchor.href && a.text !== name
                );

                const hasRating = /\b[0-5][.,]\d+\b/.test(text);

                if (hasOtherLinks && hasRating) {
                    best = {
                        text,
                        links: distinctLinks,
                        html: node.innerHTML
                    };
                    break;
                }
            }

            if (!best) continue;

            const key = anchor.href;
            if (seen.has(key)) continue;
            seen.add(key);

            results.push({
                name,
                url: anchor.href,
                containerText: best.text,
                links: best.links,
                html: best.html
            });
        }

        return {
            title: document.title,
            url: location.href,
            results
        };
    });
}

function convertCandidate(candidate) {
    const links = candidate.links || [];

    // Первую ссылку считаем названием вкуса, ищем бренд и линейку
    // среди соседних ссылок. Эти эвристики надо сверить с HTML.
    const otherLinks = links.filter(link => link.href !== candidate.url);

    const ratingMatch = candidate.containerText.match(
        /(?:^|\s)([0-5](?:[.,]\d+)?)(?=\s|$)/
    );

    const rating = ratingMatch
        ? Number(ratingMatch[1].replace(',', '.'))
        : null;

    if (!candidate.name || !otherLinks.length) return null;
    if (rating === null || !Number.isFinite(rating)) return null;
    if (rating < MIN_RATING || rating > 5) return null;

    return {
        brand: otherLinks[0].text,
        name: candidate.name,
        category: 'Популярное',
        rating,
        reviews_count: null,
        description: 'Источник: HTReviews',
        source_url: candidate.url,
        collection: otherLinks[1]?.text || null
    };
}

async function scrape() {
    let browser;

    try {
        console.log('Запуск Puppeteer...');

        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1440, height: 1000 });

        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
            'AppleWebKit/537.36 (KHTML, like Gecko) ' +
            'Chrome/131.0.0.0 Safari/537.36'
        );

        const existing = parseJsonFile();
        const merged = new Map(existing.map(item => [keyOf(item), item]));

        let totalFound = 0;
        let totalAdded = 0;
        let firstPageDebugSaved = false;

        for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
            // Пагинация пока не предполагается: URL второй страницы
            // нельзя надёжно угадать без проверки сайта.
            if (pageNumber > 1) break;

            console.log(`Открываем ${TARGET_URL}`);

            const response = await page.goto(TARGET_URL, {
                waitUntil: 'domcontentloaded',
                timeout: 60000
            });

            if (!response || !response.ok()) {
                throw new Error(
                    `HTTP-ответ: ${response?.status() ?? 'нет ответа'}`
                );
            }

            await sleep(2500);

            const extracted = await extractPage(page);

            console.log('Заголовок:', extracted.title);
            console.log('Текущий URL:', extracted.url);
            console.log('Найдено кандидатов:', extracted.results.length);

            if (!firstPageDebugSaved) {
                fs.writeFileSync(
                    DEBUG_FILE,
                    await page.content(),
                    'utf8'
                );
                firstPageDebugSaved = true;
            }

            if (extracted.results.length === 0) {
                console.warn(
                    'Не удалось найти карточки. Существующая база не изменена.'
                );
                console.warn('HTML для диагностики:', DEBUG_FILE);
                return;
            }

            totalFound += extracted.results.length;

            for (const candidate of extracted.results) {
                const item = convertCandidate(candidate);

                if (!item) continue;

                const key = keyOf(item);
                const previous = merged.get(key);

                if (!previous) {
                    merged.set(key, item);
                    totalAdded++;
                } else {
                    // Сохраняем существующие дополнительные поля.
                    // Обновляем только поля, которые извлекли достоверно.
                    merged.set(key, {
                        ...previous,
                        ...item,
                        reviews_count:
                            item.reviews_count ?? previous.reviews_count ?? null
                    });
                }
            }

            await sleep(PAGE_DELAY_MS);
        }

        if (totalFound === 0) {
            console.warn('Новых данных нет, файл оставлен без изменений.');
            return;
        }

        const finalData = [...merged.values()].sort(
            (a, b) => (b.rating ?? -1) - (a.rating ?? -1)
        );

        // Сначала записываем временный файл, затем заменяем основной.
        const tempFile = `${OUTPUT_FILE}.tmp`;

        fs.writeFileSync(
            tempFile,
            JSON.stringify(finalData, null, 2),
            'utf8'
        );

        fs.renameSync(tempFile, OUTPUT_FILE);

        console.log('Готово!');
        console.log('Кандидатов найдено:', totalFound);
        console.log('Новых записей:', totalAdded);
        console.log('Всего записей в базе:', finalData.length);
        console.log('Файл:', OUTPUT_FILE);
    } catch (error) {
        console.error('Ошибка парсера:', error.message);
        process.exitCode = 1;
    } finally {
        if (browser) await browser.close();
    }
}

scrape();
