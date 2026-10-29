// --- БАЗОВЫЕ КАТАЛОГИ (ЧАШИ ДОБАВЛЯЮТСЯ ТОЛЬКО ВРУЧНУЮ) ---
const DEFAULT_BOWLS = [];

const LEGACY_PRESET_BOWLS = [
    "Cosmobowl Turkish", "Cosmobowl Killer", "Космобоул Турка", "Космобоул Убивашка",
    "Облако Phunnel M", "Торнадо Убивашка", "SmokeLab Mummy", "Смоук Лаб Мумия",
    "Grynbowls Традишка", "UPG Малая", "UPG (Апгрейд Форм) Малая", "Werkbund Zeus",
    "Japona Hookah Mummy", "Moon Phunnel", "ST Классика", "Fox Турка", "Solaris", "Solaris (Солярис)"
];

const DEFAULT_BRANDS = [
    "Musthave",
    "Darkside",
    "Blackburn",
    "Наш",
    "Северный",
    "Deus",
    "Bonche",
    "Overdose",
    "Chabacco",
    "Tangiers",
    "Element",
    "Sebero",
    "Spectrum",
    "Satyr",
    "Duft",
    "Banger",
    "Burn",
    "Daily Hookah",
    "Starline",
    "Trofimoff's",
    "Jam",
    "Brusko"
];

let savedBowls = [];
let savedBrands = [];
let catalogSessionBrands = [];
let catalogSessionFlavors = new Map();
let sessionCatalogReady = false;
let activeDraftSaveTimer = null;
let activeDraftDirty = false;
let sessionDefaultsApplied = false;
let historyVisibleCount = 5;
let lastHistorySessions = [];
let brandPackDefaults = {};
let coalInventory = { packSize: 72, packPrice: 700, remaining: 72 };
let currentAnalyticsPeriod = 'all';

let isMixMode = false;
let timerInterval = null;
let bgWorker = null;
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
let chimeAudioUrl = null;
let lastLockScreenTitle = '';
let lockedScrollY = 0;
let keepAliveActive = false;
let warmupAlertTimeout = null;
let smoke60Timeout = null;
let smoke90Timeout = null;

function stripRussianBrackets(name) {
    return String(name || '').replace(/\s*\([^)]*\)\s*$/g, '').trim();
}

function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function byId(id) {
    return document.getElementById(id);
}

function setSelectValueIncludingLegacy(select, value) {
    if (!select) return;
    const clean = String(value || '').trim();
    if (!clean) return;
    if (![...select.options].some(option => option.value === clean)) {
        select.append(new Option(clean, clean, true, true));
    }
    select.value = clean;
}

// --- АВТОПОДСТАНОВКА ГРАММОВКИ С ПОСЛЕДНЕГО ПОКУРА ---
function getLastUsedWeights(sessionsList = null) {
    let sessions = sessionsList;
    if (!Array.isArray(sessions)) {
        try {
            sessions = JSON.parse(localStorage.getItem('hookah_sessions') || '[]');
        } catch (e) {
            sessions = [];
        }
    }

    if (Array.isArray(sessions) && sessions.length > 0) {
        for (let i = sessions.length - 1; i >= 0; i--) {
            const s = sessions[i];
            if (Array.isArray(s.mix) && s.mix.length > 0) {
                const weights = s.mix.map(m => parseFloat(m.weight)).filter(w => Number.isFinite(w) && w > 0);
                if (weights.length > 0) {
                    const total = Math.round(weights.reduce((a, b) => a + b, 0));
                    return {
                        soloWeight: total > 0 ? total : weights[0],
                        mixWeights: weights
                    };
                }
            }
        }
    }

    const savedLast = parseFloat(localStorage.getItem('hookah_last_weight'));
    const fallback = Number.isFinite(savedLast) && savedLast > 0 ? savedLast : 18;
    return {
        soloWeight: fallback,
        mixWeights: [Math.round(fallback * 0.6), Math.max(1, fallback - Math.round(fallback * 0.6))]
    };
}

function applyLastUsedWeightToForm(sessionsList = null) {
    const { soloWeight } = getLastUsedWeights(sessionsList);
    const manualWeightEl = document.getElementById('manual-weight-input');
    if (manualWeightEl) {
        manualWeightEl.value = soloWeight;
    }
    recalcLiveBowlCost();
}

function getLatestSession(sessionsList) {
    if (!Array.isArray(sessionsList) || sessionsList.length === 0) return null;
    return sessionsList.reduce((latest, session) => {
        if (!latest) return session;
        const currentId = Number(session.id) || 0;
        const latestId = Number(latest.id) || 0;
        return currentId >= latestId ? session : latest;
    }, null);
}

function applySessionDefaultsFromLast(sessionsList) {
    const last = getLatestSession(sessionsList);
    if (!last || getActiveStage()) return;

    if (last.bowl) {
        if (!savedBowls.includes(last.bowl)) savedBowls.unshift(last.bowl);
        const bowlSelect = document.getElementById('bowl-select');
        if (bowlSelect) {
            populateSelects();
            if ([...bowlSelect.options].some(option => option.value === last.bowl)) {
                bowlSelect.value = last.bowl;
            }
        }
    }

    if (last.coalsUsed && document.getElementById('start-coals-input')) {
        document.getElementById('start-coals-input').value = last.coalsUsed;
    }
    if (last.actualWarmupDuration > 0 && document.getElementById('warmup-min')) {
        document.getElementById('warmup-min').value = Math.max(1, Math.round(last.actualWarmupDuration / 60));
    }

    const mix = getNormalizedMix(last);
    if (mix.length > 0) {
        if (mix.length === 1) {
            const first = mix[0];
            const brand = stripRussianBrackets(first.brand);
            toggleMixMode(false);
            populateSelects();
            setSelectValueIncludingLegacy(document.getElementById('solo-tobacco-brand'), brand);
            syncSoloFlavorOptions(first.flavor || '');
            const weight = document.getElementById('solo-tobacco-weight');
            if (weight) weight.value = '';
            fillPackInputsForBrand('solo', brand);
        } else {
            toggleMixMode(true);
            const list = document.getElementById('mix-rows-list');
            list.innerHTML = '';
            mix.forEach(item => addMixRow(stripRussianBrackets(item.brand), item.flavor, ''));
        }
    }

    sessionDefaultsApplied = true;
    recalcLiveBowlCost();
}

// --- ФОНОВЫЙ WEB WORKER ДЛЯ ТАЙМЕРА ---
function startTimerTicker(callback) {
    stopTimerTicker();

    try {
        const blob = new Blob([`
            let id = null;
            self.onmessage = function(e) {
                if (e.data === 'start') {
                    if (id) clearInterval(id);
                    id = setInterval(() => self.postMessage('tick'), 1000);
                } else if (e.data === 'stop') {
                    if (id) clearInterval(id);
                    id = null;
                }
            };
        `], { type: 'application/javascript' });
        bgWorker = new Worker(URL.createObjectURL(blob));
        bgWorker.onmessage = () => callback();
        bgWorker.postMessage('start');
    } catch (e) {
        timerInterval = setInterval(callback, 1000);
    }
}

function stopTimerTicker() {
    if (bgWorker) {
        try {
            bgWorker.postMessage('stop');
            bgWorker.terminate();
        } catch (e) { }
        bgWorker = null;
    }
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

// --- БЛОКИРОВКА СКРОЛЛА ФОНА ПОД МОДАЛКАМИ ---
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
        else if (modalId === 'brand-manager-modal') closeBrandManagerModal();
    }
}

// --- КАСТОМНЫЕ МОДАЛКИ ---
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
    const savedMode = localStorage.getItem('hookah_theme_mode') || 'light';
    applyThemeMode(savedMode);

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        const currentMode = localStorage.getItem('hookah_theme_mode') || 'light';
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
    updateThemeAssets();
}

function isDarkTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
}

function getThemeIconPath(size = 192) {
    return `assets/icons/app-icon-v20-${size}.png`;
}

function updateThemeAssets() {
    const dark = isDarkTheme();
    const icon192 = getThemeIconPath(192);
    const logo = document.getElementById('app-logo');
    if (logo) logo.src = icon192;

    const touchIcon = document.getElementById('app-touch-icon');
    if (touchIcon) touchIcon.href = icon192;

    const favicon = document.getElementById('app-favicon');
    if (favicon) favicon.href = icon192;

    const manifest = document.getElementById('app-manifest');
    if (manifest) manifest.href = dark ? 'manifest.json' : 'manifest-light.json';

    const themeColor = document.getElementById('theme-color-meta');
    if (themeColor) themeColor.content = dark ? '#171719' : '#f8f5ec';
}

// --- ЗВУК IOS 27 И УМНАЯ MEDIASESSION ---
function initAudio() {
    if (!audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) audioCtx = new AudioContext();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    prepareKeepAliveAudio();
    prepareChimeWavUrl();
}

function prepareKeepAliveAudio() {
    const audioEl = document.getElementById('bg-audio');
    if (silentAudioUrl) {
        if (audioEl && !audioEl.getAttribute('src')) {
            audioEl.src = silentAudioUrl;
            audioEl.volume = 0.01;
        }
        return;
    }
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
    if (audioEl) {
        audioEl.src = silentAudioUrl;
        audioEl.volume = 0.01;
    }
}

function prepareChimeWavUrl() {
    if (chimeAudioUrl) return;
    const sampleRate = 22050;
    const durationSec = 2.4;
    const numSamples = Math.floor(sampleRate * durationSec);
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
        { freq: 523.25, start: 0.00, dur: 0.75 },
        { freq: 659.25, start: 0.11, dur: 0.75 },
        { freq: 783.99, start: 0.22, dur: 0.80 },
        { freq: 987.77, start: 0.33, dur: 0.90 },
        { freq: 1174.66, start: 0.44, dur: 1.10 },
        { freq: 523.25, start: 1.15, dur: 0.75 },
        { freq: 659.25, start: 1.26, dur: 0.75 },
        { freq: 783.99, start: 1.37, dur: 0.80 },
        { freq: 1174.66, start: 1.48, dur: 0.90 },
        { freq: 1567.98, start: 1.60, dur: 0.78 }
    ];

    for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        let sample = 0;
        for (const n of notes) {
            if (t >= n.start && t <= n.start + n.dur) {
                const localT = t - n.start;
                const env = Math.min(1, localT / 0.015) * Math.exp(-3.5 * (localT / n.dur));
                sample += Math.sin(2 * Math.PI * n.freq * localT) * env * 0.22;
                sample += Math.sin(2 * Math.PI * (n.freq * 2) * localT) * env * 0.05;
            }
        }
        const clamped = Math.max(-1, Math.min(1, sample));
        view.setInt16(44 + i * 2, Math.floor(clamped * 32767), true);
    }

    const blob = new Blob([buffer], { type: 'audio/wav' });
    chimeAudioUrl = URL.createObjectURL(blob);
}

