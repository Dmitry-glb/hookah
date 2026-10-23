/**
 * Чистая логика каталога: нормализация, фильтры, случайный выбор и коллекция.
 * Один и тот же модуль используется браузером (window.DimHookahCore) и тестами (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DimHookahCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const NO_STRENGTH = '__none__';
  const NO_CATEGORY = '__none__';
  const STRENGTH_ORDER = ['Лёгкая', 'Средне-лёгкая', 'Средняя', 'Средне-крепкая', 'Крепкая'];

  function text(value) {
    return String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function isDiscontinued(item) {
    return Boolean(item) && (
      item.discontinued === true ||
      Number(item.status_id) === 4 ||
      /снят\s+с\s+производства/i.test(String(item.status || ''))
    );
  }

  function isLimited(item) {
    return Boolean(item) && (
      item.limited === true ||
      Number(item.status_id) === 2 ||
      /лимит/i.test(String(item.status || ''))
    );
  }

  function toNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value === null || value === undefined || value === '') return null;
    const number = Number(String(value).replace(/\s+/g, '').replace(',', '.'));
    return Number.isFinite(number) ? number : null;
  }

  /**
   * Приводит запись старого или нового flavors.json к единому виду.
   * Старые tags могли быть строками, taste_groups могли отсутствовать.
   */
  function normalizeCatalogItem(item) {
    if (!item || typeof item !== 'object') return null;
    const slug = text(item.slug);
    const name = text(item.name);
    const brand = text(item.brand);
    if (!slug || !name || !brand) return null;

    const tags = (Array.isArray(item.tags) ? item.tags : [])
      .map((tag) => {
        if (typeof tag === 'string') return { name: text(tag), group: '', taste: '' };
        if (!tag || typeof tag !== 'object') return null;
        return { name: text(tag.name), group: text(tag.group), taste: text(tag.taste) };
      })
      .filter((tag) => tag && tag.name);

    const tastes = unique([
      ...(Array.isArray(item.tastes) ? item.tastes : []),
      ...tags.map((tag) => tag.name)
    ].map(text));

    const groups = unique([
      ...(Array.isArray(item.taste_groups) ? item.taste_groups : []),
      ...tags.map((tag) => tag.group)
    ].map(text));

    const rating = toNumber(item.rating);

    return {
      id: item.id === null || item.id === undefined ? null : item.id,
      slug,
      name,
      alt_name: text(item.alt_name),
      brand,
      brand_slug: text(item.brand_slug),
      line: text(item.line),
      strength: text(item.strength),
      status: text(item.status),
      status_id: toNumber(item.status_id),
      rating,
      ratings_count: toNumber(item.ratings_count),
      reviews_count: toNumber(item.reviews_count),
      views: toNumber(item.views),
      image_url: text(item.image_url),
      source_url: text(item.source_url) || `https://htreviews.org/tobaccos/${slug}`,
      tags,
      tastes,
      groups,
      limited: isLimited(item),
      discontinued: isDiscontinued(item)
    };
  }

  function normalizeCatalog(raw) {
    if (!Array.isArray(raw)) return [];
    const result = [];
    const seen = new Set();
    for (const item of raw) {
      const normalized = normalizeCatalogItem(item);
      if (!normalized || seen.has(normalized.slug)) continue;
      seen.add(normalized.slug);
      result.push(normalized);
    }
    return result;
  }

  function getItemCategories(item) {
    return item && Array.isArray(item.groups) ? item.groups : [];
  }

  function matchesStrength(item, strength) {
    if (!strength || strength === 'all') return true;
    if (strength === NO_STRENGTH) return !item.strength;
    return item.strength === strength;
  }

  function matchesCategory(item, category) {
    if (!category || category === 'all') return true;
    const groups = getItemCategories(item);
    if (category === NO_CATEGORY) return groups.length === 0;
    return groups.includes(category);
  }

  /**
   * Совместная фильтрация. Одна функция для рулетки, счётчиков и тестов.
   */
  function filterItems(catalog, filters) {
    const options = filters || {};
    const brand = options.brand || 'all';
    const strength = options.strength || 'all';
    const category = options.category || 'all';
    const rating = options.rating && options.rating !== 'all' ? Number(options.rating) : null;
    const photoOnly = Boolean(options.photoOnly);
    const limitedOnly = Boolean(options.limitedOnly);
    const includeDiscontinued = Boolean(options.includeDiscontinued);

    return (Array.isArray(catalog) ? catalog : []).filter((item) => {
      if (!item) return false;
      if (!includeDiscontinued && isDiscontinued(item)) return false;
      if (limitedOnly && !isLimited(item)) return false;
      if (brand !== 'all' && item.brand !== brand) return false;
      if (!matchesStrength(item, strength)) return false;
      if (!matchesCategory(item, category)) return false;
      if (rating !== null && (!Number.isFinite(item.rating) || item.rating < rating)) return false;
      if (photoOnly && !item.image_url) return false;
      return true;
    });
  }

  /**
   * Равномерный случайный выбор. random можно подменить в тестах.
   */
  function pickRandomItem(items, random) {
    if (!Array.isArray(items) || items.length === 0) return null;
    const value = Number(typeof random === 'function' ? random() : Math.random());
    const safe = Number.isFinite(value) ? Math.min(0.999999999, Math.max(0, value)) : Math.random();
    return items[Math.floor(safe * items.length)];
  }

  function computeCatalogStats(catalog) {
    const items = Array.isArray(catalog) ? catalog : [];
    const brands = new Set();
    const categories = new Set();
    let active = 0;
    let limited = 0;
    let discontinued = 0;
    let withStrength = 0;
    let withImage = 0;
    let withRating = 0;

    for (const item of items) {
      brands.add(item.brand_slug || item.brand);
      for (const group of getItemCategories(item)) categories.add(group);
      if (isDiscontinued(item)) discontinued += 1;
      else active += 1;
      if (isLimited(item)) limited += 1;
      if (item.strength) withStrength += 1;
      if (item.image_url) withImage += 1;
      if (Number.isFinite(item.rating)) withRating += 1;
    }

    return {
      total: items.length,
      brands: brands.size,
      active,
      limited,
      discontinued,
      withStrength,
      withImage,
      withRating,
      categories: categories.size
    };
  }

  function distributionBy(items, getKeys, limit) {
    const list = Array.isArray(items) ? items : [];
    const counts = new Map();
    for (const item of list) {
      const keys = getKeys(item);
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (!key) continue;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    const total = list.length || 1;
    const rows = [...counts.entries()]
      .map(([key, count]) => ({ key, count, percent: (count / total) * 100 }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, 'ru'));
    return limit ? rows.slice(0, limit) : rows;
  }

  function brandDistribution(items, limit) {
    return distributionBy(items, (item) => item.brand, limit);
  }

  function strengthDistribution(items) {
    const rows = distributionBy(items, (item) => item.strength || 'Не указана');
    const order = new Map(STRENGTH_ORDER.map((value, index) => [value, index]));
    return rows.sort((a, b) => {
      const aIndex = order.has(a.key) ? order.get(a.key) : 999;
      const bIndex = order.has(b.key) ? order.get(b.key) : 999;
      return aIndex - bIndex || b.count - a.count;
    });
  }

  function categoryDistribution(items, limit) {
    return distributionBy(items, (item) => getItemCategories(item), limit);
  }

  function statusDistribution(items) {
    return distributionBy(items, (item) => {
      if (isDiscontinued(item)) return 'Снят с производства';
      if (isLimited(item)) return 'Лимитированный';
      return item.status || 'Не указан';
    });
  }

  function normalizeCollection(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const seen = new Set();
    const result = [];
    for (const value of list) {
      const entry = typeof value === 'string' ? { slug: value } : value;
      const slug = text(entry && entry.slug);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      result.push({
        slug,
        addedAt: text(entry.addedAt) || null,
        tried: Boolean(entry.tried),
        triedAt: text(entry.triedAt) || null
      });
    }
    return result;
  }

  function addToCollection(collection, item, now) {
    const list = normalizeCollection(collection);
    const slug = text(item && item.slug);
    if (!slug) return { collection: list, added: false, reason: 'invalid' };
    if (list.some((entry) => entry.slug === slug)) {
      return { collection: list, added: false, reason: 'duplicate' };
    }
    const timestamp = now || new Date().toISOString();
    return {
      collection: [...list, { slug, addedAt: timestamp, tried: false, triedAt: null }],
      added: true,
      reason: 'added'
    };
  }

  function removeFromCollection(collection, slug) {
    const target = text(slug);
    const list = normalizeCollection(collection);
    return list.filter((entry) => entry.slug !== target);
  }

  function toggleCollectionTried(collection, slug, now) {
    const target = text(slug);
    const timestamp = now || new Date().toISOString();
    return normalizeCollection(collection).map((entry) => {
      if (entry.slug !== target) return entry;
      const tried = !entry.tried;
      return { ...entry, tried, triedAt: tried ? timestamp : null };
    });
  }

  function collectionStats(collection) {
    const list = normalizeCollection(collection);
    const tried = list.filter((entry) => entry.tried).length;
    return { total: list.length, wish: list.length - tried, tried };
  }

  return {
    NO_STRENGTH,
    NO_CATEGORY,
    STRENGTH_ORDER,
    text,
    isDiscontinued,
    isLimited,
    normalizeCatalogItem,
    normalizeCatalog,
    getItemCategories,
    filterItems,
    pickRandomItem,
    computeCatalogStats,
    distributionBy,
    brandDistribution,
    strengthDistribution,
    categoryDistribution,
    statusDistribution,
    normalizeCollection,
    addToCollection,
    removeFromCollection,
    toggleCollectionTried,
    collectionStats
  };
});
