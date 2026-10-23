'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../lib/catalog-core');

function makeRaw(overrides = {}) {
  return {
    slug: 'brand/main/flavor',
    name: 'Flavor',
    brand: 'Brand',
    brand_slug: 'brand',
    strength: 'Средняя',
    status: 'Выпускается',
    status_id: 1,
    rating: 4.5,
    image_url: 'https://example.test/flavor.webp',
    taste_groups: ['Цитрусовый'],
    tastes: ['Лимон'],
    tags: [{ name: 'Лимон', group: 'Цитрусовый', taste: 'Кислый' }],
    ...overrides
  };
}

const catalog = core.normalizeCatalog([
  makeRaw(),
  makeRaw({
    slug: 'brand/main/berry',
    name: 'Berry',
    strength: 'Лёгкая',
    rating: 3.6,
    image_url: '',
    taste_groups: ['Ягодный'],
    tastes: ['Малина'],
    tags: [{ name: 'Малина', group: 'Ягодный' }]
  }),
  makeRaw({
    slug: 'brand/main/limited',
    name: 'Limited',
    status: 'Лимитированный',
    status_id: 2,
    limited: true,
    strength: 'Крепкая',
    rating: 4.8,
    image_url: '',
    taste_groups: [],
    tastes: [],
    tags: []
  }),
  makeRaw({
    slug: 'brand/main/old',
    name: 'Old',
    status: 'Снят с производства',
    status_id: 4,
    discontinued: true,
    strength: '',
    rating: null,
    image_url: '',
    taste_groups: [],
    tags: []
  })
]);

test('normalizeCatalogItem поддерживает старые tags-строки и пустые поля', () => {
  const item = core.normalizeCatalogItem({
    slug: 'old/main/legacy',
    name: 'Legacy',
    brand: 'Old',
    tags: ['Табачный'],
    status: 'Выпускается'
  });

  assert.ok(item);
  assert.deepEqual(item.tastes, ['Табачный']);
  assert.deepEqual(item.groups, []);
  assert.equal(item.strength, '');
  assert.equal(item.image_url, '');
  assert.equal(item.rating, null);
  assert.equal(item.source_url, 'https://htreviews.org/tobaccos/old/main/legacy');
});

test('normalizeCatalog убирает дубли и некорректные записи', () => {
  const items = core.normalizeCatalog([makeRaw(), makeRaw(), { name: 'Без слота' }, null]);
  assert.equal(items.length, 1);
  assert.equal(items[0].slug, 'brand/main/flavor');
});

test('filterItems объединяет бренд и крепость', () => {
  const items = core.filterItems(catalog, { brand: 'Brand', strength: 'Средняя' });
  assert.deepEqual(items.map((item) => item.slug), ['brand/main/flavor']);
});

test('filterItems понимает категорию, отсутствие категории и отсутствие крепости', () => {
  assert.deepEqual(
    core.filterItems(catalog, { category: 'Ягодный' }).map((item) => item.slug),
    ['brand/main/berry']
  );
  assert.deepEqual(
    core.filterItems(catalog, { category: core.NO_CATEGORY }).map((item) => item.slug),
    ['brand/main/limited']
  );
  assert.deepEqual(
    core.filterItems(catalog, { strength: core.NO_STRENGTH, includeDiscontinued: true }).map((item) => item.slug),
    ['brand/main/old']
  );
});

test('filterItems исключает снятые с производства по умолчанию', () => {
  assert.equal(core.filterItems(catalog, {}).some((item) => item.slug === 'brand/main/old'), false);
  assert.equal(
    core.filterItems(catalog, { includeDiscontinued: true }).some((item) => item.slug === 'brand/main/old'),
    true
  );
});

test('filterItems фильтрует рейтинг, фото и лимитированные', () => {
  assert.deepEqual(
    core.filterItems(catalog, { rating: '4.5' }).map((item) => item.slug),
    ['brand/main/flavor', 'brand/main/limited']
  );
  assert.deepEqual(
    core.filterItems(catalog, { photoOnly: true }).map((item) => item.slug),
    ['brand/main/flavor']
  );
  assert.deepEqual(
    core.filterItems(catalog, { limitedOnly: true }).map((item) => item.slug),
    ['brand/main/limited']
  );
});

test('filterItems возвращает пустой массив при несовместимых фильтрах', () => {
  assert.deepEqual(core.filterItems(catalog, { brand: 'Brand', strength: 'Крепкая', category: 'Цитрусовый' }), []);
});

test('pickRandomItem выбирает равномерно и возвращает null для пустого списка', () => {
  const items = ['a', 'b', 'c', 'd'];
  assert.equal(core.pickRandomItem(items, () => 0), 'a');
  assert.equal(core.pickRandomItem(items, () => 0.5), 'c');
  assert.equal(core.pickRandomItem(items, () => 0.9999), 'd');
  assert.equal(core.pickRandomItem([], () => 0.5), null);
  assert.equal(core.pickRandomItem(null, () => 0.5), null);
});

test('computeCatalogStats считает реальные показатели каталога', () => {
  const stats = core.computeCatalogStats(catalog);
  assert.deepEqual(stats, {
    total: 4,
    brands: 1,
    active: 3,
    limited: 1,
    discontinued: 1,
    withStrength: 3,
    withImage: 1,
    withRating: 3,
    categories: 2
  });
});

test('распределения по брендам, крепости, категориям и статусам', () => {
  assert.deepEqual(core.brandDistribution(catalog)[0], {
    key: 'Brand',
    count: 4,
    percent: 100
  });
  assert.deepEqual(
    core.strengthDistribution(catalog).map((row) => row.key),
    ['Лёгкая', 'Средняя', 'Крепкая', 'Не указана']
  );
  assert.deepEqual(core.categoryDistribution(catalog), [
    { key: 'Цитрусовый', count: 1, percent: 25 },
    { key: 'Ягодный', count: 1, percent: 25 }
  ]);
  assert.deepEqual(
    core.statusDistribution(catalog).map((row) => row.key),
    ['Выпускается', 'Лимитированный', 'Снят с производства']
  );
});

test('коллекция: добавление, защита от дубликата, удаление и «попробовал»', () => {
  const first = core.addToCollection([], { slug: 'brand/main/flavor' }, '2026-01-01T00:00:00.000Z');
  assert.equal(first.added, true);
  assert.equal(first.collection.length, 1);

  const duplicate = core.addToCollection(first.collection, { slug: 'brand/main/flavor' });
  assert.equal(duplicate.added, false);
  assert.equal(duplicate.reason, 'duplicate');
  assert.equal(duplicate.collection.length, 1);

  const tried = core.toggleCollectionTried(first.collection, 'brand/main/flavor', '2026-01-02T00:00:00.000Z');
  assert.equal(tried[0].tried, true);
  assert.equal(tried[0].triedAt, '2026-01-02T00:00:00.000Z');
  assert.deepEqual(core.collectionStats(tried), { total: 1, wish: 0, tried: 1 });

  const untried = core.toggleCollectionTried(tried, 'brand/main/flavor');
  assert.equal(untried[0].tried, false);
  assert.equal(untried[0].triedAt, null);

  assert.deepEqual(core.removeFromCollection(tried, 'brand/main/flavor'), []);
});

test('коллекция: старый формат из строк и дубликатов', () => {
  const normalized = core.normalizeCollection(['a/main/x', { slug: 'a/main/x' }, { slug: 'b/main/y', tried: true }]);
  assert.deepEqual(normalized.map((entry) => entry.slug), ['a/main/x', 'b/main/y']);
  assert.equal(normalized[1].tried, true);
});
