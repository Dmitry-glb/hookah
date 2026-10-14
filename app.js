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

document.addEventListener('DOMContentLoaded', () => {
    renderData();
    setRating(5);
    initRealBackgroundAudio();
    setCoalPlacement('3 в колодке');
    updateDatalists(); // Подгрузка истории чаш и табаков в подсказки
});

// Генерация фонового аудио для обмана блокировки iOS
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
    audioEl.src = URL.createObjectURL(blob);
    audioEl.volume = 0.01;
}

async function startKeepAliveAudio(titleText) {
    const audioEl = document.getElementById('bg-audio');
    try {
        await audioEl.play();
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
    document.getElementById('bg-audio').pause();
}

function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

// Единоразовый звонок колокольчика
function playBellSound() {
    try {
        initAudio();
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1046.50, now); // Высокая нота До (C6)
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 1.5);
    } catch (e) { }
}

function formatTime(seconds) {
    const isNegative = seconds < 0;
    const absSec = Math.abs(seconds);
    const mins = Math.floor(absSec / 60).toString().padStart(2, '0');
    const secs = (absSec % 60).toString().padStart(2, '0');
    return (isNegative ? '-' : '') + `${mins}:${secs}`;
}

// Переключение режимов Соло / Микс
// Переключение режимов Соло / Микс
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
    const row = document.createElement('div');
    row.className = 'mix-row';
    row.innerHTML = `
        <input type="text" class="tobacco-brand" placeholder="Бренд" list="brands-list" value="${brand}" style="flex: 1.5;">
        <input type="text" class="tobacco-flavor" placeholder="Вкус" list="flavors-list" value="${flavor}" style="flex: 1.8;">
        <input type="number" class="tobacco-weight" placeholder="Гр" value="${weight}" style="flex: 0.9;">
        <button type="button" class="btn btn-danger" onclick="this.parentElement.remove()">✕</button>
    `;
    container.appendChild(row);
}

function setCoalPlacement(type) {
    currentCoalPlacement = type;
    document.querySelectorAll('.coal-chip').forEach(el => el.classList.remove('active'));
    if (type === '3 в колодке') document.getElementById('chip-3').classList.add('active');
    if (type === '2 + 1') document.getElementById('chip-21').classList.add('active');
    if (type === 'Пирамидка') document.getElementById('chip-pyr').classList.add('active');
}

// Заполняем списки автодополнения (история чаш, брендов и вкусов)
function updateDatalists() {
    const history = JSON.parse(localStorage.getItem('hookah_sessions') || '[]');
    const bowlsSet = new Set();
    const brandsSet = new Set();
    const flavorsSet = new Set();

    history.forEach(s => {
        if (s.bowl) bowlsSet.add(s.bowl);
        if (s.mix) {
            s.mix.forEach(m => {
                if (m.brand) brandsSet.add(m.brand);
                if (m.flavor) flavorsSet.add(m.flavor);
            });
        }
    });

    const bowlsEl = document.getElementById('bowls-list');
    const brandsEl = document.getElementById('brands-list');
    const flavorsEl = document.getElementById('flavors-list');

    if (bowlsEl) bowlsEl.innerHTML = Array.from(bowlsSet).map(b => `<option value="${b}">`).join('');
    if (brandsEl) brandsEl.innerHTML = Array.from(brandsSet).map(b => `<option value="${b}">`).join('');
    if (flavorsEl) flavorsEl.innerHTML = Array.from(flavorsSet).map(f => `<option value="${f}">`).join('');
}

// ШАГ 1: Запуск прогрева чаши (Автоматический старт фонового плеера iOS)
async function startWarmupSession() {
    initAudio();
    await startKeepAliveAudio('⏳ Идет прогрев чаши...');

    if ('wakeLock' in navigator) {
        try { await navigator.wakeLock.request('screen'); } catch (e) { }
    }

    const mins = parseInt(document.getElementById('warmup-min').value) || 0;
    const secs = parseInt(document.getElementById('warmup-sec').value) || 0;
    warmupTargetSec = (mins * 60) + secs;
    if (warmupTargetSec <= 0) warmupTargetSec = 300; // По умолчанию 5 минут, если пустой ввод

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

    document.getElementById('timer').innerText = formatTime(elapsed);
    document.getElementById('warmup-countdown').innerText = formatTime(remaining);

    const box = document.getElementById('warmup-box');
    if (remaining <= 0) {
        box.classList.add('alarm-active');
        if (!alarmAlreadyPlayed) {
            playBellSound();
            alarmAlreadyPlayed = true;
        }
    } else {
        box.classList.remove('alarm-active');
    }
}

// ШАГ 2: Переход к покуру
function startSmokingFromWarmup() {
    initAudio();
    // Если время ушло в минус, реальное время прогрева увеличивается на перепрогрев
    const elapsed = Math.floor((Date.now() - stepStartTime) / 1000);
    actualWarmupDuration = elapsed;

    document.getElementById('warmup-box').classList.remove('alarm-active');
    document.getElementById('status-title').innerText = '💨 Идет покур';
    document.getElementById('warmup-controls').classList.add('hidden');
    document.getElementById('smoking-controls').classList.remove('hidden');

    startKeepAliveAudio('💨 Идет покур кальяна');
    stepStartTime = Date.now();

    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        const elapsedSmoke = Math.floor((Date.now() - stepStartTime) / 1000);
        document.getElementById('timer').innerText = formatTime(elapsedSmoke);
    }, 1000);
}