function startKeepAliveAudio(titleText, subtitleText) {
    keepAliveActive = true;
    prepareKeepAliveAudio();
    const audioEl = document.getElementById('bg-audio');
    if (audioEl) {
        audioEl.volume = 0.01;
        audioEl.play().catch(() => { });
    }
    if ('mediaSession' in navigator) {
        try { navigator.mediaSession.playbackState = 'playing'; } catch (e) { }
    }
    updateLockScreenMetadata(titleText, subtitleText, true);
}

function stopKeepAliveAudio() {
    keepAliveActive = false;
    const audioEl = document.getElementById('bg-audio');
    if (audioEl) {
        audioEl.pause();
        try { audioEl.currentTime = 0; } catch (e) { }
        try {
            audioEl.removeAttribute('src');
            audioEl.load();
        } catch (e) { }
    }
    if ('mediaSession' in navigator) {
        try {
            navigator.mediaSession.playbackState = 'none';
            navigator.mediaSession.metadata = null;
            ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'].forEach(action => {
                try { navigator.mediaSession.setActionHandler(action, null); } catch (e) { }
            });
        } catch (e) { }
    }
    lastLockScreenTitle = '';
}

function updateLockScreenMetadata(title, artist, force = false) {
    if (!('mediaSession' in navigator)) return;

    const audioEl = document.getElementById('bg-audio');
    if (!force && audioEl && audioEl.paused) {
        return;
    }

    if (!force && title === lastLockScreenTitle) {
        return;
    }
    lastLockScreenTitle = title;

    try {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: title || 'DimHookah',
            artist: artist || 'Контроль сессии',
            album: 'DimHookah Timer',
            artwork: [{ src: getThemeIconPath(192), sizes: '192x192', type: 'image/png' }]
        });
    } catch (e) { }
}

function playIos27Chime() {
    try {
        initAudio();
        if (audioCtx && audioCtx.state === 'running') {
            const now = audioCtx.currentTime;
            const notes = [
                { freq: 523.25, delay: 0.00, dur: 0.85 },
                { freq: 659.25, delay: 0.11, dur: 0.85 },
                { freq: 783.99, delay: 0.22, dur: 0.90 },
                { freq: 987.77, delay: 0.33, dur: 1.05 },
                { freq: 1174.66, delay: 0.45, dur: 1.30 },
                { freq: 523.25, delay: 1.35, dur: 0.85 },
                { freq: 659.25, delay: 1.46, dur: 0.85 },
                { freq: 783.99, delay: 1.57, dur: 0.90 },
                { freq: 1174.66, delay: 1.68, dur: 1.15 },
                { freq: 1567.98, delay: 1.82, dur: 1.60 }
            ];

            notes.forEach(n => {
                const start = now + n.delay;
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(n.freq, start);

                gain.gain.setValueAtTime(0.0001, start);
                gain.gain.linearRampToValueAtTime(0.26, start + 0.018);
                gain.gain.exponentialRampToValueAtTime(0.0001, start + n.dur);

                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start(start);
                osc.stop(start + n.dur + 0.05);
            });
        }
    } catch (e) { }

    try {
        prepareChimeWavUrl();
        const audioEl = document.getElementById('bg-audio');
        if (audioEl && chimeAudioUrl) {
            audioEl.loop = false;
            audioEl.src = chimeAudioUrl;
            audioEl.volume = 0.95;
            audioEl.play().catch(() => { });
            setTimeout(() => {
                if (!keepAliveActive) return;
                if (silentAudioUrl) {
                    audioEl.src = silentAudioUrl;
                    audioEl.loop = true;
                    audioEl.volume = 0.01;
                    audioEl.play().catch(() => { });
                }
            }, 2600);
        }
    } catch (e) { }

    if (navigator.vibrate) {
        navigator.vibrate([150, 80, 150, 80, 300]);
    }
}

function showBannerToast(msg) {
    const toast = document.getElementById('toast-notification');
    if (!toast) return;
    toast.innerText = msg;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3800);
}

function sendPush(title, body) {
    showBannerToast(`${title}: ${body}`);
    if (!("Notification" in window) || Notification.permission !== "granted") return;

    const fallback = () => {
        try { new Notification(title, { body, icon: getThemeIconPath(192) }); } catch (e) { }
    };

    const show = (reg) => {
        if (!reg || !reg.showNotification) {
            fallback();
            return;
        }
        reg.showNotification(title, {
            body,
            icon: getThemeIconPath(192),
            badge: getThemeIconPath(192),
            tag: 'dimhookah-timer-alert',
            renotify: true,
            requireInteraction: true,
            vibrate: [200, 100, 200],
            data: { url: './' }
        }).catch(fallback);
    };

    if (navigator.serviceWorker) {
        navigator.serviceWorker.getRegistration()
            .then((reg) => {
                if (reg && reg.showNotification) {
                    show(reg);
                    return;
                }
                return Promise.race([
                    navigator.serviceWorker.ready,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('SW timeout')), 3000))
                ]).then(show).catch(fallback);
            })
            .catch(fallback);
    } else {
        fallback();
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
    loadAllData((sessions) => {
        applyLastUsedWeightToForm(sessions);
        renderData(sessions);
    });
};
request.onerror = function () {
    loadAllData((sessions) => {
        applyLastUsedWeightToForm(sessions);
        renderData(sessions);
    });
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
    let localData = [];
    try {
        localData = JSON.parse(localStorage.getItem('hookah_sessions') || '[]');
    } catch (e) {
        localData = [];
    }
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
    let storedBowls = [];
    let storedBrands = null;
    let storedPacks = {};
    let storedCoals = null;

    try { storedBowls = JSON.parse(localStorage.getItem('hookah_bowls') || '[]'); } catch (e) { }
    try { storedBrands = JSON.parse(localStorage.getItem('hookah_brands') || 'null'); } catch (e) { }
    try { storedPacks = JSON.parse(localStorage.getItem('hookah_brand_packs') || '{}'); } catch (e) { }
    try { storedCoals = JSON.parse(localStorage.getItem('hookah_coal_inventory') || 'null'); } catch (e) { }

    if (!localStorage.getItem('hookah_custom_bowls_only_v1')) {
        let historySessions = [];
        try { historySessions = JSON.parse(localStorage.getItem('hookah_sessions') || '[]'); } catch (e) { }
        const usedInHistory = new Set(historySessions.map(s => s.bowl).filter(Boolean));
        storedBowls = (Array.isArray(storedBowls) ? storedBowls : []).filter(
            b => !LEGACY_PRESET_BOWLS.includes(b) || usedInHistory.has(b)
        );
        localStorage.setItem('hookah_custom_bowls_only_v1', '1');
    }

    savedBowls = Array.isArray(storedBowls) ? Array.from(new Set(storedBowls.filter(Boolean))) : [];

    const rawBrands = Array.isArray(storedBrands) && storedBrands.length > 0
        ? storedBrands
        : DEFAULT_BRANDS;
    savedBrands = Array.from(new Set(rawBrands.map(stripRussianBrackets).filter(Boolean)));
    if (savedBrands.length === 0) {
        savedBrands = [...DEFAULT_BRANDS];
    }

    brandPackDefaults = {};
    if (storedPacks && typeof storedPacks === 'object') {
        Object.keys(storedPacks).forEach(k => {
            const cleanKey = stripRussianBrackets(k);
            if (storedPacks[k] && (storedPacks[k].price || storedPacks[k].weight)) {
                brandPackDefaults[cleanKey] = storedPacks[k];
            }
        });
    }

    if (storedCoals && typeof storedCoals === 'object') {
        const parsedSize = Number(storedCoals.packSize);
        const parsedPrice = Number(storedCoals.packPrice);
        const parsedRem = Number(storedCoals.remaining);

        coalInventory = {
            packSize: Number.isFinite(parsedSize) && parsedSize > 0 ? Math.round(parsedSize) : 72,
            packPrice: Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : 700,
            remaining: Number.isFinite(parsedRem) && parsedRem >= 0 ? Math.round(parsedRem) : 72
        };
    }

    localStorage.setItem('hookah_bowls', JSON.stringify(savedBowls));
    localStorage.setItem('hookah_brands', JSON.stringify(savedBrands));
    localStorage.setItem('hookah_brand_packs', JSON.stringify(brandPackDefaults));
    localStorage.setItem('hookah_coal_inventory', JSON.stringify(coalInventory));

    populateSelects();
    applyLastUsedWeightToForm();
    renderCoalInventoryUI();
}

function getBowlOptionsHtml(selectedVal = '') {
    if (savedBowls.length === 0) {
        return `<option value="" selected>Нет чаш — нажми «+ Добавить»</option>`;
    }
    const target = savedBowls.includes(selectedVal) ? selectedVal : savedBowls[0];
    return savedBowls.map(b => `<option value="${b}" ${b === target ? 'selected' : ''}>${b}</option>`).join('');
}

function sortedBrandList() {
    const source = sessionCatalogReady && catalogSessionBrands.length
        ? catalogSessionBrands
        : (savedBrands.length ? savedBrands : DEFAULT_BRANDS);
    return [...new Set(source.map(stripRussianBrackets).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'ru'));
}

