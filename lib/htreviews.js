'use strict';

/**
 * Клиент и нормализация каталога HTReviews.
 *
 * Сайт отдаёт данные двумя способами:
 *  - GET  /getData?action=brands&r=position&s=rating&d=desc&o=<offset> — рейтинг брендов;
 *  - POST /postData { action: 'objectByBrand', data: { id, limit, offset, sort } } — вкусы бренда.
 *
 * Старый вариант со скрейпингом HTML и `?o=` не работает: страница всегда отдаёт
 * первые 20 вкусов, а `data-count` при этом может быть больше. Поэтому здесь
 * используются именно API-запросы, которые умеют пагинацию.
 */

const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://htreviews.org';
const PAGE_SIZE = 20;
const DEFAULT_EXTRA_BRANDS = ['musthave'];
const USER_AGENT = 'DimHookah catalog importer/3.0 (+https://github.com/Dmitry-glb/hookah)';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function text(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Приводит числа с HTReviews к number.
 * Поддерживает "8.3k", "24,3k", "1.2 тыс.", "886.1k", "1 234", 4.6.
 */
function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined) return null;

  const raw = String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, '')
    .replace(',', '.');

  if (!raw || raw === '-' || raw === '—' || raw === '–') return null;

  const match = raw.match(/^(-?\d+(?:\.\d+)?)(k|m|b|тыс\.?|млн|млрд)?$/i);
  if (!match) return null;

  let result = Number(match[1]);
  if (!Number.isFinite(result)) return null;

  const suffix = (match[2] || '').toLowerCase();
  if (suffix === 'k' || suffix.startsWith('тыс')) result *= 1e3;
  else if (suffix === 'm' || suffix.startsWith('млн')) result *= 1e6;
  else if (suffix === 'b' || suffix.startsWith('млрд')) result *= 1e9;

  return Number.isFinite(result) ? result : null;
}