// ШАГ 3: Завершение покура
function finishSmokingSession() {
    smokeDuration = Math.floor((Date.now() - stepStartTime) / 1000);
    clearInterval(timerInterval);
    stopKeepAliveAudio();

    document.getElementById('status-title').innerText = '✅ Сессия завершена';
    document.getElementById('timer').innerText = formatTime(smokeDuration);
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
    const bowl = document.getElementById('bowl').value.trim() || 'Не указана';
    const comment = document.getElementById('comment').value.trim();
    const mix = [];

    if (isMixMode) {
        const brands = document.querySelectorAll('.tobacco-brand');
        const flavors = document.querySelectorAll('.tobacco-flavor');
        const weights = document.querySelectorAll('.tobacco-weight');
        for (let i = 0; i < brands.length; i++) {
            const brand = brands[i].value.trim();
            const flavor = flavors[i].value.trim();
            const weight = parseFloat(weights[i].value) || 0;
            if (brand || flavor) mix.push({ brand, flavor, weight });
        }
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

    const history = JSON.parse(localStorage.getItem('hookah_sessions') || '[]');
    history.unshift(session);
    localStorage.setItem('hookah_sessions', JSON.stringify(history));

    resetForm();
    renderData();
    updateDatalists(); // Обновляем подсказки новыми данными
}

function resetForm() {
    document.getElementById('status-title').innerText = 'Новая сессия';
    document.getElementById('timer').innerText = '00:00';
    document.getElementById('setup-form').classList.remove('hidden');
    document.getElementById('rating-form').classList.add('hidden');
    document.getElementById('bowl').value = '';
    document.getElementById('comment').value = '';
    document.getElementById('solo-tobacco-name').value = '';
    document.getElementById('solo-tobacco-weight').value = '';
}

function deleteSession(id) {
    if (confirm("Удалить эту запись из истории?")) {
        let history = JSON.parse(localStorage.getItem('hookah_sessions') || '[]');
        history = history.filter(s => s.id !== id);
        localStorage.setItem('hookah_sessions', JSON.stringify(history));
        renderData();
    }
}

function renderData() {
    const history = JSON.parse(localStorage.getItem('hookah_sessions') || '[]');
    const tbody = document.getElementById('history-body');
    tbody.innerHTML = '';
    const tobaccoStats = {};

    history.forEach(s => {
        const tr = document.createElement('tr');
        // Формируем текст микса из бренда и вкуса
        const mixStr = s.mix.map(m => `<span class="badge">${m.brand ? m.brand + ' ' : ''}${m.flavor ? m.flavor : ''} (${m.weight}г)</span>`).join(' ');
        const commentHtml = s.comment ? `<div style="color:var(--text-secondary); margin-top:4px; font-size:0.85em; font-style:italic;">💬 ${s.comment}</div>` : '';

        tr.innerHTML = `
            <td><b>${s.date}</b><br><span style="color:#ffb340; font-weight:700;">★ ${s.rating}</span></td>
            <td><b>${s.bowl}</b><br><span style="color:var(--text-secondary); font-size:0.82em;">🔥 ${s.placement || '3 в колодке'}</span></td>
            <td><div>${mixStr}</div>${commentHtml}</td>
            <td style="font-size:0.82em; white-space:nowrap;">
                🔥 ${formatTime(s.actualWarmupDuration || 0)}<br>
                💨 <b>${formatTime(s.smokeDuration)}</b>
            </td>
            <td style="white-space: nowrap;">
                <button class="btn btn-edit" onclick="openFullEditModal(${s.id})">✏️</button>
                <button class="btn btn-danger" onclick="deleteSession(${s.id})">✕</button>
            </td>
        `;
        tbody.appendChild(tr);

        s.mix.forEach(m => {
            const key = m.name.toLowerCase();
            if (!tobaccoStats[key]) {
                tobaccoStats[key] = { name: m.name, count: 0, totalRating: 0, totalWeight: 0 };
            }
            tobaccoStats[key].count += 1;
            tobaccoStats[key].totalRating += s.rating;
            tobaccoStats[key].totalWeight += m.weight;
        });
    });

    const analyticsDiv = document.getElementById('analytics-content');
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

// Модальное окно редактирования
function openFullEditModal(id) {
    const history = JSON.parse(localStorage.getItem('hookah_sessions') || '[]');
    const s = history.find(item => item.id === id);
    if (!s) return;

    document.getElementById('modal-id').value = s.id;
    document.getElementById('modal-date').value = s.date;
    document.getElementById('modal-bowl').value = s.bowl;
    document.getElementById('modal-warmup').value = s.actualWarmupDuration || 0;
    document.getElementById('modal-smoke').value = s.smokeDuration || 0;
    document.getElementById('modal-placement').value = s.placement || '3 в колодке';
    document.getElementById('modal-rating').value = s.rating;
    document.getElementById('modal-comment').value = s.comment || '';

    document.getElementById('edit-modal').classList.remove('hidden');
}

function closeEditModal() {
    document.getElementById('edit-modal').classList.add('hidden');
}

function saveEditedSession() {
    const id = parseInt(document.getElementById('modal-id').value);
    let history = JSON.parse(localStorage.getItem('hookah_sessions') || '[]');

    history = history.map(s => {
        if (s.id === id) {
            s.date = document.getElementById('modal-date').value;
            s.bowl = document.getElementById('modal-bowl').value;
            s.actualWarmupDuration = parseInt(document.getElementById('modal-warmup').value) || 0;
            s.smokeDuration = parseInt(document.getElementById('modal-smoke').value) || 0;
            s.placement = document.getElementById('modal-placement').value;
            s.rating = parseInt(document.getElementById('modal-rating').value) || 5;
            s.comment = document.getElementById('modal-comment').value;
        }
        return s;
    });

    localStorage.setItem('hookah_sessions', JSON.stringify(history));
    closeEditModal();
    renderData();
}

// Экспорт / Импорт
async function exportToNotes() {
    const history = JSON.parse(localStorage.getItem('hookah_sessions') || '[]');
    if (history.length === 0) { alert('История пуста!'); return; }

    let text = "💨 ИСТОРИЯ ПОКУРОВ DIMHOOKAH\n\n";
    history.forEach((s, index) => {
        const mixStr = s.mix.map(m => `${m.name} (${m.weight}г)`).join(', ');
        text += `${index + 1}. Дата: ${s.date} | Чаша: ${s.bowl}\n`;
        text += `   Микс: ${mixStr}\n`;
        text += `   Расстановка: ${s.placement || '3 в колодке'}\n`;
        text += `   Грев: ${formatTime(s.actualWarmupDuration)} | Покур: ${formatTime(s.smokeDuration)} | ⭐${s.rating}\n`;
        if (s.comment) text += `   Комментарий: ${s.comment}\n`;
        text += `-----------------------------------\n`;
    });

    if (navigator.share) {
        try { await navigator.share({ title: 'История покуров', text: text }); } catch (e) { }
    } else {
        navigator.clipboard.writeText(text);
        alert('История скопирована в буфер обмена!');
    }
}

function exportToCSV() {
    const history = JSON.parse(localStorage.getItem('hookah_sessions') || '[]');
    if (history.length === 0) { alert('История пуста!'); return; }

    let csv = '\uFEFFДата;Чаша;Расстановка;Микс;Время прогрева (сек);Время покура (сек);Оценка;Комментарий\n';
    history.forEach(s => {
        const mixStr = s.mix.map(m => `${m.name} (${m.weight}г)`).join(' + ');
        csv += `"${s.date}";"${s.bowl}";"${s.placement || ''}";"${mixStr}";"${s.actualWarmupDuration || 0}";"${s.smokeDuration}";"${s.rating}";"${s.comment || ''}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dimhookah_history_${new Date().toLocaleDateString()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function importFromCSV(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        const text = e.target.result;
        const lines = text.split('\n');
        if (lines.length < 2) { alert('Файл пустой.'); return; }

        let importedCount = 0;
        let history = JSON.parse(localStorage.getItem('hookah_sessions') || '[]');

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const row = [];
            let inRegex = false;
            let currentVal = '';
            for (let char of line) {
                if (char === '"') { inRegex = !inRegex; }
                else if (char === ';' && !inRegex) { row.push(currentVal); currentVal = ''; }
                else { currentVal += char; }
            }
            row.push(currentVal);

            if (row.length >= 7) {
                const date = row[0].replace(/"/g, '');
                const bowl = row[1].replace(/"/g, '');
                const placement = row[2] ? row[2].replace(/"/g, '') : '3 в колодке';
                const mixRaw = row[3] ? row[3].replace(/"/g, '') : '';
                const actualWarmupDuration = parseInt(row[4]) || 0;
                const smokeDuration = parseInt(row[5]) || 0;
                const rating = parseInt(row[6]) || 5;
                const comment = row[7] ? row[7].replace(/"/g, '') : '';

                const mix = [];
                mixRaw.split('+').forEach(part => {
                    const match = part.trim().match(/(.*?)\s*\((\d+)[гg]\)/i);
                    if (match) {
                        mix.push({ name: match[1].trim(), weight: parseFloat(match[2]) || 0 });
                    } else if (part.trim()) {
                        mix.push({ name: part.trim(), weight: 0 });
                    }
                });

                if (mix.length === 0) mix.push({ name: 'Без названия', weight: 0 });

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

        localStorage.setItem('hookah_sessions', JSON.stringify(history));
        renderData();
        alert(`Импортировано сессий: ${importedCount}`);
        event.target.value = '';
    };
    reader.readAsText(file, 'UTF-8');
}
