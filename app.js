// --- БАЗОВЫЕ КАТАЛОГИ ---
const DEFAULT_BOWLS = [
    "Космобоул Турка",
    "Космобоул мини",
    "Фокс убивашка",
    "Фанел"
];

const DEFAULT_BRANDS = [
    "Musthave (Мастхэв)",
    "Darkside (Дарксайд)",
    "Blackburn (Блэкберн)",
    "Наш",
    "Северный",
    "Deus (Деус)",
    "Bonche (Бонч)",
    "Overdose (Овердос)",
    "Chabacco (Чабакко)",
    "Tangiers (Танжирс)",
    "Element (Элемент)",
    "Sebero (Себеро)",
    "Spectrum (Спектрум)",
    "Satyr (Сатир)",
    "Duft (Дафт)",
    "Banger (Бэнгер)",
    "Burn (Бёрн)",
    "Daily Hookah (Дейли Хука)",
    "Starline (Старлайн)",
    "Trofimoff's (Трофимоффс)",
    "Jam (Джем)",
    "Brusko (Бруско)"
];

// Дефолтные цены и фасовки пачек (₽ / г) для удобного автозаполнения
const DEFAULT_BRAND_PACKS = {
    "Musthave (Мастхэв)": { price: 280, weight: 25 },
    "Darkside (Дарксайд)": { price: 360, weight: 30 },
    "Blackburn (Блэкберн)": { price: 330, weight: 25 },
    "Наш": { price: 420, weight: 40 },
    "Северный": { price: 420, weight: 40 },
    "Deus (Деус)": { price: 265, weight: 30 },
    "Bonche (Бонч)": { price: 850, weight: 30 },
    "Overdose (Овердос)": { price: 350, weight: 25 },
    "Chabacco (Чабакко)": { price: 220, weight: 25 },
    "Tangiers (Танжирс)": { price: 1050, weight: 50 },
    "Element (Элемент)": { price: 280, weight: 25 },
    "Sebero (Себеро)": { price: 300, weight: 25 }
};

let savedBowls = [];
let savedBrands = [];
let brandPackDefaults = {};
let coalInventory = { packSize: 72, packPrice: 700, remaining: 72 };
let currentAnalyticsPeriod = 'all';

let isMixMode = false;
let timerInterval = null;
let targetTimestamp = null;
let stepStartTime = null;
let actualWarmupDuration = 0;
let smokeDuration = 0;
let currentRating = 0;
let activeCoalsUsed = 3;
let alarmAlreadyPlayed = false;
let smokeReminder60Sent = false;
let smokeReminder90Sent = false;

let audioCtx = null;
let silentAudioUrl = null;
let lockedScrollY = 0;

// --- ЖЕЛЕЗОБЕТОННАЯ БЛОКИРОВКА СКРОЛЛА ФОНА ПОД МОДАЛКАМИ (ДЛЯ IOS SAFARI) ---
function syncBodyScrollLock() {
    const anyModalOpen = Array.from(document.querySelectorAll('.modal-backdrop'))
        .some(el => !el.classList.contains('hidden'));

    if (anyModalOpen) {
        if (!document.body.classList.contains('modal-open')) {
            lockedScrollY = window.scrollY || document.documentElement.scrollTop || 0;
            document.body.style.top = `-${lockedScrollY}px`;
            document.body.classList.add('modal-open');
        }
    } else {
        if (document.body.classList.contains('modal-open')) {
            document.body.classList.remove('modal-open');
            document.body.style.top = '';
            window.scrollTo(0, lockedScrollY);
        }
    }
}

function handleBackdropClick(event, modalId) {
    if (event.target && event.target.id === modalId) {
        if (modalId === 'edit-modal') closeEditModal();
        else if (modalId === 'manual-add-modal') closeManualAddModal();
        else if (modalId === 'roulette-modal') closeRouletteModal();
    }
}

// --- КАСТОМНЫЕ МОДАЛКИ ВМЕСТО CONFIRM И ALERT ---
function showIosConfirm(title, text, okLabel = 'Да', isDanger = true) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        if (!modal) {
            resolve(window.confirm(text));
            return;
        }
        document.getElementById('confirm-modal-title').innerText = title;
        document.getElementById('confirm-modal-text').innerText = text;

        const okBtn = document.getElementById('confirm-ok-btn');
        const cancelBtn = document.getElementById('confirm-cancel-btn');

        okBtn.innerText = okLabel;
        okBtn.className = isDanger ? 'btn btn-danger' : 'btn';

        const cleanup = (result) => {
            modal.classList.add('hidden');
            syncBodyScrollLock();
            okBtn.onclick = null;
            cancelBtn.onclick = null;
            resolve(result);
        };

        okBtn.onclick = () => cleanup(true);
        cancelBtn.onclick = () => cleanup(false);
        modal.classList.remove('hidden');
        syncBodyScrollLock();
    });
}

function showIosNotice(title, text) {
    return new Promise((resolve) => {
        const modal = document.getElementById('notice-modal');
        if (!modal) {
            alert(text);
            resolve();
            return;
        }
        document.getElementById('notice-modal-title').innerText = title;
        document.getElementById('notice-modal-text').innerText = text;

        const okBtn = document.getElementById('notice-ok-btn');
        okBtn.onclick = () => {
            modal.classList.add('hidden');
            syncBodyScrollLock();
            okBtn.onclick = null;
            resolve();
        };
        modal.classList.remove('hidden');
        syncBodyScrollLock();
    });
}

// --- ТЕМА ОФОРМЛЕНИЯ ---
function initTheme() {
    const savedMode = localStorage.getItem('hookah_theme_mode') || 'auto';
    applyThemeMode(savedMode);

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        const currentMode = localStorage.getItem('hookah_theme_mode') || 'auto';
        if (currentMode === 'auto') applyThemeMode('auto');
    });
}

function setThemeMode(mode) {
    localStorage.setItem('hookah_theme_mode', mode);
    applyThemeMode(mode);
}

function applyThemeMode(mode) {
    const root = document.documentElement;
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === mode);
    });

    if (mode === 'dark') {
        root.setAttribute('data-theme', 'dark');
    } else if (mode === 'light') {
        root.removeAttribute('data-theme');
    } else {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (prefersDark) root.setAttribute('data-theme', 'dark');
        else root.removeAttribute('data-theme');
    }
}

// --- ЗВУК, ОПОВЕЩЕНИЯ И ЭКРАН БЛОКИРОВКИ ---
function initAudio() {
    if (!audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) audioCtx = new AudioContext();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    prepareKeepAliveAudio();
}

function prepareKeepAliveAudio() {
    if (silentAudioUrl) return;
    const sampleRate = 8000;
    const numSamples = sampleRate;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    const writeString = (offset, str) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, numSamples * 2, true);

    for (let i = 0; i < numSamples; i++) {
        view.setInt16(44 + i * 2, 1, true);
    }

    const blob = new Blob([buffer], { type: 'audio/wav' });
    silentAudioUrl = URL.createObjectURL(blob);
    const audioEl = document.getElementById('bg-audio');
    if (audioEl) {
        audioEl.src = silentAudioUrl;
        audioEl.volume = 0.01;
    }
}

function startKeepAliveAudio(titleText, subtitleText) {
    prepareKeepAliveAudio();
    const audioEl = document.getElementById('bg-audio');
    if (audioEl) {
        audioEl.play().catch(() => { });
    }
    updateLockScreenMetadata(titleText, subtitleText);
}

function stopKeepAliveAudio() {
    const audioEl = document.getElementById('bg-audio');
    if (audioEl) {
        audioEl.pause();
    }
    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'none';
    }
}

function updateLockScreenMetadata(title, artist) {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: title || 'DimHookah',
            artist: artist || 'Контроль сессии',
            album: 'DimHookah Timer',
            artwork: [{ src: 'icon.png', sizes: '192x192', type: 'image/png' }]
        });
        navigator.mediaSession.playbackState = 'playing';
    }
}

function playBeep() {
    try {
        initAudio();
        if (!audioCtx) return;
        const now = audioCtx.currentTime;
        for (let i = 0; i < 4; i++) {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, now + i * 0.32);
            gain.gain.setValueAtTime(0.35, now + i * 0.32);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.32 + 0.24);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now + i * 0.32);
            osc.stop(now + i * 0.32 + 0.25);
        }
    } catch (e) { }
    if (navigator.vibrate) navigator.vibrate([350, 150, 350, 150, 400]);
}

function showBannerToast(msg) {
    const toast = document.getElementById('toast-notification');
    if (!toast) return;
    toast.innerText = msg;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 4000);
}

function sendPush(title, body) {
    showBannerToast(`${title}: ${body}`);
    if ("Notification" in window && Notification.permission === "granted") {
        try {
            if (navigator.serviceWorker && navigator.serviceWorker.ready) {
                navigator.serviceWorker.ready.then(reg => {
                    reg.showNotification(title, { body, icon: 'icon.png', vibrate: [200, 100, 200] });
                });
            } else {
                new Notification(title, { body, icon: 'icon.png' });
            }
        } catch (e) { }
    }
}