function isLegacyDefaultBrand(value) {
    const key = stripRussianBrackets(value).toLowerCase().replace(/[’']/g, "'");
    return DEFAULT_BRANDS.some(brand => stripRussianBrackets(brand).toLowerCase().replace(/[’']/g, "'") === key);
}

function getBrandOptionsHtml(selectedVal = '') {
    const list = sortedBrandList();
    const cleanSelected = stripRussianBrackets(selectedVal);
    const optionsList = [...list];
    if (cleanSelected && !optionsList.includes(cleanSelected)) optionsList.push(cleanSelected);
    if (!optionsList.length) return `<option value="">Нет брендов</option>`;
    const target = cleanSelected || optionsList[0];
    return optionsList.map(b => {
        const safe = escapeHtml(b);
        return `<option value="${safe}" ${b === target ? 'selected' : ''}>${safe}</option>`;
    }).join('');
}

function getFlavorOptionsHtml(brand, selected = '') {
    const list = (catalogSessionFlavors.get(brand) || []).slice();
    const cleanSelected = String(selected || '').trim();
    const optionsList = [...list];
    if (cleanSelected && !optionsList.includes(cleanSelected)) optionsList.unshift(cleanSelected);
    if (!optionsList.length) return `<option value="">Нет вкусов</option>`;
    const target = cleanSelected && optionsList.includes(cleanSelected) ? cleanSelected : optionsList[0];
    return optionsList.map(flavor => {
        const safe = escapeHtml(flavor);
        return `<option value="${safe}" ${flavor === target ? 'selected' : ''}>${safe}</option>`;
    }).join('');
}

function syncSoloFlavorOptions(selected) {
    const select = document.getElementById('solo-tobacco-flavor');
    if (!select) return;
    const brand = document.getElementById('solo-tobacco-brand')?.value || '';
    const previous = selected === undefined ? select.value : selected;
    select.innerHTML = getFlavorOptionsHtml(brand, previous);
    if (previous && [...select.options].some(option => option.value === previous)) {
        select.value = previous;
    } else {
        select.value = select.options[0]?.value || '';
    }
}

function syncMixFlavorOptions(card, selected) {
    if (!card) return;
    const select = card.querySelector('.flavor-select');
    if (!select) return;
    const brand = card.querySelector('.brand-select')?.value || '';
    const previous = selected === undefined ? select.value : selected;
    select.innerHTML = getFlavorOptionsHtml(brand, previous);
    if (previous && [...select.options].some(option => option.value === previous)) {
        select.value = previous;
    } else {
        select.value = select.options[0]?.value || '';
    }
}

function syncManualFlavorOptions(selected) {
    const select = document.getElementById('manual-flavor-input');
    if (!select) return;
    const brand = document.getElementById('manual-brand-select')?.value || '';
    const previous = selected === undefined ? select.value : selected;
    select.innerHTML = getFlavorOptionsHtml(brand, previous);
    if (previous && [...select.options].some(option => option.value === previous)) {
        select.value = previous;
    } else {
        select.value = select.options[0]?.value || '';
    }
}

function applyCatalogToSession(catalog) {
    if (!Array.isArray(catalog) || catalog.length === 0) return;
    const byBrand = new Map();
    for (const item of catalog) {
        if (!item || !item.brand || !item.name) continue;
        if (!byBrand.has(item.brand)) byBrand.set(item.brand, new Set());
        byBrand.get(item.brand).add(item.name);
    }
    catalogSessionBrands = [...byBrand.keys()].sort((a, b) => a.localeCompare(b, 'ru'));
    catalogSessionFlavors = new Map(
        [...byBrand.entries()].map(([brand, flavors]) => [
            brand,
            [...flavors].sort((a, b) => a.localeCompare(b, 'ru'))
        ])
    );
    sessionCatalogReady = true;
    savedBrands = catalogSessionBrands.slice();
    try { localStorage.setItem('hookah_brands', JSON.stringify(savedBrands)); } catch (e) { }

    const manualBrand = document.getElementById('manual-brand-select');
    if (manualBrand) {
        const previous = manualBrand.value;
        manualBrand.innerHTML = getBrandOptionsHtml(previous);
        manualBrand.value = [...manualBrand.options].some(option => option.value === previous)
            ? previous
            : (manualBrand.options[0]?.value || '');
        syncManualFlavorOptions();
    }

    populateSelects();
    document.querySelectorAll('#edit-mix-rows .tobacco-grid-mix').forEach(row => {
        const brandSelect = row.querySelector('.brand-select');
        const flavorSelect = row.querySelector('.flavor-select');
        if (!brandSelect) return;
        const brand = brandSelect.value;
        const flavor = flavorSelect?.value || '';
        brandSelect.innerHTML = getBrandOptionsHtml(brand);
        brandSelect.value = brand;
        syncMixFlavorOptions(row, flavor);
    });
}

function populateSelects() {
    const bowlSelect = document.getElementById('bowl-select');
    if (bowlSelect) {
        const currentVal = bowlSelect.value && savedBowls.includes(bowlSelect.value) ? bowlSelect.value : (savedBowls[0] || '');
        bowlSelect.innerHTML = getBowlOptionsHtml(currentVal);
        bowlSelect.value = currentVal;
    }

    const soloBrand = document.getElementById('solo-tobacco-brand');
    if (soloBrand) {
        const prevBrand = stripRussianBrackets(soloBrand.value);
        const keepPrev = prevBrand && (
            !sessionCatalogReady ||
            catalogSessionBrands.includes(prevBrand) ||
            !isLegacyDefaultBrand(prevBrand)
        );
        const targetBrand = keepPrev ? prevBrand : (catalogSessionBrands[0] || sortedBrandList()[0] || '');
        soloBrand.innerHTML = getBrandOptionsHtml(targetBrand);
        soloBrand.value = [...soloBrand.options].some(option => option.value === targetBrand)
            ? targetBrand
            : (soloBrand.options[0]?.value || '');
        syncSoloFlavorOptions();
        fillPackInputsForBrand('solo', soloBrand.value);
    }

    document.querySelectorAll('#mix-rows-list .tobacco-card-box').forEach(card => {
        const sel = card.querySelector('.brand-select');
        if (!sel) return;
        const cur = stripRussianBrackets(sel.value);
        const keepCur = cur && (
            !sessionCatalogReady ||
            catalogSessionBrands.includes(cur) ||
            !isLegacyDefaultBrand(cur)
        );
        const targetCur = keepCur ? cur : (catalogSessionBrands[0] || sortedBrandList()[0] || '');
        const currentFlavor = card.querySelector('.flavor-select')?.value || '';
        sel.innerHTML = getBrandOptionsHtml(targetCur);
        sel.value = [...sel.options].some(option => option.value === targetCur)
            ? targetCur
            : (sel.options[0]?.value || '');
        syncMixFlavorOptions(card, currentFlavor);
    });

    recalcLiveBowlCost();
}

function fillPackInputsForBrand(mode, brandName, rowEl = null) {
    const pack = brandPackDefaults[brandName];
    if (mode === 'solo') {
        const priceEl = document.getElementById('solo-pack-price');
        const weightEl = document.getElementById('solo-pack-weight');
        if (priceEl && weightEl) {
            priceEl.value = pack && pack.price ? pack.price : '';
            weightEl.value = pack && pack.weight ? pack.weight : '';
        }
    } else if (rowEl) {
        const priceEl = rowEl.querySelector('.mix-pack-price');
        const weightEl = rowEl.querySelector('.mix-pack-weight');
        if (priceEl && weightEl) {
            priceEl.value = pack && pack.price ? pack.price : '';
            weightEl.value = pack && pack.weight ? pack.weight : '';
        }
    }
}

function onPackInfoChange(mode, inputEl = null) {
    if (mode === 'solo') {
        const brandSel = document.getElementById('solo-tobacco-brand');
        const brand = brandSel?.value || '';
        const price = parseFloat(document.getElementById('solo-pack-price').value) || 0;
        const weight = parseFloat(document.getElementById('solo-pack-weight').value) || 0;
        if (brand) {
            brandPackDefaults[brand] = { price, weight };
            localStorage.setItem('hookah_brand_packs', JSON.stringify(brandPackDefaults));
        }
    } else if (inputEl) {
        const card = inputEl.closest('.tobacco-card-box');
        if (card) {
            const sel = card.querySelector('.brand-select');
            const brand = sel?.value || '';
            const price = parseFloat(card.querySelector('.mix-pack-price').value) || 0;
            const weight = parseFloat(card.querySelector('.mix-pack-weight').value) || 0;
            if (brand) {
                brandPackDefaults[brand] = { price, weight };
                localStorage.setItem('hookah_brand_packs', JSON.stringify(brandPackDefaults));
            }
        }
    }
    recalcLiveBowlCost();
}

// --- ДОБАВЛЕНИЕ И УДАЛЕНИЕ ЧАШ ---
function toggleQuickAddBowl() {
    const box = document.getElementById('quick-bowl-box');
    if (!box) return;
    box.classList.toggle('hidden');
    if (!box.classList.contains('hidden')) {
        document.getElementById('new-bowl-input')?.focus();
    }
}

function addCustomBowl() {
    const input = document.getElementById('new-bowl-input');
    if (!input) return;
    const name = input.value.trim();
    if (!name) {
        showBannerToast('Введи название чаши!');
        input.focus();
        return;
    }

    const existsIdx = savedBowls.findIndex(b => b.toLowerCase() === name.toLowerCase());
    if (existsIdx !== -1) {
        savedBowls.splice(existsIdx, 1);
    }
    savedBowls.unshift(name);
    localStorage.setItem('hookah_bowls', JSON.stringify(savedBowls));

    populateSelects();
    const bowlSelect = document.getElementById('bowl-select');
    if (bowlSelect) bowlSelect.value = name;

    input.value = '';
    document.getElementById('quick-bowl-box')?.classList.add('hidden');
    showBannerToast(`Чаша «${name}» добавлена`);
    revealSetupStep(2);
}

async function deleteSelectedBowl() {
    const select = document.getElementById('bowl-select');
    const target = select?.value;
    if (!target) {
        showBannerToast('Сначала добавь чашу в список');
        return;
    }

    const ok = await showIosConfirm('Удалить чашу?', `Убрать чашу «${target}» из списка?`, 'Удалить', true);
    if (!ok) return;

    savedBowls = savedBowls.filter(b => b !== target);
    localStorage.setItem('hookah_bowls', JSON.stringify(savedBowls));
    populateSelects();
    showBannerToast(`Чаша «${target}» удалена`);
}

// --- ДОБАВЛЕНИЕ И УДАЛЕНИЕ БРЕНДОВ ТАБАКА ---
function toggleQuickAddBrand() {
    const box = document.getElementById('quick-brand-box');
    if (!box) return;
    box.classList.toggle('hidden');
    if (!box.classList.contains('hidden')) {
        document.getElementById('new-brand-input')?.focus();
    }
}

function addCustomBrandFromBar() {
    const input = document.getElementById('new-brand-input');
    if (!input) return;
    const name = stripRussianBrackets(input.value);
    if (!name) {
        showBannerToast('Введи название бренда!');
        input.focus();
        return;
    }

    const existsIdx = savedBrands.findIndex(b => b.toLowerCase() === name.toLowerCase());
    if (existsIdx !== -1) {
        savedBrands.splice(existsIdx, 1);
    }
    savedBrands.unshift(name);
    localStorage.setItem('hookah_brands', JSON.stringify(savedBrands));

    populateSelects();

    const soloBrand = document.getElementById('solo-tobacco-brand');
    if (soloBrand) {
        soloBrand.value = name;
        document.getElementById('solo-custom-brand')?.classList.add('hidden');
        fillPackInputsForBrand('solo', name);
    }

    input.value = '';
    document.getElementById('quick-brand-box')?.classList.add('hidden');
    recalcLiveBowlCost();
    showBannerToast(`Бренд «${name}» добавлен и выбран`);
}

function openBrandManagerModal() {
    renderBrandManagerList();
    document.getElementById('brand-manager-modal')?.classList.remove('hidden');
    syncBodyScrollLock();
}

function closeBrandManagerModal() {
    document.getElementById('brand-manager-modal')?.classList.add('hidden');
    syncBodyScrollLock();
}

function renderBrandManagerList() {
    const listEl = document.getElementById('brand-manager-list');
    if (!listEl) return;

    listEl.innerHTML = savedBrands.map(b => `
        <div class="brand-chip-item">
            <span>${b}</span>
            <button type="button" class="brand-chip-del" onclick="removeBrandFromCatalog('${b.replace(/'/g, "\\'")}')">✕</button>
        </div>
    `).join('');
}

function removeBrandFromCatalog(brandName) {
    if (savedBrands.length <= 1) {
        showBannerToast('Оставь хотя бы 1 бренд в списке!');
        return;
    }
    savedBrands = savedBrands.filter(b => b !== brandName);
    localStorage.setItem('hookah_brands', JSON.stringify(savedBrands));
    renderBrandManagerList();
    populateSelects();
}

function resetDefaultBrands() {
    savedBrands = Array.from(new Set([...DEFAULT_BRANDS, ...savedBrands]));
    localStorage.setItem('hookah_brands', JSON.stringify(savedBrands));
    renderBrandManagerList();
    populateSelects();
    showBannerToast('Базовые бренды восстановлены');
}

function clearNewTobaccoWeight(control) {
    if (getActiveStage() || !control.closest('#setup-form')) return;
    const row = control.closest('.tobacco-card-box');
    const weight = row && row.querySelector('#solo-tobacco-weight, .mix-weight-input');
    if (weight) weight.value = '';
    recalcLiveBowlCost();
}

function onBrandSelectChange(selectEl) {
    clearNewTobaccoWeight(selectEl);
    const card = selectEl.closest('.tobacco-card-box');
    const mixRow = selectEl.closest('.tobacco-grid-mix');
    if (selectEl.id === 'solo-tobacco-brand') {
        syncSoloFlavorOptions();
        fillPackInputsForBrand('solo', selectEl.value);
    } else if (mixRow) {
        syncMixFlavorOptions(mixRow);
        if (card) fillPackInputsForBrand('mix', selectEl.value, card);
    }
    recalcLiveBowlCost();
}

function onManualBrandChange(selectEl) {
    syncManualFlavorOptions();
}

function ensureBrandSaved(brandName) {
    if (sessionCatalogReady) return;
    const clean = stripRussianBrackets(brandName);
    if (clean && clean !== '__custom__' && !savedBrands.includes(clean)) {
        savedBrands.unshift(clean);
        localStorage.setItem('hookah_brands', JSON.stringify(savedBrands));
    }
}

// --- КАЛЬКУЛЯТОР СЕБЕСТОИМОСТИ И СКЛАД УГЛЕЙ ---
function getSingleCoalPrice() {
    const size = Number(coalInventory.packSize);
    const price = Number(coalInventory.packPrice);
    if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(price) || price < 0) return 0;
    return price / size;
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
            const g = parseFloat(card.querySelector('.mix-weight-input')?.value) || 0;
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
    const safeRemaining = Number.isFinite(Number(coalInventory.remaining))
        ? Math.max(0, Math.round(Number(coalInventory.remaining)))
        : 0;
    coalInventory.remaining = safeRemaining;

    const infoEl = document.getElementById('coal-price-info');
    const remEl = document.getElementById('coal-stock-remaining');
    const badgeEl = document.getElementById('coal-low-badge');

    if (infoEl) {
        infoEl.innerText = `1 шт ≈ ${oneCoal.toFixed(1)} ₽ (Пачка ${coalInventory.packSize} шт = ${coalInventory.packPrice} ₽)`;
    }
    if (remEl) {
        remEl.innerText = String(safeRemaining);
    }
    if (badgeEl) {
        badgeEl.classList.toggle('hidden', safeRemaining > 12);
    }

    const sizeInput = document.getElementById('coal-pack-size-input');
    const priceInput = document.getElementById('coal-pack-price-input');
    const stockInput = document.getElementById('coal-current-stock-input');
    if (sizeInput) sizeInput.value = coalInventory.packSize;
    if (priceInput) priceInput.value = coalInventory.packPrice;
    if (stockInput) stockInput.value = safeRemaining;
}

function toggleCoalSettings() {
    document.getElementById('coal-settings-panel')?.classList.toggle('hidden');
}

function saveCoalInventorySettings() {
    const rawSize = Number(document.getElementById('coal-pack-size-input').value);
    const rawPrice = Number(document.getElementById('coal-pack-price-input').value);
    const rawRemStr = document.getElementById('coal-current-stock-input').value.trim();
    const rawRem = rawRemStr === '' ? 0 : Number(rawRemStr);

    coalInventory.packSize = Number.isFinite(rawSize) && rawSize >= 1 ? Math.round(rawSize) : 72;
    coalInventory.packPrice = Number.isFinite(rawPrice) && rawPrice >= 0 ? rawPrice : 700;
    coalInventory.remaining = Number.isFinite(rawRem) && rawRem >= 0 ? Math.round(rawRem) : 0;

    localStorage.setItem('hookah_coal_inventory', JSON.stringify(coalInventory));
    renderCoalInventoryUI();
    recalcLiveBowlCost();
    document.getElementById('coal-settings-panel')?.classList.add('hidden');
    showBannerToast('Склад углей обновлён');
}

function buyNewCoalPack() {
    const currentRem = Number.isFinite(Number(coalInventory.remaining)) ? Number(coalInventory.remaining) : 0;
    const packSz = Number.isFinite(Number(coalInventory.packSize)) && Number(coalInventory.packSize) > 0 ? Number(coalInventory.packSize) : 72;
    coalInventory.remaining = Math.max(0, Math.round(currentRem + packSz));
    localStorage.setItem('hookah_coal_inventory', JSON.stringify(coalInventory));
    renderCoalInventoryUI();
    showBannerToast(`+${packSz} углей добавлено на склад!`);
}

function consumeCoalsFromStock(count) {
    const c = Number(count);
    const used = Number.isFinite(c) && c > 0 ? Math.round(c) : 0;
    const currentRem = Number.isFinite(Number(coalInventory.remaining)) ? Number(coalInventory.remaining) : 0;
    coalInventory.remaining = Math.max(0, Math.round(currentRem - used));
    localStorage.setItem('hookah_coal_inventory', JSON.stringify(coalInventory));
    renderCoalInventoryUI();
}

// --- ПЕРЕХОД В МИКС: БЕЗ ОТДЕЛЬНОГО ПЕРЕКЛЮЧАТЕЛЯ ---
function setMixModeVisual() {
    const soloContainer = document.getElementById('solo-container');
    const mixContainer = document.getElementById('mix-container');
    if (soloContainer) soloContainer.classList.toggle('hidden', isMixMode);
    if (mixContainer) mixContainer.classList.toggle('hidden', !isMixMode);
}

function toggleMixMode(forceState = null) {
    isMixMode = typeof forceState === 'boolean' ? forceState : !isMixMode;
    setMixModeVisual();

    if (isMixMode) {
        const list = document.getElementById('mix-rows-list');
        if (list && list.children.length === 0) {
            addMixRow(sortedBrandList()[0] || '', '', '');
        }
    }
    recalcLiveBowlCost();
}

function addTobaccoToMix() {
    if (!isMixMode) {
        const brand = document.getElementById('solo-tobacco-brand')?.value || sortedBrandList()[0] || '';
        const flavor = document.getElementById('solo-tobacco-flavor')?.value || '';
        const weight = document.getElementById('solo-tobacco-weight')?.value || '';
        isMixMode = true;
        setMixModeVisual();
        const list = document.getElementById('mix-rows-list');
        if (list) {
            list.innerHTML = '';
            addMixRow(brand, flavor, weight);
            addMixRow(sortedBrandList()[1] || sortedBrandList()[0] || '', '', '');
        }
    } else {
        addMixRow();
    }
    recalcLiveBowlCost();
    revealSetupStep(3);
}

function addMixRow(brand = '', flavor = '', weight = '') {
    const list = document.getElementById('mix-rows-list');
    const selectedBrand = stripRussianBrackets(brand) || savedBrands[0] || DEFAULT_BRANDS[0];
    const pack = brandPackDefaults[selectedBrand] || { price: '', weight: '' };
    const defaultWeight = weight;

    const card = document.createElement('div');
    card.className = 'tobacco-card-box';
    card.innerHTML = `
        <div class="tobacco-grid-mix">
            <select class="brand-select control-h" onchange="onBrandSelectChange(this)">
                ${getBrandOptionsHtml(selectedBrand)}
            </select>
            <select class="flavor-select control-h" onchange="clearNewTobaccoWeight(this); revealSetupStep(3)"></select>
            <div class="unit-input-box control-h">
                <input type="number" class="mix-weight-input" value="${defaultWeight}" placeholder="—" aria-label="Вес табака в граммах" min="1" max="100" oninput="recalcLiveBowlCost()">
                <span>г</span>
            </div>
            <button type="button" class="remove-mix-btn" onclick="removeMixRow(this)">✕</button>
        </div>
        <div class="pack-price-grid">
            <div class="pack-field">
                <span class="pack-field-label">Цена пачки</span>
                <div class="pack-field-control">
                    <input type="number" class="mix-pack-price" placeholder="0" value="${pack.price || ''}" min="0" oninput="onPackInfoChange('mix', this)">
                    <span>₽</span>
                </div>
            </div>
            <div class="pack-field">
                <span class="pack-field-label">Вес пачки</span>
                <div class="pack-field-control">
                    <input type="number" class="mix-pack-weight" placeholder="25" value="${pack.weight || ''}" min="1" oninput="onPackInfoChange('mix', this)">
                    <span>г</span>
                </div>
            </div>
        </div>
    `;
    list.appendChild(card);
    const sel = card.querySelector('.brand-select');
    if (sel) sel.value = selectedBrand;
    syncMixFlavorOptions(card, flavor);
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
        const brand = stripRussianBrackets(brandSelect?.value || sortedBrandList()[0] || '');
        const flavor = document.getElementById('solo-tobacco-flavor')?.value || '';
        const weight = parseFloat(document.getElementById('solo-tobacco-weight').value) || 0;
        const packPrice = parseFloat(document.getElementById('solo-pack-price').value) || 0;
        const packWeight = parseFloat(document.getElementById('solo-pack-weight').value) || 0;
        const cost = Math.round(calcSingleTobaccoCost(weight, packPrice, packWeight));

        if (weight > 0) localStorage.setItem('hookah_last_weight', String(weight));
        ensureBrandSaved(brand);
        if (brand && packPrice > 0 && packWeight > 0) {
            brandPackDefaults[brand] = { price: packPrice, weight: packWeight };
            localStorage.setItem('hookah_brand_packs', JSON.stringify(brandPackDefaults));
        }
        return [{ brand, flavor, weight, packPrice, packWeight, cost }];
    } else {
        const items = [];
        let sumW = 0;
        document.querySelectorAll('#mix-rows-list .tobacco-card-box').forEach(card => {
            const sel = card.querySelector('.brand-select');
            const brand = stripRussianBrackets(sel?.value || sortedBrandList()[0] || '');
            const flavor = card.querySelector('.flavor-select')?.value || '';
            const weight = parseFloat(card.querySelector('.mix-weight-input').value) || 0;
            const packPrice = parseFloat(card.querySelector('.mix-pack-price').value) || 0;
            const packWeight = parseFloat(card.querySelector('.mix-pack-weight').value) || 0;
            const cost = Math.round(calcSingleTobaccoCost(weight, packPrice, packWeight));

            sumW += weight;
            ensureBrandSaved(brand);
            if (brand && packPrice > 0 && packWeight > 0) {
                brandPackDefaults[brand] = { price: packPrice, weight: packWeight };
                localStorage.setItem('hookah_brand_packs', JSON.stringify(brandPackDefaults));
            }
            if (brand || flavor || weight > 0) {
                items.push({ brand, flavor, weight, packPrice, packWeight, cost });
            }
        });
        if (sumW > 0) localStorage.setItem('hookah_last_weight', String(sumW));
        return items.length ? items : [{ brand: savedBrands[0], flavor: '', weight: 0, packPrice: 0, packWeight: 0, cost: 0 }];
    }
}

function formatMixText(mixArray) {
    if (!Array.isArray(mixArray) || mixArray.length === 0) return 'Табак не указан';
    return mixArray.map(item => {
        const cleanB = stripRussianBrackets(item.brand);
        const namePart = item.flavor ? `${cleanB} (${item.flavor})` : cleanB;
        const weightPart = item.weight ? ` <span class="mix-tag">${item.weight}г</span>` : '';
        return `${namePart}${weightPart}`;
    }).join(' + ');
}

function formatMixPlainText(mixArray) {
    if (!Array.isArray(mixArray) || mixArray.length === 0) return 'Без названия';
    return mixArray.map(item => {
        const cleanB = stripRussianBrackets(item.brand);
        const namePart = item.flavor ? `${cleanB} ${item.flavor}` : cleanB;
        const weightPart = item.weight ? ` (${item.weight}г)` : '';
        return `${namePart}${weightPart}`;
    }).join(' + ');
}

function setWarmupPreset(min) {
    document.getElementById('warmup-min').value = min;
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

        if (state.bowl) {
            if (!savedBowls.includes(state.bowl)) {
                savedBowls.unshift(state.bowl);
                populateSelects();
            }
            document.getElementById('bowl-select').value = state.bowl;
        }

        if (Array.isArray(state.mix) && state.mix.length > 0) {
            if (state.mix.length === 1) {
                const first = state.mix[0];
                toggleMixMode(false);
                populateSelects();
                setSelectValueIncludingLegacy(document.getElementById('solo-tobacco-brand'), stripRussianBrackets(first.brand));
                syncSoloFlavorOptions(first.flavor || '');
                if (first.weight) document.getElementById('solo-tobacco-weight').value = first.weight;
            } else {
                toggleMixMode(true);
                const list = document.getElementById('mix-rows-list');
                list.innerHTML = '';
                state.mix.forEach(m => addMixRow(stripRussianBrackets(m.brand), m.flavor, m.weight));
            }
        }

        document.getElementById('setup-form').classList.remove('hidden');
        document.getElementById('active-session').classList.remove('hidden');
        setStartButtonActive(true);
        document.getElementById('active-mix-label').innerText = formatMixPlainText(state.mix);

        if (state.stage === 'warmup') {
            document.getElementById('status-title').innerText = '🔥 Прогрев чаши...';
            document.getElementById('warmup-controls').classList.remove('hidden');
            document.getElementById('smoking-controls').classList.add('hidden');
            document.getElementById('rating-form').classList.add('hidden');

            startTimerTicker(updateWarmupTimer);
            updateWarmupTimer();
            scheduleWarmupAlert();
        } else if (state.stage === 'smoking') {
            document.getElementById('status-title').innerText = '💨 Идет покур';
            document.getElementById('warmup-controls').classList.add('hidden');
            document.getElementById('smoking-controls').classList.remove('hidden');
            document.getElementById('rating-form').classList.add('hidden');
            document.getElementById('warmup-overtime-label')?.classList.add('hidden');
            document.getElementById('timer')?.classList.remove('overtime-text');

            startTimerTicker(updateSmokingTimer);
            updateSmokingTimer();
            scheduleSmokingAlerts();
        } else if (state.stage === 'rating') {
            document.getElementById('status-title').innerText = '✅ Сессия завершена';
            document.getElementById('warmup-controls').classList.add('hidden');
            document.getElementById('smoking-controls').classList.add('hidden');
            document.getElementById('rating-form').classList.remove('hidden');
            document.getElementById('warmup-overtime-label')?.classList.add('hidden');
            document.getElementById('timer')?.classList.remove('overtime-text');
            document.getElementById('timer').innerText = formatTimerSec(smokeDuration);

            const forgottenBox = document.getElementById('forgotten-timer-box');
            const rawTimeEl = document.getElementById('forgotten-raw-time');
            if (forgottenBox && smokeDuration > 5400) {
                if (rawTimeEl) rawTimeEl.innerText = formatDurationHM(smokeDuration);
                forgottenBox.classList.remove('hidden');
            }
        }
    } catch (e) {
        console.warn('Ошибка восстановления сессии:', e);
    }
}

// --- ЖИВОЕ ЗАПОЛНЕНИЕ АКТИВНОЙ СЕССИИ ---
function getActiveStage() {
    const active = document.getElementById('active-session');
    if (!active || active.classList.contains('hidden')) return null;
    if (!document.getElementById('smoking-controls')?.classList.contains('hidden')) return 'smoking';
    if (!document.getElementById('warmup-controls')?.classList.contains('hidden')) return 'warmup';
    if (!document.getElementById('rating-form')?.classList.contains('hidden')) return 'rating';
    return null;
}

function isWarmupOrSmokingActive() {
    const stage = getActiveStage();
    return stage === 'warmup' || stage === 'smoking';
}

function setStartButtonState(active, dirty = false) {
    const button = document.getElementById('start-btn');
    if (!button) return;
    button.disabled = Boolean(active && !dirty);
    if (!active) {
        button.innerText = '🔥 Начать прогрев';
    } else if (dirty) {
        button.innerText = '💾 Сохранить';
    } else {
        button.innerText = 'Сессия идёт…';
    }
}

function setStartButtonActive(active) {
    activeDraftDirty = false;
    setStartButtonState(active, false);
}

function markActiveDraftDirty() {
    const stage = getActiveStage();
    if (!stage || stage === 'rating') return;
    activeDraftDirty = true;
    setStartButtonState(true, true);
}

function handleStartButton() {
    const stage = getActiveStage();
    if (!stage) {
        startWarmupSession();
        return;
    }
    if (stage === 'rating') {
        showBannerToast('Поставьте оценку и сохраните сессию');
        return;
    }
    if (!activeDraftDirty) return;
    saveActiveSessionState(stage);
    activeDraftDirty = false;
    setStartButtonState(true, false);
    updateActiveMixLabel();
    showBannerToast('Данные сессии сохранены');
}

function updateActiveMixLabel() {
    const label = document.getElementById('active-mix-label');
    if (!label || !getActiveStage()) return;
    const mixText = formatMixPlainText(getDraftMixFromForm());
    label.innerText = mixText && mixText !== 'Без названия' && mixText !== 'Табак не указан'
        ? mixText
        : 'Данные сессии можно заполнить во время прогрева';
}

function setupActiveDraftTracking() {
    const form = document.getElementById('setup-form');
    if (!form) return;
    const handler = () => {
        const stage = getActiveStage();
        if (!stage) return;
        markActiveDraftDirty();
        updateActiveMixLabel();
        clearTimeout(activeDraftSaveTimer);
        activeDraftSaveTimer = setTimeout(() => {
            if (getActiveStage()) saveActiveSessionState(getActiveStage());
        }, 250);
    };
    form.addEventListener('input', handler);
    form.addEventListener('change', handler);
}

function clearSessionAlertTimers() {
    if (warmupAlertTimeout) clearTimeout(warmupAlertTimeout);
    if (smoke60Timeout) clearTimeout(smoke60Timeout);
    if (smoke90Timeout) clearTimeout(smoke90Timeout);
    warmupAlertTimeout = null;
    smoke60Timeout = null;
    smoke90Timeout = null;
}

function scheduleWarmupAlert() {
    if (warmupAlertTimeout) clearTimeout(warmupAlertTimeout);
    if (!targetTimestamp) return;
    const delay = targetTimestamp - Date.now();
    if (delay <= 0) return;
    warmupAlertTimeout = setTimeout(() => {
        if (getActiveStage() !== 'warmup' || alarmAlreadyPlayed) return;
        alarmAlreadyPlayed = true;
        playIos27Chime();
        sendPush('Кальян готов! 💨', 'Чаша прогрелась, пора раскуривать!');
        saveActiveSessionState('warmup');
    }, delay);
}

function scheduleSmokingAlerts() {
    if (smoke60Timeout) clearTimeout(smoke60Timeout);
    if (smoke90Timeout) clearTimeout(smoke90Timeout);
    if (!stepStartTime) return;

    const elapsed = Date.now() - stepStartTime;
    const delay60 = Math.max(0, 3600 * 1000 - elapsed);
    const delay90 = Math.max(0, 5400 * 1000 - elapsed);

    smoke60Timeout = setTimeout(() => {
        if (getActiveStage() !== 'smoking' || smokeReminder60Sent) return;
        smokeReminder60Sent = true;
        playIos27Chime();
        sendPush('Идет 2-й час покура 💨', 'Кальян ещё курится или пора завершить сессию?');
    }, delay60);

    smoke90Timeout = setTimeout(() => {
        if (getActiveStage() !== 'smoking' || smokeReminder90Sent) return;
        smokeReminder90Sent = true;
        playIos27Chime();
        sendPush('Покур идет уже 1.5 часа ⏳', 'Не забудь остановить таймер в DimHookah!');
    }, delay90);
}

function scheduleIdleAudioCleanup() {
    const cleanup = () => {
        if (!isWarmupOrSmokingActive()) stopKeepAliveAudio();
    };
    setTimeout(cleanup, 60000);
    setInterval(cleanup, 60000);
}

// --- ЛОГИКА ТАЙМЕРА ПРОГРЕВА И ПОКУРА ---
function startWarmupSession() {
    if (isWarmupOrSmokingActive() || getActiveStage() === 'rating') {
        showBannerToast('Сессия уже идёт — заполните данные и завершите её');
        return;
    }

    const selectedBowl = document.getElementById('bowl-select')?.value;
    if (!selectedBowl) {
        document.getElementById('quick-bowl-box')?.classList.remove('hidden');
        document.getElementById('new-bowl-input')?.focus();
        showIosNotice("Добавь свою чашу 🏺", "Список чаш пуст! Введи название своей чаши в поле выше и нажми «ОК».");
        return;
    }

    initAudio();
    if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
    }

    const mins = parseInt(document.getElementById('warmup-min').value) || 0;
    const totalSeconds = mins * 60;

    if (totalSeconds <= 0) {
        showIosNotice("Время прогрева", "Укажи количество минут для прогрева чаши!");
        return;
    }

    const mix = getDraftMixFromForm();
    populateSelects();

    activeCoalsUsed = parseInt(document.getElementById('start-coals-input').value) || 3;
    consumeCoalsFromStock(activeCoalsUsed);

    document.getElementById('active-session').classList.remove('hidden');
    document.getElementById('warmup-controls').classList.remove('hidden');
    document.getElementById('smoking-controls').classList.add('hidden');
    document.getElementById('rating-form').classList.add('hidden');
    document.getElementById('warmup-box').classList.remove('alarm-active');
    document.getElementById('warmup-overtime-label')?.classList.add('hidden');
    document.getElementById('timer')?.classList.remove('overtime-text');
    setStartButtonActive(true);

    document.getElementById('status-title').innerText = '🔥 Прогрев чаши...';
    const mixText = formatMixPlainText(mix);
    document.getElementById('active-mix-label').innerText =
        mixText && mixText !== 'Без названия' && mixText !== 'Табак не указан'
            ? mixText
            : 'Данные сессии можно заполнить во время прогрева';

    stepStartTime = Date.now();
    targetTimestamp = stepStartTime + (totalSeconds * 1000);
    alarmAlreadyPlayed = false;

    saveActiveSessionState('warmup');
    startKeepAliveAudio('🔥 Прогрев чаши', mixText);

    startTimerTicker(updateWarmupTimer);
    updateWarmupTimer();
    clearSessionAlertTimers();
    scheduleWarmupAlert();
    setTimeout(() => {
        document.getElementById('active-session')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
}

function updateWarmupTimer() {
    const now = Date.now();
    const diffSec = Math.ceil((targetTimestamp - now) / 1000);
    const totalElapsedWarmup = Math.max(0, Math.floor((now - stepStartTime) / 1000));

    const timerEl = document.getElementById('timer');
    const overtimeBadge = document.getElementById('warmup-overtime-label');

    if (diffSec <= 0) {
        const overtimeSec = Math.abs(diffSec);
        const minusFormatted = `-${formatTimerSec(overtimeSec)}`;

        if (timerEl) {
            timerEl.innerText = minusFormatted;
            timerEl.classList.add('overtime-text');
        }
        if (overtimeBadge) {
            overtimeBadge.innerText = `Общий прогрев: ${formatDurationText(totalElapsedWarmup)} (перегрев +${formatTimerSec(overtimeSec)})`;
            overtimeBadge.classList.remove('hidden');
        }

        document.getElementById('status-title').innerText = "🚨 Чаша прогрелась! Идет перегрев!";
        document.getElementById('warmup-box').classList.add('alarm-active');
        updateLockScreenMetadata(`🚨 Перегрев: ${minusFormatted}`, `Общий прогрев: ${formatTimerSec(totalElapsedWarmup)}`);

        if (!alarmAlreadyPlayed) {
            alarmAlreadyPlayed = true;
            playIos27Chime();
            sendPush("Кальян готов! 💨", "Чаша прогрелась, пора раскуривать!");
            saveActiveSessionState('warmup');
        }
        return;
    }

    if (timerEl) timerEl.classList.remove('overtime-text');
    if (overtimeBadge) overtimeBadge.classList.add('hidden');

    const formatted = formatTimerSec(diffSec);
    if (timerEl) timerEl.innerText = formatted;
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
    document.getElementById('warmup-overtime-label')?.classList.add('hidden');
    document.getElementById('timer')?.classList.remove('overtime-text');
    document.getElementById('status-title').innerText = "🔥 Прогрев чаши (+1 мин)...";
    saveActiveSessionState('warmup');
    scheduleWarmupAlert();
    updateWarmupTimer();
}

function startSmokingFromWarmup() {
    initAudio();
    actualWarmupDuration = Math.max(1, Math.floor((Date.now() - stepStartTime) / 1000));

    document.getElementById('warmup-box').classList.remove('alarm-active');
    document.getElementById('warmup-overtime-label')?.classList.add('hidden');
    document.getElementById('timer')?.classList.remove('overtime-text');
    document.getElementById('status-title').innerText = '💨 Идет покур';
    document.getElementById('active-mix-label').innerText = getCurrentMixSummaryText();
    document.getElementById('warmup-controls').classList.add('hidden');
    document.getElementById('smoking-controls').classList.remove('hidden');

    stepStartTime = Date.now();
    smokeReminder60Sent = false;
    smokeReminder90Sent = false;
    saveActiveSessionState('smoking');
    startKeepAliveAudio('💨 Покур: 00:00', getCurrentMixSummaryText());
    activeDraftDirty = false;
    setStartButtonState(true, false);

    startTimerTicker(updateSmokingTimer);
    updateSmokingTimer();
    if (warmupAlertTimeout) clearTimeout(warmupAlertTimeout);
    warmupAlertTimeout = null;
    scheduleSmokingAlerts();
}

function updateSmokingTimer() {
    const elapsedSmoke = Math.floor((Date.now() - stepStartTime) / 1000);
    const formatted = formatTimerSec(elapsedSmoke);
    document.getElementById('timer').innerText = formatted;
    updateLockScreenMetadata(`💨 Покур: ${formatted}`, getCurrentMixSummaryText());

    if (elapsedSmoke >= 3600 && elapsedSmoke < 5400 && !smokeReminder60Sent) {
        smokeReminder60Sent = true;
        playIos27Chime();
        sendPush('Идет 2-й час покура 💨', 'Кальян ещё курится или пора завершить сессию?');
    }

    if (elapsedSmoke >= 5400 && !smokeReminder90Sent) {
        smokeReminder90Sent = true;
        playIos27Chime();
        sendPush('Покур идет уже 1.5 часа ⏳', 'Не забудь остановить таймер в DimHookah!');
    }

    if (elapsedSmoke >= 9000) {
        finishSmokingSession();
    }
}

function finishSmokingSession() {
    smokeDuration = Math.floor((Date.now() - stepStartTime) / 1000);
    stopTimerTicker();
    stopKeepAliveAudio();
    clearSessionAlertTimers();

    document.getElementById('status-title').innerText = '✅ Сессия завершена';
    document.getElementById('timer').innerText = formatTimerSec(smokeDuration);
    document.getElementById('smoking-controls').classList.add('hidden');
    document.getElementById('rating-form').classList.remove('hidden');
    activeDraftDirty = false;
    setStartButtonState(true, false);

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

    stopTimerTicker();
    stopKeepAliveAudio();
    clearSessionAlertTimers();
    clearActiveSessionState();

    document.getElementById('active-session').classList.add('hidden');
    document.getElementById('setup-form').classList.remove('hidden');
    setStartButtonActive(false);
    setCurrentRating(0);
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

// --- ОЦЕНКА ПОКУРА: ЗВЕЗДЫ С ШАГОМ 0.5 ---
function setCurrentRating(value) {
    const numeric = Number(value);
    const clamped = Math.max(0, Math.min(5, Math.round((Number.isFinite(numeric) ? numeric : 0) * 2) / 2));
    currentRating = clamped;
    document.querySelectorAll('.star').forEach(star => {
        const starValue = Number(star.dataset.value);
        const full = clamped >= starValue;
        const half = !full && clamped >= starValue - 0.5 && clamped > 0;
        star.classList.toggle('active', full);
        star.classList.toggle('half', half);
    });
    const display = document.getElementById('rating-value');
    if (display) display.textContent = clamped.toFixed(1);
    const container = document.getElementById('star-rating');
    if (container) container.setAttribute('aria-valuenow', String(clamped));
}

function initStarRating() {
    const stars = document.querySelectorAll('.star');
    stars.forEach(star => {
        star.addEventListener('click', event => {
            const rect = star.getBoundingClientRect();
            const value = Number(star.dataset.value) - ((event.clientX - rect.left) < rect.width / 2 ? 0.5 : 0);
            setCurrentRating(value);
        });
    });
    const container = document.getElementById('star-rating');
    if (container) {
        container.addEventListener('keydown', event => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
                event.preventDefault();
                setCurrentRating(currentRating - 0.5);
            } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
                event.preventDefault();
                setCurrentRating(currentRating + 0.5);
            } else if (event.key === 'Home') {
                event.preventDefault();
                setCurrentRating(0.5);
            } else if (event.key === 'End') {
                event.preventDefault();
                setCurrentRating(5);
            }
        });
    }
    setCurrentRating(0);
}

initStarRating();

// --- СОХРАНЕНИЕ ЗАВЕРШЕННОЙ СЕССИИ ---
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
    if (currentRating < 0.5) {
        showIosNotice("Оценка покура", "Пожалуйста, поставьте оценку от 0.5 до 5 звезд!");
        return;
    }

    let savedState = null;
    try {
        savedState = JSON.parse(localStorage.getItem('hookah_active_session'));
    } catch (e) { }

    const mix = getDraftMixFromForm();
    const bowl = document.getElementById('bowl-select')?.value || (savedState && savedState.bowl) || 'Не указана';
    const coalsUsed = activeCoalsUsed || 3;

    const totalW = mix.reduce((acc, item) => acc + (parseFloat(item.weight) || 0), 0);
    if (totalW > 0) {
        localStorage.setItem('hookah_last_weight', String(Math.round(totalW)));
    }

    const tobaccoCost = mix.reduce((acc, item) => acc + (item.cost || 0), 0);
    const coalCost = Math.round(coalsUsed * getSingleCoalPrice());
    const sessionCost = Math.round(tobaccoCost + coalCost);

    const session = {
        id: Date.now(),
        date: new Date().toLocaleDateString('ru-RU'),
        bowl,
        mix,
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
            resetUI(sessions);
            renderData(sessions);
            showSaveSuccessOverlay();
        });
    });
}

