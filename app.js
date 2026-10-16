let timerInterval;
let stepStartTime;
let warmupTargetSec = 300;
let actualWarmupDuration = 0;
let smokeDuration = 0;
let currentRating = 5;
let currentCoalPlacement = '3 в колодке';
let isMixMode = false;
let alarmAlreadyPlayed = false;
let audioCtx;
let swRegistration = null;
let silentAudioUrl = null;
let alarmAudioUrl = null;
let selectedPeriod = 'all'; // 'all' или ключ месяца 'MM.YYYY' (или 'MM')
let brandPackDefaults = {}; // Авто-память цены и граммовки пачки для каждого бренда

// Режимы темы: 'auto' (по системе телефона) | 'light' | 'dark'
let currentThemeMode = localStorage.getItem('hookah_theme_mode') || 'auto';
const systemDarkMedia = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
    let effectiveTheme = currentThemeMode;
    if (currentThemeMode === 'auto') {
        effectiveTheme = systemDarkMedia.matches ? 'dark' : 'light';
    }

    if (effectiveTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        document.getElementById('meta-theme-color')?.setAttribute('content', '#000000');
    } else {
        document.documentElement.removeAttribute('data-theme');
        document.getElementById('meta-theme-color')?.setAttribute('content', '#F2F2F7');
    }

    const btn = document.getElementById('theme-toggle-btn');
    if (btn) {
        if (currentThemeMode === 'auto') btn.innerText = '🌗 Авто';
        else if (currentThemeMode === 'light') btn.innerText = '☀️ Светлая';
        else btn.innerText = '🌙 Темная';
    }
}

function cycleThemeMode() {
    if (currentThemeMode === 'auto') currentThemeMode = 'dark';
    else if (currentThemeMode === 'dark') currentThemeMode = 'light';
    else currentThemeMode = 'auto';

    localStorage.setItem('hookah_theme_mode', currentThemeMode);
    applyTheme();
}

systemDarkMedia.addEventListener('change', () => {
    if (currentThemeMode === 'auto') applyTheme();
});

// Кастомные диалоги в стиле iOS 27 (работают везде без блокировок)
function openIosPrompt(title, placeholder, callback) {
    const modal = document.getElementById('ios-dialog-modal');
    const titleEl = document.getElementById('ios-dialog-title');
    const msgEl = document.getElementById('ios-dialog-msg');
    const inputEl = document.getElementById('ios-dialog-input');
    const cancelBtn = document.getElementById('ios-dialog-cancel');
    const okBtn = document.getElementById('ios-dialog-ok');

    if (!modal) return;
    titleEl.innerText = title;
    msgEl.classList.add('hidden');
    inputEl.classList.remove('hidden');
    inputEl.placeholder = placeholder || '';
    inputEl.value = '';
    cancelBtn.classList.remove('hidden');

    okBtn.onclick = () => {
        const val = inputEl.value.trim();
        closeIosDialog();
        if (val && callback) callback(val);
    };

    modal.classList.remove('hidden');
    setTimeout(() => inputEl.focus(), 60);
}

function showIosNotice(title, message) {
    const modal = document.getElementById('ios-dialog-modal');
    const titleEl = document.getElementById('ios-dialog-title');
    const msgEl = document.getElementById('ios-dialog-msg');
    const inputEl = document.getElementById('ios-dialog-input');
    const cancelBtn = document.getElementById('ios-dialog-cancel');
    const okBtn = document.getElementById('ios-dialog-ok');

    if (!modal) return;
    titleEl.innerText = title;
    msgEl.innerText = message;
    msgEl.classList.remove('hidden');
    inputEl.classList.add('hidden');
    cancelBtn.classList.add('hidden');

    okBtn.onclick = () => closeIosDialog();
    modal.classList.remove('hidden');
}

function closeIosDialog() {
    const modal = document.getElementById('ios-dialog-modal');
    const inputEl = document.getElementById('ios-dialog-input');
    if (inputEl) inputEl.blur();
    if (modal) modal.classList.add('hidden');
}

const DEFAULT_BRANDS = [
    'Adalya', 'Afzal', 'Banger', 'Black Burn', 'Bonche',
    'Brusko', 'Burn', 'Chabacco', 'Daily Hookah', 'Darkside',
    'Deus', 'Duft', 'Element', 'Jent', 'Musthave',
    'Overdose', 'Satyr', 'Sebero', 'Spectrum', 'Tangiers',
    'Trofimoff\'s', 'Наш'
].sort((a, b) => a.localeCompare(b, 'ru'));

let savedBowls = [];
let savedBrands = [];
let removedItems = [];

document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    registerPWA();
    initTimeWheels();
    initRealBackgroundAudio();
    setRating(5);
    setCoalPlacement('3 в колодке');

    loadAllData((history) => {
        syncCatalogFromHistory(history);
        populateSelects();
        renderData(history);
        restoreActiveSessionIfAny();
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            syncActiveTimerOnWake();
        }
    });

    // Закрытие выпадающего списка месяцев при клике вне его
    document.addEventListener('click', (e) => {
        const wrap = document.getElementById('period-dropdown-wrap');
        if (wrap && !wrap.contains(e.target)) {
            closePeriodDropdown();
        }
    });
});

async function registerPWA() {
    if ('serviceWorker' in navigator) {
        try {
            swRegistration = await navigator.serviceWorker.register('./sw.js');
        } catch (e) { }
    }
    updatePushButtonState();
}

function updatePushButtonState() {
    const btn = document.getElementById('push-perm-btn');
    if (!btn) return;
    if ('Notification' in window && Notification.permission === 'granted') {
        btn.classList.add('hidden');
    } else {
        btn.classList.remove('hidden');
    }
}

async function requestPushPermission() {
    if (!('Notification' in window)) {
        showIosNotice(
            'Установка на iPhone 📲',
            'Чтобы работали пуши:\n1. Нажми «Поделиться» внизу Safari.\n2. Выбери «На экран Домой».\n3. Открой DimHookah с иконки на рабочем столе!'
        );
        return;
    }
    try {
        const perm = await Notification.requestPermission();
        updatePushButtonState();
        if (perm === 'granted') {
            playBellSound();
            sendPush('Уведомления включены! 🔥', 'Теперь DimHookah предупредит, когда чаша прогреется.');
        } else {
            showIosNotice('Пуши отключены', 'Разреши уведомления для DimHookah в настройках телефона.');
        }
    } catch (e) { }
}

function initTimeWheels() {
    const minSelect = document.getElementById('warmup-min');
    if (!minSelect) return;

    let minHtml = '';
    for (let m = 1; m <= 20; m++) {
        const sel = (m === 5) ? 'selected' : '';
        minHtml += `<option value="${m}" ${sel}>${m}</option>`;
    }
    minSelect.innerHTML = minHtml;
}

function loadAllData(callback) {
    try {
        savedBowls = JSON.parse(localStorage.getItem('hookah_custom_bowls') || '[]');
        savedBrands = JSON.parse(localStorage.getItem('hookah_custom_brands') || '[]');
        removedItems = JSON.parse(localStorage.getItem('hookah_removed_items') || '[]');
        brandPackDefaults = JSON.parse(localStorage.getItem('hookah_brand_packs') || '{}');
    } catch (e) {
        savedBowls = [];
        savedBrands = [];
        removedItems = [];
        brandPackDefaults = {};
    }

    let history = [];
    try {
        history = JSON.parse(localStorage.getItem('hookah_sessions') || '[]');
    } catch (e) { }

    if (callback) callback(history);
}

function saveBrandPackDefault(brand, packPrice, packWeight) {
    if (!brand) return;
    brandPackDefaults[brand] = {
        price: parseFloat(packPrice) || 0,
        weight: parseFloat(packWeight) || 0
    };
    localStorage.setItem('hookah_brand_packs', JSON.stringify(brandPackDefaults));
}

function onBrandSelectChange(selectEl) {
    const brand = selectEl.value;
    const card = selectEl.closest('.tobacco-entry-card');
    if (!card || !brand) return;

    const saved = brandPackDefaults[brand];
    const priceInput = card.querySelector('#solo-pack-price, .tobacco-pack-price, .modal-pack-price');
    const weightInput = card.querySelector('#solo-pack-weight, .tobacco-pack-weight, .modal-pack-weight');

    if (saved) {
        if (priceInput && saved.price) priceInput.value = saved.price;
        if (weightInput && saved.weight) weightInput.value = saved.weight;
    }
    recalcLiveBowlCost();
}

function onPackInfoInput(inputEl) {
    const card = inputEl.closest('.tobacco-entry-card');
    if (card) {
        const brandSel = card.querySelector('select');
        const priceInput = card.querySelector('#solo-pack-price, .tobacco-pack-price, .modal-pack-price');
        const weightInput = card.querySelector('#solo-pack-weight, .tobacco-pack-weight, .modal-pack-weight');
        if (brandSel && brandSel.value && priceInput && weightInput) {
            saveBrandPackDefault(brandSel.value, priceInput.value, weightInput.value);
        }
    }
    recalcLiveBowlCost();
}

