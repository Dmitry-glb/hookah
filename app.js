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

let savedBowls = [];
let savedBrands = [];

const tg = window.Telegram?.WebApp;
if (tg) {
    tg.expand();
    tg.ready();
}

document.addEventListener('DOMContentLoaded', () => {
    initTimeWheels();
    initRealBackgroundAudio();
    setRating(5);
    setCoalPlacement('3 в колодке');

    loadAllData((history) => {
        syncCatalogFromHistory(history);
        populateSelects();
        renderData(history);
    });
});

// Инициализация барабанов времени (Минуты от 5 до 20 с шагом 1, Секунды 00-55)
function initTimeWheels() {
    const minSelect = document.getElementById('warmup-min');
    const secSelect = document.getElementById('warmup-sec');

    let minHtml = '';
    for (let m = 5; m <= 20; m++) {
        const sel = (m === 5) ? 'selected' : '';
        minHtml += `<option value="${m}" ${sel}>${m}</option>`;
    }
    minSelect.innerHTML = minHtml;

    let secHtml = '';
    for (let s = 0; s < 60; s += 5) {
        const label = s.toString().padStart(2, '0');
        secHtml += `<option value="${s}">${label}</option>`;
    }
    secSelect.innerHTML = secHtml;
}

// Загрузка истории и пользовательских списков чаш/брендов
function loadAllData(callback) {
    try {
        savedBowls = JSON.parse(localStorage.getItem('hookah_custom_bowls') || '[]');
        savedBrands = JSON.parse(localStorage.getItem('hookah_custom_brands') || '[]');
    } catch (e) {
        savedBowls = [];
        savedBrands = [];
    }

    if (tg && tg.CloudStorage) {
        tg.CloudStorage.getItems(['hookah_sessions', 'hookah_custom_bowls', 'hookah_custom_brands'], (err, values) => {
            let history = [];
            if (!err && values) {
                if (values.hookah_sessions) {
                    try { history = JSON.parse(values.hookah_sessions); } catch (e) { }
                }
                if (values.hookah_custom_bowls) {
                    try { savedBowls = JSON.parse(values.hookah_custom_bowls); } catch (e) { }
                }
                if (values.hookah_custom_brands) {
                    try { savedBrands = JSON.parse(values.hookah_custom_brands); } catch (e) { }
                }
            }
            if (history.length === 0) {
                try { history = JSON.parse(localStorage.getItem('hookah_sessions') || '[]'); } catch (e) { }
            }
            callback(history);
        });
    } else {
        let history = [];
        try { history = JSON.parse(localStorage.getItem('hookah_sessions') || '[]'); } catch (e) { }
        callback(history);
    }
}

function saveSessionsToStorage(history, callback) {
    const jsonStr = JSON.stringify(history);
    localStorage.setItem('hookah_sessions', jsonStr);

    if (tg && tg.CloudStorage) {
        tg.CloudStorage.setItem('hookah_sessions', jsonStr, () => {
            if (callback) callback();
        });
    } else {
        if (callback) callback();
    }
}

function saveCatalogsToStorage() {
    const bowlsStr = JSON.stringify(savedBowls);
    const brandsStr = JSON.stringify(savedBrands);
    localStorage.setItem('hookah_custom_bowls', bowlsStr);
    localStorage.setItem('hookah_custom_brands', brandsStr);

    if (tg && tg.CloudStorage) {
        tg.CloudStorage.setItem('hookah_custom_bowls', bowlsStr);
        tg.CloudStorage.setItem('hookah_custom_brands', brandsStr);
    }
}

// Собираем все чаши и бренды из истории покуров
// Собираем только реальные чаши и бренды из истории без дефолтного мусора
function syncCatalogFromHistory(history) {
    const bowlSet = new Set(savedBowls.filter(b => b !== 'Облако Phunnel M'));
    const brandSet = new Set(savedBrands.filter(b => !['Darkside', 'Musthave', 'Black Burn'].includes(b)));

    (history || []).forEach(s => {
        if (s.bowl && s.bowl !== 'Не указана') bowlSet.add(s.bowl);
        (s.mix || []).forEach(m => {
            const b = (m.brand || m.name || '').trim();
            if (b && b !== 'Без названия') brandSet.add(b);
        });
    });

    savedBowls = Array.from(bowlSet);
    savedBrands = Array.from(brandSet);
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
    }

    const soloBrand = document.getElementById('solo-tobacco-brand');
    if (soloBrand) {
        const current = soloBrand.value;
        soloBrand.innerHTML = getBrandOptionsHtml(current);
    }

    document.querySelectorAll('.tobacco-brand-select').forEach(sel => {
        const current = sel.value;
        sel.innerHTML = getBrandOptionsHtml(current);
    });

    const modalBowl = document.getElementById('modal-bowl');
    if (modalBowl) {
        const current = modalBowl.value;
        modalBowl.innerHTML = getBowlOptionsHtml(current);
    }
}