// --- STORAGE: INDEXEDDB + LOCALSTORAGE ---
const dbName = "HookahDB";
let db;

const request = indexedDB.open(dbName, 2);
request.onupgradeneeded = function (event) {
    db = event.target.result;
    if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "id", autoIncrement: true });
    }
};
request.onsuccess = function (event) {
    db = event.target.result;
    loadAllData(renderData);
};
request.onerror = function () {
    loadAllData(renderData);
};

function saveSessionsToStorage(sessions, callback) {
    localStorage.setItem('hookah_sessions', JSON.stringify(sessions));
    if (db) {
        try {
            const tx = db.transaction(["sessions"], "readwrite");
            const store = tx.objectStore("sessions");
            store.clear();
            sessions.forEach(s => store.put(s));
            tx.oncomplete = () => { if (callback) callback(); };
        } catch (e) {
            if (callback) callback();
        }
    } else if (callback) {
        callback();
    }
}

function loadAllData(callback) {
    let localData = JSON.parse(localStorage.getItem('hookah_sessions') || '[]');
    if (db) {
        try {
            const tx = db.transaction(["sessions"], "readonly");
            const store = tx.objectStore("sessions");
            const getAll = store.getAll();
            getAll.onsuccess = function () {
                const dbData = getAll.result || [];
                const finalData = dbData.length >= localData.length ? dbData : localData;
                localStorage.setItem('hookah_sessions', JSON.stringify(finalData));
                callback(finalData);
            };
            getAll.onerror = () => callback(localData);
        } catch (e) {
            callback(localData);
        }
    } else {
        callback(localData);
    }
}

// --- КАТАЛОГИ ЧАШ, БРЕНДОВ, ЦЕН ПАЧЕК И СКЛАДА УГЛЕЙ ---
function initCatalogs() {
    const storedBowls = JSON.parse(localStorage.getItem('hookah_bowls') || '[]');
    const storedBrands = JSON.parse(localStorage.getItem('hookah_brands') || '[]');
    const storedPacks = JSON.parse(localStorage.getItem('hookah_brand_packs') || '{}');
    const storedCoals = JSON.parse(localStorage.getItem('hookah_coal_inventory') || 'null');

    savedBowls = Array.from(new Set([...DEFAULT_BOWLS, ...storedBowls]));
    savedBrands = Array.from(new Set([...DEFAULT_BRANDS, ...storedBrands]));
    brandPackDefaults = { ...DEFAULT_BRAND_PACKS, ...storedPacks };

    if (storedCoals && typeof storedCoals === 'object') {
        coalInventory = {
            packSize: parseInt(storedCoals.packSize) || 72,
            packPrice: parseFloat(storedCoals.packPrice) || 700,
            remaining: parseInt(storedCoals.remaining) ?? 72
        };
    }

    localStorage.setItem('hookah_bowls', JSON.stringify(savedBowls));
    localStorage.setItem('hookah_brands', JSON.stringify(savedBrands));
    localStorage.setItem('hookah_brand_packs', JSON.stringify(brandPackDefaults));
    localStorage.setItem('hookah_coal_inventory', JSON.stringify(coalInventory));

    populateSelects();
    renderCoalInventoryUI();
}

function getBowlOptionsHtml(selectedVal = '') {
    return savedBowls.map(b => `<option value="${b}" ${b === selectedVal ? 'selected' : ''}>${b}</option>`).join('');
}

function getBrandOptionsHtml(selectedVal = '') {
    const options = savedBrands.map(b => `<option value="${b}" ${b === selectedVal ? 'selected' : ''}>${b}</option>`).join('');
    return `${options}<option value="__custom__">➕ Другой бренд...</option>`;
}

function populateSelects() {
    const bowlSelect = document.getElementById('bowl-select');
    if (bowlSelect) {
        const currentVal = bowlSelect.value;
        bowlSelect.innerHTML = getBowlOptionsHtml(currentVal);
    }

    const soloBrand = document.getElementById('solo-tobacco-brand');
    if (soloBrand) {
        const currentBrand = soloBrand.value && soloBrand.value !== '__custom__' ? soloBrand.value : savedBrands[0];
        soloBrand.innerHTML = getBrandOptionsHtml(currentBrand);
        fillPackInputsForBrand('solo', soloBrand.value);
    }
    recalcLiveBowlCost();
}

function fillPackInputsForBrand(mode, brandName, rowEl = null) {
    const pack = brandPackDefaults[brandName];
    if (mode === 'solo') {
        const priceEl = document.getElementById('solo-pack-price');
        const weightEl = document.getElementById('solo-pack-weight');
        if (priceEl && weightEl) {
            priceEl.value = pack ? pack.price : '';
            weightEl.value = pack ? pack.weight : '';
        }
    } else if (rowEl) {
        const priceEl = rowEl.querySelector('.mix-pack-price');
        const weightEl = rowEl.querySelector('.mix-pack-weight');
        if (priceEl && weightEl) {
            priceEl.value = pack ? pack.price : '';
            weightEl.value = pack ? pack.weight : '';
        }
    }
}

function onPackInfoChange(mode, inputEl = null) {
    if (mode === 'solo') {
        const brandSel = document.getElementById('solo-tobacco-brand');
        const customBrand = document.getElementById('solo-custom-brand');
        const brand = brandSel.value === '__custom__' ? customBrand.value.trim() : brandSel.value;
        const price = parseFloat(document.getElementById('solo-pack-price').value);
        const weight = parseFloat(document.getElementById('solo-pack-weight').value);
        if (brand && price > 0 && weight > 0) {
            brandPackDefaults[brand] = { price, weight };
            localStorage.setItem('hookah_brand_packs', JSON.stringify(brandPackDefaults));
        }
    } else if (inputEl) {
        const card = inputEl.closest('.tobacco-card-box');
        if (card) {
            const sel = card.querySelector('.brand-select');
            const custom = card.querySelector('.custom-brand-input');
            const brand = sel.value === '__custom__' ? custom.value.trim() : sel.value;
            const price = parseFloat(card.querySelector('.mix-pack-price').value);
            const weight = parseFloat(card.querySelector('.mix-pack-weight').value);
            if (brand && price > 0 && weight > 0) {
                brandPackDefaults[brand] = { price, weight };
                localStorage.setItem('hookah_brand_packs', JSON.stringify(brandPackDefaults));
            }
        }
    }
    recalcLiveBowlCost();
}

function toggleQuickAddBowl() {
    const box = document.getElementById('quick-bowl-box');
    box.classList.toggle('hidden');
    if (!box.classList.contains('hidden')) {
        document.getElementById('new-bowl-input').focus();
    }
}

function addCustomBowl() {
    const input = document.getElementById('new-bowl-input');
    const name = input.value.trim();
    if (!name) return;

    if (!savedBowls.includes(name)) {
        savedBowls.unshift(name);
        localStorage.setItem('hookah_bowls', JSON.stringify(savedBowls));
    }
    populateSelects();
    document.getElementById('bowl-select').value = name;
    input.value = '';
    document.getElementById('quick-bowl-box').classList.add('hidden');
    showBannerToast(`Чаша «${name}» добавлена`);
}

function onBrandSelectChange(selectEl) {
    const card = selectEl.closest('.tobacco-card-box') || selectEl.parentElement.parentElement;
    const customInput = card.querySelector('.custom-brand-input');
    if (!customInput) return;

    if (selectEl.value === '__custom__') {
        customInput.classList.remove('hidden');
        customInput.focus();
    } else {
        customInput.classList.add('hidden');
        if (selectEl.id === 'solo-tobacco-brand') {
            fillPackInputsForBrand('solo', selectEl.value);
        } else {
            fillPackInputsForBrand('mix', selectEl.value, card);
        }
    }
    recalcLiveBowlCost();
}

function onManualBrandChange(selectEl) {
    const customInput = document.getElementById('manual-custom-brand');
    if (!customInput) return;
    if (selectEl.value === '__custom__') {
        customInput.classList.remove('hidden');
        customInput.focus();
    } else {
        customInput.classList.add('hidden');
    }
}

function ensureBrandSaved(brandName) {
    const clean = (brandName || '').trim();
    if (clean && clean !== '__custom__' && !savedBrands.includes(clean)) {
        savedBrands.push(clean);
        localStorage.setItem('hookah_brands', JSON.stringify(savedBrands));
    }
}

// --- КАЛЬКУЛЯТОР СЕБЕСТОИМОСТИ И СКЛАД УГЛЕЙ ---
function getSingleCoalPrice() {
    if (!coalInventory.packSize || coalInventory.packSize <= 0) return 0;
    return coalInventory.packPrice / coalInventory.packSize;
}

