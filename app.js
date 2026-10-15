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
});

async function registerPWA() {
    if ('serviceWorker' in navigator) {
        try {
            swRegistration = await navigator.serviceWorker.register('./sw.js');
        } catch (e) {
            console.warn('SW registration failed:', e);
        }
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
        alert('📲 Ты открыл сайт в обычном браузере!\n\nЧтобы работали пуши на iPhone:\n1. Нажми «Поделиться» внизу Safari.\n2. Выбери «На экран Домой».\n3. Открой DimHookah с иконки на рабочем столе!');
        return;
    }
    try {
        const perm = await Notification.requestPermission();
        updatePushButtonState();
        if (perm === 'granted') {
            playBellSound();
            sendPush('Уведомления включены! 🔥', 'Теперь DimHookah предупредит, когда чаша прогреется.');
        } else {
            alert('Уведомления запрещены. Проверь Настройки iPhone -> Уведомления -> DimHookah.');
        }
    } catch (e) {
        alert('Ошибка запроса уведомлений: ' + e.message);
    }
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
    } catch (e) {
        savedBowls = [];
        savedBrands = [];
        removedItems = [];
    }

    let history = [];
    try {
        history = JSON.parse(localStorage.getItem('hookah_sessions') || '[]');
    } catch (e) { }

    if (callback) callback(history);
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
    const newBowl = prompt('Введите название новой чаши:');
    if (newBowl && newBowl.trim()) {
        const clean = newBowl.trim();
        removedItems = removedItems.filter(item => item !== clean);
        if (!savedBowls.includes(clean)) savedBowls.push(clean);
        saveCatalogsToStorage();
        populateSelects();
        const target = document.getElementById(targetSelectId);
        if (target) target.value = clean;
    }
}

function deleteSelectedBowl(targetSelectId = 'bowl-select') {
    const target = document.getElementById(targetSelectId);
    const val = target ? target.value : '';
    if (!val) {
        alert('Сначала выбери чашу в списке, которую нужно удалить!');
        return;
    }
    if (confirm(`Удалить чашу «${val}» из списка?`)) {
        savedBowls = savedBowls.filter(b => b !== val);
        if (!removedItems.includes(val)) removedItems.push(val);
        saveCatalogsToStorage();
        if (target) {
            target.blur();
            target.value = '';
        }
        populateSelects();
    }
}

function addNewBrandPrompt(targetSelectOrElem) {
    const newBrand = prompt('Введите название нового бренда табака:');
    if (newBrand && newBrand.trim()) {
        const clean = newBrand.trim();
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
    }
}

function deleteSelectedBrand(targetSelectOrElem) {
    const el = (typeof targetSelectOrElem === 'string')
        ? document.getElementById(targetSelectOrElem)
        : targetSelectOrElem;
    const val = el ? el.value : '';
    if (!val) {
        alert('Сначала выбери бренд в списке, который хочешь удалить!');
        return;
    }
    if (confirm(`Удалить бренд «${val}» из списка?`)) {
        savedBrands = savedBrands.filter(b => b !== val);
        if (!removedItems.includes(val)) removedItems.push(val);
        saveCatalogsToStorage();
        if (el) {
            el.blur();
            el.value = '';
        }
        populateSelects();
    }
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
        btn.style.borderColor = 'var(--success)';
        btn.style.color = '#8aff9d';
        soloBox.classList.add('hidden');
        mixBox.classList.remove('hidden');
        addBtn.classList.remove('hidden');
        if (mixBox.children.length === 0) {
            addMixRow();
            addMixRow();
        }
    } else {
        btn.innerText = 'Режим: Соло';
        btn.style.borderColor = 'rgba(10, 132, 255, 0.35)';
        btn.style.color = '#64b5f6';
        soloBox.classList.remove('hidden');
        mixBox.classList.add('hidden');
        addBtn.classList.add('hidden');
    }
}