function calcSingleTobaccoCost(usedGrams, packPrice, packWeight) {
    const g = parseFloat(usedGrams) || 0;
    const p = parseFloat(packPrice) || 0;
    const pw = parseFloat(packWeight) || 0;
    if (g <= 0 || p <= 0 || pw <= 0) return 0;
    return (p / pw) * g;
}

function recalcLiveBowlCost() {
    const draft = getDraftMixFromForm();
    let tobaccoCost = 0;
    let totalGrams = 0;
    draft.forEach(m => {
        totalGrams += (parseFloat(m.weight) || 0);
        tobaccoCost += calcSingleTobaccoCost(m.weight, m.packPrice, m.packWeight);
    });

    const coalsUsed = parseInt(document.getElementById('session-coals-used')?.value) || 0;
    const coalCost = coalsUsed * getSingleCoalPrice();
    const totalCost = tobaccoCost + coalCost;

    const hintEl = document.getElementById('live-coal-cost-hint');
    if (hintEl) hintEl.innerText = `+${Math.round(coalCost)} ₽ за угли`;

    const valEl = document.getElementById('live-bowl-cost-val');
    if (valEl) {
        valEl.innerText = `${Math.round(totalCost)} ₽ (${totalGrams} г + ${coalsUsed} угл.)`;
    }
}

function saveSessionsToStorage(history, callback) {
    localStorage.setItem('hookah_sessions', JSON.stringify(history));
    if (callback) callback();
}

function saveCatalogsToStorage() {
    savedBowls.sort((a, b) => a.localeCompare(b, 'ru'));
    savedBrands.sort((a, b) => a.localeCompare(b, 'ru'));

    localStorage.setItem('hookah_custom_bowls', JSON.stringify(savedBowls));
    localStorage.setItem('hookah_custom_brands', JSON.stringify(savedBrands));
    localStorage.setItem('hookah_removed_items', JSON.stringify(removedItems));
}

function syncCatalogFromHistory(history) {
    const bowlSet = new Set(savedBowls.filter(b => b !== 'Облако Phunnel M' && !removedItems.includes(b)));
    const brandSet = new Set([...DEFAULT_BRANDS, ...savedBrands].filter(b => !removedItems.includes(b)));

    (history || []).forEach(s => {
        if (s.bowl && s.bowl !== 'Не указана' && !removedItems.includes(s.bowl)) {
            bowlSet.add(s.bowl);
        }
        (s.mix || []).forEach(m => {
            const b = (m.brand || m.name || '').trim();
            if (b && b !== 'Без названия' && !removedItems.includes(b)) {
                brandSet.add(b);
            }
        });
    });

    savedBowls = Array.from(bowlSet).sort((a, b) => a.localeCompare(b, 'ru'));
    savedBrands = Array.from(brandSet).sort((a, b) => a.localeCompare(b, 'ru'));
    saveCatalogsToStorage();
}

function getBowlOptionsHtml(selectedVal = '') {
    const placeholder = `<option value="" disabled ${!selectedVal ? 'selected' : ''}>Выбери чашу...</option>`;
    return placeholder + savedBowls.map(b => `<option value="${b}" ${b === selectedVal ? 'selected' : ''}>${b}</option>`).join('');
}

function getBrandOptionsHtml(selectedVal = '') {
    const placeholder = `<option value="" disabled ${!selectedVal ? 'selected' : ''}>Бренд</option>`;
    return placeholder + savedBrands.map(b => `<option value="${b}" ${b === selectedVal ? 'selected' : ''}>${b}</option>`).join('');
}

function populateSelects() {
    const bowlSelect = document.getElementById('bowl-select');
    if (bowlSelect) {
        const current = bowlSelect.value;
        bowlSelect.innerHTML = getBowlOptionsHtml(current);
        if (savedBowls.includes(current)) bowlSelect.value = current;
    }

    const soloBrand = document.getElementById('solo-tobacco-brand');
    if (soloBrand) {
        const current = soloBrand.value;
        soloBrand.innerHTML = getBrandOptionsHtml(current);
        if (savedBrands.includes(current) || DEFAULT_BRANDS.includes(current)) soloBrand.value = current;
    }

    document.querySelectorAll('.tobacco-brand-select').forEach(sel => {
        const current = sel.value;
        sel.innerHTML = getBrandOptionsHtml(current);
        if (savedBrands.includes(current) || DEFAULT_BRANDS.includes(current)) sel.value = current;
    });

    const modalBowl = document.getElementById('modal-bowl');
    if (modalBowl) {
        const current = modalBowl.value;
        modalBowl.innerHTML = getBowlOptionsHtml(current);
        if (savedBowls.includes(current)) modalBowl.value = current;
    }
}

function addNewBowlPrompt(targetSelectId = 'bowl-select') {
    openIosPrompt('Новая чаша', 'Например: Oblako Phunnel M', (clean) => {
        removedItems = removedItems.filter(item => item !== clean);
        if (!savedBowls.includes(clean)) savedBowls.push(clean);
        saveCatalogsToStorage();
        populateSelects();
        const target = document.getElementById(targetSelectId);
        if (target) target.value = clean;
    });
}

function deleteSelectedBowl(targetSelectId = 'bowl-select') {
    const target = document.getElementById(targetSelectId);
    const val = target ? target.value : '';
    if (!val) {
        showIosNotice('Чаша не выбрана', 'Сначала выбери чашу в выпадающем списке, чтобы удалить её.');
        return;
    }
    savedBowls = savedBowls.filter(b => b !== val);
    if (!removedItems.includes(val)) removedItems.push(val);
    saveCatalogsToStorage();
    if (target) {
        target.blur();
        target.value = '';
    }
    populateSelects();
}

function addNewBrandPrompt(targetSelectOrElem) {
    openIosPrompt('Новый бренд табака', 'Например: Blackburn', (clean) => {
        removedItems = removedItems.filter(item => item !== clean);
        if (!savedBrands.includes(clean)) savedBrands.push(clean);
        saveCatalogsToStorage();
        populateSelects();
        if (typeof targetSelectOrElem === 'string') {
            const el = document.getElementById(targetSelectOrElem);
            if (el) el.value = clean;
        } else if (targetSelectOrElem) {
            targetSelectOrElem.value = clean;
        }
    });
}

function deleteSelectedBrand(targetSelectOrElem) {
    const el = (typeof targetSelectOrElem === 'string')
        ? document.getElementById(targetSelectOrElem)
        : targetSelectOrElem;
    const val = el ? el.value : '';
    if (!val) {
        showIosNotice('Бренд не выбран', 'Сначала выбери бренд табака в списке, чтобы удалить его.');
        return;
    }
    savedBrands = savedBrands.filter(b => b !== val);
    if (!removedItems.includes(val)) removedItems.push(val);
    saveCatalogsToStorage();
    if (el) {
        el.blur();
        el.value = '';
    }
    populateSelects();
}

function toggleMixMode() {
    document.querySelectorAll('select').forEach(s => s.blur());
    isMixMode = !isMixMode;
    const btn = document.getElementById('mix-toggle-btn');
    const soloBox = document.getElementById('solo-container');
    const mixBox = document.getElementById('mix-container');
    const addBtn = document.getElementById('add-mix-btn');

    if (isMixMode) {
        btn.innerText = 'Режим: Микс';
        btn.style.borderColor = 'var(--primary)';
        btn.style.color = 'var(--primary)';
        soloBox.classList.add('hidden');
        mixBox.classList.remove('hidden');
        addBtn.classList.remove('hidden');
        if (mixBox.children.length === 0) {
            addMixRow();
            addMixRow();
        }
    } else {
        btn.innerText = 'Режим: Соло';
        btn.style.borderColor = 'var(--glass-border)';
        btn.style.color = 'var(--text)';
        soloBox.classList.remove('hidden');
        mixBox.classList.add('hidden');
        addBtn.classList.add('hidden');
    }
    recalcLiveBowlCost();
}

