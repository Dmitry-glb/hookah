/** Собирает полный каталог HTReviews в flavors.json. Запуск: npm run scrape */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const CATALOG_URL = 'https://htreviews.org/tobaccos?r=discussed&s=rating&d=desc&k=3';
const API_URL = 'https://htreviews.org/getData';
const OUTPUT_PATH = path.join(__dirname, 'flavors.json');
const PAGE_SIZE = 20;

const http = axios.create({
    timeout: 45_000,
    headers: { 'User-Agent': 'DimHookah catalog importer/1.0', Accept: 'application/json, text/html;q=0.9, */*;q=0.8' },
    responseType: 'text'
});

function numberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const normalized = String(value).trim().replace(/\s/g, '').replace(',', '.');
    const number = Number(normalized.replace(/k$/i, '')) * (/k$/i.test(normalized) ? 1000 : 1);
    return Number.isFinite(number) ? number : null;
}

function cleanText(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }

function getExpectedCount(html) {
    const $ = cheerio.load(html);
    const counts = $('.tobacco_list_items[data-count]').map((_, el) => Number($(el).attr('data-count'))).get();
    return Math.max(...counts.filter(Number.isFinite), 0);
}

async function getPage(offset) {
    // `flavor` — полный каталог вкусов. `discussed` из URL пользователя —
    // рейтинговая выборка и содержит только часть всех позиций.
    const response = await http.get(API_URL, { params: { r: 'flavor', s: 'rating', d: 'desc', k: 3, o: offset, action: 'tobaccos' } });
    try {
        const payload = typeof response.data === 'string' ? response.data.replace(/^\uFEFF/, '') : response.data;
        const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
        const rows = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : null);
        if (!rows) throw new Error('ответ не является массивом записей');
        return rows;
    } catch (error) {
        throw new Error(`Не удалось разобрать ответ на offset=${offset}: ${error.message}`);
    }
}

function normalizeRecord(item) {
    const tags = Array.isArray(item.tags) ? item.tags.map(tag => ({
        id: numberOrNull(tag.id), name: cleanText(tag.name), group: cleanText(tag.group), taste: cleanText(tag.taste)
    })).filter(tag => tag.name) : [];
    const name = cleanText(item.name);
    const brand = cleanText(item.brand);
    if (numberOrNull(item.id) === null || !name || !brand || !item.slug) return null;
    return {
        id: numberOrNull(item.id), name, flavor: name, alt_name: cleanText(item.alt_name), brand,
        line: cleanText(item.line), slug: item.slug, source_url: `https://htreviews.org/tobaccos/${item.slug}`,
        rating: numberOrNull(item.rating), ratings_count: numberOrNull(item.ratings_count),
        reviews_count: numberOrNull(item.reviews), views: numberOrNull(item.views), strength: cleanText(item.strength),
        tags, tastes: tags.map(tag => tag.name), taste_groups: [...new Set(tags.map(tag => tag.group).filter(Boolean))]
    };
}

async function scrape() {
    console.log('🌐 Проверяю каталог HTReviews...');
    const catalogResponse = await http.get(CATALOG_URL);
    const htmlCount = getExpectedCount(catalogResponse.data);
    if (!htmlCount) throw new Error('Не удалось определить размер каталога');
    console.log(`📚 В HTML каталога заявлено позиций: ${htmlCount}`);

    const records = new Map();
    // getData отдаёт фактические страницы полного каталога. У HTReviews
    // data-count в HTML относится к выбранной вкладке, поэтому заканчиваем
    // на короткой/пустой странице и дополнительно проверяем полноту.
    for (let offset = 0; offset < Math.max(PAGE_SIZE, htmlCount + PAGE_SIZE); offset += PAGE_SIZE) {
        let page;
        let lastError;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            try { page = await getPage(offset); break; }
            catch (error) { lastError = error; if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 700 * attempt)); }
        }
        if (!page) throw lastError;
        if (!page.length) break;
        page.map(normalizeRecord).filter(Boolean).forEach(record => records.set(record.id || record.slug, record));
        console.log(`  ✓ получено ${records.size} позиций`);
        if (page.length < PAGE_SIZE || records.size >= htmlCount) break;
    }

    const result = [...records.values()];
    if (!result.length) throw new Error('Проверка полноты не пройдена: каталог пуст');
    if (result.length < Math.max(1, Math.floor(htmlCount * 0.95))) {
        throw new Error(`Проверка полноты не пройдена: собрано ${result.length} из ${htmlCount}`);
    }
    if (result.some(item => !item.brand || !item.name || !Number.isFinite(item.rating))) {
        throw new Error('Проверка полей не пройдена: найдены неполные записи');
    }
    result.sort((a, b) => (b.rating - a.rating) || (b.reviews_count - a.reviews_count));
    const tempPath = `${OUTPUT_PATH}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, OUTPUT_PATH);
    console.log(`✅ Готово: ${result.length} вкусов записано в ${path.basename(OUTPUT_PATH)}`);
}

scrape().catch(error => { console.error(`❌ Парсер остановлен: ${error.message}`); process.exitCode = 1; });