function calcSingleTobaccoCost(grams, packPrice, packWeight) {
    const g = parseFloat(grams) || 0;
    const p = parseFloat(packPrice) || 0;
    const w = parseFloat(packWeight) || 0;
    if (g <= 0 || p <= 0 || w <= 0) return 0;
    return (g / w) * p;
}

function recalcLiveBowlCost() {
    let tobaccoCost = 0;
    let totalGrams = 0;

    if (!isMixMode) {
        const g = parseFloat(document.getElementById('solo-tobacco-weight')?.value) || 0;
        const p = parseFloat(document.getElementById('solo-pack-price')?.value) || 0;
        const w = parseFloat(document.getElementById('solo-pack-weight')?.value) || 0;
        totalGrams = g;
        tobaccoCost = calcSingleTobaccoCost(g, p, w);
    } else {
        document.querySelectorAll('#mix-rows-list .tobacco-card-box').forEach(card => {
            const g = parseFloat(card.querySelector('.weight-input')?.value) || 0;
            const p = parseFloat(card.querySelector('.mix-pack-price')?.value) || 0;
            const w = parseFloat(card.querySelector('.mix-pack-weight')?.value) || 0;
            totalGrams += g;
            tobaccoCost += calcSingleTobaccoCost(g, p, w);
        });
        const badge = document.getElementById('mix-total-weight');
        if (badge) badge.innerText = `Всего: ${totalGrams} г`;
    }

    const startCoals = parseInt(document.getElementById('start-coals-input')?.value) || 0;
    const coalCost = startCoals * getSingleCoalPrice();
    const totalCost = Math.round(tobaccoCost + coalCost);

    const detailsEl = document.getElementById('live-cost-details');
    const totalEl = document.getElementById('live-cost-total');
    if (detailsEl && totalEl) {
        detailsEl.innerText = `Табак (${totalGrams} г): ${Math.round(tobaccoCost)} ₽ • Угли (${startCoals} шт): ${Math.round(coalCost)} ₽`;
        totalEl.innerText = `${totalCost} ₽`;
    }
}

function renderCoalInventoryUI() {
    const oneCoal = getSingleCoalPrice();
    const infoEl = document.getElementById('coal-price-info');
    const remEl = document.getElementById('coal-stock-remaining');
    const badgeEl = document.getElementById('coal-low-badge');

    if (infoEl) {
        infoEl.innerText = `1 уголь ≈ ${oneCoal.toFixed(1)} ₽ (Пачка ${coalInventory.packSize} шт = ${coalInventory.packPrice} ₽)`;
    }
    if (remEl) {
        remEl.innerText = coalInventory.remaining;
    }
    if (badgeEl) {
        badgeEl.classList.toggle('hidden', coalInventory.remaining > 12);
    }

    const sizeInput = document.getElementById('coal-pack-size-input');
    const priceInput = document.getElementById('coal-pack-price-input');
    const stockInput = document.getElementById('coal-current-stock-input');
    if (sizeInput) sizeInput.value = coalInventory.packSize;
    if (priceInput) priceInput.value = coalInventory.packPrice;
    if (stockInput) stockInput.value = coalInventory.remaining;
}

function toggleCoalSettings() {
    document.getElementById('coal-settings-panel').classList.toggle('hidden');
}

function saveCoalInventorySettings() {
    const size = parseInt(document.getElementById('coal-pack-size-input').value) || 72;
    const price = parseFloat(document.getElementById('coal-pack-price-input').value) || 700;
    const rem = parseInt(document.getElementById('coal-current-stock-input').value);

    coalInventory.packSize = Math.max(1, size);
    coalInventory.packPrice = Math.max(0, price);
    coalInventory.remaining = isNaN(rem) ? coalInventory.packSize : Math.max(0, rem);

    localStorage.setItem('hookah_coal_inventory', JSON.stringify(coalInventory));
    renderCoalInventoryUI();
    recalcLiveBowlCost();
    document.getElementById('coal-settings-panel').classList.add('hidden');
    showBannerToast('Настройки углей сохранены');
}

function buyNewCoalPack() {
    coalInventory.remaining += coalInventory.packSize;
    localStorage.setItem('hookah_coal_inventory', JSON.stringify(coalInventory));
    renderCoalInventoryUI();
    showBannerToast(`+${coalInventory.packSize} углей добавлено на склад!`);
}

function consumeCoalsFromStock(count) {
    const c = parseInt(count) || 0;
    coalInventory.remaining = Math.max(0, coalInventory.remaining - c);
    localStorage.setItem('hookah_coal_inventory', JSON.stringify(coalInventory));
    renderCoalInventoryUI();
}

// --- ПЕРЕКЛЮЧАТЕЛЬ СОЛО / МИКС ---
function toggleMixMode() {
    const toggle = document.getElementById('mix-mode-toggle');
    isMixMode = toggle.checked;

    const soloContainer = document.getElementById('solo-container');
    const mixContainer = document.getElementById('mix-container');
    const modeLabel = document.getElementById('mode-label');

    if (isMixMode) {
        soloContainer.classList.add('hidden');
        mixContainer.classList.remove('hidden');
        modeLabel.innerText = 'Режим: Микс (Несколько вкусов)';
        const list = document.getElementById('mix-rows-list');
        if (list.children.length === 0) {
            addMixRow(savedBrands[0], '', 12);
            addMixRow(savedBrands[1] || savedBrands[0], '', 8);
        }
    } else {
        soloContainer.classList.remove('hidden');
        mixContainer.classList.add('hidden');
        modeLabel.innerText = 'Режим: Соло (1 табак)';
    }
    recalcLiveBowlCost();
}

function addMixRow(brand = '', flavor = '', weight = '') {
    const list = document.getElementById('mix-rows-list');
    const selectedBrand = brand || savedBrands[0];
    const pack = brandPackDefaults[selectedBrand] || { price: '', weight: '' };

    const card = document.createElement('div');
    card.className = 'tobacco-card-box';
    card.innerHTML = `
        <div class="tobacco-row">
            <select class="brand-select" onchange="onBrandSelectChange(this)">
                ${getBrandOptionsHtml(selectedBrand)}
            </select>
            <input type="text" class="flavor-input" placeholder="Вкус" value="${flavor}">
            <input type="number" class="weight-input" placeholder="Гр" value="${weight}" min="1" max="100" oninput="recalcLiveBowlCost()">
            <button type="button" class="remove-mix-btn" onclick="removeMixRow(this)">✕</button>
        </div>
        <input type="text" class="custom-brand-input hidden" placeholder="Введите название бренда..." oninput="recalcLiveBowlCost()">
        <div class="pack-price-row">
            <div class="pack-input-wrap">
                <span>Пачка ₽:</span>
                <input type="number" class="mix-pack-price" placeholder="280" value="${pack.price}" min="0" oninput="onPackInfoChange('mix', this)">
            </div>
            <div class="pack-input-wrap">
                <span>Вес (г):</span>
                <input type="number" class="mix-pack-weight" placeholder="25" value="${pack.weight}" min="1" oninput="onPackInfoChange('mix', this)">
            </div>
        </div>
    `;
    list.appendChild(card);
    recalcLiveBowlCost();
}

function removeMixRow(btn) {
    const list = document.getElementById('mix-rows-list');
    if (list.children.length <= 1) {
        showBannerToast('В миксе должен быть хотя бы 1 табак');
        return;
    }
    btn.closest('.tobacco-card-box').remove();
    recalcLiveBowlCost();
}

function getDraftMixFromForm() {
    if (!isMixMode) {
        const brandSelect = document.getElementById('solo-tobacco-brand');
        const customBrand = document.getElementById('solo-custom-brand').value.trim();
        const brand = brandSelect.value === '__custom__' ? (customBrand || 'Свой табак') : brandSelect.value;
        const flavor = document.getElementById('solo-tobacco-flavor').value.trim();
        const weight = parseFloat(document.getElementById('solo-tobacco-weight').value) || 0;
        const packPrice = parseFloat(document.getElementById('solo-pack-price').value) || 0;
        const packWeight = parseFloat(document.getElementById('solo-pack-weight').value) || 0;
        const cost = Math.round(calcSingleTobaccoCost(weight, packPrice, packWeight));

        ensureBrandSaved(brand);
        return [{ brand, flavor, weight, packPrice, packWeight, cost }];
    } else {
        const items = [];
        document.querySelectorAll('#mix-rows-list .tobacco-card-box').forEach(card => {
            const sel = card.querySelector('.brand-select');
            const custom = card.querySelector('.custom-brand-input').value.trim();
            const brand = sel.value === '__custom__' ? (custom || 'Свой табак') : sel.value;
            const flavor = card.querySelector('.flavor-input').value.trim();
            const weight = parseFloat(card.querySelector('.weight-input').value) || 0;
            const packPrice = parseFloat(card.querySelector('.mix-pack-price').value) || 0;
            const packWeight = parseFloat(card.querySelector('.mix-pack-weight').value) || 0;
            const cost = Math.round(calcSingleTobaccoCost(weight, packPrice, packWeight));

            ensureBrandSaved(brand);
            if (brand || flavor || weight > 0) {
                items.push({ brand, flavor, weight, packPrice, packWeight, cost });
            }
        });
        return items.length ? items : [{ brand: savedBrands[0], flavor: '', weight: 0, packPrice: 0, packWeight: 0, cost: 0 }];
    }
}