function resetUI(sessions = null) {
    document.getElementById('setup-form').classList.remove('hidden');
    document.getElementById('active-session').classList.add('hidden');
    document.getElementById('comment').value = '';
    const flavorSelect = document.getElementById('solo-tobacco-flavor');
    if (flavorSelect && flavorSelect.options.length) flavorSelect.selectedIndex = 0;
    setCurrentRating(0);
    setStartButtonActive(false);
    applySessionDefaultsFromLast(sessions);
    populateSelects();
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
                const shortBrand = stripRussianBrackets(item.brand);
                brandFreq[shortBrand] = (brandFreq[shortBrand] || 0) + 1;
            }
        });
    });

    const favBrand = Object.keys(brandFreq).sort((a, b) => brandFreq[b] - brandFreq[a])[0] || '—';
    const favBowl = Object.keys(bowlFreq).sort((a, b) => bowlFreq[b] - bowlFreq[a])[0] || '—';
    const avgCost = filtered.length > 0 ? Math.round(totalSpentRub / filtered.length) : 0;

    document.getElementById('stat-total-hours').innerText = formatDurationHM(totalSmokeSeconds);
    document.getElementById('stat-total-money').innerText = `${Math.round(totalSpentRub).toLocaleString('ru-RU')} ₽`;
    document.getElementById('stat-avg-cost').innerText = `Средняя: ${avgCost} ₽`;
    document.getElementById('stat-fav-brand').innerText = favBrand;
    document.getElementById('stat-total-grams').innerText = `Скурено: ${Math.round(totalGrams)} г`;
    document.getElementById('stat-fav-bowl').innerText = favBowl;
    document.getElementById('stat-total-sessions').innerText = `Сессий: ${filtered.length}`;
}