// Добавление новой чаши через "+"
function addNewBowlPrompt(targetSelectId = 'bowl-select') {
    const newBowl = prompt('Введите название новой чаши:');
    if (newBowl && newBowl.trim()) {
        const clean = newBowl.trim();
        if (!savedBowls.includes(clean)) {
            savedBowls.push(clean);
            saveCatalogsToStorage();
        }
        populateSelects();
        const target = document.getElementById(targetSelectId);
        if (target) target.value = clean;
    }
}

// Добавление нового бренда табака через "+"
function addNewBrandPrompt(targetSelectOrElem) {
    const newBrand = prompt('Введите название нового бренда табака:');
    if (newBrand && newBrand.trim()) {
        const clean = newBrand.trim();
        if (!savedBrands.includes(clean)) {
            savedBrands.push(clean);
            saveCatalogsToStorage();
        }
        populateSelects();
        if (typeof targetSelectOrElem === 'string') {
            const el = document.getElementById(targetSelectOrElem);
            if (el) el.value = clean;
        } else if (targetSelectOrElem) {
            targetSelectOrElem.value = clean;
        }
    }
}

// Переключение Соло / Микс
function toggleMixMode() {
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
            <button type="button" class="btn-danger" style="height: 44px; padding: 0 14px;" onclick="this.closest('.mix-item').remove()">✕</button>
        </div>
        <div style="display: flex; gap: 8px;">
            <input type="text" class="tobacco-flavor" placeholder="Вкус" value="${flavor}" style="flex: 2.2;">
            <input type="number" class="tobacco-weight" placeholder="Грамм" value="${weight}" style="flex: 1;">
        </div>
    `;
    container.appendChild(card);
}

// Форматирование секунд для активного секундомера (ММ:СС)
function formatTimerSec(seconds) {
    const isNegative = seconds < 0;
    const absSec = Math.abs(seconds);
    const mins = Math.floor(absSec / 60).toString().padStart(2, '0');
    const secs = (absSec % 60).toString().padStart(2, '0');
    return (isNegative ? '-' : '') + `${mins}:${secs}`;
}

// Форматирование времени для истории в Часы и Минуты
function formatDurationHM(seconds) {
    const totalMins = Math.round((seconds || 0) / 60);
    if (totalMins <= 0) return '1 мин';
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    if (h > 0 && m > 0) return `${h} ч ${m} мин`;
    if (h > 0) return `${h} ч`;
    return `${m} мин`;
}

// Фоновое аудио для iOS
function initRealBackgroundAudio() {
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
        view.setInt16(44 + i * 2, (i % 2 === 0) ? 1 : -1, true);
    }
    const blob = new Blob([buffer], { type: 'audio/wav' });
    const audioEl = document.getElementById('bg-audio');
    if (audioEl) {
        audioEl.src = URL.createObjectURL(blob);
        audioEl.volume = 0.01;
    }
}

async function startKeepAliveAudio(titleText) {
    const audioEl = document.getElementById('bg-audio');
    try {
        if (audioEl) await audioEl.play();
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: titleText || 'DimHookah Активен 🔥',
                artist: 'DimHookah Tracker',
                album: 'Сессия кальяна'
            });
        }
    } catch (e) { }
}

function stopKeepAliveAudio() {
    const audioEl = document.getElementById('bg-audio');
    if (audioEl) audioEl.pause();
}

function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playBellSound() {
    try {
        initAudio();
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1046.50, now);
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 1.5);
    } catch (e) { }
}

function setCoalPlacement(type) {
    if (type === 'Пирамидка') type = 'Пирамида';
    currentCoalPlacement = type;
    document.querySelectorAll('.coal-chip').forEach(el => el.classList.remove('active'));
    if (type === '3 в колодке') document.getElementById('chip-3')?.classList.add('active');
    if (type === '2 + 1') document.getElementById('chip-21')?.classList.add('active');
    if (type === 'Пирамида') document.getElementById('chip-pyr')?.classList.add('active');
}

function sendPush(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification(title, { body }); } catch (e) { }
    }
    if (tg && tg.showPopup) {
        try { tg.showPopup({ title: title, message: body, buttons: [{ type: 'ok' }] }); } catch (e) { }
    }
}

async function startWarmupSession() {
    initAudio();
    await startKeepAliveAudio('⏳ Идет прогрев чаши...');

    if ('Notification' in window && Notification.permission !== 'granted') {
        try { await Notification.requestPermission(); } catch (e) { }
    }
    if ('wakeLock' in navigator) {
        try { await navigator.wakeLock.request('screen'); } catch (e) { }
    }

    const mins = parseInt(document.getElementById('warmup-min').value) || 5;
    const secs = parseInt(document.getElementById('warmup-sec').value) || 0;
    warmupTargetSec = (mins * 60) + secs;

    document.getElementById('status-title').innerText = '⏳ Прогрев чаши';
    document.getElementById('setup-form').classList.add('hidden');
    document.getElementById('warmup-controls').classList.remove('hidden');

    stepStartTime = Date.now();
    alarmAlreadyPlayed = false;

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
        if (!alarmAlreadyPlayed) {
            playBellSound();
            if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('warning');
            sendPush('Чаша прогрелась! 🔥', 'Пора раскуривать кальян, пока не сжег табак!');
            alarmAlreadyPlayed = true;
        }
    } else {
        box.classList.remove('alarm-active');
    }
}

function startSmokingFromWarmup() {
    initAudio();
    actualWarmupDuration = Math.floor((Date.now() - stepStartTime) / 1000);

    document.getElementById('warmup-box').classList.remove('alarm-active');
    document.getElementById('status-title').innerText = '💨 Идет покур';
    document.getElementById('warmup-controls').classList.add('hidden');
    document.getElementById('smoking-controls').classList.remove('hidden');

    startKeepAliveAudio('💨 Идет покур кальяна');
    stepStartTime = Date.now();

    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        const elapsedSmoke = Math.floor((Date.now() - stepStartTime) / 1000);
        document.getElementById('timer').innerText = formatTimerSec(elapsedSmoke);
    }, 1000);
}

function finishSmokingSession() {
    smokeDuration = Math.floor((Date.now() - stepStartTime) / 1000);
    clearInterval(timerInterval);
    stopKeepAliveAudio();

    document.getElementById('status-title').innerText = '✅ Сессия завершена';
    document.getElementById('timer').innerText = formatTimerSec(smokeDuration);
    document.getElementById('smoking-controls').classList.add('hidden');
    document.getElementById('rating-form').classList.remove('hidden');
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
    const mix = [];

    if (isMixMode) {
        const items = document.querySelectorAll('#mix-container .mix-item');
        items.forEach(item => {
            const brand = item.querySelector('.tobacco-brand-select').value.trim();
            const flavor = item.querySelector('.tobacco-flavor').value.trim();
            const weight = parseFloat(item.querySelector('.tobacco-weight').value) || 0;
            if (brand || flavor) mix.push({ brand, flavor, weight });
        });
    } else {
        const brand = document.getElementById('solo-tobacco-brand').value.trim();
        const flavor = document.getElementById('solo-tobacco-flavor').value.trim();
        const weight = parseFloat(document.getElementById('solo-tobacco-weight').value) || 0;
        if (brand || flavor) mix.push({ brand, flavor, weight });
    }

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

// Строка табака в модальном окне редактирования
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
            <button type="button" class="btn-danger" style="height: 44px; padding: 0 14px;" onclick="this.closest('.modal-mix-item').remove()">✕</button>
        </div>
        <div style="display: flex; gap: 8px;">
            <input type="text" class="modal-tobacco-flavor" placeholder="Вкус" value="${flavor}" style="flex: 2.2;">
            <input type="number" class="modal-tobacco-weight" placeholder="Грамм" value="${weight}" style="flex: 1;">
        </div>
    `;
    container.appendChild(card);
}