function addMixRow(brand = '', flavor = '', weight = '') {
    const container = document.getElementById('mix-container');
    const card = document.createElement('div');
    card.className = 'tobacco-entry-card mix-item';
    card.innerHTML = `
        <div class="select-with-add" style="margin-bottom: 8px;">
            <select class="tobacco-brand-select">${getBrandOptionsHtml(brand)}</select>
            <button type="button" class="btn-plus" onclick="addNewBrandPrompt(this.previousElementSibling)">+</button>
            <button type="button" class="btn-minus" onclick="deleteSelectedBrand(this.previousElementSibling.previousElementSibling)">−</button>
            <button type="button" class="btn-danger" style="height: 42px; padding: 0 12px;" onclick="this.closest('.mix-item').remove()">✕</button>
        </div>
        <div style="display: flex; gap: 8px;">
            <input type="text" class="tobacco-flavor" placeholder="Вкус" value="${flavor}" style="flex: 2.2;">
            <input type="number" class="tobacco-weight" placeholder="Грамм" value="${weight}" style="flex: 1;">
        </div>
    `;
    container.appendChild(card);
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

// Генерация двух WAV-дорожек: 1) Бесшумная для удержания фона 2) Нежные «капельки» для будильника
function initRealBackgroundAudio() {
    silentAudioUrl = createWavBlobUrl(false);
    alarmAudioUrl = createWavBlobUrl(true);

    const audioEl = document.getElementById('bg-audio');
    if (audioEl) {
        audioEl.src = silentAudioUrl;
        audioEl.volume = 0.05;

        // Плеер сам будит таймер в фоне на заблокированном экране iOS
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
        { start: 0.05, freq: 1046.50 }, // C6
        { start: 0.22, freq: 1318.51 }, // E6
        { start: 0.39, freq: 1567.98 }  // G6
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
            if (audioEl.src !== silentAudioUrl) {
                audioEl.src = silentAudioUrl;
            }
            audioEl.volume = 0.05;
            if (audioEl.paused) await audioEl.play();
        }
        updateLockScreenMetadata(titleText, subtitleText);
    } catch (e) { }
}

// Проигрываем «капельки» ровно 2 раза (3.6 сек) и возвращаем тишину
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

function setCoalPlacement(type) {
    if (type === 'Пирамидка') type = 'Пирамида';
    currentCoalPlacement = type;
    document.querySelectorAll('.coal-chip').forEach(el => el.classList.remove('active'));
    if (type === '3 в колодке') document.getElementById('chip-3')?.classList.add('active');
    if (type === '2 + 1') document.getElementById('chip-21')?.classList.add('active');
    if (type === 'Пирамида') document.getElementById('chip-pyr')?.classList.add('active');
    saveActiveSessionState();
}

async function sendPush(title, body) {
    if (navigator.vibrate) {
        try { navigator.vibrate([300, 150, 300, 150, 400]); } catch (e) { }
    }
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    try {
        if (swRegistration && swRegistration.showNotification) {
            await swRegistration.showNotification(title, {
                body: body,
                icon: 'icon.png',
                vibrate: [300, 150, 300],
                tag: 'dimhookah-warmup',
                renotify: true
            });
        } else {
            new Notification(title, { body, icon: 'icon.png' });
        }
    } catch (e) {
        try { new Notification(title, { body }); } catch (err) { }
    }
}