function formatMixText(mixArray) {
    if (!Array.isArray(mixArray) || mixArray.length === 0) return 'Табак не указан';
    return mixArray.map(item => {
        const namePart = item.flavor ? `${item.brand} (${item.flavor})` : item.brand;
        const weightPart = item.weight ? ` <span class="mix-tag">${item.weight}г</span>` : '';
        return `${namePart}${weightPart}`;
    }).join(' + ');
}

function formatMixPlainText(mixArray) {
    if (!Array.isArray(mixArray) || mixArray.length === 0) return 'Без названия';
    return mixArray.map(item => {
        const namePart = item.flavor ? `${item.brand} ${item.flavor}` : item.brand;
        const weightPart = item.weight ? ` (${item.weight}г)` : '';
        return `${namePart}${weightPart}`;
    }).join(' + ');
}

// --- БЫСТРЫЕ ПРЕСЕТЫ ПРОГРЕВА ---
function setWarmupPreset(min, sec) {
    document.getElementById('warmup-min').value = min;
    document.getElementById('warmup-sec').value = sec;
}

// --- СОХРАНЕНИЕ И ВОССТАНОВЛЕНИЕ АКТИВНОЙ СЕССИИ ---
function saveActiveSessionState(stage) {
    const state = {
        stage,
        targetTimestamp,
        stepStartTime,
        actualWarmupDuration,
        smokeDuration,
        activeCoalsUsed,
        alarmAlreadyPlayed,
        bowl: document.getElementById('bowl-select')?.value || '',
        placement: document.getElementById('coal-placement')?.value || '',
        mix: getDraftMixFromForm()
    };
    localStorage.setItem('hookah_active_session', JSON.stringify(state));
}

function clearActiveSessionState() {
    localStorage.removeItem('hookah_active_session');
}

function restoreActiveSessionIfAny() {
    const raw = localStorage.getItem('hookah_active_session');
    if (!raw) return;

    try {
        const state = JSON.parse(raw);
        if (!state || !state.stage) return;

        targetTimestamp = state.targetTimestamp;
        stepStartTime = state.stepStartTime;
        actualWarmupDuration = state.actualWarmupDuration || 0;
        smokeDuration = state.smokeDuration || 0;
        activeCoalsUsed = state.activeCoalsUsed || 3;
        alarmAlreadyPlayed = !!state.alarmAlreadyPlayed;

        if (state.bowl) document.getElementById('bowl-select').value = state.bowl;
        if (state.placement) document.getElementById('coal-placement').value = state.placement;

        const coalCounterEl = document.getElementById('active-coals-count');
        if (coalCounterEl) coalCounterEl.innerText = activeCoalsUsed;

        document.getElementById('setup-form').classList.add('hidden');
        document.getElementById('active-session').classList.remove('hidden');
        document.getElementById('active-mix-label').innerText = formatMixPlainText(state.mix);

        if (state.stage === 'warmup') {
            document.getElementById('status-title').innerText = '🔥 Прогрев чаши...';
            document.getElementById('warmup-controls').classList.remove('hidden');
            document.getElementById('smoking-controls').classList.add('hidden');
            document.getElementById('rating-form').classList.add('hidden');

            clearInterval(timerInterval);
            timerInterval = setInterval(updateWarmupTimer, 1000);
            updateWarmupTimer();
        } else if (state.stage === 'smoking') {
            document.getElementById('status-title').innerText = '💨 Идет покур';
            document.getElementById('warmup-controls').classList.add('hidden');
            document.getElementById('smoking-controls').classList.remove('hidden');
            document.getElementById('rating-form').classList.add('hidden');

            clearInterval(timerInterval);
            timerInterval = setInterval(updateSmokingTimer, 1000);
            updateSmokingTimer();
        } else if (state.stage === 'rating') {
            document.getElementById('status-title').innerText = '✅ Сессия завершена';
            document.getElementById('warmup-controls').classList.add('hidden');
            document.getElementById('smoking-controls').classList.add('hidden');
            document.getElementById('rating-form').classList.remove('hidden');
            document.getElementById('timer').innerText = formatTimerSec(smokeDuration);

            const forgottenBox = document.getElementById('forgotten-timer-box');
            const rawTimeEl = document.getElementById('forgotten-raw-time');
            if (forgottenBox && smokeDuration > 5400) {
                if (rawTimeEl) rawTimeEl.innerText = formatDurationHM(smokeDuration);
                forgottenBox.classList.remove('hidden');
            }
        }
    } catch (e) {
        console.warn('Ошибка восстановления сессии, но данные сохранены:', e);
    }
}

// --- ЛОГИКА ТАЙМЕРА ПРОГРЕВА И ПОКУРА ---
function startWarmupSession() {
    initAudio();
    if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
    }

    const mins = parseInt(document.getElementById('warmup-min').value) || 0;
    const secs = parseInt(document.getElementById('warmup-sec').value) || 0;
    const totalSeconds = (mins * 60) + secs;

    if (totalSeconds <= 0) {
        showIosNotice("Время прогрева", "Укажи корректное время прогрева чаши!");
        return;
    }

    const mix = getDraftMixFromForm();
    populateSelects();

    activeCoalsUsed = parseInt(document.getElementById('start-coals-input').value) || 3;
    consumeCoalsFromStock(activeCoalsUsed);
    document.getElementById('active-coals-count').innerText = activeCoalsUsed;

    document.getElementById('setup-form').classList.add('hidden');
    document.getElementById('active-session').classList.remove('hidden');
    document.getElementById('warmup-controls').classList.remove('hidden');
    document.getElementById('smoking-controls').classList.add('hidden');
    document.getElementById('rating-form').classList.add('hidden');
    document.getElementById('warmup-box').classList.remove('alarm-active');

    document.getElementById('status-title').innerText = '🔥 Прогрев чаши...';
    const mixText = formatMixPlainText(mix);
    document.getElementById('active-mix-label').innerText = mixText;

    stepStartTime = Date.now();
    targetTimestamp = stepStartTime + (totalSeconds * 1000);
    alarmAlreadyPlayed = false;

    saveActiveSessionState('warmup');
    startKeepAliveAudio('🔥 Прогрев чаши', mixText);

    clearInterval(timerInterval);
    timerInterval = setInterval(updateWarmupTimer, 1000);
    updateWarmupTimer();
}

function updateWarmupTimer() {
    const now = Date.now();
    const remaining = Math.ceil((targetTimestamp - now) / 1000);

    if (remaining <= 0) {
        document.getElementById('timer').innerText = "00:00";
        document.getElementById('status-title').innerText = "🚨 Чаша прогрелась! Пора раскуривать!";
        document.getElementById('warmup-box').classList.add('alarm-active');
        updateLockScreenMetadata('🚨 Чаша готова!', 'Пора раскуривать кальян');

        if (!alarmAlreadyPlayed) {
            alarmAlreadyPlayed = true;
            playBeep();
            sendPush("Кальян готов! 💨", "Чаша прогрелась, пора раскуривать!");
            saveActiveSessionState('warmup');
        }
        return;
    }

    const formatted = formatTimerSec(remaining);
    document.getElementById('timer').innerText = formatted;
    updateLockScreenMetadata(`🔥 Прогрев: ${formatted}`, getCurrentMixSummaryText());
}

function addWarmupMinute() {
    initAudio();
    const now = Date.now();
    if (targetTimestamp < now) {
        targetTimestamp = now + 60000;
    } else {
        targetTimestamp += 60000;
    }
    alarmAlreadyPlayed = false;
    document.getElementById('warmup-box').classList.remove('alarm-active');
    document.getElementById('status-title').innerText = "🔥 Прогрев чаши (+1 мин)...";
    saveActiveSessionState('warmup');
    updateWarmupTimer();
}

function addExtraCoalInSession(count) {
    activeCoalsUsed += count;
    document.getElementById('active-coals-count').innerText = activeCoalsUsed;
    consumeCoalsFromStock(count);
    saveActiveSessionState('smoking');
    showBannerToast(`+${count} уголь добавлен к сессии`);
}

function startSmokingFromWarmup() {
    initAudio();
    actualWarmupDuration = Math.floor((Date.now() - stepStartTime) / 1000);

    document.getElementById('warmup-box').classList.remove('alarm-active');
    document.getElementById('status-title').innerText = '💨 Идет покур';
    document.getElementById('active-mix-label').innerText = getCurrentMixSummaryText();
    document.getElementById('warmup-controls').classList.add('hidden');
    document.getElementById('smoking-controls').classList.remove('hidden');

    stepStartTime = Date.now();
    smokeReminder60Sent = false;
    smokeReminder90Sent = false;
    saveActiveSessionState('smoking');
    startKeepAliveAudio('💨 Покур: 00:00', getCurrentMixSummaryText());

    clearInterval(timerInterval);
    timerInterval = setInterval(updateSmokingTimer, 1000);
    updateSmokingTimer();
}