function addMixRow(brand = '', flavor = '', weight = '', packPrice = '', packWeight = '') {
    if (brand && (!packPrice || !packWeight) && brandPackDefaults[brand]) {
        packPrice = brandPackDefaults[brand].price || '';
        packWeight = brandPackDefaults[brand].weight || '';
    }
    const container = document.getElementById('mix-container');
    const card = document.createElement('div');
    card.className = 'tobacco-entry-card mix-item';
    card.innerHTML = `
                <div class="select-with-add" style="margin-bottom: 8px;">
                    <select class="tobacco-brand-select" onchange="onBrandSelectChange(this)">${getBrandOptionsHtml(brand)}</select>
                    <button type="button" class="btn-plus" onclick="addNewBrandPrompt(this.previousElementSibling)">+</button>
                    <button type="button" class="btn-minus" onclick="deleteSelectedBrand(this.previousElementSibling.previousElementSibling)">−</button>
                    <button type="button" class="btn-danger" style="height: 44px; width: 44px;" onclick="this.closest('.mix-item').remove(); recalcLiveBowlCost();">✕</button>
                </div>
                <div style="display: flex; gap: 8px;">
                    <input type="text" class="tobacco-flavor" placeholder="Вкус" value="${flavor}" style="flex: 2;">
                    <input type="number" class="tobacco-weight" placeholder="Грамм в чашу" value="${weight}" oninput="recalcLiveBowlCost()" style="flex: 1.2;">
                </div>
                <div class="pack-price-row">
                    <span class="pack-price-label">🏷️ Пачка:</span>
                    <input type="number" class="tobacco-pack-price" placeholder="Цена ₽" value="${packPrice}" oninput="onPackInfoInput(this)">
                    <span class="pack-price-label">за</span>
                    <input type="number" class="tobacco-pack-weight" placeholder="Грамм" value="${packWeight}" oninput="onPackInfoInput(this)">
                    <span class="pack-price-label">г</span>
                </div>
            `;
    container.appendChild(card);
    recalcLiveBowlCost();
}

function formatTimerSec(seconds) {
    const isNegative = seconds < 0;
    const absSec = Math.abs(seconds);
    const mins = Math.floor(absSec / 60).toString().padStart(2, '0');
    const secs = (absSec % 60).toString().padStart(2, '0');
    return (isNegative ? '-' : '') + `${mins}:${secs}`;
}

function formatDurationHM(seconds) {
    const totalMins = Math.round((seconds || 0) / 60);
    if (totalMins <= 0) return '1 мин';
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    if (h > 0 && m > 0) return `${h} ч ${m} мин`;
    if (h > 0) return `${h} ч`;
    return `${m} мин`;
}

function initRealBackgroundAudio() {
    silentAudioUrl = createWavBlobUrl(false);
    alarmAudioUrl = createWavBlobUrl(true);

    const audioEl = document.getElementById('bg-audio');
    if (audioEl) {
        audioEl.src = silentAudioUrl;
        audioEl.volume = 0.05;

        audioEl.addEventListener('timeupdate', () => {
            if (!document.getElementById('warmup-controls').classList.contains('hidden')) {
                updateWarmupTimer();
            } else if (!document.getElementById('smoking-controls').classList.contains('hidden')) {
                updateSmokingTimer();
            }
        });
    }
}

function createWavBlobUrl(isAlarm) {
    const sampleRate = 16000;
    const durationSec = 2;
    const numSamples = sampleRate * durationSec;
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

    const notes = [
        { start: 0.05, freq: 1046.50 },
        { start: 0.22, freq: 1318.51 },
        { start: 0.39, freq: 1567.98 }
    ];

    for (let i = 0; i < numSamples; i++) {
        let sample = 0;
        if (isAlarm) {
            const t = i / sampleRate;
            for (const n of notes) {
                if (t >= n.start && t < n.start + 0.35) {
                    const localT = t - n.start;
                    const env = Math.exp(-localT * 14);
                    const pitchSlide = n.freq * (1 + 0.08 * Math.exp(-localT * 40));
                    sample += Math.sin(2 * Math.PI * pitchSlide * localT) * env * 12000;
                }
            }
        } else {
            sample = (i % 2 === 0) ? 1 : -1;
        }
        view.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, sample)), true);
    }
    const blob = new Blob([buffer], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
}

function getCurrentMixSummaryText() {
    const bowl = document.getElementById('bowl-select')?.value || 'Чаша';
    let tobText = '';
    if (isMixMode) {
        const parts = [];
        document.querySelectorAll('#mix-container .mix-item').forEach(item => {
            const b = item.querySelector('.tobacco-brand-select')?.value || '';
            const f = item.querySelector('.tobacco-flavor')?.value || '';
            if (b || f) parts.push(`${b} ${f}`.trim());
        });
        tobText = parts.join(' + ');
    } else {
        const b = document.getElementById('solo-tobacco-brand')?.value || '';
        const f = document.getElementById('solo-tobacco-flavor')?.value || '';
        tobText = `${b} ${f}`.trim();
    }
    return tobText ? `${bowl} • ${tobText}` : bowl;
}

async function startKeepAliveAudio(titleText, subtitleText) {
    const audioEl = document.getElementById('bg-audio');
    try {
        if (audioEl) {
            if (audioEl.src !== silentAudioUrl) audioEl.src = silentAudioUrl;
            audioEl.volume = 0.05;
            if (audioEl.paused) await audioEl.play();
        }
        updateLockScreenMetadata(titleText, subtitleText);
    } catch (e) { }
}

async function triggerLockScreenAudioAlarm() {
    const audioEl = document.getElementById('bg-audio');
    try {
        if (audioEl && alarmAudioUrl) {
            audioEl.src = alarmAudioUrl;
            audioEl.volume = 0.9;
            await audioEl.play();

            setTimeout(async () => {
                if (!document.getElementById('warmup-controls').classList.contains('hidden')) {
                    audioEl.src = silentAudioUrl;
                    audioEl.volume = 0.05;
                    try { await audioEl.play(); } catch (e) { }
                }
            }, 3600);
        }
    } catch (e) { }
}

function updateLockScreenMetadata(titleText, subtitleText) {
    if ('mediaSession' in navigator) {
        try {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: titleText || 'DimHookah Активен 🔥',
                artist: subtitleText || getCurrentMixSummaryText(),
                album: 'DimHookah Tracker'
            });
        } catch (e) { }
    }
}

function stopKeepAliveAudio() {
    const audioEl = document.getElementById('bg-audio');
    if (audioEl) {
        audioEl.pause();
        if (silentAudioUrl) audioEl.src = silentAudioUrl;
    }
}

function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playBellSound() {
    try {
        initAudio();
        const now = audioCtx.currentTime;
        const notes = [1046.50, 1318.51, 1567.98];
        notes.forEach((freq, idx) => {
            const start = now + idx * 0.16;
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq * 0.92, start);
            osc.frequency.exponentialRampToValueAtTime(freq, start + 0.04);

            gain.gain.setValueAtTime(0.4, start);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);

            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(start);
            osc.stop(start + 0.45);
        });
    } catch (e) { }
}