function getDraftMixFromForm() {
    const mix = [];
    if (isMixMode) {
        document.querySelectorAll('#mix-container .mix-item').forEach(item => {
            const brand = item.querySelector('.tobacco-brand-select')?.value.trim() || '';
            const flavor = item.querySelector('.tobacco-flavor')?.value.trim() || '';
            const weight = parseFloat(item.querySelector('.tobacco-weight')?.value) || 0;
            if (brand || flavor || weight) mix.push({ brand, flavor, weight });
        });
    } else {
        const brand = document.getElementById('solo-tobacco-brand')?.value.trim() || '';
        const flavor = document.getElementById('solo-tobacco-flavor')?.value.trim() || '';
        const weight = parseFloat(document.getElementById('solo-tobacco-weight')?.value) || 0;
        if (brand || flavor || weight) mix.push({ brand, flavor, weight });
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
                state.mix.forEach(m => addMixRow(m.brand, m.flavor, m.weight || ''));
            } else {
                const m = state.mix[0];
                document.getElementById('solo-tobacco-brand').value = m.brand || '';
                document.getElementById('solo-tobacco-flavor').value = m.flavor || '';
                document.getElementById('solo-tobacco-weight').value = m.weight || '';
            }
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
    if (confirm('Отменить текущую сессию?')) {
        clearInterval(timerInterval);
        stopKeepAliveAudio();
        document.getElementById('warmup-box').classList.remove('alarm-active');
        document.getElementById('warmup-controls').classList.add('hidden');
        document.getElementById('smoking-controls').classList.add('hidden');
        saveActiveSessionState('idle');
        resetForm();
    }
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

    if (mix.length === 0) mix.push({ brand: 'Без названия', flavor: '', weight: 0 });

    const session = {
        id: Date.now(),
        date: new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
        bowl,
        placement: currentCoalPlacement,
        mix,
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
    document.getElementById('mix-container').innerHTML = '';
    document.getElementById('bowl-select').value = '';
    document.getElementById('solo-tobacco-brand').value = '';
    if (isMixMode) toggleMixMode();
}

function deleteSession(id) {
    if (confirm("Удалить эту запись из истории?")) {
        loadAllData((history) => {
            history = history.filter(s => s.id !== id);
            saveSessionsToStorage(history, () => {
                renderData(history);
            });
        });
    }
}

function renderData(history) {
    if (!history) {
        loadAllData((h) => renderData(h));
        return;
    }

    const tbody = document.getElementById('history-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    const tobaccoStats = {};

    history.forEach(s => {
        const tr = document.createElement('tr');
        const placementText = (s.placement === 'Пирамидка') ? 'Пирамида' : (s.placement || '3 в колодке');

        const mixStr = (s.mix || []).map(m => {
            const b = m.brand || m.name || '';
            const f = m.flavor || '';
            return `<span class="badge">${b} ${f} (${m.weight || 0}г)</span>`;
        }).join(' ');

        const commentHtml = s.comment ? `<div style="color:var(--text-secondary); margin-top:4px; font-size:0.85em; font-style:italic;">💬 ${s.comment}</div>` : '';

        tr.innerHTML = `
            <td><b>${s.date}</b><br><span style="color:#ffb340; font-weight:700;">★ ${s.rating}</span></td>
            <td><b>${s.bowl}</b><br><span style="color:var(--text-secondary); font-size:0.82em;">🔥 ${placementText}</span></td>
            <td><div>${mixStr}</div>${commentHtml}</td>
            <td style="font-size:0.82em; white-space:nowrap;">
                🔥 ${formatDurationHM(s.actualWarmupDuration)}<br>
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
                    tobaccoStats[key] = { name: tobName, count: 0, totalRating: 0, totalWeight: 0 };
                }
                tobaccoStats[key].count += 1;
                tobaccoStats[key].totalRating += s.rating;
                tobaccoStats[key].totalWeight += (parseFloat(m.weight) || 0);
            }
        });
    });

    const analyticsDiv = document.getElementById('analytics-content');
    if (!analyticsDiv) return;
    const sortedTobaccos = Object.values(tobaccoStats).sort((a, b) => (b.totalRating / b.count) - (a.totalRating / a.count));

    if (sortedTobaccos.length === 0) {
        analyticsDiv.innerHTML = '<p style="color: var(--text-secondary); margin:0; font-size:0.9em;">Пока нет сохраненных сессий.</p>';
        return;
    }

    let html = '<table><thead><tr><th>Табак</th><th>Рейтинг</th><th>Сессий</th><th>Вес</th></tr></thead><tbody>';
    sortedTobaccos.forEach(t => {
        const avg = (t.totalRating / t.count).toFixed(1);
        html += `
            <tr>
                <td><b>${t.name}</b></td>
                <td style="color: #ffb340; font-weight: bold;">★ ${avg}</td>
                <td>${t.count}</td>
                <td>${t.totalWeight} г</td>
            </tr>
        `;
    });
    html += '</tbody></table>';
    analyticsDiv.innerHTML = html;
}

function addModalMixRow(brand = '', flavor = '', weight = '') {
    if (brand && !savedBrands.includes(brand)) {
        savedBrands.push(brand);
    }
    const container = document.getElementById('modal-mix-container');
    const card = document.createElement('div');
    card.className = 'tobacco-entry-card modal-mix-item';
    card.innerHTML = `
        <div class="select-with-add" style="margin-bottom: 8px;">
            <select class="tobacco-brand-select">${getBrandOptionsHtml(brand)}</select>
            <button type="button" class="btn-plus" onclick="addNewBrandPrompt(this.previousElementSibling)">+</button>
            <button type="button" class="btn-minus" onclick="deleteSelectedBrand(this.previousElementSibling.previousElementSibling)">−</button>
            <button type="button" class="btn-danger" style="height: 42px; padding: 0 12px;" onclick="this.closest('.modal-mix-item').remove()">✕</button>
        </div>
        <div style="display: flex; gap: 8px;">
            <input type="text" class="modal-tobacco-flavor" placeholder="Вкус" value="${flavor}" style="flex: 2.2;">
            <input type="number" class="modal-tobacco-weight" placeholder="Грамм" value="${weight}" style="flex: 1;">
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
            addModalMixRow(m.brand || m.name || '', m.flavor || '', m.weight || 0);
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
                    if (brand || flavor) updatedMix.push({ brand, flavor, weight });
                });
                s.mix = updatedMix.length > 0 ? updatedMix : [{ brand: 'Без названия', flavor: '', weight: 0 }];
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
        if (history.length === 0) { alert('История пуста!'); return; }

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
            try { await navigator.share({ title: 'История покуров', text: text }); } catch (e) { }
        } else {
            navigator.clipboard.writeText(text);
            alert('История скопирована в буфер обмена!');
        }
    });
}

function exportToCSV() {
    loadAllData((history) => {
        if (history.length === 0) { alert('История пуста!'); return; }

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
        if (lines.length < 2) { alert('Файл пустой.'); return; }

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
                alert(`Импортировано сессий: ${importedCount}`);
                event.target.value = '';
            });
        });
    };
    reader.readAsText(file, 'UTF-8');
}