function absoluteUrl(value) {
  const raw = text(value);
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${BASE_URL}/${raw.replace(/^\/+/, '')}`;
}

function uniqueBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (key === null || key === undefined || key === '') continue;
    if (!map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

function normalizeTag(tag) {
  if (!tag || typeof tag !== 'object') return null;
  const name = text(tag.name);
  if (!name) return null;
  return {
    id: parseNumber(tag.id),
    name,
    group: text(tag.group),
    taste: text(tag.taste),
  };
}

/**
 * Нормализует вкус из ответа /postData к формату flavors.json.
 * @param {object} item
 * @param {object} brand
 * @param {{ includeDiscontinued?: boolean }} [options]
 */
function normalizeFlavor(item, brand, options = {}) {
  if (!item || typeof item !== 'object') return null;

  const slug = text(item.slug);
  const name = text(item.name);
  if (!slug || !name) return null;

  const statusId = parseNumber(item.status_id);
  const status = text(item.status);
  const discontinued = statusId === 4 || /снят\s+с\s+производства/i.test(status);
  if (discontinued && !options.includeDiscontinued) return null;

  const tags = Array.isArray(item.tags) ? item.tags.map(normalizeTag).filter(Boolean) : [];
  const tastes = [...new Set(tags.map((tag) => tag.name).filter(Boolean))];
  const tasteGroups = [...new Set(tags.map((tag) => tag.group).filter(Boolean))];
  const lineSlug = text(item.line_slug);
  const brandName = text(item.brand) || text(brand && brand.name);
  const brandSlug = text(item.brand_slug) || text(brand && brand.slug);

  return {
    id: parseNumber(item.id),
    name,
    flavor: name,
    alt_name: text(item.alt_name),
    brand: brandName,
    brand_slug: brandSlug,
    brand_position: parseNumber(brand && brand.position),
    line: text(item.line),
    line_slug: lineSlug,
    line_url: lineSlug ? `${BASE_URL}/tobaccos/${lineSlug}` : null,
    slug,
    source_url: `${BASE_URL}/tobaccos/${slug}`,
    flavor_position: parseNumber(item.position),
    rating: parseNumber(item.rating),
    ratings_count: parseNumber(item.ratings_count),
    reviews_count: parseNumber(item.reviews),
    views: parseNumber(item.views),
    strength: text(item.strength),
    strength_count: parseNumber(item.strength_count),
    status: status || null,
    status_id: statusId,
    limited: statusId === 2 || /лимит/i.test(status),
    discontinued,
    tags,
    tastes,
    taste_groups: tasteGroups,
    image_url: absoluteUrl(item.media || item.image_url),
  };
}

function normalizeBrand(item) {
  if (!item || typeof item !== 'object') return null;
  const slug = text(item.slug);
  if (!slug) return null;
  return {
    id: item.id === null || item.id === undefined || item.id === '' ? null : String(item.id),
    slug,
    name: text(item.name) || slug,
    position: parseNumber(item.position),
    country: text(item.country),
    lines_count: parseNumber(item.lines),
    tobaccos_count: parseNumber(item.tobaccos),
    rating: parseNumber(item.rating),
    ratings_count: parseNumber(item.ratings_count),
    reviews_count: parseNumber(item.reviews),
    views: parseNumber(item.views),
  };
}

function brandSlugFromRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const direct = text(record.brand_slug);
  if (direct) return direct;

  const source = text(record.source_url);
  const match = source.match(/\/tobaccos\/([^/?#]+)/);
  if (match) return match[1];

  const slug = text(record.slug);
  const first = slug.split('/')[0];
  return first || null;
}

function compareRecords(a, b) {
  const aPosition = Number.isFinite(a.brand_position) ? a.brand_position : 1e9;
  const bPosition = Number.isFinite(b.brand_position) ? b.brand_position : 1e9;
  return (
    aPosition - bPosition ||
    (Number(b.rating) || 0) - (Number(a.rating) || 0) ||
    (Number(b.reviews_count) || 0) - (Number(a.reviews_count) || 0) ||
    String(a.brand || '').localeCompare(String(b.brand || ''), 'ru') ||
    String(a.line || '').localeCompare(String(b.line || ''), 'ru') ||
    (Number(a.flavor_position) || 0) - (Number(b.flavor_position) || 0)
  );
}

/**
 * Выбирает бренды для импорта.
 * merge — все бренды из текущего flavors.json + extraBrands;
 * clean — топ limitBrands (или все) + extraBrands;
 * onlyBrands — строго указанные бренды.
 */
function selectTargets(input = {}) {
  const directory = Array.isArray(input.directory) ? input.directory : [];
  const existing = Array.isArray(input.existing) ? input.existing : [];
  const extraBrands = Array.isArray(input.extraBrands) ? input.extraBrands : [];
  const onlyBrands = Array.isArray(input.onlyBrands) ? input.onlyBrands : [];
  const mode = input.mode === 'merge' ? 'merge' : 'clean';
  const rawLimit = input.limitBrands === undefined ? 40 : Number(input.limitBrands);
  const limitBrands = Number.isFinite(rawLimit) ? Math.max(0, rawLimit) : 40;
  const allBrands = Boolean(input.allBrands);

  const bySlug = new Map();
  for (const brand of directory) {
    if (brand && brand.slug) bySlug.set(brand.slug, brand);
  }

  const existingInfo = new Map();
  for (const record of existing) {
    const slug = brandSlugFromRecord(record);
    if (!slug) continue;
    const info = existingInfo.get(slug) || { position: null, name: null };
    if (info.position === null) info.position = parseNumber(record.brand_position);
    if (!info.name) info.name = text(record.brand);
    existingInfo.set(slug, info);
  }

  const makeTarget = (slug) => {
    const fromDirectory = bySlug.get(slug);
    if (fromDirectory) return { ...fromDirectory };
    const info = existingInfo.get(slug) || {};
    return {
      id: null,
      slug,
      name: info.name || null,
      position: info.position === undefined ? null : info.position,
      tobaccos_count: null,
      needsResolve: true,
    };
  };

  if (onlyBrands.length) {
    return uniqueBy(onlyBrands.map((slug) => text(slug)).filter(Boolean).map(makeTarget), (brand) => brand.slug);
  }

  let slugs = [];
  if (mode === 'merge' && existing.length) {
    slugs = [...existingInfo.keys()];
    for (const slug of extraBrands) if (!slugs.includes(slug)) slugs.push(slug);
  } else {
    const selected = allBrands || limitBrands <= 0 ? directory : directory.slice(0, limitBrands);
    slugs = selected.map((brand) => brand.slug);
    for (const slug of extraBrands) if (!slugs.includes(slug)) slugs.push(slug);
  }

  return uniqueBy(slugs.filter(Boolean).map(makeTarget), (brand) => brand.slug);
}

/**
 * Оставляет нетронутыми бренды, которые не участвовали в текущем импорте.
 * Записи пересобранных брендов полностью заменяются новыми.
 */
function mergeRecords(existing, scraped, scrapedSlugs) {
  const keep = existing.filter((record) => {
    if (!record || !record.slug) return false;
    const slug = brandSlugFromRecord(record);
    if (!slug) return true;
    return !scrapedSlugs.has(slug);
  });
  return uniqueBy([...keep, ...scraped], (record) => record.slug);
}

function summarizeCatalog(records) {
  const brands = new Map();
  let discontinued = 0;
  for (const record of records) {
    const slug = record.brand_slug || '?';
    brands.set(slug, (brands.get(slug) || 0) + 1);
    if (record.discontinued) discontinued += 1;
  }
  const musthave = records.filter((record) => record.brand_slug === 'musthave');
  return {
    total: records.length,
    brands: brands.size,
    discontinued,
    musthave: musthave.length,
    musthaveActive: musthave.filter((record) => !record.discontinued).length,
  };
}

class HTReviewsClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || BASE_URL;

    const retries = Number(options.retries);
    const retryDelay = Number(options.retryDelay);
    const minInterval = Number(options.minInterval);
    const timeout = Number(options.timeout);

    this.retries = Number.isInteger(retries) && retries > 0 ? retries : 3;
    this.retryDelay = Number.isFinite(retryDelay) && retryDelay >= 0 ? retryDelay : 750;
    this.minInterval = Number.isFinite(minInterval) && minInterval >= 0 ? minInterval : 0;
    this.logger = options.logger || console;
    this._lastRequestAt = 0;

    this.http =
      options.http ||
      axios.create({
        timeout: Number.isFinite(timeout) && timeout > 0 ? timeout : 45000,
        responseType: 'text',
        headers: {
          'User-Agent': options.userAgent || USER_AGENT,
          'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });
  }

  async _throttle() {
    if (!this.minInterval) {
      this._lastRequestAt = Date.now();
      return;
    }
    const wait = this.minInterval - (Date.now() - this._lastRequestAt);
    if (wait > 0) await sleep(wait);
    this._lastRequestAt = Date.now();
  }

  _isRetryable(error) {
    const status = error && error.response ? error.response.status : null;
    if (!status) return true; // сеть, таймаут, сброс соединения
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }

  async _request(label, fn) {
    let lastError;
    for (let attempt = 1; attempt <= this.retries; attempt += 1) {
      try {
        await this._throttle();
        return await fn();
      } catch (error) {
        lastError = error;
        if (!this._isRetryable(error) || attempt >= this.retries) throw error;
        const delay = this.retryDelay * 2 ** (attempt - 1);
        if (this.logger && typeof this.logger.warn === 'function') {
          this.logger.warn(`${label}: ${error.message}. Повтор ${attempt}/${this.retries} через ${delay} мс`);
        }
        await sleep(delay);
      }
    }
    throw lastError;
  }

  async get(path, config = {}) {
    return this._request(`GET ${path}`, () => this.http.get(`${this.baseUrl}${path}`, config));
  }

  async post(path, body, config = {}) {
    return this._request(`POST ${path}`, () =>
      this.http.post(`${this.baseUrl}${path}`, body, {
        ...config,
        headers: { 'Content-Type': 'application/json', ...(config.headers || {}) },
      })
    );
  }

  _asArray(data) {
    let value = data;
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch (error) {
        return [];
      }
    }
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return Object.values(value);
    return [];
  }

  /** Весь рейтинг брендов (обычно 60 записей, по 20 на страницу). */
  async fetchBrands() {
    const brands = [];
    for (let offset = 0; offset < 4000; offset += PAGE_SIZE) {
      const response = await this.get('/getData', {
        params: { r: 'position', s: 'rating', d: 'desc', o: offset, action: 'brands' },
      });
      const page = this._asArray(response.data).map(normalizeBrand).filter(Boolean);
      if (!page.length) break;
      brands.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
    return uniqueBy(brands, (brand) => brand.slug);
  }

  /**
   * Все вкусы бренда. Пагинация идёт до data-count, а не до первой короткой
   * страницы: у MUSTHAVE страница offset=80 содержит 7 записей, а offset=100 —
   * ещё 4 снятых с производства вкуса.
   */
  async getBrandFlavors(brandId, options = {}) {
    if (!brandId) throw new Error('Не указан id бренда');

    const limit = Math.max(1, Number(options.limit) || PAGE_SIZE);
    const expected = Number(options.expectedCount);
    const hasExpected = Number.isFinite(expected) && expected > 0;
    const sort = options.sort || { s: 'position', d: 'asc' };
    const collected = new Map();
    const maxOffset = hasExpected ? expected + limit : 20000;
    let sawShortPage = false;

    for (let offset = 0; offset < maxOffset; offset += limit) {
      const response = await this.post('/postData', {
        action: 'objectByBrand',
        data: { id: String(brandId), limit, offset, sort },
      });
      const page = this._asArray(response.data);
      if (!page.length) break;

      for (const item of page) {
        const key = String(item && (item.id || item.slug) ? item.id || item.slug : `${offset}:${collected.size}`);
        if (!collected.has(key)) collected.set(key, item);
      }

      if (typeof options.onPage === 'function') options.onPage(page, offset);

      if (hasExpected) {
        if (offset + limit >= expected) break;
      } else if (page.length < limit) {
        // Без data-count даём шанс странице с «хвостом» (например, 7 + 4).
        if (sawShortPage) break;
        sawShortPage = true;
      } else {
        sawShortPage = false;
      }
    }

    return [...collected.values()];
  }

  /** id и количество вкусов для бренда, которого нет в топ-рейтинге. */
  async resolveBrandPage(slug) {
    const response = await this.get(`/tobaccos/${encodeURIComponent(slug)}`, { responseType: 'text' });
    if (typeof response.data !== 'string') throw new Error(`Страница бренда ${slug} вернула не HTML`);

    const $ = cheerio.load(response.data);
    const wrapper = $('.object_wrapper').first();
    const id = wrapper.attr('data-id');
    if (!id) throw new Error(`Не удалось определить id бренда ${slug}`);

    const list = $('.tobacco_list_items').first();
    return {
      id: String(id),
      slug,
      name: text($('h1').first().text()) || slug,
      position: null,
      country: null,
      lines_count: null,
      tobaccos_count: parseNumber(list.attr('data-count')),
      rating: null,
      ratings_count: null,
      reviews_count: null,
      views: null,
    };
  }
}

/**
 * Собирает каталог и возвращает готовые записи.
 * @param {HTReviewsClient} client
 * @param {object} options
 */
async function scrapeCatalog(client, options = {}) {
  const mode = options.mode === 'merge' ? 'merge' : 'clean';
  const existing = Array.isArray(options.existing) ? options.existing : [];
  const extraBrands = Array.isArray(options.extraBrands) ? options.extraBrands : DEFAULT_EXTRA_BRANDS;
  const onlyBrands = Array.isArray(options.onlyBrands) ? options.onlyBrands : [];
  const includeDiscontinued = Boolean(options.includeDiscontinued);
  const logger = options.logger || console;

  const directory = await client.fetchBrands();
  if (!directory.length) throw new Error('HTReviews вернул пустой список брендов');
  if (typeof logger.log === 'function') logger.log(`Брендов в рейтинге: ${directory.length}`);

  const targets = selectTargets({
    directory,
    existing,
    mode,
    limitBrands: options.limitBrands,
    allBrands: options.allBrands,
    extraBrands,
    onlyBrands,
  });
  if (!targets.length) throw new Error('Не выбрано ни одного бренда для импорта');
  if (typeof logger.log === 'function') logger.log(`К импорту: ${targets.length} бренд(ов)`);

  const scraped = [];
  const scrapedSlugs = new Set();
  const failed = [];
  const brands = [];

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    let brand = target;
    try {
      if (!brand.id) {
        if (typeof logger.log === 'function') logger.log(`[${index + 1}/${targets.length}] Ищу id бренда ${brand.slug}...`);
        const resolved = await client.resolveBrandPage(brand.slug);
        brand = {
          ...resolved,
          name: resolved.name || brand.name,
          position: brand.position === null || brand.position === undefined ? resolved.position : brand.position,
        };
      }

      if (typeof logger.log === 'function') logger.log(`[${index + 1}/${targets.length}] ${brand.name || brand.slug}...`);
      const expectedCount = Number.isFinite(brand.tobaccos_count) ? brand.tobaccos_count : null;
      const raw = await client.getBrandFlavors(brand.id, { expectedCount });
      const records = raw
        .map((item) => normalizeFlavor(item, brand, { includeDiscontinued }))
        .filter(Boolean);

      scraped.push(...records);
      scrapedSlugs.add(brand.slug);
      brands.push({ slug: brand.slug, name: brand.name, count: records.length, expected: expectedCount });
      if (typeof logger.log === 'function') {
        logger.log(`   ✓ ${records.length} вкусов${expectedCount ? ` (заявлено ${expectedCount})` : ''}`);
      }
    } catch (error) {
      failed.push({ slug: brand.slug, message: error.message });
      if (typeof logger.warn === 'function') logger.warn(`   ⚠ ${brand.name || brand.slug}: ${error.message}`);
    }
  }

  if (!scraped.length) throw new Error('Не удалось собрать ни одного вкуса');

  let records = mode === 'merge' && existing.length ? mergeRecords(existing, scraped, scrapedSlugs) : scraped;
  records = uniqueBy(records.filter((record) => record && record.slug), (record) => record.slug);
  records.sort(compareRecords);

  return {
    records,
    targets,
    brands,
    failed,
    directorySize: directory.length,
  };
}

module.exports = {
  BASE_URL,
  PAGE_SIZE,
  DEFAULT_EXTRA_BRANDS,
  USER_AGENT,
  parseNumber,
  text,
  absoluteUrl,
  uniqueBy,
  normalizeTag,
  normalizeFlavor,
  normalizeBrand,
  brandSlugFromRecord,
  compareRecords,
  selectTargets,
  mergeRecords,
  summarizeCatalog,
  HTReviewsClient,
  scrapeCatalog,
};