function updateSmokingTimer() {
    const elapsedSmoke = Math.floor((Date.now() - stepStartTime) / 1000);
    const formatted = formatTimerSec(elapsedSmoke);
    document.getElementById('timer').innerText = formatted;
    updateLockScreenMetadata(`💨 Покур: ${formatted}`, getCurrentMixSummaryText());

    if (elapsedSmoke >= 3600 && elapsedSmoke < 5400 && !smokeReminder60Sent) {
        smokeReminder60Sent = true;
        sendPush('Идет 2-й час покура 💨', 'Кальян ещё курится или пора завершить сессию?');
    }

    if (elapsedSmoke >= 5400 && !smokeReminder90Sent) {
        smokeReminder90Sent = true;
        sendPush('Покур идет уже 1.5 часа ⏳', 'Не забудь остановить таймер в DimHookah, чтобы не испортить статистику!');
    }

    if (elapsedSmoke >= 9000) {
        finishSmokingSession();
    }
}

function finishSmokingSession() {
    smokeDuration = Math.floor((Date.now() - stepStartTime) / 1000);
    clearInterval(timerInterval);
    stopKeepAliveAudio();

    document.getElementById('status-title').innerText = '✅ Сессия завершена';
    document.getElementById('timer').innerText = formatTimerSec(smokeDuration);
    document.getElementById('smoking-controls').classList.add('hidden');
    document.getElementById('rating-form').classList.remove('hidden');

    const forgottenBox = document.getElementById('forgotten-timer-box');
    const rawTimeEl = document.getElementById('forgotten-raw-time');
    if (forgottenBox) {
        if (smokeDuration > 5400) {
            if (rawTimeEl) rawTimeEl.innerText = formatDurationHM(smokeDuration);
            forgottenBox.classList.remove('hidden');
        } else {
            forgottenBox.classList.add('hidden');
        }
    }

    saveActiveSessionState('rating');
}

function applyQuickSmokeDuration(mins) {
    smokeDuration = mins * 60;
    document.getElementById('timer').innerText = formatTimerSec(smokeDuration);
    document.getElementById('forgotten-timer-box')?.classList.add('hidden');
    saveActiveSessionState('rating');
}

async function cancelActiveSession() {
    const confirmed = await showIosConfirm(
        'Отмена сессии',
        'Точно отменить текущую сессию без сохранения?',
        'Отменить сессию',
        true
    );
    if (!confirmed) return;

    clearInterval(timerInterval);
    stopKeepAliveAudio();
    clearActiveSessionState();

    document.getElementById('active-session').classList.add('hidden');
    document.getElementById('setup-form').classList.remove('hidden');
}

function getCurrentMixSummaryText() {
    const raw = localStorage.getItem('hookah_active_session');
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (parsed.mix) return formatMixPlainText(parsed.mix);
        } catch (e) { }
    }
    return formatMixPlainText(getDraftMixFromForm());
}

// --- СОХРАНЕНИЕ ЗАВЕРШЕННОЙ СЕССИИ ---
document.querySelectorAll('.star').forEach(star => {
    star.addEventListener('click', function () {
        currentRating = parseInt(this.getAttribute('data-value'));
        document.querySelectorAll('.star').forEach(s => {
            s.classList.toggle('active', parseInt(s.getAttribute('data-value')) <= currentRating);
        });
    });
});

