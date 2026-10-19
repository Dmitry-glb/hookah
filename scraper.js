const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const TARGET_URL = 'https://htreviews.org/tobaccos';
const filePath = path.join(__dirname, 'flavors.json');

async function scrapeWithPuppeteer() {
    console.log('🕷️ Запуск реального браузера (Puppeteer)...');

    // Запускаем видимый или скрытый браузер на твоем ПК
    const browser = await puppeteer.launch({
        headless: true, // true — браузер работает в фоне без окна
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();

        // Маскируемся под нормального пользователя
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        console.لog('🌐 Переходим на страницу HTReviews...');
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Ждем, пока подгрузятся карточки (имитируем скролл, если нужно)
        console.log('⏳ Ждем прогрузки элементов...');
        await new Promise(r => setTimeout(r, 4000));

        // Вытаскиваем данные прямо из DOM страницы с помощью браузера
        const scrapedFlavors = await page.evaluate(() => {
            const items = [];
            // Ищем карточки по типичным селекторам каталогов
            const cards = document.querySelectorAll('.tobacco-card, .item-card, article, div[class*="card"]');

            cards.forEach(card => {
                const brandEl = card.querySelector('.brand-name, .item-brand, [class*="brand"]');
                const nameEl = card.querySelector('.tobacco-name, .item-title, [class*="title"], [class*="name"]');
                const ratingEl = card.querySelector('.rating-value, .badge-rating, [class*="rating"]');

                if (brandEl && nameEl) {
                    const brand = brandEl.innerText.trim();
                    const name = nameEl.innerText.trim();
                    const ratingStr = ratingEl ? ratingEl.innerText.trim().replace(',', '.') : '4.5';
                    const rating = parseFloat(ratingStr) || 4.5;

                    if (brand && name && rating >= 4.0) {
                        items.push({
                            brand,
                            name,
                            category: 'Популярное',
                            rating,
                            reviews_count: 100,
                            description: 'Спарсено с HTReviews через Puppeteer.'
                        });
                    }
                }
            });

            return items;
        });

        console.log(`🔍 Найдено позиций на странице: ${scrapedFlavors.length}`);

        let existingFlavors = [];
        if (fs.existsSync(filePath)) {
            existingFlavors = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }

        if (scrapedFlavors.length === 0) {
            console.warn('⚠️ Браузер не нашел карточки. Возможно, изменились классы на сайте.');
            await browser.close();
            return;
        }

        // Объединяем со старой базой без дубликатов
        const map = new Map();
        [...existingFlavors, ...scrapedFlavors].forEach(item => {
            const key = `${item.brand.toLowerCase()}_${item.name.toLowerCase()}`;
            if (!map.has(key) || item.rating >= map.get(key).rating) {
                map.set(key, item);
            }
        });

        const finalFlavors = Array.from(map.values()).sort((a, b) => b.rating - a.rating);

        fs.writeFileSync(filePath, JSON.stringify(finalFlavors, null, 2), 'utf8');
        console.log(`✅ Готово! Файл flavors.json обновлен. Всего вкусов в базе: ${finalFlavors.length}`);

    } catch (error) {
        console.error('❌ Ошибка Puppeteer:', error.message);
    } finally {
        await browser.close();
    }
}

scrapeWithPuppeteer();