// 5 классических видов расстановки угля из гайда со встроенными схемами
const COAL_SETUPS = [
    {
        id: '3 внутри',
        title: '3 внутри',
        desc: 'Классика (3 угля на дне калауда). Максимальный стартовый жар для прогрева и крепких табаков.',
        svg: `<svg viewBox="0 0 120 120" width="110" height="110" style="margin:0 auto 10px;display:block;"><circle cx="60" cy="60" r="52" fill="none" stroke="var(--text-secondary)" stroke-width="5"/><rect x="46" y="22" width="28" height="28" rx="5" fill="#FF5500"/><rect x="26" y="62" width="28" height="28" rx="5" fill="#FF5500"/><rect x="66" y="62" width="28" height="28" rx="5" fill="#FF5500"/></svg>`
    },
    {
        id: '2 + 1',
        title: '2 + 1 (На грани)',
        desc: 'Самая популярная схема: 2 угля внутри на дне, 1 стоит ребром на бортике калауда. Идеальный баланс жара без перегрева.',
        svg: `<svg viewBox="0 0 120 120" width="110" height="110" style="margin:0 auto 10px;display:block;"><circle cx="60" cy="60" r="52" fill="none" stroke="var(--text-secondary)" stroke-width="5"/><rect x="28" y="54" width="28" height="28" rx="5" fill="#FF5500"/><rect x="64" y="54" width="28" height="28" rx="5" fill="#FF5500"/><rect x="46" y="6" width="28" height="18" rx="4" fill="#FF9500" stroke="#fff" stroke-width="1.5"/></svg>`
    },
    {
        id: 'Чебурашка',
        title: 'Чебурашка (1+2)',
        desc: '1 уголь по центру на дне калауда, а 2 стоят «ушами» на бортиках по бокам. Щадящий, мягкий жар — идеально, когда чаша уже хорошо прогрета или табак боится перегрева.',
        svg: `<svg viewBox="0 0 120 120" width="110" height="110" style="margin:0 auto 10px;display:block;"><circle cx="60" cy="60" r="52" fill="none" stroke="var(--text-secondary)" stroke-width="5"/><rect x="46" y="46" width="28" height="28" rx="5" fill="#FF5500"/><rect x="4" y="46" width="18" height="28" rx="4" fill="#FF9500" stroke="#fff" stroke-width="1.5"/><rect x="98" y="46" width="18" height="28" rx="4" fill="#FF9500" stroke="#fff" stroke-width="1.5"/></svg>`
    },
    {
        id: 'Пирамида',
        title: 'Пирамида',
        desc: '2 угля стоят на дне калауда, а 3-й лежит сверху на них. Мягкий и долгий жар, отлично подходит для легких и средних смесей.',
        svg: `<svg viewBox="0 0 120 120" width="110" height="110" style="margin:0 auto 10px;display:block;"><circle cx="60" cy="60" r="52" fill="none" stroke="var(--text-secondary)" stroke-width="5"/><rect x="28" y="48" width="28" height="28" rx="5" fill="#FF5500"/><rect x="64" y="48" width="28" height="28" rx="5" fill="#FF5500"/><rect x="46" y="36" width="28" height="28" rx="5" fill="#FF9500" stroke="#1C1C1E" stroke-width="2"/></svg>`
    },
    {
        id: 'Домик',
        title: 'Домик (2+2)',
        desc: '4 угля: 2 на дне калауда и 2 сверху на бортиках. Мощный прогрев и долгая отдача жара для больших чаш.',
        svg: `<svg viewBox="0 0 120 120" width="110" height="110" style="margin:0 auto 10px;display:block;"><circle cx="60" cy="60" r="52" fill="none" stroke="var(--text-secondary)" stroke-width="5"/><rect x="30" y="46" width="26" height="26" rx="5" fill="#FF5500"/><rect x="64" y="46" width="26" height="26" rx="5" fill="#FF5500"/><rect x="22" y="14" width="26" height="16" rx="4" fill="#FF9500"/><rect x="72" y="14" width="26" height="16" rx="4" fill="#FF9500"/></svg>`
    },
    {
        id: '4 внутри',
        title: '4 внутри',
        desc: 'Экстремальный жар: 4 угля (обычно 22 мм или отряхнутые 25 мм) плотно внутри колодки. Для жаростойких сигарных табаков.',
        svg: `<svg viewBox="0 0 120 120" width="110" height="110" style="margin:0 auto 10px;display:block;"><circle cx="60" cy="60" r="52" fill="none" stroke="var(--text-secondary)" stroke-width="5"/><rect x="30" y="30" width="26" height="26" rx="4" fill="#FF5500"/><rect x="64" y="30" width="26" height="26" rx="4" fill="#FF5500"/><rect x="30" y="64" width="26" height="26" rx="4" fill="#FF5500"/><rect x="64" y="64" width="26" height="26" rx="4" fill="#FF5500"/></svg>`
    }
];

function renderCoalSelectors() {
    ['smoking-coal-selector', 'rating-coal-selector'].forEach(containerId => {
        const box = document.getElementById(containerId);
        if (!box) return;
        box.innerHTML = COAL_SETUPS.map(c => `
            <div class="coal-chip ${currentCoalPlacement === c.id ? 'active' : ''}" onclick="setCoalPlacement('${c.id}')">
                <span>${c.title}</span>
                <span class="coal-help-btn" onclick="showCoalHelp('${c.id}', event)" title="Схема и описание">?</span>
            </div>
        `).join('');
    });
}

function setCoalPlacement(type) {
    if (type === 'Пирамидка') type = 'Пирамида';
    if (type === '3 в колодке') type = '3 внутри';
    currentCoalPlacement = type;
    renderCoalSelectors();
    saveActiveSessionState();
}

function showCoalHelp(setupId, event) {
    if (event) event.stopPropagation();
    const item = COAL_SETUPS.find(c => c.id === setupId);
    if (!item) return;

    const modal = document.getElementById('ios-dialog-modal');
    const titleEl = document.getElementById('ios-dialog-title');
    const msgEl = document.getElementById('ios-dialog-msg');
    const inputEl = document.getElementById('ios-dialog-input');
    const cancelBtn = document.getElementById('ios-dialog-cancel');
    const okBtn = document.getElementById('ios-dialog-ok');

    titleEl.innerText = `🔥 ${item.title}`;
    msgEl.innerHTML = `${item.svg}<div>${item.desc}</div>`;
    msgEl.classList.remove('hidden');
    inputEl.classList.add('hidden');
    cancelBtn.classList.add('hidden');
    okBtn.onclick = () => closeIosDialog();
    modal.classList.remove('hidden');
}

// --- СКЛАД И СТОИМОСТЬ УГЛЕЙ ---
let coalInventory = { size: '25', packPrice: 600, packCount: 72, stock: 0 };

function loadCoalInventory() {
    try {
        const raw = localStorage.getItem('hookah_coal_inventory');
        if (raw) coalInventory = { ...coalInventory, ...JSON.parse(raw) };
    } catch (e) { }
    updateCoalUI();
}

function saveCoalSettings() {
    const sizeEl = document.getElementById('coal-size-select');
    const priceEl = document.getElementById('coal-pack-price');
    const countEl = document.getElementById('coal-pack-count');

    if (sizeEl) coalInventory.size = sizeEl.value;
    if (priceEl) coalInventory.packPrice = parseFloat(priceEl.value) || 0;
    if (countEl) coalInventory.packCount = parseInt(countEl.value) || 72;

    localStorage.setItem('hookah_coal_inventory', JSON.stringify(coalInventory));
    updateCoalUI();
    recalcLiveBowlCost();
}

function onCoalSizeChange() {
    const size = document.getElementById('coal-size-select')?.value;
    const countEl = document.getElementById('coal-pack-count');
    if (countEl) {
        if (size === '25') countEl.value = 72;
        else if (size === '26') countEl.value = 64;
        else if (size === '22') countEl.value = 96;
    }
    saveCoalSettings();
}

function getSingleCoalPrice() {
    if (!coalInventory.packPrice || !coalInventory.packCount || coalInventory.packCount <= 0) return 0;
    return coalInventory.packPrice / coalInventory.packCount;
}

function updateCoalUI() {
    const sizeEl = document.getElementById('coal-size-select');
    const priceEl = document.getElementById('coal-pack-price');
    const countEl = document.getElementById('coal-pack-count');
    const badgeEl = document.getElementById('coal-stock-badge');
    const unitEl = document.getElementById('coal-unit-price-label');

    if (sizeEl && document.activeElement !== sizeEl) sizeEl.value = coalInventory.size || '25';
    if (priceEl && document.activeElement !== priceEl) priceEl.value = coalInventory.packPrice || '';
    if (countEl && document.activeElement !== countEl) countEl.value = coalInventory.packCount || 72;

    if (badgeEl) {
        badgeEl.innerText = `Остаток: ${coalInventory.stock} шт.`;
        badgeEl.style.color = coalInventory.stock <= 12 ? 'var(--danger)' : 'var(--primary)';
    }
    if (unitEl) {
        const uPrice = getSingleCoalPrice();
        unitEl.innerText = `Цена 1 угля (${coalInventory.size} мм): ${uPrice.toFixed(1)} ₽`;
    }
}

function buyCoalPack() {
    const addCount = parseInt(coalInventory.packCount) || 72;
    coalInventory.stock = (parseInt(coalInventory.stock) || 0) + addCount;
    localStorage.setItem('hookah_coal_inventory', JSON.stringify(coalInventory));
    updateCoalUI();
    showIosNotice('Запас пополнен! 🧱', `Добавлено +${addCount} углей. Всего дома: ${coalInventory.stock} шт.`);
}

function editCoalStockPrompt() {
    openIosPrompt('Точный остаток углей (шт)', String(coalInventory.stock || 0), (val) => {
        const num = parseInt(val);
        if (!isNaN(num) && num >= 0) {
            coalInventory.stock = num;
            localStorage.setItem('hookah_coal_inventory', JSON.stringify(coalInventory));
            updateCoalUI();
        }
    });
}

async function sendPush(title, body) {
    if (navigator.vibrate) {
        try { navigator.vibrate([300, 150, 300]); } catch (e) { }
    }
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
        if (swRegistration && swRegistration.showNotification) {
            await swRegistration.showNotification(title, {
                body: body,
                icon: 'icon.png',
                tag: 'dimhookah-warmup',
                renotify: true
            });
        } else {
            new Notification(title, { body, icon: 'icon.png' });
        }
    } catch (e) { }
}

