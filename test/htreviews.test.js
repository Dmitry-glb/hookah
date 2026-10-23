'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  HTReviewsClient,
  normalizeFlavor,
  normalizeBrand,
  parseNumber,
  selectTargets,
  mergeRecords,
  scrapeCatalog,
  summarizeCatalog,
} = require('../lib/htreviews');

const silentLogger = { log() {}, warn() {} };

function makeBrand(id, slug, position, tobaccos = 20) {
  return { id: String(id), slug, name: slug, position: String(position), tobaccos: String(tobaccos) };
}

function makeFlavor(id, position = id, overrides = {}) {
  return {
    id: String(id),
    slug: `musthave/main/flavor-${id}`,
    name: `Flavor ${id}`,
    alt_name: `Вкус ${id}`,
    media: `uploads/objects/4/flavor-${id}.webp`,
    line: 'Основная',
    line_slug: 'musthave/main',
    brand: 'MUSTHAVE',
    brand_slug: 'musthave',
    position,
    rating: '4.5',
    ratings_count: '100',
    reviews: '90',
    views: '1.2k',
    strength: 'Средняя',
    status: 'Выпускается',
    status_id: '1',
    tags: [{ id: '29', name: 'Бергамот', group: 'Цитрусовый', taste: 'Терпкий' }],
    ...overrides,
  };
}

function makeHttp({ brandsPages = {}, flavorsPages = {}, failGet = 0, failPost = 0 } = {}) {
  const calls = { get: [], post: [] };
  let getFails = failGet;
  let postFails = failPost;

  return {
    calls,
    async get(url, config) {
      calls.get.push({ url, config });
      if (getFails > 0) {
        getFails -= 1;
        const error = new Error('server error');
        error.response = { status: 500 };
        throw error;
      }
      const offset = config && config.params ? config.params.o : 0;
      return { data: brandsPages[offset] || [] };
    },
    async post(url, body) {
      calls.post.push({ url, body });
      if (postFails > 0) {
        postFails -= 1;
        const error = new Error('server error');
        error.response = { status: 500 };
        throw error;
      }
      const offset = body.data.offset;
      return { data: flavorsPages[offset] || [] };
    },
  };
}

function makeClient(http) {
  return new HTReviewsClient({
    http,
    retries: 3,
    retryDelay: 0,
    minInterval: 0,
    logger: silentLogger,
  });
}

test('parseNumber понимает форматы HTReviews', () => {
  assert.equal(parseNumber('8.3k'), 8300);
  assert.equal(parseNumber('24,3k'), 24300);
  assert.equal(parseNumber('1.2 тыс.'), 1200);
  assert.equal(parseNumber('886.1k'), 886100);
  assert.equal(parseNumber('1 234'), 1234);
  assert.equal(parseNumber('4.6'), 4.6);
  assert.equal(parseNumber('0'), 0);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber(null), null);
  assert.equal(parseNumber('—'), null);
  assert.equal(parseNumber('Выпускается'), null);
});

test('normalizeBrand приводит поля бренда к числам', () => {
  const brand = normalizeBrand({
    id: '37',
    slug: 'musthave',
    name: 'MUSTHAVE',
    position: '36',
    country: 'Россия',
    lines: '1',
    tobaccos: '104',
    rating: 3.8,
    ratings_count: '10058',
    reviews: '9148',
    views: '886.1k',
  });

  assert.equal(brand.id, '37');
  assert.equal(brand.slug, 'musthave');
  assert.equal(brand.position, 36);
  assert.equal(brand.tobaccos_count, 104);
  assert.equal(brand.ratings_count, 10058);
  assert.equal(brand.views, 886100);
  assert.equal(normalizeBrand({ slug: '' }), null);
});

