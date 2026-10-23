'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const catalog = require('../flavors.json');

function isDiscontinued(item) {
  return item.discontinued === true || Number(item.status_id) === 4 || /снят\s+с\s+производства/i.test(String(item.status || ''));
}

test('flavors.json: каталог непустой и содержит MUSTHAVE и Black Burn', () => {
  assert.ok(Array.isArray(catalog));
  assert.ok(catalog.length >= 4500, `ожидалось >= 4500 вкусов, получено ${catalog.length}`);

  const brands = new Set(catalog.map((item) => item.brand_slug));
  assert.ok(brands.size >= 56, `ожидалось >= 56 брендов, получено ${brands.size}`);
  assert.ok(brands.has('musthave'), 'MUSTHAVE должен быть в каталоге');
  assert.ok(brands.has('black-burn'), 'Black Burn должен быть в каталоге');
  assert.equal(catalog.some((item) => isDiscontinued(item)), false, 'в каталоге не должно быть снятых с производства вкусов');
  assert.equal(
    catalog.every((item) => Number(item.status_id) === 1 || Number(item.status_id) === 2),
    true,
    'в каталоге должны быть только выпускаемые и лимитированные вкусы'
  );

  const musthave = catalog.filter((item) => item.brand_slug === 'musthave');
  assert.ok(musthave.length >= 85, `MUSTHAVE: ожидалось >= 85, получено ${musthave.length}`);
  assert.ok(musthave.filter((item) => !isDiscontinued(item)).length >= 85, 'активных вкусов MUSTHAVE должно быть >= 85');
  assert.ok(musthave.some((item) => item.slug === 'musthave/main/earl-grey'), 'Earl Grey должен быть в каталоге');
});

test('flavors.json: у всех записей есть обязательные поля и корректные ссылки', () => {
  const slugs = new Set();
  const ids = new Set();

  for (const item of catalog) {
    assert.ok(item && typeof item === 'object');
    assert.ok(String(item.name || '').trim(), `пустое name у ${item.slug}`);
    assert.ok(String(item.brand || '').trim(), `пустой brand у ${item.slug}`);
    assert.ok(String(item.brand_slug || '').trim(), `пустой brand_slug у ${item.slug}`);
    assert.ok(String(item.slug || '').trim(), 'пустой slug');
    assert.match(item.slug, /^[a-z0-9_-]+\/[a-z0-9_-]+\/[a-z0-9_-]+$/i);
    assert.equal(item.source_url, `https://htreviews.org/tobaccos/${item.slug}`);
    assert.ok(Number.isFinite(item.rating) && item.rating >= 0 && item.rating <= 5, `rating у ${item.slug}`);
    assert.ok(Number.isFinite(item.brand_position), `brand_position у ${item.slug}`);
    assert.ok(Array.isArray(item.tags), `tags у ${item.slug}`);
    assert.ok(Array.isArray(item.tastes), `tastes у ${item.slug}`);
    assert.ok(Array.isArray(item.taste_groups), `taste_groups у ${item.slug}`);
    assert.equal(typeof item.discontinued, 'boolean', `discontinued у ${item.slug}`);
    assert.ok(item.discontinued === false || item.status_id === 4, `флаг discontinued у ${item.slug}`);

    if (!slugs.has(item.slug)) slugs.add(item.slug);
    else assert.fail(`дубликат slug: ${item.slug}`);

    if (Number.isFinite(item.id)) {
      if (!ids.has(item.id)) ids.add(item.id);
      else assert.fail(`дубликат id: ${item.id}`);
    }
  }

  assert.equal(slugs.size, catalog.length);
});

test('flavors.json: теги согласованы с tastes/taste_groups', () => {
  for (const item of catalog) {
    const tagNames = item.tags.map((tag) => tag && tag.name).filter(Boolean);
    const tagGroups = item.tags.map((tag) => tag && tag.group).filter(Boolean);
    assert.deepEqual([...new Set(tagNames)], item.tastes);
    assert.deepEqual([...new Set(tagGroups)], item.taste_groups);
  }
});

test('flavors.json: picker-фильтры дают непустую выдачу и не предлагают снятые вкусы', () => {
  const active = catalog.filter((item) => !isDiscontinued(item));
  assert.ok(active.length >= 2000);

  const musthave = active.filter((item) => item.brand_slug === 'musthave');
  assert.ok(musthave.length >= 85);
  assert.ok(musthave.every((item) => !isDiscontinued(item)));

  const categories = [...new Set(active.flatMap((item) => [...(item.taste_groups || []), ...(item.tastes || [])]))];
  assert.ok(categories.includes('Цитрусовый'));

  const strengths = [...new Set(active.map((item) => item.strength).filter(Boolean))];
  assert.ok(strengths.includes('Средняя'));

  const filtered = musthave.filter(
    (item) =>
      item.strength === 'Средняя' &&
      (item.taste_groups || []).includes('Цитрусовый') &&
      Number(item.rating) >= 4
  );
  assert.ok(filtered.length > 0, 'фильтр MUSTHAVE + Средняя + Цитрусовый + рейтинг 4 не должен быть пустым');
});