function showSaveSuccessOverlay() {
    const overlay = document.getElementById('save-success-overlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    if (navigator.vibrate) navigator.vibrate([80, 50, 120]);
    setTimeout(() => {
        overlay.classList.add('hidden');
    }, 1350);
}

function saveCompletedSession() {
    if (currentRating === 0) {
        showIosNotice("Оценка покура", "Пожалуйста, поставьте оценку от 1 до 5 звезд!");
        return;
    }

    let savedState = null;
    try {
        savedState = JSON.parse(localStorage.getItem('hookah_active_session'));
    } catch (e) { }

    const mix = (savedState && savedState.mix) ? savedState.mix : getDraftMixFromForm();
    const bowl = (savedState && savedState.bowl) ? savedState.bowl : document.getElementById('bowl-select').value;
    const placement = (savedState && savedState.placement) ? savedState.placement : document.getElementById('coal-placement').value;
    const coalsUsed = activeCoalsUsed || 3;

    const tobaccoCost = mix.reduce((acc, item) => acc + (item.cost || 0), 0);
    const coalCost = Math.round(coalsUsed * getSingleCoalPrice());
    const sessionCost = Math.round(tobaccoCost + coalCost);

    const session = {
        id: Date.now(),
        date: new Date().toLocaleDateString('ru-RU'),
        bowl,
        mix,
        placement,
        coalsUsed,
        coalCost,
        sessionCost,
        actualWarmupDuration,
        smokeDuration,
        rating: currentRating,
        comment: document.getElementById('comment').value.trim()
    };

    loadAllData(function (sessions) {
        sessions.push(session);
        saveSessionsToStorage(sessions, () => {
            clearActiveSessionState();
            resetUI();
            renderData(sessions);
            showSaveSuccessOverlay();
        });
    });
}

function resetUI() {
    document.getElementById('setup-form').classList.remove('hidden');
    document.getElementById('active-session').classList.add('hidden');
    document.getElementById('comment').value = '';
    document.getElementById('solo-tobacco-flavor').value = '';
    currentRating = 0;
    document.querySelectorAll('.star').forEach(s => s.classList.remove('active'));
    recalcLiveBowlCost();
}

// --- ВЫПАДАЮЩИЙ КАЛЕНДАРЬ ПЕРИОДОВ И КАРТА ПОБЕД ---
const MONTH_NAMES_RU = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

function getSessionMonthKey(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('.');
    if (parts.length !== 3) return null;
    return `${parts[2]}-${parts[1]}`;
}

function formatMonthKeyLabel(monthKey) {
    if (monthKey === 'all') return 'За всё время';
    const [year, month] = monthKey.split('-');
    const mIndex = parseInt(month, 10) - 1;
    return `${MONTH_NAMES_RU[mIndex] || month} ${year}`;
}

function togglePeriodDropdown(e) {
    e.stopPropagation();
    const menu = document.getElementById('period-dropdown-menu');
    if (menu) menu.classList.toggle('hidden');
}

document.addEventListener('click', () => {
    const menu = document.getElementById('period-dropdown-menu');
    if (menu && !menu.classList.contains('hidden')) {
        menu.classList.add('hidden');
    }
});

function selectAnalyticsPeriod(periodKey) {
    currentAnalyticsPeriod = periodKey;
    const menu = document.getElementById('period-dropdown-menu');
    if (menu) menu.classList.add('hidden');
    loadAllData(renderData);
}

function renderAnalyticsAndAchievements(allSessions) {
    const monthCounts = {};
    allSessions.forEach(s => {
        const key = getSessionMonthKey(s.date);
        if (key) monthCounts[key] = (monthCounts[key] || 0) + 1;
    });

    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (!monthCounts[currentMonthKey]) {
        monthCounts[currentMonthKey] = 0;
    }

    const sortedMonths = Object.keys(monthCounts).sort().reverse();
    if (currentAnalyticsPeriod !== 'all' && !(currentAnalyticsPeriod in monthCounts)) {
        currentAnalyticsPeriod = 'all';
    }

    const labelEl = document.getElementById('period-dropdown-label');
    if (labelEl) labelEl.innerText = formatMonthKeyLabel(currentAnalyticsPeriod);

    const menuEl = document.getElementById('period-dropdown-menu');
    if (menuEl) {
        let html = `
            <button type="button" class="period-option ${currentAnalyticsPeriod === 'all' ? 'active' : ''}" onclick="selectAnalyticsPeriod('all')">
                <span>🌐 За всё время</span>
                <span class="period-option-count">${allSessions.length}</span>
            </button>
        `;
        sortedMonths.forEach(mKey => {
            html += `
                <button type="button" class="period-option ${currentAnalyticsPeriod === mKey ? 'active' : ''}" onclick="selectAnalyticsPeriod('${mKey}')">
                    <span>📅 ${formatMonthKeyLabel(mKey)}</span>
                    <span class="period-option-count">${monthCounts[mKey]}</span>
                </button>
            `;
        });
        menuEl.innerHTML = html;
    }

    const filtered = currentAnalyticsPeriod === 'all'
        ? allSessions
        : allSessions.filter(s => getSessionMonthKey(s.date) === currentAnalyticsPeriod);

    let totalSmokeSeconds = 0;
    let totalSpentRub = 0;
    let totalGrams = 0;
    const brandFreq = {};
    const bowlFreq = {};

    filtered.forEach(s => {
        totalSmokeSeconds += (s.smokeDuration || 0);
        totalSpentRub += (s.sessionCost || 0);
        if (s.bowl) bowlFreq[s.bowl] = (bowlFreq[s.bowl] || 0) + 1;

        const mixArr = getNormalizedMix(s);
        mixArr.forEach(item => {
            const w = parseFloat(item.weight) || 0;
            totalGrams += w;
            if (item.brand) {
                const shortBrand = item.brand.split(' (')[0];
                brandFreq[shortBrand] = (brandFreq[shortBrand] || 0) + 1;
            }
        });
    });

    const favBrand = Object.keys(brandFreq).sort((a, b) => brandFreq[b] - brandFreq[a])[0] || '—';
    const favBowl = Object.keys(bowlFreq).sort((a, b) => bowlFreq[b] - bowlFreq[a])[0] || '—';
    const avgCost = filtered.length > 0 ? Math.round(totalSpentRub / filtered.length) : 0;

    document.getElementById('stat-total-hours').innerText = formatDurationHM(totalSmokeSeconds);
    document.getElementById('stat-total-money').innerText = `${Math.round(totalSpentRub).toLocaleString('ru-RU')} ₽`;
    document.getElementById('stat-avg-cost').innerText = `Средняя чаша: ${avgCost} ₽`;
    document.getElementById('stat-fav-brand').innerText = favBrand;
    document.getElementById('stat-total-grams').innerText = `Скурено: ${Math.round(totalGrams)} г`;
    document.getElementById('stat-fav-bowl').innerText = favBowl;
    document.getElementById('stat-total-sessions').innerText = `Сессий: ${filtered.length}`;
}

function getNormalizedMix(session) {
    if (Array.isArray(session.mix) && session.mix.length > 0) return session.mix;
    if (session.tobacco) return [{ brand: session.tobacco, flavor: '', weight: 0, cost: 0 }];
    return [];
}

// --- ОТРИСОВКА ИСТОРИИ, ФИЛЬТРАЦИЯ И УПРАВЛЕНИЕ ---
function applyFilters() {
    loadAllData(renderData);
}

function renderData(sessions) {
    syncCatalogFromHistory(sessions);
    renderAnalyticsAndAchievements(sessions);

    const historyList = document.getElementById('history-list');
    const searchQuery = (document.getElementById('search-input')?.value || '').toLowerCase().trim();
    const ratingFilter = document.getElementById('filter-rating')?.value || 'all';

    let filtered = sessions.filter(s => {
        if (ratingFilter !== 'all' && s.rating < parseInt(ratingFilter)) return false;
        if (searchQuery) {
            const mixStr = formatMixPlainText(getNormalizedMix(s)).toLowerCase();
            const bowlStr = (s.bowl || '').toLowerCase();
            const commentStr = (s.comment || '').toLowerCase();
            return mixStr.includes(searchQuery) || bowlStr.includes(searchQuery) || commentStr.includes(searchQuery);
        }
        return true;
    });

    historyList.innerHTML = '';

    if (filtered.length === 0) {
        historyList.innerHTML = '<p style="text-align:center; color: var(--text-secondary); padding: 18px 0;">Записей не найдено</p>';
        return;
    }

    filtered.slice().reverse().forEach(s => {
        const mixArr = getNormalizedMix(s);
        const mixHtml = formatMixText(mixArr);
        const totalWeight = mixArr.reduce((acc, i) => acc + (parseFloat(i.weight) || 0), 0);
        const costBadge = s.sessionCost ? `<span class="cost-tag">💰 ${s.sessionCost} ₽</span>` : '';
        const coalsText = s.coalsUsed ? ` • 🔥 ${s.coalsUsed} угл.` : '';

        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML = `
            <div class="history-top-bar">
                <span class="history-date">${s.date || '—'}</span>
                <span class="history-rating-pill">★ ${s.rating}</span>
            </div>
            <div class="history-mix-title">${mixHtml} ${costBadge}</div>
            <div class="history-meta">
                🏺 <b>Чаша:</b> ${s.bowl} ${totalWeight > 0 ? `(Всего ${totalWeight}г)` : ''}<br>
                炭 <b>Постановка:</b> ${s.placement || 'Не указана'}${coalsText}<br>
                ⏱ <b>Прогрев:</b> ${formatDurationText(s.actualWarmupDuration)} &nbsp;|&nbsp; 💨 <b>Покур:</b> ${formatDurationText(s.smokeDuration)}
            </div>
            ${s.comment ? `<div class="history-comment">«${s.comment}»</div>` : ''}
            <div class="history-actions">
                <button class="action-chip repeat" onclick="repeatSession(${s.id})">🔄 Повторить</button>
                <button class="action-chip" onclick="openEditModal(${s.id})">✏️ Изменить</button>
                <button class="action-chip delete" onclick="deleteSession(${s.id})">🗑️</button>
            </div>
        `;
        historyList.appendChild(item);
    });
}

function syncCatalogFromHistory(sessions) {
    let changed = false;
    sessions.forEach(s => {
        if (s.bowl && !savedBowls.includes(s.bowl)) {
            savedBowls.push(s.bowl);
            changed = true;
        }
        getNormalizedMix(s).forEach(m => {
            if (m.brand && m.brand !== '__custom__' && !savedBrands.includes(m.brand)) {
                savedBrands.push(m.brand);
                changed = true;
            }
        });
    });
    if (changed) {
        localStorage.setItem('hookah_bowls', JSON.stringify(savedBowls));
        localStorage.setItem('hookah_brands', JSON.stringify(savedBrands));
        populateSelects();
    }
}

// --- ПОВТОР СЕССИИ В 1 КЛИК ---
function repeatSession(sessionId) {
    loadAllData(sessions => {
        const target = sessions.find(s => s.id === sessionId);
        if (!target) return;

        document.getElementById('bowl-select').value = target.bowl;
        if (target.placement) document.getElementById('coal-placement').value = target.placement;
        if (target.coalsUsed) document.getElementById('start-coals-input').value = target.coalsUsed;

        const mixArr = getNormalizedMix(target);
        const toggle = document.getElementById('mix-mode-toggle');

        if (mixArr.length <= 1) {
            toggle.checked = false;
            toggleMixMode();
            const first = mixArr[0] || { brand: savedBrands[0], flavor: '', weight: 18 };
            document.getElementById('solo-tobacco-brand').value = first.brand;
            document.getElementById('solo-tobacco-flavor').value = first.flavor || '';
            document.getElementById('solo-tobacco-weight').value = first.weight || 18;
            fillPackInputsForBrand('solo', first.brand);
        } else {
            toggle.checked = true;
            toggleMixMode();
            const list = document.getElementById('mix-rows-list');
            list.innerHTML = '';
            mixArr.forEach(m => addMixRow(m.brand, m.flavor, m.weight));
        }

        recalcLiveBowlCost();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        showBannerToast('Микс загружен в форму сессии!');
    });
}

// --- УДАЛЕНИЕ СЕССИИ ---
async function deleteSession(sessionId) {
    const confirmed = await showIosConfirm(
        'Удалить запись?',
        'Эта сессия будет удалена из истории и статистики навсегда.',
        'Удалить',
        true
    );
    if (!confirmed) return;

    loadAllData(sessions => {
        const updated = sessions.filter(s => s.id !== sessionId);
        saveSessionsToStorage(updated, () => {
            renderData(updated);
            showBannerToast('Запись удалена');
        });
    });
}

// --- МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ ---
function openEditModal(sessionId) {
    loadAllData(sessions => {
        const target = sessions.find(s => s.id === sessionId);
        if (!target) return;

        document.getElementById('edit-session-id').value = target.id;
        document.getElementById('edit-bowl').innerHTML = getBowlOptionsHtml(target.bowl);
        document.getElementById('edit-placement').value = target.placement || '2 внутри, 1 на ребре (Пирамида)';
        document.getElementById('edit-coals-used').value = target.coalsUsed || 3;
        document.getElementById('edit-rating').value = target.rating || 5;
        document.getElementById('edit-comment').value = target.comment || '';

        const container = document.getElementById('edit-mix-rows');
        container.innerHTML = '';
        const mixArr = getNormalizedMix(target);
        mixArr.forEach(m => addEditMixRow(m.brand, m.flavor, m.weight));

        document.getElementById('edit-modal').classList.remove('hidden');
        syncBodyScrollLock();
    });
}

function addEditMixRow(brand = '', flavor = '', weight = '') {
    const container = document.getElementById('edit-mix-rows');
    const row = document.createElement('div');
    row.className = 'tobacco-row';
    row.style.marginBottom = '8px';
    row.innerHTML = `
        <select class="brand-select" onchange="onBrandSelectChange(this)">
            ${getBrandOptionsHtml(brand || savedBrands[0])}
        </select>
        <input type="text" class="flavor-input" placeholder="Вкус" value="${flavor}">
        <input type="number" class="weight-input" placeholder="Гр" value="${weight}" min="1" max="100">
        <button type="button" class="remove-mix-btn" onclick="this.parentElement.remove()">✕</button>
    `;
    container.appendChild(row);
}

function closeEditModal() {
    document.getElementById('edit-modal').classList.add('hidden');
    syncBodyScrollLock();
}

function saveEditedSession() {
    const id = parseInt(document.getElementById('edit-session-id').value);
    const bowl = document.getElementById('edit-bowl').value;
    const placement = document.getElementById('edit-placement').value;
    const coalsUsed = parseInt(document.getElementById('edit-coals-used').value) || 3;
    const rating = parseInt(document.getElementById('edit-rating').value);
    const comment = document.getElementById('edit-comment').value.trim();

    const newMix = [];
    document.querySelectorAll('#edit-mix-rows .tobacco-row').forEach(row => {
        const brand = row.querySelector('.brand-select').value;
        const flavor = row.querySelector('.flavor-input').value.trim();
        const weight = parseFloat(row.querySelector('.weight-input').value) || 0;
        const pack = brandPackDefaults[brand] || { price: 0, weight: 0 };
        const cost = Math.round(calcSingleTobaccoCost(weight, pack.price, pack.weight));
        newMix.push({ brand, flavor, weight, packPrice: pack.price, packWeight: pack.weight, cost });
    });

    const tobaccoCost = newMix.reduce((acc, i) => acc + (i.cost || 0), 0);
    const coalCost = Math.round(coalsUsed * getSingleCoalPrice());
    const sessionCost = Math.round(tobaccoCost + coalCost);

    loadAllData(sessions => {
        const idx = sessions.findIndex(s => s.id === id);
        if (idx !== -1) {
            sessions[idx].bowl = bowl;
            sessions[idx].placement = placement;
            sessions[idx].coalsUsed = coalsUsed;
            sessions[idx].coalCost = coalCost;
            sessions[idx].sessionCost = sessionCost;
            sessions[idx].rating = rating;
            sessions[idx].comment = comment;
            sessions[idx].mix = newMix;
        }
        saveSessionsToStorage(sessions, () => {
            closeEditModal();
            renderData(sessions);
            showBannerToast('Изменения сохранены');
        });
    });
}

// --- РУЧНОЕ ДОБАВЛЕНИЕ СЕССИИ ЗАДНИМ ЧИСЛОМ ---
function openManualAddModal() {
    const modal = document.getElementById('manual-add-modal');
    if (!modal) return;

    const dateInput = document.getElementById('manual-date-input');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

    const bSelect = document.getElementById('manual-bowl-select');
    if (bSelect) bSelect.innerHTML = getBowlOptionsHtml();

    const brandSelect = document.getElementById('manual-brand-select');
    if (brandSelect) {
        brandSelect.innerHTML = getBrandOptionsHtml(savedBrands[0]);
    }
    const customBrand = document.getElementById('manual-custom-brand');
    if (customBrand) {
        customBrand.value = '';
        customBrand.classList.add('hidden');
    }

    document.getElementById('manual-flavor-input').value = '';
    document.getElementById('manual-comment-input').value = '';

    modal.classList.remove('hidden');
    syncBodyScrollLock();
}

function closeManualAddModal() {
    const modal = document.getElementById('manual-add-modal');
    if (modal) modal.classList.add('hidden');
    syncBodyScrollLock();
}

function saveManualSession() {
    const dateVal = document.getElementById('manual-date-input').value;
    const bowl = document.getElementById('manual-bowl-select').value || 'Не указана';
    const brandSelectVal = document.getElementById('manual-brand-select').value;
    const customBrandVal = document.getElementById('manual-custom-brand')?.value.trim();
    const brand = brandSelectVal === '__custom__' ? (customBrandVal || 'Свой табак') : (brandSelectVal || 'Без бренда');
    const flavor = document.getElementById('manual-flavor-input').value.trim();
    const weight = parseFloat(document.getElementById('manual-weight-input').value) || 18;
    const durMins = parseInt(document.getElementById('manual-duration-input').value) || 60;
    const coalsUsed = parseInt(document.getElementById('manual-coals-input')?.value) || 3;
    const rating = parseInt(document.getElementById('manual-rating-select').value) || 5;
    const comment = document.getElementById('manual-comment-input').value.trim();

    if (!dateVal) {
        showIosNotice('Дата покура', 'Пожалуйста, укажи дату сессии.');
        return;
    }

    ensureBrandSaved(brand);
    consumeCoalsFromStock(coalsUsed);

    const [yyyy, mm, dd] = dateVal.split('-');
    const formattedDate = `${dd}.${mm}.${yyyy}`;

    const savedPack = brandPackDefaults[brand];
    const itemCost = Math.round(calcSingleTobaccoCost(weight, savedPack?.price, savedPack?.weight));
    const coalCost = Math.round(coalsUsed * getSingleCoalPrice());

    const session = {
        id: Date.now(),
        date: formattedDate,
        bowl,
        placement: '3 внутри',
        coalsUsed,
        coalCost,
        mix: [{
            brand,
            flavor,
            weight,
            packPrice: savedPack?.price || 0,
            packWeight: savedPack?.weight || 0,
            cost: itemCost
        }],
        sessionCost: itemCost + coalCost,
        actualWarmupDuration: 300,
        smokeDuration: durMins * 60,
        rating,
        comment: comment || ''
    };

    loadAllData((history) => {
        history.push(session);
        syncCatalogFromHistory(history);
        saveSessionsToStorage(history, () => {
            closeManualAddModal();
            renderData(history);
            showSaveSuccessOverlay();
        });
    });
}

// --- РУЛЕТКА ВКУСОВ ИЗ FLAVORS.JSON ---
const FALLBACK_FLAVORS = [
    { brand: "Musthave", name: "Pinkman", category: "Ягоды", rating: 4.9, reviews_count: 1450, description: "Розовый грейпфрут с клубничным сиропом и спелой малиной." },
    { brand: "Darkside", name: "Lemonblast", category: "Цитрусы", rating: 4.8, reviews_count: 1310, description: "Эталонный натуральный лимон с яркой сочной кислинкой." },
    { brand: "Blackburn", name: "Chupa Graper", category: "Ягоды", rating: 4.8, reviews_count: 640, description: "Леденцовый чупа-чупс с соком тёмного винограда." },
    { brand: "Deus", name: "Punky Island", category: "Тропики", rating: 4.8, reviews_count: 610, description: "Взрывное трио спелой маракуйи, гуавы и манго." }
];

let cachedFlavors = [];
let currentRolledFlavor = null;

async function openFlavorRouletteModal() {
    const modal = document.getElementById('roulette-modal');
    if (!modal) return;

    if (cachedFlavors.length === 0) {
        try {
            const res = await fetch('flavors.json', { cache: 'no-cache' });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0) {
                    cachedFlavors = data;
                }
            }
        } catch (e) {
            console.warn('Не удалось загрузить внешний flavors.json, используем встроенный резерв:', e);
        }
        if (cachedFlavors.length === 0) {
            cachedFlavors = FALLBACK_FLAVORS;
        }
    }

    const brandSelect = document.getElementById('roulette-brand-filter');
    if (brandSelect) {
        const currentB = brandSelect.value || 'all';
        const brands = Array.from(new Set(cachedFlavors.map(f => (f.brand || '').trim()))).filter(Boolean).sort();
        brandSelect.innerHTML = '<option value="all">🌐 Все бренды</option>' +
            brands.map(b => `<option value="${b}">${b}</option>`).join('');
        if (brands.includes(currentB)) brandSelect.value = currentB;
    }

    const catSelect = document.getElementById('roulette-cat-filter');
    if (catSelect) {
        const currentC = catSelect.value || 'all';
        const cats = Array.from(new Set(cachedFlavors.map(f => (f.category || '').trim()))).filter(Boolean).sort();
        catSelect.innerHTML = '<option value="all">✨ Любой</option>' +
            cats.map(c => `<option value="${c}">${c}</option>`).join('');
        if (cats.includes(currentC)) catSelect.value = currentC;
    }

    modal.classList.remove('hidden');
    syncBodyScrollLock();

    if (!currentRolledFlavor) {
        spinFlavorRoulette();
    }
}