test('normalizeFlavor собирает tags/tastes/groups и абсолютные ссылки', () => {
  const flavor = normalizeFlavor(makeFlavor(1), { slug: 'musthave', name: 'MUSTHAVE', position: 36 });

  assert.equal(flavor.id, 1);
  assert.equal(flavor.name, 'Flavor 1');
  assert.equal(flavor.alt_name, 'Вкус 1');
  assert.equal(flavor.brand_position, 36);
  assert.equal(flavor.flavor_position, 1);
  assert.equal(flavor.views, 1200);
  assert.equal(flavor.source_url, 'https://htreviews.org/tobaccos/musthave/main/flavor-1');
  assert.equal(flavor.line_url, 'https://htreviews.org/tobaccos/musthave/main');
  assert.equal(flavor.image_url, 'https://htreviews.org/uploads/objects/4/flavor-1.webp');
  assert.deepEqual(flavor.tastes, ['Бергамот']);
  assert.deepEqual(flavor.taste_groups, ['Цитрусовый']);
  assert.deepEqual(flavor.tags, [{ id: 29, name: 'Бергамот', group: 'Цитрусовый', taste: 'Терпкий' }]);
  assert.equal(flavor.discontinued, false);
});

test('normalizeFlavor по умолчанию исключает снятые с производства вкусы', () => {
  const discontinued = makeFlavor(2, 101, {
    status: 'Снят с производства',
    status_id: '4',
  });

  assert.equal(normalizeFlavor(discontinued, { slug: 'musthave', position: 36 }), null);

  const included = normalizeFlavor(discontinued, { slug: 'musthave', position: 36 }, { includeDiscontinued: true });
  assert.equal(included.discontinued, true);
  assert.equal(included.status, 'Снят с производства');
});

test('normalizeFlavor исключает неподтверждённые и шуточные статусы', () => {
  const unknown = makeFlavor(3, 102, { status: 'Не известен', status_id: '3' });
  const joke = makeFlavor(4, 103, { status: 'Шуточный 🙃', status_id: '5' });

  assert.equal(normalizeFlavor(unknown, { slug: 'musthave', position: 36 }), null);
  assert.equal(normalizeFlavor(joke, { slug: 'musthave', position: 36 }), null);
  assert.equal(normalizeFlavor(unknown, { slug: 'musthave', position: 36 }, { includeUnknown: true }).status, 'Не известен');
  assert.equal(normalizeFlavor(joke, { slug: 'musthave', position: 36 }, { includeUnknown: true }).status, 'Шуточный 🙃');
});

test('normalizeFlavor возвращает null без slug/name', () => {
  assert.equal(normalizeFlavor({ name: 'Без слота' }, { slug: 'musthave' }), null);
  assert.equal(normalizeFlavor({ slug: 'musthave/main/x' }, { slug: 'musthave' }), null);
});

test('selectTargets: топ брендов + MUSTHAVE, даже если он вне лимита', () => {
  const directory = [makeBrand(1, 'baza', 1), makeBrand(2, 'dogma', 2), makeBrand(37, 'musthave', 36)];
  const targets = selectTargets({
    directory,
    mode: 'clean',
    limitBrands: 1,
    extraBrands: ['musthave'],
  });

  assert.deepEqual(
    targets.map((brand) => brand.slug),
    ['baza', 'musthave']
  );
  assert.equal(targets[1].id, '37');
});

test('selectTargets: merge берёт бренды из существующего файла и добавляет extra', () => {
  const existing = [
    { slug: 'old-brand/main/a', brand_slug: 'old-brand', brand: 'Old', brand_position: 10 },
    { slug: 'musthave/main/a', brand_slug: 'musthave', brand: 'MUSTHAVE', brand_position: 36 },
  ];
  const directory = [makeBrand(37, 'musthave', 36)];
  const targets = selectTargets({
    directory,
    existing,
    mode: 'merge',
    extraBrands: ['musthave'],
  });

  assert.deepEqual(
    targets.map((brand) => brand.slug),
    ['old-brand', 'musthave']
  );
  assert.equal(targets[0].id, null);
  assert.equal(targets[0].needsResolve, true);
  assert.equal(targets[0].position, 10);
  assert.equal(targets[1].id, '37');
});

