const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const TARGET_URL = 'https://htreviews.org/tobaccos';
const filePath = path.join(__dirname, 'flavors.json');

async function scrapeHTReviews() {
    console.log('🕷️ Подключаемся к HTReviews со своего ПК...');

    try {
        // Усложняем заголовки, чтобы сайт думал, что зашел реальный человек из браузера Chrome
        const { data: html } = await axios.get(TARGET_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1'
            }
        });

        const $ = cheerio.load(html);
        const scrapedFlavors = [];

        // Пробуем универсальный поиск карточек по различным классам и тегам каталога
        // Ищем любые блоки, где могут быть карточки табаков
        $('div, article, li').each((_, element) => {
            const el = $(element);

            // Пытаемся вытащить бренд и название из стандартных селекторов каталога
            const brand = el.find('.brand, .item-brand, [class*="brand"]').first().text().trim();
            const name = el.find('.title, .name, .item-name, [class*="title"]').first().text().trim();
            const ratingStr = el.find('.rating, .score, .badge, [class*="rating"]').first().text().trim();

            const rating = parseFloat(ratingStr.replace(',', '.')) || 4.5;

            // Отсеиваем мусор, оставляем только валидные позиции с высоким рейтингом
            if (brand && name && name.length > 2 && rating >= 4.0 && rating <= 5.0) {
                // Избегаем дубликатов внутри текущего прогона
                const exists = scrapedFlavors.some(f => f.brand.toLowerCase() === brand.toLowerCase() && f.name.toLowerCase() === name.toLowerCase());
                if (!exists) {
                    scrapedFlavors.push({
                        brand,
                        name,
                        category: 'Популярное',
                        rating,
                        reviews_count: 100,
                        description: 'Популярный вкус с высоким рейтингом на HTReviews.'
                    });
                }
            }
        });

        console.log(`🔍 Найдено позиций на сайте: ${scrapedFlavors.length}`);

        let existingFlavors = [];
        if (fs.existsSync(filePath)) {
            existingFlavors = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }

        if (scrapedFlavors.length === 0) {
            console.warn('⚠️ Сайт отдал пустую выдачу или изменил структуру. База не изменена.');
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
        console.log(`✅ Успешно! Файл flavors.json обновлен. Всего вкусов в базе: ${finalFlavors.length}`);

    } catch (error) {
        console.error('❌ Ошибка при скачивании страницы:', error.message);
    }
}

scrapeHTReviews();