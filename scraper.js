'use strict';

/**
 * Сборка каталога вкусов HTReviews для flavor-picker.
 *
 * Примеры:
 *   npm run scrape                       # обновить текущий flavors.json + MUSTHAVE
 *   npm run scrape -- --dry-run          # показать, что изменится, не писать файл
 *   npm run scrape -- --only-brand musthave --out debug/musthave.json
 *   npm run scrape -- --clean            # собрать топ-60 брендов заново
 *   npm run scrape -- --clean --all-brands
 */

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_EXTRA_BRANDS,
  HTReviewsClient,
  scrapeCatalog,
  summarizeCatalog,
} = require('./lib/htreviews');

const DEFAULT_OUTPUT = 'flavors.json';
const DEFAULT_LIMIT_BRANDS = 60;
const DEFAULT_DELAY_MS = 250;

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    out: DEFAULT_OUTPUT,
    mode: 'auto',
    limitBrands: DEFAULT_LIMIT_BRANDS,
    allBrands: false,
    extraBrands: [...DEFAULT_EXTRA_BRANDS],
    onlyBrands: [],
    includeDiscontinued: false,
    delay: DEFAULT_DELAY_MS,
    retries: 3,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const equalIndex = arg.indexOf('=');
    const key = equalIndex === -1 ? arg : arg.slice(0, equalIndex);
    const inlineValue = equalIndex === -1 ? null : arg.slice(equalIndex + 1);

    const readValue = () => {
      if (inlineValue !== null) return inlineValue;
      index += 1;
      if (index >= argv.length) throw new Error(`Для ${key} требуется значение`);
      return argv[index];
    };

    switch (key) {
      case '--out':
        options.out = readValue();
        break;
      case '--clean':
        options.mode = 'clean';
        break;
      case '--merge':
        options.mode = 'merge';
        break;
      case '--limit-brands': {
        const value = Number(readValue());
        if (!Number.isInteger(value) || value < 0) throw new Error('--limit-brands должен быть целым числом >= 0');
        options.limitBrands = value;
        break;
      }
      case '--all-brands':
        options.allBrands = true;
        break;
      case '--brand':
        options.extraBrands.push(...splitList(readValue()));
        break;
      case '--only-brand':
        options.onlyBrands.push(...splitList(readValue()));
        break;
      case '--include-discontinued':
        options.includeDiscontinued = true;
        break;
      case '--delay': {
        const value = Number(readValue());
        if (!Number.isFinite(value) || value < 0) throw new Error('--delay должен быть числом >= 0');
        options.delay = value;
        break;
      }
      case '--retries': {
        const value = Number(readValue());
        if (!Number.isInteger(value) || value < 1) throw new Error('--retries должен быть целым числом >= 1');
        options.retries = value;
        break;
      }
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Неизвестный аргумент: ${arg}`);
    }
  }

  options.extraBrands = [...new Set(options.extraBrands.filter(Boolean))];
  options.onlyBrands = [...new Set(options.onlyBrands.filter(Boolean))];
  if (options.onlyBrands.length) {
    options.mode = 'clean';
  }
  return options;
}

function printHelp() {
  console.log(`DimHookah — импорт каталога HTReviews

Использование:
  node scraper.js [опции]

Опции:
  --out <file>              куда писать каталог (по умолчанию flavors.json)
  --merge                   обновить бренды, уже присутствующие в файле, + MUSTHAVE
  --clean                   собрать каталог заново из текущего рейтинга брендов
  --limit-brands <n>        сколько брендов брать в режиме --clean (по умолчанию 60; 0 = все)
  --all-brands              взять все бренды из рейтинга (то же, что --limit-brands 0)
  --brand <slug[,slug]>     дополнительно включить бренды (по умолчанию уже включён musthave)
  --only-brand <slug,...>   собрать только указанные бренды, игнорируя остальные
  --include-discontinued    включить вкусы со статусом «Снят с производства»
  --delay <ms>              пауза между запросами (по умолчанию ${DEFAULT_DELAY_MS})
  --retries <n>             число попыток при сетевых ошибках/5xx (по умолчанию 3)
  --dry-run                 не записывать файл
  --help                    показать эту справку

По умолчанию, если flavors.json существует, скрипт обновляет бренды из него
и добавляет MUSTHAVE, не удаляя остальные бренды. Если файла нет — собирает
топ-${DEFAULT_LIMIT_BRANDS} брендов текущего рейтинга.
`);
}

function readCatalog(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error(`${filePath}: ожидался JSON-массив`);
  return data;
}

async function writeCatalog(filePath, records) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await fs.promises.writeFile(tmpPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  await fs.promises.rename(tmpPath, filePath);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return null;
  }

  const outputPath = path.resolve(process.cwd(), options.out);
  let mode = options.mode;
  let existing = [];

  if (mode === 'auto') {
    if (fs.existsSync(outputPath)) {
      existing = readCatalog(outputPath);
      mode = existing.length ? 'merge' : 'clean';
    } else {
      mode = 'clean';
    }
  } else if (mode === 'merge') {
    if (fs.existsSync(outputPath)) {
      existing = readCatalog(outputPath);
    } else {
      console.warn(`Файл ${options.out} не найден — собираю каталог заново.`);
      mode = 'clean';
    }
  }

  if (options.onlyBrands.length) {
    mode = 'clean';
    existing = [];
  }

  console.log('=== DimHookah: каталог HTReviews ===');
  console.log(
    mode === 'merge'
      ? `Режим: обновление брендов из ${options.out}`
      : options.onlyBrands.length
        ? `Режим: только ${options.onlyBrands.join(', ')}`
        : `Режим: новый каталог, брендов: ${options.allBrands || options.limitBrands === 0 ? 'все' : options.limitBrands}`
  );

  const client = new HTReviewsClient({
    minInterval: options.delay,
    retries: options.retries,
    logger: console,
  });

  const result = await scrapeCatalog(client, {
    mode,
    existing,
    limitBrands: options.limitBrands,
    allBrands: options.allBrands,
    extraBrands: options.extraBrands,
    onlyBrands: options.onlyBrands,
    includeDiscontinued: options.includeDiscontinued,
    logger: console,
  });

  const summary = summarizeCatalog(result.records);
  const musthave = result.brands.find((brand) => brand.slug === 'musthave');

  console.log('');
  console.log(`Итого: ${summary.total} вкусов, ${summary.brands} бренд(ов)`);
  if (musthave) {
    console.log(
      `MUSTHAVE: ${summary.musthave} вкусов (${summary.musthaveActive} выпускается)` +
        (musthave.expected ? `, на HTReviews заявлено ${musthave.expected}` : '')
    );
  }
  if (summary.discontinued) {
    console.log(`Снято с производства: ${summary.discontinued}${options.includeDiscontinued ? '' : ' (исключены)'}`);
  }
  if (result.failed.length) {
    console.warn(`Не удалось обновить брендов: ${result.failed.length} — ${result.failed.map((item) => item.slug).join(', ')}`);
  }

  if (options.dryRun) {
    console.log('Dry-run: файл не изменён.');
  } else {
    await writeCatalog(outputPath, result.records);
    console.log(`Записано: ${path.relative(process.cwd(), outputPath)}`);
  }

  return { ...result, summary, outputPath, mode };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Парсер остановлен: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_OUTPUT,
  DEFAULT_LIMIT_BRANDS,
  DEFAULT_DELAY_MS,
  parseArgs,
  printHelp,
  readCatalog,
  writeCatalog,
  main,
};