function getDraftMixFromForm() {
    const mix = [];
    if (isMixMode) {
        document.querySelectorAll('#mix-container .mix-item').forEach(item => {
            const brand = item.querySelector('.tobacco-brand-select')?.value.trim() || '';
            const flavor = item.querySelector('.tobacco-flavor')?.value.trim() || '';
            const weight = parseFloat(item.querySelector('.tobacco-weight')?.value) || 0;
            const packPrice = parseFloat(item.querySelector('.tobacco-pack-price')?.value) || 0;
            const packWeight = parseFloat(item.querySelector('.tobacco-pack-weight')?.value) || 0;
            const cost = Math.round(calcSingleTobaccoCost(weight, packPrice, packWeight));
            if (brand && packPrice > 0 && packWeight > 0) saveBrandPackDefault(brand, packPrice, packWeight);
            if (brand || flavor || weight) mix.push({ brand, flavor, weight, packPrice, packWeight, cost });
        });
    } else {
        const brand = document.getElementById('solo-tobacco-brand')?.value.trim() || '';
        const flavor = document.getElementById('solo-tobacco-flavor')?.value.trim() || '';
        const weight = parseFloat(document.getElementById('solo-tobacco-weight')?.value) || 0;
        const packPrice = parseFloat(document.getElementById('solo-pack-price')?.value) || 0;
        const packWeight = parseFloat(document.getElementById('solo-pack-weight')?.value) || 0;
        const cost = Math.round(calcSingleTobaccoCost(weight, packPrice, packWeight));
        if (brand && packPrice > 0 && packWeight > 0) saveBrandPackDefault(brand, packPrice, packWeight);
        if (brand || flavor || weight) mix.push({ brand, flavor, weight, packPrice, packWeight, cost });
    }
    return mix;
}

function saveActiveSessionState(stageOverride = null) {
    let stage = stageOverride;
    if (!stage) {
        if (!document.getElementById('warmup-controls').classList.contains('hidden')) stage = 'warmup';
        else if (!document.getElementById('smoking-controls').classList.contains('hidden')) stage = 'smoking';
        else if (!document.getElementById('rating-form').classList.contains('hidden')) stage = 'rating';
        else stage = 'idle';
    }

    if (stage === 'idle') {
        localStorage.removeItem('hookah_active_session');
        return;
    }

    const state = {
        stage,
        stepStartTime,
        warmupTargetSec,
        actualWarmupDuration,
        smokeDuration,
        alarmAlreadyPlayed,
        currentCoalPlacement,
        isMixMode,
        bowl: document.getElementById('bowl-select')?.value || '',
        mix: getDraftMixFromForm()
    };
    localStorage.setItem('hookah_active_session', JSON.stringify(state));
}

function restoreActiveSessionIfAny() {
    const raw = localStorage.getItem('hookah_active_session');
    if (!raw) return;

    try {
        const state = JSON.parse(raw);
        if (!state || !state.stage || state.stage === 'idle') return;

        stepStartTime = state.stepStartTime || Date.now();
        warmupTargetSec = state.warmupTargetSec || 300;
        actualWarmupDuration = state.actualWarmupDuration || 0;
        smokeDuration = state.smokeDuration || 0;
        alarmAlreadyPlayed = !!state.alarmAlreadyPlayed;
        setCoalPlacement(state.currentCoalPlacement || '3 в колодке');

        if (state.bowl) {
            const bowlSel = document.getElementById('bowl-select');
            if (bowlSel) bowlSel.value = state.bowl;
        }

        if (state.isMixMode && !isMixMode) toggleMixMode();
        if (state.mix && state.mix.length > 0) {
            if (state.isMixMode) {
                const container = document.getElementById('mix-container');
                container.innerHTML = '';
                state.mix.forEach(m => addMixRow(m.brand, m.flavor, m.weight || '', m.packPrice || '', m.packWeight || ''));
            } else {
                const m = state.mix[0];
                document.getElementById('solo-tobacco-brand').value = m.brand || '';
                document.getElementById('solo-tobacco-flavor').value = m.flavor || '';
                document.getElementById('solo-tobacco-weight').value = m.weight || '';
                document.getElementById('solo-pack-price').value = m.packPrice || '';
                document.getElementById('solo-pack-weight').value = m.packWeight || '';
            }
            recalcLiveBowlCost();
        }

        document.getElementById('setup-form').classList.add('hidden');

        if (state.stage === 'warmup') {
            document.getElementById('status-title').innerText = '⏳ Прогрев чаши';
            document.getElementById('warmup-controls').classList.remove('hidden');
            clearInterval(timerInterval);
            timerInterval = setInterval(updateWarmupTimer, 1000);
            updateWarmupTimer();
        } else if (state.stage === 'smoking') {
            document.getElementById('status-title').innerText = '💨 Идет покур';
            document.getElementById('active-mix-label').innerText = getCurrentMixSummaryText();
            document.getElementById('smoking-controls').classList.remove('hidden');
            clearInterval(timerInterval);
            timerInterval = setInterval(updateSmokingTimer, 1000);
            updateSmokingTimer();
        } else if (state.stage === 'rating') {
            document.getElementById('status-title').innerText = '✅ Сессия завершена';
            document.getElementById('timer').innerText = formatTimerSec(smokeDuration);
            document.getElementById('rating-form').classList.remove('hidden');
        }
    } catch (e) {
        localStorage.removeItem('hookah_active_session');
    }
}

function syncActiveTimerOnWake() {
    if (!document.getElementById('warmup-controls').classList.contains('hidden')) {
        updateWarmupTimer();
    } else if (!document.getElementById('smoking-controls').classList.contains('hidden')) {
        updateSmokingTimer();
    }
}

async function startWarmupSession() {
    initAudio();

    if ('Notification' in window && Notification.permission === 'default') {
        try {
            await Notification.requestPermission();
            updatePushButtonState();
        } catch (e) { }
    }

    if ('wakeLock' in navigator) {
        try { await navigator.wakeLock.request('screen'); } catch (e) { }
    }

    const mins = parseInt(document.getElementById('warmup-min').value) || 5;
    warmupTargetSec = mins * 60;

    document.getElementById('status-title').innerText = '⏳ Прогрев чаши';
    document.getElementById('setup-form').classList.add('hidden');
    document.getElementById('warmup-controls').classList.remove('hidden');

    stepStartTime = Date.now();
    alarmAlreadyPlayed = false;
    saveActiveSessionState('warmup');

    await startKeepAliveAudio(`⏳ Прогрев: ${formatTimerSec(warmupTargetSec)}`, getCurrentMixSummaryText());

    clearInterval(timerInterval);
    timerInterval = setInterval(updateWarmupTimer, 1000);
    updateWarmupTimer();
}

function updateWarmupTimer() {
    const elapsed = Math.floor((Date.now() - stepStartTime) / 1000);
    const remaining = warmupTargetSec - elapsed;

    document.getElementById('timer').innerText = formatTimerSec(elapsed);
    document.getElementById('warmup-countdown').innerText = formatTimerSec(remaining);

    const box = document.getElementById('warmup-box');
    if (remaining <= 0) {
        box.classList.add('alarm-active');
        updateLockScreenMetadata('🔥 ЧАША ПРОГРЕЛАСЬ!', 'Пора раскуривать кальян!');
        if (!alarmAlreadyPlayed) {
            alarmAlreadyPlayed = true;
            saveActiveSessionState('warmup');
            playBellSound();
            triggerLockScreenAudioAlarm();
            sendPush('Чаша прогрелась! 🔥', 'Пора раскуривать кальян, пока не сжег табак!');
        }
    } else {
        box.classList.remove('alarm-active');
        updateLockScreenMetadata(`⏳ Прогрев: ${formatTimerSec(remaining)}`, getCurrentMixSummaryText());
    }
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
}

function finishSmokingSession() {
    smokeDuration = Math.floor((Date.now() - stepStartTime) / 1000);
    clearInterval(timerInterval);
    stopKeepAliveAudio();

    document.getElementById('status-title').innerText = '✅ Сессия завершена';
    document.getElementById('timer').innerText = formatTimerSec(smokeDuration);
    document.getElementById('smoking-controls').classList.add('hidden');
    document.getElementById('rating-form').classList.remove('hidden');
    saveActiveSessionState('rating');
}

function cancelActiveSession() {
    clearInterval(timerInterval);
    stopKeepAliveAudio();
    document.getElementById('warmup-box').classList.remove('alarm-active');
    document.getElementById('warmup-controls').classList.add('hidden');
    document.getElementById('smoking-controls').classList.add('hidden');
    saveActiveSessionState('idle');
    resetForm();
}

function setRating(val) {
    currentRating = val;
    const stars = document.querySelectorAll('.star');
    stars.forEach((star, index) => {
        star.classList.toggle('active', index < val);
    });
}