function closeRouletteModal() {
    const modal = document.getElementById('roulette-modal');
    if (modal) modal.classList.add('hidden');
    syncBodyScrollLock();
}

function spinFlavorRoulette() {
    if (!cachedFlavors || cachedFlavors.length === 0) {
        cachedFlavors = FALLBACK_FLAVORS;
    }

    const brandFilter = document.getElementById('roulette-brand-filter')?.value || 'all';
    const catFilter = document.getElementById('roulette-cat-filter')?.value || 'all';

    let pool = cachedFlavors.filter(f => {
        const matchBrand = brandFilter === 'all' || (f.brand && f.brand.toLowerCase() === brandFilter.toLowerCase());
        const matchCat = catFilter === 'all' || (f.category && f.category.toLowerCase() === catFilter.toLowerCase());
        return matchBrand && matchCat;
    });

    if (pool.length === 0) {
        showBannerToast('По этим фильтрам нет вкусов, крутим из всех!');
        pool = cachedFlavors;
    }

    if (pool.length > 1 && currentRolledFlavor) {
        const withoutCurrent = pool.filter(f => f.name !== currentRolledFlavor.name || f.brand !== currentRolledFlavor.brand);
        if (withoutCurrent.length > 0) pool = withoutCurrent;
    }

    currentRolledFlavor = pool[Math.floor(Math.random() * pool.length)];

    const card = document.getElementById('roulette-result-card');
    if (card) {
        card.classList.add('spin-anim');
        setTimeout(() => card.classList.remove('spin-anim'), 180);
    }

    const brandEl = document.getElementById('roulette-res-brand');
    const catEl = document.getElementById('roulette-res-cat');
    const nameEl = document.getElementById('roulette-res-name');
    const descEl = document.getElementById('roulette-res-desc');
    const applyBtn = document.getElementById('roulette-apply-btn');

    if (brandEl) {
        const rev = currentRolledFlavor.reviews_count ? ` (${currentRolledFlavor.reviews_count} отз.)` : '';
        brandEl.innerText = `${currentRolledFlavor.brand} • ★ ${currentRolledFlavor.rating || 4.7}${rev}`;
    }
    if (catEl) {
        if (currentRolledFlavor.category) {
            catEl.innerText = currentRolledFlavor.category;
            catEl.classList.remove('hidden');
        } else {
            catEl.classList.add('hidden');
        }
    }
    if (nameEl) nameEl.innerText = currentRolledFlavor.name;
    if (descEl) descEl.innerText = currentRolledFlavor.description || 'Проверенный топовый вкус с высоким рейтингом.';
    if (applyBtn) applyBtn.classList.remove('hidden');
}

