const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const TARGET_URL = 'https://htreviews.org/tobaccos';
const filePath = path.join(__dirname, 'flavors.json');

async function scrapeHTReviews() {
    console.log('🕷️ Подключаемся к HTReviews со своего ПК...');

    try {
        // Делаем реальный запрос к сайту с нормальным User-Agent
        const { data: html } = await axios.get(TARGET_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
            }
        });

        const $ = cheerio.load(html);
        const scrapedFlavors = [];

        // Парсим карточки табаков из каталога HTReviews
        $('.tobacco-card, .item-card, .catalog-item').each((_, element) => {
            const brand = $(element).find('.brand-name, .item-brand').text().trim();
            const name = $(element).find('.tobacco-name, .item-title').text().trim();
            const ratingStr = $(element).find('.rating-value, .badge-rating').text().trim();
            const desc = $(element).find('.description, .item-desc').text().trim();

            const rating = parseFloat(ratingStr.replace(',', '.')) || 4.5;

            if (brand && name && rating >= 4.0) {
                scrapedFlavors.push({
                    brand,
                    name,
                    category: 'Популярное',
                    rating,
                    reviews_count: 100,
                    description: desc || 'Популярный вкус с высоким рейтингом на HTReviews.'
                });
            }
        });

        console.log(`🔍 Найдено позиций на сайте: ${scrapedFlavors.length}`);

        // Загружаем текущий flavors.json, если он есть
        let existingFlavors = [];
        if (fs.existsSync(filePath)) {
            existingFlavors = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }

        if (scrapedFlavors.length === 0) {
            console.warn('⚠️ Парсер не смог зацепить карточки (возможно, изменилась верстка сайта). База не изменена.');
            return;
        }

        // Объединяем старые и новые данные, убирая дубликаты
        const map = new Map();
        [...existingFlavors, ...scrapedFlavors].forEach(item => {
            const key = `${item.brand.toLowerCase()}_${item.name.toLowerCase()}`;
            if (!map.has(key) || item.rating >= map.get(key).rating) {
                map.set(key, item);
            }
        });

        const finalFlavors = Array.from(map.values()).sort((a, b) => b.rating - a.rating);

        // Сохраняем обновленный файл
        fs.writeFileSync(filePath, JSON.stringify(finalFlavors, null, 2), 'utf8');
        console.log(`✅ Успешно! Файл flavors.json обновлен. Всего вкусов в базе: ${finalFlavors.length}`);

    } catch (error) {
        console.error('❌ Ошибка при скачивании страницы:', error.message);
    }
}

scrapeHTReviews();