function saveSession() {
    const bowl = document.getElementById('bowl-select').value || 'Не указана';
    const comment = document.getElementById('comment').value.trim();
    const mix = getDraftMixFromForm();

    if (mix.length === 0) mix.push({ brand: 'Без названия', flavor: '', weight: 0, packPrice: 0, packWeight: 0, cost: 0 });
    const coalsUsed = parseInt(document.getElementById('session-coals-used')?.value) || 0;
    const coalCost = Math.round(coalsUsed * getSingleCoalPrice());
    const tobaccoCost = Math.round(mix.reduce((acc, m) => acc + (m.cost || calcSingleTobaccoCost(m.weight, m.packPrice, m.packWeight)), 0));
    const sessionCost = tobaccoCost + coalCost;

    // Списываем угли из домашнего остатка
    if (coalsUsed > 0) {
        coalInventory.stock = Math.max(0, (parseInt(coalInventory.stock) || 0) - coalsUsed);
        localStorage.setItem('hookah_coal_inventory', JSON.stringify(coalInventory));
        updateCoalUI();
    }

    const now = new Date();
    const session = {
        id: Date.now(),
        date: now.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }),
        bowl,
        placement: currentCoalPlacement,
        coalsUsed,
        coalCost,
        mix,
        sessionCost,
        actualWarmupDuration,
        smokeDuration,
        rating: currentRating,
        comment
    };

    loadAllData((history) => {
        history.unshift(session);
        syncCatalogFromHistory(history);
        saveSessionsToStorage(history, () => {
            saveActiveSessionState('idle');
            resetForm();
            populateSelects();
            renderData(history);
        });
    });
}

function resetForm() {
    document.getElementById('status-title').innerText = 'Новая сессия';
    document.getElementById('timer').innerText = '00:00';
    document.getElementById('setup-form').classList.remove('hidden');
    document.getElementById('rating-form').classList.add('hidden');
    document.getElementById('comment').value = '';
    document.getElementById('solo-tobacco-flavor').value = '';
    document.getElementById('solo-tobacco-weight').value = '';
    document.getElementById('solo-pack-price').value = '';
    document.getElementById('solo-pack-weight').value = '';
    document.getElementById('mix-container').innerHTML = '';
    document.getElementById('bowl-select').value = '';
    document.getElementById('solo-tobacco-brand').value = '';
    setCoalPlacement('3 в колодке');
    if (isMixMode) toggleMixMode();
    recalcLiveBowlCost();
}

function deleteSession(id) {
    const modal = document.getElementById('ios-dialog-modal');
    const titleEl = document.getElementById('ios-dialog-title');
    const msgEl = document.getElementById('ios-dialog-msg');
    const inputEl = document.getElementById('ios-dialog-input');
    const cancelBtn = document.getElementById('ios-dialog-cancel');
    const okBtn = document.getElementById('ios-dialog-ok');

    if (!modal) return;
    titleEl.innerText = 'Удалить покур?';
    msgEl.innerText = 'Запись будет безвозвратно стерта из истории и статистики.';
    msgEl.classList.remove('hidden');
    inputEl.classList.add('hidden');
    cancelBtn.classList.remove('hidden');

    okBtn.onclick = () => {
        closeIosDialog();
        loadAllData((history) => {
            history = history.filter(s => s.id !== id);
            saveSessionsToStorage(history, () => {
                renderData(history);
            });
        });
    };

    modal.classList.remove('hidden');
}

const MONTH_NAMES_RU = {
    '01': 'Январь', '02': 'Февраль', '03': 'Март', '04': 'Апрель',
    '05': 'Май', '06': 'Июнь', '07': 'Июль', '08': 'Август',
    '09': 'Сентябрь', '10': 'Октябрь', '11': 'Ноябрь', '12': 'Декабрь'
};

function getSessionMonthKey(s) {
    const dStr = (s.date || '').trim();
    const parts = dStr.split('.');
    if (parts.length >= 2) {
        const mm = parts[1].padStart(2, '0');
        const yyyy = parts[2] ? parts[2].trim() : new Date(s.id || Date.now()).getFullYear().toString();
        return `${mm}.${yyyy}`;
    }
    const dt = new Date(s.id || Date.now());
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    return `${mm}.${dt.getFullYear()}`;
}

function formatMonthKeyLabel(key) {
    if (key === 'all') return 'За всё время';
    const [mm, yyyy] = key.split('.');
    const currentYear = new Date().getFullYear().toString();
    const mName = MONTH_NAMES_RU[mm] || mm;
    return (yyyy && yyyy !== currentYear) ? `${mName} ${yyyy}` : mName;
}

function setPeriodFilter(periodKey) {
    selectedPeriod = periodKey;
    closePeriodDropdown();
    loadAllData((history) => renderData(history));
}

function togglePeriodDropdown(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('period-popover-menu');
    const btn = document.getElementById('period-trigger-btn');
    if (!menu) return;
    const isHidden = menu.classList.contains('hidden');
    if (isHidden) {
        menu.classList.remove('hidden');
        if (btn) btn.classList.add('open');
    } else {
        closePeriodDropdown();
    }
}

function closePeriodDropdown() {
    const menu = document.getElementById('period-popover-menu');
    const btn = document.getElementById('period-trigger-btn');
    if (menu) menu.classList.add('hidden');
    if (btn) btn.classList.remove('open');
}

function renderPeriodFilterPills(history) {
    const menu = document.getElementById('period-popover-menu');
    const badge = document.getElementById('stats-period-badge');

    const monthKeys = [];
    (history || []).forEach(s => {
        const k = getSessionMonthKey(s);
        if (!monthKeys.includes(k)) monthKeys.push(k);
    });

    if (selectedPeriod !== 'all' && !monthKeys.includes(selectedPeriod)) {
        selectedPeriod = 'all';
    }

    if (badge) badge.innerText = formatMonthKeyLabel(selectedPeriod);
    if (!menu) return;

    const totalCount = (history || []).length;
    let html = `
                <button type="button" class="period-option ${selectedPeriod === 'all' ? 'active' : ''}" onclick="setPeriodFilter('all')">
                    <span>${selectedPeriod === 'all' ? '✓ ' : ''}За всё время</span>
                    <span class="period-option-count">${totalCount}</span>
                </button>
            `;

    monthKeys.forEach(k => {
        const count = history.filter(s => getSessionMonthKey(s) === k).length;
        const isAct = selectedPeriod === k;
        html += `
                    <button type="button" class="period-option ${isAct ? 'active' : ''}" onclick="setPeriodFilter('${k}')">
                        <span>${isAct ? '✓ ' : ''}${formatMonthKeyLabel(k)}</span>
                        <span class="period-option-count">${count}</span>
                    </button>
                `;
    });

    menu.innerHTML = html;
}

function getSessionTotalCost(s) {
    if (typeof s.sessionCost === 'number' && s.sessionCost > 0) return s.sessionCost;
    let sum = 0;
    (s.mix || []).forEach(m => {
        if (typeof m.cost === 'number' && m.cost > 0) {
            sum += m.cost;
        } else {
            const savedPack = brandPackDefaults[m.brand || m.name || ''];
            const pPrice = m.packPrice || (savedPack ? savedPack.price : 0);
            const pWeight = m.packWeight || (savedPack ? savedPack.weight : 0);
            sum += calcSingleTobaccoCost(m.weight, pPrice, pWeight);
        }
    });
    return Math.round(sum);
}