function findMatchingBrandInCatalog(shortBrand) {
    const clean = (shortBrand || '').trim().toLowerCase();
    const match = savedBrands.find(b => b.toLowerCase().startsWith(clean));
    if (match) return match;
    ensureBrandSaved(shortBrand);
    populateSelects();
    return shortBrand;
}

function applyRouletteFlavor() {
    if (!currentRolledFlavor) return;

    const matchedBrand = findMatchingBrandInCatalog(currentRolledFlavor.brand);

    if (isMixMode) {
        addMixRow(matchedBrand, currentRolledFlavor.name, 10);
        showBannerToast(`Добавлено в микс: ${currentRolledFlavor.brand} — ${currentRolledFlavor.name}`);
    } else {
        const brandSel = document.getElementById('solo-tobacco-brand');
        const flavorInput = document.getElementById('solo-tobacco-flavor');
        const weightInput = document.getElementById('solo-tobacco-weight');

        if (brandSel) {
            brandSel.value = matchedBrand;
            onBrandSelectChange(brandSel);
        }
        if (flavorInput) flavorInput.value = currentRolledFlavor.name;
        if (weightInput && !weightInput.value) weightInput.value = '18';
        showBannerToast(`Выбран вкус: ${currentRolledFlavor.brand} — ${currentRolledFlavor.name}`);
    }

    closeRouletteModal();
    recalcLiveBowlCost();
}

// --- ЭКСПОРТ В ЗАМЕТКИ IPHONE И JSON БЕКАП ---
function exportToAppleNotes() {
    loadAllData(sessions => {
        if (!sessions || sessions.length === 0) {
            showIosNotice('История пуста', 'Пока нет сохраненных сессий для экспорта.');
            return;
        }

        let text = `💨 DimHookah — Дневник покуров (${sessions.length})\n====================\n\n`;
        sessions.slice().reverse().forEach((s, idx) => {
            const mixStr = formatMixPlainText(getNormalizedMix(s));
            const costStr = s.sessionCost ? ` | 💰 ${s.sessionCost} ₽` : '';
            text += `${idx + 1}. 📅 ${s.date} — ★ ${s.rating}/5${costStr}\n`;
            text += `   🍂 Табак: ${mixStr}\n`;
            text += `   🏺 Чаша: ${s.bowl} | 🔥 Угли: ${s.placement || '—'} (${s.coalsUsed || 3} шт)\n`;
            text += `   ⏱ Прогрев: ${formatDurationText(s.actualWarmupDuration)} | Покур: ${formatDurationText(s.smokeDuration)}\n`;
            if (s.comment) text += `   💬 Заметка: "${s.comment}"\n`;
            text += `\n`;
        });

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                showIosNotice('Скопировано в буфер! 📋', 'Открой «Заметки» на iPhone и нажми «Вставить» — вся твоя история красиво сохранится.');
            }).catch(() => fallbackShareText(text));
        } else {
            fallbackShareText(text);
        }
    });
}

function fallbackShareText(text) {
    if (navigator.share) {
        navigator.share({ title: 'DimHookah — История', text }).catch(() => { });
    } else {
        showIosNotice('Ваш текст готов', text);
    }
}

function exportHistoryData() {
    loadAllData(sessions => {
        const backup = {
            version: 3,
            exportedAt: new Date().toISOString(),
            bowls: savedBowls,
            brands: savedBrands,
            brandPacks: brandPackDefaults,
            coalInventory,
            sessions
        };
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `DimHookah_Backup_${new Date().toLocaleDateString('ru-RU').replace(/\./g, '-')}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showBannerToast('Файл резервной копии скачан');
    });
}

function importHistoryData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const parsed = JSON.parse(e.target.result);
            const importedSessions = Array.isArray(parsed) ? parsed : (parsed.sessions || []);

            if (parsed.bowls) {
                savedBowls = Array.from(new Set([...savedBowls, ...parsed.bowls]));
                localStorage.setItem('hookah_bowls', JSON.stringify(savedBowls));
            }
            if (parsed.brands) {
                savedBrands = Array.from(new Set([...savedBrands, ...parsed.brands]));
                localStorage.setItem('hookah_brands', JSON.stringify(savedBrands));
            }
            if (parsed.brandPacks) {
                brandPackDefaults = { ...brandPackDefaults, ...parsed.brandPacks };
                localStorage.setItem('hookah_brand_packs', JSON.stringify(brandPackDefaults));
            }
            if (parsed.coalInventory) {
                coalInventory = parsed.coalInventory;
                localStorage.setItem('hookah_coal_inventory', JSON.stringify(coalInventory));
            }

            saveSessionsToStorage(importedSessions, () => {
                populateSelects();
                renderCoalInventoryUI();
                renderData(importedSessions);
                showBannerToast(`Импортировано записей: ${importedSessions.length}`);
            });
        } catch (err) {
            showIosNotice('Ошибка чтения', 'Не удалось прочитать файл резервной копии. Проверьте формат JSON.');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ФОРМАТИРОВАНИЯ ---
function formatTimerSec(totalSeconds) {
    const s = Math.max(0, totalSeconds);
    const hours = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
    const secs = (s % 60).toString().padStart(2, '0');
    return hours > 0 ? `${hours}:${mins}:${secs}` : `${mins}:${secs}`;
}

function formatDurationText(seconds) {
    if (!seconds || seconds <= 0) return '0 сек';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m === 0) return `${s} сек`;
    return s > 0 ? `${m} мин ${s} сек` : `${m} мин`;
}

function formatDurationHM(totalSeconds) {
    if (!totalSeconds || totalSeconds <= 0) return '0 ч 0 м';
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.round((totalSeconds % 3600) / 60);
    if (hours === 0) return `${mins} мин`;
    return `${hours} ч ${mins} м`;
}

function syncActiveTimerOnWake() {
    const isWarmup = !document.getElementById('warmup-controls').classList.contains('hidden');
    const isSmoking = !document.getElementById('smoking-controls').classList.contains('hidden');
    if (!document.getElementById('active-session').classList.contains('hidden')) {
        if (isWarmup && targetTimestamp) updateWarmupTimer();
        else if (isSmoking && stepStartTime) updateSmokingTimer();
    }
}

// --- ИНИЦИАЛИЗАЦИЯ ПРИ ЗАПУСКЕ ---
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initCatalogs();
    restoreActiveSessionIfAny();

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            syncActiveTimerOnWake();
        }
    });

    document.addEventListener('touchstart', () => {
        const isWarmup = !document.getElementById('warmup-controls').classList.contains('hidden');
        const isSmoking = !document.getElementById('smoking-controls').classList.contains('hidden');
        if (isWarmup || isSmoking) {
            const audioEl = document.getElementById('bg-audio');
            if (audioEl && audioEl.paused) {
                startKeepAliveAudio();
            }
        }
    }, { passive: true });

    window.addEventListener('focus', syncActiveTimerOnWake);
    window.addEventListener('pageshow', syncActiveTimerOnWake);
});

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
}