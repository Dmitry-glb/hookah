'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseArgs, readCatalog, writeCatalog } = require('../scraper');

test('parseArgs: значения по умолчанию', () => {
  const options = parseArgs([]);

  assert.equal(options.out, 'flavors.json');
  assert.equal(options.mode, 'auto');
  assert.equal(options.limitBrands, 60);
  assert.equal(options.delay, 250);
  assert.equal(options.retries, 3);
  assert.deepEqual(options.extraBrands, ['musthave']);
  assert.deepEqual(options.onlyBrands, []);
});

test('parseArgs: --only-brand включает режим clean и убирает extra', () => {
  const options = parseArgs(['--only-brand', 'musthave', '--out', 'debug/x.json']);

  assert.equal(options.mode, 'clean');
  assert.equal(options.out, 'debug/x.json');
  assert.deepEqual(options.onlyBrands, ['musthave']);
});

test('parseArgs: --brand добавляет бренды и дедуплицирует', () => {
  const options = parseArgs(['--brand', 'layalina,musthave', '--brand=layalina']);

  assert.deepEqual(options.extraBrands, ['musthave', 'layalina']);
});

test('parseArgs: --limit-brands 0 и --all-brands', () => {
  assert.equal(parseArgs(['--limit-brands', '0']).limitBrands, 0);
  assert.equal(parseArgs(['--limit-brands=12']).limitBrands, 12);
  assert.equal(parseArgs(['--all-brands']).allBrands, true);
});

test('parseArgs: --include-discontinued и --dry-run', () => {
  const options = parseArgs(['--include-discontinued', '--dry-run']);

  assert.equal(options.includeDiscontinued, true);
  assert.equal(options.dryRun, true);
});

test('parseArgs: неизвестный аргумент и пропущенное значение', () => {
  assert.throws(() => parseArgs(['--nope']), /Неизвестный аргумент/);
  assert.throws(() => parseArgs(['--out']), /требуется значение/);
  assert.throws(() => parseArgs(['--limit-brands', '-1']), /целым числом/);
});

test('readCatalog/writeCatalog: атомарная запись и чтение массива', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dimhookah-test-'));
  const file = path.join(dir, 'catalog.json');
  const records = [{ slug: 'musthave/main/earl-grey', brand_slug: 'musthave' }];

  try {
    await writeCatalog(file, records);
    assert.deepEqual(readCatalog(file), records);
    assert.equal(fs.readFileSync(file, 'utf8').endsWith('\n'), true);
    assert.equal(fs.existsSync(`${file}.tmp`), false);
    assert.deepEqual(readCatalog(path.join(dir, 'missing.json')), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readCatalog: не-массив считается ошибкой', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dimhookah-test-'));
  const file = path.join(dir, 'bad.json');
  try {
    fs.writeFileSync(file, '{"not":"array"}', 'utf8');
    assert.throws(() => readCatalog(file), /ожидался JSON-массив/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