function renderHookahStats(filteredHistory) {
    const statsContainer = document.getElementById('hookah-stats-grid');
    if (!statsContainer) return;

    if (!filteredHistory || filteredHistory.length === 0) {
        statsContainer.innerHTML = `
            <div class="stat-card">
                <div class="stat-value">—</div>
                <div class="stat-label">В дыму</div>
            </div>
            <div class="stat-card">
                <div class="stat-value accent-cost">—</div>
                <div class="stat-label">Потрачено всего</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">—</div>
                <div class="stat-label">Чаще всего курил</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">—</div>
                <div class="stat-label">Самый долгий / Чаша</div>
            </div>
        `;
        return;
    }

    let totalSeconds = 0;
    let totalSpentRub = 0;
    let totalGramsUsed = 0;
    let totalCoalsUsed = 0;
    const bowlCounts = {};
    const tobaccoFreq = {};
    let longestSmokeSec = 0;
    let longestTobaccoName = '—';

    filteredHistory.forEach(s => {
        const dur = s.smokeDuration || 0;
        totalSeconds += dur;
        totalSpentRub += getSessionTotalCost(s);
        totalCoalsUsed += (parseInt(s.coalsUsed) || 0);

        if (s.bowl && s.bowl !== 'Не указана') {
            bowlCounts[s.bowl] = (bowlCounts[s.bowl] || 0) + 1;
        }

        const mixNames = [];
        (s.mix || []).forEach(m => {
            totalGramsUsed += (parseFloat(m.weight) || 0);
            const bName = ((m.brand || m.name || '') + ' ' + (m.flavor || '')).trim();
            if (bName && bName !== 'Без названия') {
                mixNames.push(bName);
                tobaccoFreq[bName] = (tobaccoFreq[bName] || 0) + 1;
            }
        });

        if (dur > longestSmokeSec && mixNames.length > 0) {
            longestSmokeSec = dur;
            longestTobaccoName = mixNames.join(' + ');
        }
    });

    // Топ табак по частоте покуров за период
    let mostSmokedTobacco = '—';
    let maxTobCount = 0;
    for (const [tName, count] of Object.entries(tobaccoFreq)) {
        if (count > maxTobCount) {
            maxTobCount = count;
            mostSmokedTobacco = `${tName} (${count}x)`;
        }
    }

    // Топ чаша
    let topBowl = '—';
    let maxBowlCount = 0;
    for (const [bowl, count] of Object.entries(bowlCounts)) {
        if (count > maxBowlCount) {
            maxBowlCount = count;
            topBowl = bowl;
        }
    }

    const n = filteredHistory.length;
    const sessionWord = (n % 10 === 1 && n % 100 !== 11) ? 'покур' : ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) ? 'покура' : 'покуров';
    const timeFormatted = formatDurationHM(totalSeconds);
    const costDisplay = totalSpentRub > 0 ? `${totalSpentRub.toLocaleString('ru-RU')} ₽` : '—';
    const longestSub = longestSmokeSec > 0 ? `${longestTobaccoName} (${formatDurationHM(longestSmokeSec)})` : '—';

    statsContainer.innerHTML = `
        <div class="stat-card">
            <div class="stat-value">${timeFormatted}</div>
            <div class="stat-label">В дыму (${n} ${sessionWord})</div>
        </div>
        <div class="stat-card">
            <div class="stat-value accent-cost">${costDisplay}</div>
            <div class="stat-label">Бюджет (${Math.round(totalGramsUsed)}г • ${totalCoalsUsed} угл.)</div>
        </div>
        <div class="stat-card">
            <div class="stat-value" style="font-size: 0.92em; padding-top: 4px;" title="${mostSmokedTobacco}">${mostSmokedTobacco}</div>
            <div class="stat-label">Чаще всего курил</div>
        </div>
        <div class="stat-card">
            <div class="stat-value" style="font-size: 0.88em; padding-top: 4px;" title="Рекорд: ${longestSub} | Чаша: ${topBowl}">⏳ ${longestSub}</div>
            <div class="stat-label">Топ чаша: ${topBowl}</div>
        </div>
    `;
}