// Открытие модального окна с редактированием табака и времени (Часы / Минуты)
let currentModalRating = 5;
function setModalRating(val) {
    currentModalRating = val;
    document.querySelectorAll('.modal-star').forEach((star, index) => {
        star.classList.toggle('active', index < val);
    });
}

function openFullEditModal(id) {
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

        // Переводим секунды в Часы и Минуты
        const warmupTotalMins = Math.round((s.actualWarmupDuration || 0) / 60);
        document.getElementById('modal-warmup-h').value = Math.floor(warmupTotalMins / 60);
        document.getElementById('modal-warmup-m').value = warmupTotalMins % 60;

        const smokeTotalMins = Math.round((s.smokeDuration || 0) / 60);
        document.getElementById('modal-smoke-h').value = Math.floor(smokeTotalMins / 60);
        document.getElementById('modal-smoke-m').value = smokeTotalMins % 60;

        // Заполняем табаки
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

                // Считываем часы и минуты обратно в секунды
                const wh = parseInt(document.getElementById('modal-warmup-h').value) || 0;
                const wm = parseInt(document.getElementById('modal-warmup-m').value) || 0;
                s.actualWarmupDuration = (wh * 3600) + (wm * 60);

                const sh = parseInt(document.getElementById('modal-smoke-h').value) || 0;
                const sm = parseInt(document.getElementById('modal-smoke-m').value) || 0;
                s.smokeDuration = (sh * 3600) + (sm * 60);

                // Считываем отредактированный табак
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

// Экспорт в заметки
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

// Экспорт в CSV
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

// Импорт из CSV
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