function getNormalizedMix(session) {
    if (Array.isArray(session.mix) && session.mix.length > 0) return session.mix;
    if (session.tobacco) return [{ brand: stripRussianBrackets(session.tobacco), flavor: '', weight: 0, cost: 0 }];
    return [];
}

// --- ОТРИСОВКА ИСТОРИИ ---
function applyFilters() {
    historyVisibleCount = 5;
    loadAllData(renderData);
}

function showMoreHistory() {
    historyVisibleCount += 5;
    renderData(lastHistorySessions);
}

function renderData(sessions) {
    lastHistorySessions = Array.isArray(sessions) ? sessions : [];
    window.DimHookahHistory = {
        sessions: lastHistorySessions,
        updatedAt: Date.now()
    };
    window.dispatchEvent(new CustomEvent('dimhookah:history-ready'));

    syncCatalogFromHistory(sessions);
    if (!sessionDefaultsApplied) {
        applySessionDefaultsFromLast(sessions);
    }
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
        historyList.innerHTML = '<p style="text-align:center; color: var(--text-secondary); padding: 18px 0; font-size: 0.9em;">Записей пока нет</p>';
        return;
    }

    const ordered = filtered.slice().reverse();
    const visible = ordered.slice(0, historyVisibleCount);

    visible.forEach(s => {
        const mixArr = getNormalizedMix(s);
        const mixHtml = formatMixText(mixArr);
        const totalWeight = mixArr.reduce((acc, i) => acc + (parseFloat(i.weight) || 0), 0);
        const costBadge = s.sessionCost ? `<span class="cost-tag">💰 ${s.sessionCost} ₽</span>` : '';
        const coalsText = s.coalsUsed ? `${s.coalsUsed} шт.` : 'Не указано';

        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML = `
            <div class="history-top-bar">
                <span class="history-date">${s.date || '—'}</span>
                <span class="history-rating-pill">★ ${s.rating}</span>
            </div>
            <div class="history-mix-title">${mixHtml} ${costBadge}</div>
            <div class="history-meta">
                🏺 <b>Чаша:</b> ${s.bowl} ${totalWeight > 0 ? `(${totalWeight} г)` : ''}<br>
                🔥 <b>Угли:</b> ${coalsText}<br>
                ⏱ <b>Прогрев:</b> ${formatDurationText(s.actualWarmupDuration)} &nbsp;•&nbsp; 💨 <b>Покур:</b> ${formatDurationText(s.smokeDuration)}
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

    if (ordered.length > historyVisibleCount) {
        const more = document.createElement('div');
        more.className = 'history-more-row';
        more.innerHTML = `
            <span>Показано ${visible.length} из ${ordered.length}</span>
            <button type="button" class="btn btn-secondary" onclick="showMoreHistory()">Показать ещё 5</button>
        `;
        historyList.appendChild(more);
    }
}

function syncCatalogFromHistory(sessions) {
    let changed = false;
    sessions.forEach(s => {
        if (s.bowl && !savedBowls.includes(s.bowl)) {
            savedBowls.push(s.bowl);
            changed = true;
        }
        getNormalizedMix(s).forEach(m => {
            const cleanB = stripRussianBrackets(m.brand);
            if (!sessionCatalogReady && cleanB && cleanB !== '__custom__' && !savedBrands.includes(cleanB)) {
                savedBrands.push(cleanB);
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

// --- ПЕРЕНЕСТИ ВКУС ИЗ КОЛЛЕКЦИИ В ЧАШУ ---
function fillSessionFromCollection(data) {
    if (!data) return;
    const brand = stripRussianBrackets(data.brand);
    const flavor = String(data.flavor || '').trim();
    if (!brand) return;

    toggleMixMode(false);
    populateSelects();
    setSelectValueIncludingLegacy(document.getElementById('solo-tobacco-brand'), brand);
    syncSoloFlavorOptions(flavor);
    clearNewTobaccoWeight(document.getElementById('solo-tobacco-brand'));
    fillPackInputsForBrand('solo', brand);
    recalcLiveBowlCost();

    if (getActiveStage()) {
        markActiveDraftDirty();
        updateActiveMixLabel();
        saveActiveSessionState(getActiveStage());
    }

    if (window.DimHookahUI && typeof window.DimHookahUI.showTab === 'function') {
        window.DimHookahUI.showTab('home');
    }
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 80);
    showBannerToast(`«${flavor || brand}» перенесён в забивку`);
}

// --- ПОВТОР СЕССИИ В 1 КЛИК ---
function repeatSession(sessionId) {
    loadAllData(sessions => {
        const target = sessions.find(s => s.id === sessionId);
        if (!target) return;

        if (target.bowl && !savedBowls.includes(target.bowl)) {
            savedBowls.unshift(target.bowl);
            localStorage.setItem('hookah_bowls', JSON.stringify(savedBowls));
            populateSelects();
        }
        document.getElementById('bowl-select').value = target.bowl;
        if (target.coalsUsed) document.getElementById('start-coals-input').value = target.coalsUsed;

        const mixArr = getNormalizedMix(target);

        if (mixArr.length <= 1) {
            toggleMixMode(false);
            const first = mixArr[0] || { brand: savedBrands[0], flavor: '', weight: getLastUsedWeights(sessions).soloWeight };
            const cleanB = stripRussianBrackets(first.brand);
            ensureBrandSaved(cleanB);
            populateSelects();
            setSelectValueIncludingLegacy(document.getElementById('solo-tobacco-brand'), cleanB);
            syncSoloFlavorOptions(first.flavor || '');
            document.getElementById('solo-tobacco-weight').value = first.weight || getLastUsedWeights(sessions).soloWeight;
            fillPackInputsForBrand('solo', cleanB);
        } else {
            toggleMixMode(true);
            const list = document.getElementById('mix-rows-list');
            list.innerHTML = '';
            mixArr.forEach(m => {
                const cleanB = stripRussianBrackets(m.brand);
                ensureBrandSaved(cleanB);
                addMixRow(cleanB, m.flavor, m.weight);
            });
        }

        recalcLiveBowlCost();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        showBannerToast('Микс загружен в форму сессии!');
        toggleAllSetupSteps(true);
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
            applyLastUsedWeightToForm(updated);
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

        document.getElementById('edit-coals-used').value = target.coalsUsed || 3;
        const editRating = Math.round((Number(target.rating) || 5) * 2) / 2;
        document.getElementById('edit-rating').value = String(editRating);
        document.getElementById('edit-comment').value = target.comment || '';
        for (const [prefix, duration] of [['warmup', target.actualWarmupDuration], ['smoke', target.smokeDuration]]) {
            const seconds = Math.max(0, Math.round(Number(duration) || 0));
            document.getElementById(`edit-${prefix}-minutes`).value = Math.floor(seconds / 60);
            document.getElementById(`edit-${prefix}-seconds`).value = seconds % 60;
        }

        const container = document.getElementById('edit-mix-rows');
        container.innerHTML = '';
        const mixArr = getNormalizedMix(target);
        mixArr.forEach(m => addEditMixRow(stripRussianBrackets(m.brand), m.flavor, m.weight));

        document.getElementById('edit-modal').classList.remove('hidden');
        syncBodyScrollLock();
    });
}

function addEditMixRow(brand = '', flavor = '', weight = '') {
    const container = document.getElementById('edit-mix-rows');
    const cleanB = stripRussianBrackets(brand) || savedBrands[0] || DEFAULT_BRANDS[0];
    const row = document.createElement('div');
    row.className = 'tobacco-grid-mix';
    row.style.marginBottom = '8px';
    row.innerHTML = `
        <select class="brand-select control-h" onchange="onBrandSelectChange(this)">
            ${getBrandOptionsHtml(cleanB)}
        </select>
        <select class="flavor-select control-h"></select>
        <div class="unit-input-box control-h">
            <input type="number" class="edit-weight-input" value="${weight || getLastUsedWeights().soloWeight}" min="1" max="100">
            <span>г</span>
        </div>
        <button type="button" class="remove-mix-btn" onclick="this.parentElement.remove()">✕</button>
    `;
    container.appendChild(row);
    const sel = row.querySelector('.brand-select');
    if (sel) sel.value = cleanB;
    syncMixFlavorOptions(row, flavor);
}

function closeEditModal() {
    document.getElementById('edit-modal').classList.add('hidden');
    syncBodyScrollLock();
}

function saveEditedSession() {
    const timeInputs = [...document.querySelectorAll('#edit-modal .duration-pair input')];
    for (const input of timeInputs) {
        if (!input.reportValidity()) return;
    }
    const readDuration = prefix => Number(document.getElementById(`edit-${prefix}-minutes`).value) * 60 + Number(document.getElementById(`edit-${prefix}-seconds`).value);
    const editedWarmupDuration = readDuration('warmup');
    const editedSmokeDuration = readDuration('smoke');
    const id = parseInt(document.getElementById('edit-session-id').value);
    const bowl = document.getElementById('edit-bowl').value;
    const coalsUsed = parseInt(document.getElementById('edit-coals-used').value) || 3;
    const rating = parseFloat(document.getElementById('edit-rating').value) || 5;
    const comment = document.getElementById('edit-comment').value.trim();

    const newMix = [];
    document.querySelectorAll('#edit-mix-rows .tobacco-grid-mix').forEach(row => {
        const brand = stripRussianBrackets(row.querySelector('.brand-select').value);
        const flavor = row.querySelector('.flavor-select')?.value || '';
        const weight = parseFloat(row.querySelector('.edit-weight-input').value) || 0;
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
            sessions[idx].actualWarmupDuration = editedWarmupDuration;
            sessions[idx].smokeDuration = editedSmokeDuration;
            sessions[idx].coalsUsed = coalsUsed;
            sessions[idx].coalCost = coalCost;
            sessions[idx].sessionCost = sessionCost;
            sessions[idx].rating = rating;
            sessions[idx].comment = comment;
            sessions[idx].mix = newMix;
        }
        saveSessionsToStorage(sessions, () => {
            closeEditModal();
            applyLastUsedWeightToForm(sessions);
            renderData(sessions);
            showBannerToast('Изменения сохранены');
        });
    });
}

// --- РУЧНОЕ ДОБАВЛЕНИЕ СЕССИИ ---
function openManualAddModal() {
    const modal = document.getElementById('manual-add-modal');
    if (!modal) return;

    const dateInput = document.getElementById('manual-date-input');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

    const bSelect = document.getElementById('manual-bowl-select');
    if (bSelect) bSelect.innerHTML = getBowlOptionsHtml();

    const brandSelect = document.getElementById('manual-brand-select');
    if (brandSelect) {
        const firstBrand = sortedBrandList()[0] || '';
        brandSelect.innerHTML = getBrandOptionsHtml(firstBrand);
        brandSelect.value = firstBrand;
    }

    const { soloWeight } = getLastUsedWeights();
    const manualWeightInput = document.getElementById('manual-weight-input');
    if (manualWeightInput) manualWeightInput.value = soloWeight;

    syncManualFlavorOptions('');
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
    const brand = stripRussianBrackets(brandSelectVal || sortedBrandList()[0] || 'Без бренда');
    const flavor = document.getElementById('manual-flavor-input').value || '';
    const weight = parseFloat(document.getElementById('manual-weight-input').value) || getLastUsedWeights().soloWeight;
    const durMins = parseInt(document.getElementById('manual-duration-input').value) || 60;
    const coalsUsed = parseInt(document.getElementById('manual-coals-input')?.value) || 3;
    const rating = parseFloat(document.getElementById('manual-rating-select').value) || 5;
    const comment = document.getElementById('manual-comment-input').value.trim();

    if (!dateVal) {
        showIosNotice('Дата покура', 'Пожалуйста, укажи дату сессии.');
        return;
    }

    if (weight > 0) {
        localStorage.setItem('hookah_last_weight', String(weight));
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
            applyLastUsedWeightToForm(history);
            renderData(history);
            showSaveSuccessOverlay();
        });
    });
}

// --- ЭКСПОРТ В ЗАМЕТКИ IPHONE И JSON БЕКАП ---
// --- МГНОВЕННЫЙ ВЫЗОВ СИСТЕМНОГО МЕНЮ «ПОДЕЛИТЬСЯ» IOS ДЛЯ ЗАМЕТОК ---
async function exportToAppleNotes() {
    // Читаем синхронно из localStorage, чтобы iOS Safari не заблокировал navigator.share()!
    let sessions = [];
    try {
        sessions = JSON.parse(localStorage.getItem('hookah_sessions') || '[]');
    } catch (e) {
        sessions = [];
    }

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
        text += `   🏺 Чаша: ${s.bowl} | 🔥 Угли: ${s.coalsUsed || 3} шт\n`;
        text += `   ⏱ Прогрев: ${formatDurationText(s.actualWarmupDuration)} | Покур: ${formatDurationText(s.smokeDuration)}\n`;
        if (s.comment) text += `   💬 Заметка: "${s.comment}"\n`;
        text += `\n`;
    });

    // 1. Сначала пробуем вызвать родное системное окно «Поделиться» iOS!
    if (navigator.share) {
        try {
            await navigator.share({
                title: 'DimHookah — Дневник покуров',
                text: text
            });
            return;
        } catch (err) {
            // Если пользователь сам закрыл шторку «Поделиться» (AbortError) — ничего не делаем
            if (err && err.name === 'AbortError') return;
        }
    }

    // 2. Резервный вариант (для ПК или если Web Share API недоступен) — копируем в буфер
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showIosNotice('Скопировано в буфер! 📋', 'Открой «Заметки» на iPhone и нажми «Вставить» — вся твоя история красиво сохранится.');
        }).catch(() => {
            showIosNotice('Ваш текст готов', text);
        });
    } else {
        showIosNotice('Ваш текст готов', text);
    }
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
            version: 7,
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
                const cleaned = parsed.brands.map(stripRussianBrackets).filter(Boolean);
                savedBrands = Array.from(new Set([...savedBrands, ...cleaned]));
                localStorage.setItem('hookah_brands', JSON.stringify(savedBrands));
            }
            if (parsed.brandPacks) {
                brandPackDefaults = { ...brandPackDefaults, ...parsed.brandPacks };
                localStorage.setItem('hookah_brand_packs', JSON.stringify(brandPackDefaults));
            }
            if (parsed.coalInventory) {
                coalInventory = {
                    packSize: Number(parsed.coalInventory.packSize) || 72,
                    packPrice: Number(parsed.coalInventory.packPrice) || 700,
                    remaining: Number.isFinite(Number(parsed.coalInventory.remaining)) ? Number(parsed.coalInventory.remaining) : 72
                };
                localStorage.setItem('hookah_coal_inventory', JSON.stringify(coalInventory));
            }

            saveSessionsToStorage(importedSessions, () => {
                populateSelects();
                applyLastUsedWeightToForm(importedSessions);
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

// --- ФОРМАТИРОВАНИЕ ВРЕМЕНИ ---
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

// Keep browser zoom available; lock touch zoom only in the installed app.
function initPwaViewport() {
    const standalone = window.matchMedia('(display-mode: standalone)');
    const fullscreen = window.matchMedia('(display-mode: fullscreen)');
    const viewport = document.querySelector('meta[name="viewport"]');
    const baseViewport = 'width=device-width, initial-scale=1.0, viewport-fit=cover';
    const isInstalled = () => standalone.matches || fullscreen.matches || navigator.standalone === true;
    const sync = () => {
        const installed = isInstalled();
        document.documentElement.classList.toggle('is-pwa', installed);
        if (viewport) viewport.content = baseViewport + (installed ? ', maximum-scale=1.0, user-scalable=no' : '');
    };
    sync();
    standalone.addEventListener('change', sync);
    fullscreen.addEventListener('change', sync);
    window.addEventListener('pageshow', sync);
    for (const name of ['gesturestart', 'gesturechange']) {
        document.addEventListener(name, event => { if (isInstalled()) event.preventDefault(); }, { passive: false });
    }
    document.addEventListener('touchmove', event => {
        if (isInstalled() && event.touches.length > 1) event.preventDefault();
    }, { passive: false });
    document.addEventListener('wheel', event => {
        if (isInstalled() && (event.ctrlKey || event.metaKey)) event.preventDefault();
    }, { passive: false });
    document.addEventListener('keydown', event => {
        if (isInstalled() && (event.ctrlKey || event.metaKey) && ['+', '-', '=', '0'].includes(event.key)) event.preventDefault();
    });
}

// --- ИНИЦИАЛИЗАЦИЯ ---
document.addEventListener('DOMContentLoaded', () => {
    initPwaViewport();
    initTheme();
    initCatalogs();
    restoreActiveSessionIfAny();

    window.addEventListener('dimhookah:catalog-ready', event => {
        const catalog = event && event.detail && Array.isArray(event.detail.catalog)
            ? event.detail.catalog
            : [];
        applyCatalogToSession(catalog);
    });

    setupActiveDraftTracking();
    scheduleIdleAudioCleanup();

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
                startKeepAliveAudio(lastLockScreenTitle || 'DimHookah', getCurrentMixSummaryText());
            }
        }
    }, { passive: true });

    window.addEventListener('focus', syncActiveTimerOnWake);
    window.addEventListener('pageshow', syncActiveTimerOnWake);
});

if ('serviceWorker' in navigator) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    let refreshingForUpdate = false;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || refreshingForUpdate) return;
        refreshingForUpdate = true;
        window.location.reload();
    });

    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
        .then((registration) => {
            registration.update().catch(() => { });
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    registration.update().catch(() => { });
                }
            });
        })
        .catch(() => { });
}

// --- ЛОГИКА ПОШАГОВОГО РАСКРЫТИЯ ПОЛЕЙ (IOS 27 PROGRESSIVE REVEAL) ---
let allStepsForcedOpen = false;

function revealSetupStep(stepNum) {
    const stepEl = document.getElementById(`setup-step-${stepNum}`);
    if (!stepEl) return;

    if (stepEl.classList.contains('step-collapsed')) {
        stepEl.classList.remove('step-collapsed');
        stepEl.classList.add('step-visible');
    }

    // Прячем промежуточную кнопку «Далее» у предыдущего шага, когда следующий уже открыт
    if (stepNum >= 2) {
        document.getElementById('step-1-next-btn')?.classList.add('hidden');
    }
    if (stepNum >= 3) {
        document.getElementById('step-2-next-btn')?.classList.add('hidden');
    }

    syncToggleAllButtonLabel();
}

function onStep1BowlSelect() {
    const val = document.getElementById('bowl-select')?.value;
    if (val) {
        revealSetupStep(2);
    }
}

function onTobaccoFlavorInput() {
    const val = document.getElementById('solo-tobacco-flavor')?.value.trim();
    if (val && val.length >= 1) {
        revealSetupStep(3);
    }
}

function toggleAllSetupSteps(forceExpand = null) {
    const step2 = document.getElementById('setup-step-2');
    const step3 = document.getElementById('setup-step-3');
    if (!step2 || !step3) return;

    const isCurrentlyAllOpen = step2.classList.contains('step-visible') && step3.classList.contains('step-visible');
    const shouldExpand = typeof forceExpand === 'boolean' ? forceExpand : !isCurrentlyAllOpen;
    allStepsForcedOpen = shouldExpand;

    if (shouldExpand) {
        revealSetupStep(2);
        revealSetupStep(3);
    } else {
        step2.classList.remove('step-visible');
        step2.classList.add('step-collapsed');
        step3.classList.remove('step-visible');
        step3.classList.add('step-collapsed');
        document.getElementById('step-1-next-btn')?.classList.remove('hidden');
        document.getElementById('step-2-next-btn')?.classList.remove('hidden');
    }

    syncToggleAllButtonLabel();
}

function syncToggleAllButtonLabel() {
    const btn = document.getElementById('toggle-all-steps-btn');
    const step2 = document.getElementById('setup-step-2');
    const step3 = document.getElementById('setup-step-3');
    if (!btn || !step2 || !step3) return;

    const bothOpen = step2.classList.contains('step-visible') && step3.classList.contains('step-visible');
    btn.innerText = bothOpen ? '🔼 Свернуть шаги' : '✨ Развернуть все';
}
