'use strict';

// Агрегатор тестов для запуска без `node --test`: в песочнице Windows
// встроенный runner пытается spawn-ить дочерний процесс и получает EPERM.
require('./htreviews.test.js');
require('./cli.test.js');
require('./catalog-core.test.js');
require('./catalog.test.js');
require('./live.test.js');
require('./ui.test.js');
