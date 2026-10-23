'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { HTReviewsClient, normalizeFlavor } = require('../lib/htreviews');

const LIVE = process.env.LIVE_HTREVIEWS === '1';
const skip = LIVE ? false : 'задайте LIVE_HTREVIEWS=1';

test('live: MUSTHAVE присутствует в рейтинге и отдаёт полный список вкусов', { skip }, async () => {
  const client = new HTReviewsClient({
    minInterval: 120,
    retries: 2,
    logger: { log() {}, warn() {} },
  });

  const brands = await client.fetchBrands();
  const musthaveBrand = brands.find((brand) => brand.slug === 'musthave');
  assert.ok(musthaveBrand, 'MUSTHAVE должен быть в рейтинге брендов');
  assert.equal(musthaveBrand.id, '37');
  assert.ok(musthaveBrand.tobaccos_count >= 100, 'на странице бренда заявлено больше 100 вкусов');

  const raw = await client.getBrandFlavors('37', { expectedCount: musthaveBrand.tobaccos_count });
  assert.ok(raw.length >= 80, `ожидалось не меньше 80 вкусов, получено ${raw.length}`);

  const all = raw
    .map((item) => normalizeFlavor(item, musthaveBrand, { includeDiscontinued: true }))
    .filter(Boolean);
  const active = all.filter((item) => !item.discontinued);

  assert.ok(active.length >= 80, `активных вкусов должно быть много, получено ${active.length}`);
  assert.ok(all.length >= active.length);
  assert.ok(all.some((item) => item.slug === 'musthave/main/earl-grey'), 'Earl Grey должен быть в каталоге');
  assert.ok(all.every((item) => item.source_url.startsWith('https://htreviews.org/tobaccos/')));

  const positions = all.map((item) => item.flavor_position).filter(Number.isFinite);
  assert.equal(new Set(positions).size, positions.length, 'позиции вкусов не должны дублироваться');
});