function renderData(history) {
    if (!history) {
        loadAllData((h) => renderData(h));
        return;
    }

    renderPeriodFilterPills(history);

    const filteredHistory = (selectedPeriod === 'all')
        ? history
        : history.filter(s => getSessionMonthKey(s) === selectedPeriod);

    renderHookahStats(filteredHistory);

    const tbody = document.getElementById('history-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    const tobaccoStats = {};

    filteredHistory.forEach(s => {
        const tr = document.createElement('tr');
        const placementText = (s.placement === 'Пирамидка') ? 'Пирамида' : (s.placement || '3 в колодке');
        const sessionCost = getSessionTotalCost(s);
        const costBadgeHtml = sessionCost > 0
            ? `<span class="cost-badge">💰 ${sessionCost} ₽</span>`
            : '';

        const mixStr = (s.mix || []).map(m => {
            const b = m.brand || m.name || '';
            const f = m.flavor || '';
            const itemCost = m.cost || Math.round(calcSingleTobaccoCost(m.weight, m.packPrice, m.packWeight));
            const costHint = itemCost > 0 ? ` • ${itemCost}₽` : '';
            return `<span class="badge">${b} ${f} (${m.weight || 0}г${costHint})</span>`;
        }).join(' ');

        const commentHtml = s.comment ? `<div style="color:var(--text-secondary); margin-top:6px; font-size:0.85em; font-style:italic;">💬 ${s.comment}</div>` : '';

        tr.innerHTML = `
                    <td><b>${s.date}</b><span style="color:#ffb340; font-weight:800;">★ ${s.rating}</span> ${costBadgeHtml}</td>
                    <td><b>${s.bowl}</b><br><span style="color:var(--text-secondary); font-size:0.85em;">🔥 ${placementText}</span></td>
                    <td><div>${mixStr}</div>${commentHtml}</td>
                    <td style="font-size:0.82em; white-space:nowrap;">
                        🔥 ${formatDurationHM(s.actualWarmupDuration)} &nbsp;•&nbsp;
                        💨 <b>${formatDurationHM(s.smokeDuration)}</b>
                    </td>
                    <td style="white-space: nowrap;">
                        <button class="btn-edit" onclick="openFullEditModal(${s.id})">✏️</button>
                        <button class="btn-danger" onclick="deleteSession(${s.id})">✕</button>
                    </td>
                `;
        tbody.appendChild(tr);

        (s.mix || []).forEach(m => {
            const tobName = ((m.brand || m.name || '') + ' ' + (m.flavor || '')).trim();
            const key = tobName.toLowerCase();
            if (key) {
                if (!tobaccoStats[key]) {
                    tobaccoStats[key] = { name: tobName, count: 0, totalRating: 0, totalWeight: 0, totalSpent: 0 };
                }
                tobaccoStats[key].count += 1;
                tobaccoStats[key].totalRating += s.rating;
                tobaccoStats[key].totalWeight += (parseFloat(m.weight) || 0);
                tobaccoStats[key].totalSpent += Math.round(m.cost || calcSingleTobaccoCost(m.weight, m.packPrice, m.packWeight));
            }
        });
    });

    const analyticsDiv = document.getElementById('analytics-content');
    if (!analyticsDiv) return;
    const sortedTobaccos = Object.values(tobaccoStats).sort((a, b) => (b.totalRating / b.count) - (a.totalRating / a.count));

    if (sortedTobaccos.length === 0) {
        analyticsDiv.innerHTML = '<p style="color: var(--text-secondary); margin:0; font-size:0.9em;">Нет сохраненных сессий за выбранный период.</p>';
        return;
    }

    let html = '<table><thead><tr><th>Табак</th><th>Рейтинг</th><th>Вес / Бюджет</th></tr></thead><tbody>';
    sortedTobaccos.forEach(t => {
        const avg = (t.totalRating / t.count).toFixed(1);
        const spentStr = t.totalSpent > 0 ? ` • <span style="color:var(--primary); font-weight:700;">${t.totalSpent} ₽</span>` : '';
        html += `
                    <tr>
                        <td><b>${t.name}</b> <span style="color:var(--text-secondary); font-size:0.8em;">(${t.count})</span></td>
                        <td style="color: #ffb340; font-weight: 800;">★ ${avg}</td>
                        <td>${t.totalWeight} г${spentStr}</td>
                    </tr>
                `;
    });
    html += '</tbody></table>';
    analyticsDiv.innerHTML = html;
}

function addModalMixRow(brand = '', flavor = '', weight = '', packPrice = '', packWeight = '') {
    if (brand && !savedBrands.includes(brand)) savedBrands.push(brand);
    if (brand && (!packPrice || !packWeight) && brandPackDefaults[brand]) {
        packPrice = brandPackDefaults[brand].price || '';
        packWeight = brandPackDefaults[brand].weight || '';
    }
    const container = document.getElementById('modal-mix-container');
    const card = document.createElement('div');
    card.className = 'tobacco-entry-card modal-mix-item';
    card.innerHTML = `
                <div class="select-with-add" style="margin-bottom: 8px;">
                    <select class="tobacco-brand-select" onchange="onBrandSelectChange(this)">${getBrandOptionsHtml(brand)}</select>
                    <button type="button" class="btn-plus" onclick="addNewBrandPrompt(this.previousElementSibling)">+</button>
                    <button type="button" class="btn-minus" onclick="deleteSelectedBrand(this.previousElementSibling.previousElementSibling)">−</button>
                    <button type="button" class="btn-danger" style="height: 44px; width: 44px;" onclick="this.closest('.modal-mix-item').remove()">✕</button>
                </div>
                <div style="display: flex; gap: 8px;">
                    <input type="text" class="modal-tobacco-flavor" placeholder="Вкус" value="${flavor}" style="flex: 2;">
                    <input type="number" class="modal-tobacco-weight" placeholder="Грамм" value="${weight}" style="flex: 1.2;">
                </div>
                <div class="pack-price-row">
                    <span class="pack-price-label">🏷️ Пачка:</span>
                    <input type="number" class="modal-pack-price" placeholder="Цена ₽" value="${packPrice}" oninput="onPackInfoInput(this)">
                    <span class="pack-price-label">за</span>
                    <input type="number" class="modal-pack-weight" placeholder="Грамм" value="${packWeight}" oninput="onPackInfoInput(this)">
                    <span class="pack-price-label">г</span>
                </div>
            `;
    container.appendChild(card);
}

let currentModalRating = 5;
function setModalRating(val) {
    currentModalRating = val;
    document.querySelectorAll('.modal-star').forEach((star, index) => {
        star.classList.toggle('active', index < val);
    });
}

function openFullEditModal(id) {
    document.querySelectorAll('select, input').forEach(el => el.blur());
    loadAllData((history) => {
        const s = history.find(item => item.id === id);
        if (!s) return;

        if (s.bowl && !savedBowls.includes(s.bowl)) savedBowls.push(s.bowl);
        populateSelects();

        document.getElementById('modal-id').value = s.id;
        document.getElementById('modal-date').value = s.date;
        document.getElementById('modal-bowl').value = s.bowl;

        const placementVal = (s.placement === 'Пирамидка') ? 'Пирамида' : (s.placement || '3 в колодке');
        document.getElementById('modal-placement').value = placementVal;
        setModalRating(s.rating || 5);
        document.getElementById('modal-comment').value = s.comment || '';

        const warmupTotalMins = Math.round((s.actualWarmupDuration || 0) / 60);
        document.getElementById('modal-warmup-h').value = Math.floor(warmupTotalMins / 60);
        document.getElementById('modal-warmup-m').value = warmupTotalMins % 60;

        const smokeTotalMins = Math.round((s.smokeDuration || 0) / 60);
        document.getElementById('modal-smoke-h').value = Math.floor(smokeTotalMins / 60);
        document.getElementById('modal-smoke-m').value = smokeTotalMins % 60;

        const mixContainer = document.getElementById('modal-mix-container');
        mixContainer.innerHTML = '';
        (s.mix || []).forEach(m => {
            addModalMixRow(m.brand || m.name || '', m.flavor || '', m.weight || 0, m.packPrice || '', m.packWeight || '');
        });
        if ((s.mix || []).length === 0) addModalMixRow();

        document.getElementById('edit-modal').classList.remove('hidden');
    });
}

function closeEditModal() {
    document.querySelectorAll('#edit-modal select, #edit-modal input').forEach(el => el.blur());
    document.getElementById('edit-modal').classList.add('hidden');
}

function saveEditedSession() {
    const id = parseInt(document.getElementById('modal-id').value);
    loadAllData((history) => {
        history = history.map(s => {
            if (s.id === id) {
                s.date = document.getElementById('modal-date').value;
                s.bowl = document.getElementById('modal-bowl').value;
                s.placement = document.getElementById('modal-placement').value;
                s.rating = currentModalRating;
                s.comment = document.getElementById('modal-comment').value;

                const wh = parseInt(document.getElementById('modal-warmup-h').value) || 0;
                const wm = parseInt(document.getElementById('modal-warmup-m').value) || 0;
                s.actualWarmupDuration = (wh * 3600) + (wm * 60);

                const sh = parseInt(document.getElementById('modal-smoke-h').value) || 0;
                const sm = parseInt(document.getElementById('modal-smoke-m').value) || 0;
                s.smokeDuration = (sh * 3600) + (sm * 60);

                const updatedMix = [];
                document.querySelectorAll('#modal-mix-container .modal-mix-item').forEach(item => {
                    const brand = item.querySelector('.tobacco-brand-select').value.trim();
                    const flavor = item.querySelector('.modal-tobacco-flavor').value.trim();
                    const weight = parseFloat(item.querySelector('.modal-tobacco-weight').value) || 0;
                    const packPrice = parseFloat(item.querySelector('.modal-pack-price')?.value) || 0;
                    const packWeight = parseFloat(item.querySelector('.modal-pack-weight')?.value) || 0;
                    const cost = Math.round(calcSingleTobaccoCost(weight, packPrice, packWeight));
                    if (brand && packPrice > 0 && packWeight > 0) saveBrandPackDefault(brand, packPrice, packWeight);
                    if (brand || flavor) updatedMix.push({ brand, flavor, weight, packPrice, packWeight, cost });
                });
                s.mix = updatedMix.length > 0 ? updatedMix : [{ brand: 'Без названия', flavor: '', weight: 0, packPrice: 0, packWeight: 0, cost: 0 }];
                s.sessionCost = Math.round(s.mix.reduce((acc, m) => acc + (m.cost || 0), 0));
            }
            return s;
        });

        syncCatalogFromHistory(history);
        saveSessionsToStorage(history, () => {
            closeEditModal();
            populateSelects();
            renderData(history);
        });
    });
}

async function exportToNotes() {
    loadAllData(async (history) => {
        if (history.length === 0) {
            showIosNotice('История пуста', 'Сначала сохрани хотя бы один покур!');
            return;
        }

        let text = "💨 ИСТОРИЯ ПОКУРОВ DIMHOOKAH\n\n";
        history.forEach((s, index) => {
            const mixStr = (s.mix || []).map(m => `${m.brand || m.name || ''} ${m.flavor || ''} (${m.weight}г)`).join(', ');
            const placementText = (s.placement === 'Пирамидка') ? 'Пирамида' : (s.placement || '3 в колодке');
            text += `${index + 1}. Дата: ${s.date} | Чаша: ${s.bowl}\n`;
            text += `   Микс: ${mixStr}\n`;
            text += `   Расстановка: ${placementText}\n`;
            text += `   🔥 ${formatDurationHM(s.actualWarmupDuration)} | 💨 ${formatDurationHM(s.smokeDuration)} | ⭐${s.rating}\n`;
            if (s.comment) text += `   Комментарий: ${s.comment}\n`;
            text += `-----------------------------------\n`;
        });

        if (navigator.share) {
            try { await navigator.share({ title: 'История покуров', text: text }); return; } catch (e) { }
        }
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showIosNotice('Скопировано! 📋', 'История покуров скопирована в буфер обмена.');
    });
}

function exportToCSV() {
    loadAllData((history) => {
        if (history.length === 0) {
            showIosNotice('История пуста', 'Нет записей для экспорта.');
            return;
        }

        let csv = '\uFEFFДата;Чаша;Расстановка;Микс;Время прогрева (сек);Время покура (сек);Оценка;Комментарий\n';
        history.forEach(s => {
            const placementText = (s.placement === 'Пирамидка') ? 'Пирамида' : (s.placement || '3 в колодке');
            const mixStr = (s.mix || []).map(m => `${m.brand || m.name || ''}|${m.flavor || ''}(${m.weight}г)`).join(' + ');
            csv += `"${s.date}";"${s.bowl}";"${placementText}";"${mixStr}";"${s.actualWarmupDuration || 0}";"${s.smokeDuration || 0}";"${s.rating}";"${s.comment || ''}"\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dimhookah_history_${new Date().toLocaleDateString()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });
}

function importFromCSV(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        const text = e.target.result;
        const lines = text.split('\n');
        if (lines.length < 2) return;

        loadAllData((history) => {
            let importedCount = 0;
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                const row = [];
                let inQuotes = false;
                let currentVal = '';
                for (let char of line) {
                    if (char === '"') { inQuotes = !inQuotes; }
                    else if (char === ';' && !inQuotes) { row.push(currentVal); currentVal = ''; }
                    else { currentVal += char; }
                }
                row.push(currentVal);

                if (row.length >= 7) {
                    const date = row[0].replace(/"/g, '');
                    const bowl = row[1].replace(/"/g, '');
                    let placement = row[2] ? row[2].replace(/"/g, '') : '3 в колодке';
                    if (placement === 'Пирамидка') placement = 'Пирамида';
                    const mixRaw = row[3] ? row[3].replace(/"/g, '') : '';
                    const actualWarmupDuration = parseInt(row[4]) || 0;
                    const smokeDuration = parseInt(row[5]) || 0;
                    const rating = parseInt(row[6]) || 5;
                    const comment = row[7] ? row[7].replace(/"/g, '') : '';

                    const mix = [];
                    mixRaw.split('+').forEach(part => {
                        const match = part.trim().match(/(.*?)\s*\((\d+(?:\.\d+)?)[гg]\)/i);
                        if (match) {
                            const rawName = match[1].trim();
                            const weight = parseFloat(match[2]) || 0;
                            if (rawName.includes('|')) {
                                const [b, f] = rawName.split('|');
                                mix.push({ brand: b.trim(), flavor: (f || '').trim(), weight });
                            } else {
                                mix.push({ brand: rawName, flavor: '', weight });
                            }
                        } else if (part.trim()) {
                            mix.push({ brand: part.trim(), flavor: '', weight: 0 });
                        }
                    });

                    if (mix.length === 0) mix.push({ brand: 'Без названия', flavor: '', weight: 0 });

                    history.push({
                        id: Date.now() + i,
                        date,
                        bowl,
                        placement,
                        mix,
                        actualWarmupDuration,
                        smokeDuration,
                        rating,
                        comment
                    });
                    importedCount++;
                }
            }

            syncCatalogFromHistory(history);
            saveSessionsToStorage(history, () => {
                populateSelects();
                renderData(history);
                event.target.value = '';
                showIosNotice('Импорт завершен ✅', `Успешно добавлено записей: ${importedCount}`);
            });
        });
    };
    reader.readAsText(file, 'UTF-8');
}