test('selectTargets: без limitBrands по умолчанию берёт 60 брендов', () => {
  const directory = Array.from({ length: 70 }, (_, index) =>
    makeBrand(index + 1, `brand-${index + 1}`, index + 1)
  );
  const targets = selectTargets({ directory, mode: 'clean' });

  assert.equal(targets.length, 60);
  assert.equal(targets[0].slug, 'brand-1');
  assert.equal(targets[59].slug, 'brand-60');
});

test('selectTargets: onlyBrands имеет приоритет', () => {
  const directory = [makeBrand(37, 'musthave', 36)];
  const targets = selectTargets({
    directory,
    mode: 'merge',
    existing: [{ slug: 'baza/main/a', brand_slug: 'baza' }],
    onlyBrands: ['musthave'],
    extraBrands: ['baza'],
  });

  assert.deepEqual(
    targets.map((brand) => brand.slug),
    ['musthave']
  );
});

test('mergeRecords заменяет пересобранный бренд и сохраняет остальные', () => {
  const existing = [
    { slug: 'baza/main/old', brand_slug: 'baza', name: 'old' },
    { slug: 'layalina/main/keep', brand_slug: 'layalina', name: 'keep' },
  ];
  const scraped = [{ slug: 'baza/main/new', brand_slug: 'baza', name: 'new' }];
  const merged = mergeRecords(existing, scraped, new Set(['baza']));

  assert.deepEqual(
    merged.map((record) => record.slug).sort(),
    ['baza/main/new', 'layalina/main/keep']
  );
});

test('fetchBrands листает /getData до короткой страницы', async () => {
  const firstPage = Array.from({ length: 20 }, (_, index) => makeBrand(index + 1, `brand-${index + 1}`, index + 1));
  const http = makeHttp({
    brandsPages: {
      0: firstPage,
      20: [makeBrand(21, 'brand-21', 21), makeBrand(22, 'brand-22', 22)],
    },
  });
  const client = makeClient(http);
  const brands = await client.fetchBrands();

  assert.equal(brands.length, 22);
  assert.equal(brands[0].slug, 'brand-1');
  assert.equal(brands[21].slug, 'brand-22');
  assert.deepEqual(
    http.calls.get.map((call) => call.config.params.o),
    [0, 20]
  );
  assert.deepEqual(
    http.calls.get.map((call) => call.config.params.action),
    ['brands', 'brands']
  );
});

test('getBrandFlavors листает до data-count, а не до первой короткой страницы', async () => {
  const flavorsPages = {};
  let id = 0;
  for (const [offset, count] of [
    [0, 20],
    [20, 20],
    [40, 20],
    [60, 20],
    [80, 7],
    [100, 4],
  ]) {
    flavorsPages[offset] = Array.from({ length: count }, () => makeFlavor((id += 1)));
  }

  const http = makeHttp({ flavorsPages });
  const client = makeClient(http);
  const flavors = await client.getBrandFlavors('37', { expectedCount: 104 });

  assert.equal(flavors.length, 91);
  assert.deepEqual(
    http.calls.post.map((call) => call.body.data.offset),
    [0, 20, 40, 60, 80, 100]
  );
  assert.deepEqual(
    http.calls.post.map((call) => call.body.data.id),
    ['37', '37', '37', '37', '37', '37']
  );
});

test('getBrandFlavors без data-count продолжает после короткой страницы', async () => {
  const http = makeHttp({
    flavorsPages: {
      0: Array.from({ length: 20 }, (_, i) => makeFlavor(i + 1)),
      20: Array.from({ length: 7 }, (_, i) => makeFlavor(21 + i)),
      40: Array.from({ length: 4 }, (_, i) => makeFlavor(28 + i)),
    },
  });
  const client = makeClient(http);
  const flavors = await client.getBrandFlavors('37');

  assert.equal(flavors.length, 31);
  assert.deepEqual(
    http.calls.post.map((call) => call.body.data.offset),
    [0, 20, 40]
  );
});

