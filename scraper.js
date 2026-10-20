const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const TARGET_URL = 'https://htreviews.org/tobaccos';
const filePath = path.join(__dirname, 'flavors.json');

// Словарь каноничных брендов и мусорных подстрок для очистки
const CANONICAL_BRANDS = [
    { canon: 'Darkside', aliases: ['darkside', 'дарксайд', 'dark side'] },
    { canon: 'Musthave', aliases: ['musthave', 'must have', 'мастхэв'] },
    { canon: 'Blackburn', aliases: ['blackburn', 'блэкберн', 'black burn', 'burn'] },
    { canon: 'Deus', aliases: ['deus', 'деус'] },
    { canon: 'Северный', aliases: ['северный', 'severnyj', 'severny'] },
    { canon: 'Наш', aliases: ['наш', 'nash'] },
    { canon: 'Element', aliases: ['element', 'элемент'] },
    { canon: 'Bonche', aliases: ['bonche', 'бонче'] },
    { canon: 'Tangiers', aliases: ['tangiers', 'танж'] },
    { canon: 'Overdose', aliases: ['overdose', 'овердоз'] },
    { canon: 'Satyr', aliases: ['satyr', 'сатир'] },
    { canon: 'Spectrum', aliases: ['spectrum', 'спектрум'] },
    { canon: 'Sebero', aliases: ['sebero', 'себеро'] },
    { canon: 'Chabacco', aliases: ['chabacco', 'чабакко'] },
    { canon: 'Dogma', aliases: ['dogma', 'догма'] },
    { canon: 'Banger', aliases: ['banger', 'бэнгер'] },
    { canon: 'Trofimoff', aliases: ['trofimoff', 'трофимов'] },
    { canon: 'Starline', aliases: ['starline', 'старлайн'] },
    { canon: 'Сарма', aliases: ['сарма', 'sarma'] },
    { canon: 'Chupa', aliases: ['chupa', 'чупа'] }
];

function normalizeBrand(rawBrand, rawName) {
    const combined = `${rawBrand} ${rawName}`.toLowerCase();
    for (const b of CANONICAL_BRANDS) {
        for (const alias of b.aliases) {
            if (combined.includes(alias)) {
                return b.canon;
            }
        }
    }
    // Если бренд не распознан, аккуратно очищаем сырой
    return rawBrand.replace(/(tobacco|табак|линейка|line|core|rare|shot)/gi, '').trim() || 'Custom';
}

function cleanFlavorName(rawName, brand) {
    let clean = rawName;
    // Убираем имя бренда из названия вкуса, если ChatGPT их склеил
    const regBrand = new RegExp(`^${brand}\\s*[-/]?\\s*`, 'i');
    clean = clean.replace(regBrand, '');
    // Убираем пометки граммовок и крепости в скобках: (25г), (Medium)
    clean = clean.replace(/\(\d+\s*г\)/gi, '');
    clean = clean.replace(/\((rare\vert{}core\vert{}base\vert{}strong\vert{}medium\vert{}shot)\)/gi, '');
    return clean.trim();
}

async function scrapeWithPuppeteer() {
    console.log('🕷️ Запуск чистого парсера HTReviews...');

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

        console.log('🌐 Загрузка каталога...');
        await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });

        // Автоскролл страницы вниз для подгрузки динамических элементов
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 400;
                const timer = setInterval(() => {
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if (totalHeight >= 2400) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 200);
            });
        });

        const rawData = await page.evaluate(() => {
            const results = [];
            // Ищем карточки и ссылки каталога
            const elements = document.querySelectorAll('a[href*="/tobaccos/"], div[class*="tobacco-card"], div[class*="item"]');

            elements.forEach(el => {
                const text = el.innerText || '';
                const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

                // Извлекаем рейтинг (число с точкой 4.x)
                const ratingMatch = text.match(/([4-5]\.[0-9])/);
                const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 4.5;

                if (lines.length >= 2) {
                    results.push({
                        line0: lines[0],
                        line1: lines[1],
                        line2: lines[2] || '',
                        rating
                    });
                }
            });
            return results;
        });

        console.log(`🔍 Собрано сырых блоков: ${rawData.length}`);

        // Загружаем существующую базу
        let existingFlavors = [];
        if (fs.existsSync(filePath)) {
            try {
                existingFlavors = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            } catch (e) {
                existingFlavors = [];
            }
        }

        const cleanedBatch = [];
        for (const item of rawData) {
            // Анализируем структуру строк
            let rawBrand = item.line0;
            let rawName = item.line1;

            const brand = normalizeBrand(rawBrand, rawName);
            const name = cleanFlavorName(rawName, brand);

            if (name.length > 2 && item.rating >= 4.0) {
                cleanedBatch.push({
                    brand,
                    name,
                    category: "Популярное",
                    rating: item.rating,
                    reviews_count: 120,
                    description: `Топовый вкус от ${brand} с рейтингом ${item.rating} на HTReviews.`
                });
            }
        }

        // Объединяем со старой базой с удалением дубликатов и чисткой
        const map = new Map();

        // Сначала нормализуем то, что уже было в базе (лечим старые косяки)
        existingFlavors.forEach(f => {
            const normBrand = normalizeBrand(f.brand || '', f.name || '');
            const normName = cleanFlavorName(f.name || '', normBrand);
            if (normName.length > 1) {
                const key = `${normBrand.toLowerCase()}:::${normName.toLowerCase()}`;
                map.set(key, { ...f, brand: normBrand, name: normName });
            }
        });

        // Накатываем новые спарсенные позиции
        cleanedBatch.forEach(f => {
            const key = `${f.brand.toLowerCase()}:::${f.name.toLowerCase()}`;
            if (!map.has(key) || f.rating >= map.get(key).rating) {
                map.set(key, f);
            }
        });

        const finalFlavors = Array.from(map.values())
            .filter(f => f.brand !== 'Custom' && f.name.length >= 3)
            .sort((a, b) => b.rating - a.rating);

        fs.writeFileSync(filePath, JSON.stringify(finalFlavors, null, 2), 'utf8');
        console.log(`✅ База успешно вычищена и обновлена! Реальных чистых табаков: ${finalFlavors.length}`);

    } catch (err) {
        console.error('❌ Ошибка парсера:', err);
    } finally {
        await browser.close();
    }
}

scrapeWithPuppeteer();