test('getBrandFlavors дедуплицирует записи', async () => {
  const first = Array.from({ length: 20 }, (_, i) => makeFlavor(i + 1));
  first.push(makeFlavor(1)); // дубль на той же странице
  const http = makeHttp({
    flavorsPages: {
      0: first,
      20: [],
    },
  });
  const client = makeClient(http);
  const flavors = await client.getBrandFlavors('37', { expectedCount: 21 });

  assert.equal(flavors.length, 20);
});

test('HTReviewsClient повторяет запрос после 5xx', async () => {
  const http = makeHttp({
    failGet: 1,
    brandsPages: {
      0: [makeBrand(1, 'baza', 1)],
    },
  });
  const client = makeClient(http);
  const brands = await client.fetchBrands();

  assert.equal(brands.length, 1);
  assert.equal(http.calls.get.length, 2);
});

test('HTReviewsClient не повторяет 400', async () => {
  let calls = 0;
  const http = {
    async get() {
      calls += 1;
      const error = new Error('bad request');
      error.response = { status: 400 };
      throw error;
    },
    async post() {
      throw new Error('not used');
    },
  };
  const client = makeClient(http);

  await assert.rejects(() => client.fetchBrands(), /bad request/);
  assert.equal(calls, 1);
});

test('scrapeCatalog добавляет MUSTHAVE в режиме clean', async () => {
  const directory = [makeBrand(1, 'baza', 1), makeBrand(2, 'dogma', 2), makeBrand(37, 'musthave', 36)];
  const client = {
    async fetchBrands() {
      return directory;
    },
    async getBrandFlavors(id) {
      if (id === '37') return [makeFlavor(2)];
      return [{ ...makeFlavor(1), brand: 'База', brand_slug: 'baza' }];
    },
    async resolveBrandPage() {
      throw new Error('not expected');
    },
  };

  const result = await scrapeCatalog(client, {
    mode: 'clean',
    limitBrands: 1,
    extraBrands: ['musthave'],
    logger: silentLogger,
  });

  assert.deepEqual(
    result.records.map((record) => record.brand_slug).sort(),
    ['baza', 'musthave']
  );
  assert.equal(result.summary, undefined);
  assert.equal(summarizeCatalog(result.records).musthave, 1);
});

test('scrapeCatalog в merge сохраняет бренд, который не удалось обновить', async () => {
  const existing = [
    { slug: 'old/main/old', brand_slug: 'old', brand: 'Old', brand_position: 10 },
    { slug: 'keep/main/keep', brand_slug: 'keep', brand: 'Keep', brand_position: 11 },
  ];
  const client = {
    async fetchBrands() {
      return [makeBrand(1, 'baza', 1)];
    },
    async resolveBrandPage(slug) {
      if (slug === 'keep') throw new Error('404');
      return { id: '99', slug: 'old', name: 'Old', position: null, tobaccos_count: 1 };
    },
    async getBrandFlavors(id) {
      assert.equal(id, '99');
      return [makeFlavor(5)];
    },
  };

  const result = await scrapeCatalog(client, {
    mode: 'merge',
    existing,
    extraBrands: [],
    logger: silentLogger,
  });

  assert.deepEqual(
    result.records.map((record) => record.slug).sort(),
    ['keep/main/keep', 'musthave/main/flavor-5']
  );
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].slug, 'keep');
});

test('summarizeCatalog считает бренды, MUSTHAVE и снятые вкусы', () => {
  const summary = summarizeCatalog([
    { slug: 'musthave/main/a', brand_slug: 'musthave', discontinued: false },
    { slug: 'musthave/main/b', brand_slug: 'musthave', discontinued: true },
    { slug: 'baza/main/c', brand_slug: 'baza', discontinued: false },
  ]);

  assert.deepEqual(summary, {
    total: 3,
    brands: 2,
    discontinued: 1,
    musthave: 2,
    musthaveActive: 1,
  });
});
