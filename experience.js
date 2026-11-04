'use strict';
// Move existing controls intact: storage keys, form IDs and Siri entry points stay compatible.
(function () {
    const byId = id => document.getElementById(id);
    byId('panel-session').append(byId('setup-form'));
    byId('panel-timer').append(byId('active-session'));
    const historyCard = byId('history-list').closest('section');
    byId('panel-history').append(historyCard);
    historyCard.querySelector('.history-header h2').textContent = 'Мои записи';
    byId('panel-stats').append(byId('analytics-card'));
    byId('panel-home').querySelector('.home-stack').remove();

    const timer = byId('timer');
    timer.setAttribute('role', 'timer');
    timer.setAttribute('aria-live', 'off');
    const progress = document.createElement('div');
    progress.className = 'timer-progress';
    progress.innerHTML = '<progress id="timer-progress" max="100" value="0" aria-label="Прогресс сессии"></progress><p id="timer-elapsed">Прошло 00:00</p>';
    timer.after(progress);
    const pause = document.createElement('button');
    pause.type = 'button'; pause.id = 'pause-session'; pause.className = 'btn btn-secondary';
    pause.textContent = 'Ⅱ Пауза'; pause.onclick = () => toggleSessionPause();
    const toolbar = document.createElement('div'); toolbar.className = 'timer-toolbar';
    const stop = document.createElement('button'); stop.type = 'button'; stop.className = 'btn btn-secondary'; stop.textContent = '■ Стоп'; stop.onclick = () => cancelActiveSession();
    toolbar.append(pause, stop); byId('warmup-controls').before(toolbar);
    const edit = document.createElement('button');
    edit.type = 'button'; edit.className = 'text-link timer-edit'; edit.dataset.openTab = 'session'; edit.textContent = 'Чаша, табак и детали ↗';
    byId('active-session').append(edit);

    const manual = byId('manual-add-modal').querySelector('.modal-content');
    const details = document.createElement('details'); details.className = 'optional-fields';
    const summary = document.createElement('summary'); summary.textContent = 'Дополнительно: время, вес, угли и заметки'; details.append(summary);
    const dateGroup = byId('manual-date-input').closest('.form-group');
    const packs = byId('manual-weight-input').closest('.pack-price-grid');
    const coalGroup = byId('manual-coals-input').closest('.form-group');
    const commentGroup = byId('manual-comment-input').closest('.form-group');
    details.append(dateGroup, packs, coalGroup, commentGroup);
    manual.querySelector('.modal-actions-row').before(details);
    byId('manual-duration-input').value = ''; byId('manual-duration-input').placeholder = 'Не указано';
    byId('manual-coals-input').value = ''; byId('manual-coals-input').placeholder = 'Не указано';
    const emptyRating = document.createElement('option'); emptyRating.value = ''; emptyRating.textContent = 'Выбери оценку';
    byId('manual-rating-select').prepend(emptyRating);

    const filters = byId('roulette-filters');
    const filterDetails = document.createElement('details'); filterDetails.className = 'roulette-options';
    filterDetails.innerHTML = '<summary>Настроить подбор <span>Бренд · крепость · вкус</span></summary>';
    filters.before(filterDetails); filterDetails.append(filters, document.querySelector('.advanced-filters'));
    const fastOption = byId('roulette-fast').closest('label');
    fastOption.lastElementChild.textContent = 'Мгновенный результат';
    filterDetails.append(fastOption);
    const intro = document.createElement('div'); intro.className = 'roulette-intro';
    intro.innerHTML = '<span class="roulette-dice" aria-hidden="true">⚄</span><h3>Твой следующий<br>любимый вкус?</h3><p>Нажми — и доверься случаю.</p>';
    document.querySelector('.roulette-stage').before(intro);
    const observeResult = new MutationObserver(() => {
        const result = byId('roulette-result');
        document.querySelector('.roulette-card').classList.toggle('has-result', !result.classList.contains('hidden'));
    });
    observeResult.observe(byId('roulette-result'), { attributes: true, attributeFilter: ['class'] });

    function renderRecent(sessions) {
        const list = byId('recent-sessions'); list.replaceChildren();
        const recent = [...sessions].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 3);
        for (const session of recent) {
            const card = document.createElement('button'); card.type = 'button'; card.className = 'recent-session';
            const mark = document.createElement('span'); mark.className = 'recent-mark'; mark.textContent = '♨';
            const first = getNormalizedMix(session)[0];
            const product = first && window.DimHookahUI?.getState().catalog.find(item => item.brand.toLowerCase() === stripRussianBrackets(first.brand).toLowerCase() && item.name === first.flavor);
            if (product?.image_url) {
                const photo = document.createElement('img'); photo.src = product.image_url; photo.alt = ''; photo.loading = 'lazy';
                photo.onerror = () => { photo.remove(); mark.textContent = '♨'; };
                mark.replaceChildren(photo);
            }
            const body = document.createElement('span');
            const name = document.createElement('strong'); name.textContent = getNormalizedMix(session).map(item => [item.brand, item.flavor].filter(Boolean).join(' · ')).join(' + ') || 'Мой покур';
            const meta = document.createElement('small'); meta.textContent = [session.date, session.smokeDuration ? formatDurationText(session.smokeDuration) : null].filter(Boolean).join(' · ');
            const rating = document.createElement('b'); rating.textContent = `★ ${session.rating || '—'}`;
            body.append(name, meta); card.append(mark, body, rating); card.onclick = () => { window.DimHookahUI.showTab('history'); openEditModal(session.id); };
            list.append(card);
        }
        if (!recent.length) { const empty = document.createElement('p'); empty.className = 'quiet-empty'; empty.textContent = 'Пока нет записей. Сохрани свой первый покур.'; list.append(empty); }
    }
    function updateTimerView() {
        const stage = getActiveStage();
        byId('resume-session').classList.toggle('hidden', !stage);
        byId('quick-preheat').classList.toggle('session-running', Boolean(stage));
        byId('quick-preheat').querySelector('strong').textContent = stage ? 'Вернуться к сессии' : 'Начать прогрев';
        byId('quick-preheat').querySelector('b').textContent = stage ? byId('timer').textContent : '07:00';
        byId('quick-preheat').querySelector('small').textContent = stage ? timerPausedAt ? 'На паузе — продолжи, когда удобно' : 'Таймер и данные сессии сохранены' : 'Одно нажатие — и всё готово';
        byId('resume-session').textContent = stage === 'smoking' ? 'Покур идёт — открыть таймер ↗' : stage === 'rating' ? 'Оцени покур и сохрани запись ↗' : 'Прогрев идёт — открыть таймер ↗';
        const pause = byId('pause-session');
        pause.classList.toggle('hidden', !['warmup', 'smoking'].includes(stage));
        pause.textContent = timerPausedAt ? '▶ Продолжить' : 'Ⅱ Пауза';
        const now = timerPausedAt || Date.now();
        const elapsed = Math.max(0, Math.floor((now - (stepStartTime || now)) / 1000));
        const duration = Math.max(1, (targetTimestamp - stepStartTime) / 1000);
        byId('timer-progress').value = stage === 'warmup' ? Math.min(100, elapsed / duration * 100) : Math.min(100, elapsed / 5400 * 100);
        byId('timer-elapsed').textContent = `${timerPausedAt ? 'На паузе · ' : ''}Прошло ${formatTimerSec(elapsed)}`;
        document.documentElement.classList.toggle('session-paused', Boolean(timerPausedAt));
    }
    function openActive() {
        updateTimerView();
        if (getActiveStage() && !window.DimHookahLaunchTarget && window.DimHookahUI?.isInitialized()) window.DimHookahUI.showTab('timer', { scroll: false });
    }
    window.addEventListener('dimhookah:history-ready', event => renderRecent(event.detail?.sessions || []));
    window.addEventListener('dimhookah:catalog-ready', () => renderRecent(window.DimHookahHistory?.sessions || []));
    window.addEventListener('dimhookah:timer-change', event => {
        updateTimerView();
        if (event.detail?.state && !event.detail.previous && window.DimHookahUI?.isInitialized()) window.DimHookahUI.showTab('timer');
        if (!event.detail?.state && window.DimHookahUI?.getState().activeTab === 'timer') window.DimHookahUI.showTab('home');
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { window.DimHookahLaunchTarget = null; openActive(); } });
    window.addEventListener('pageshow', openActive);
    document.addEventListener('DOMContentLoaded', () => {
        loadAllData(renderRecent);
        openActive();
        setInterval(updateTimerView, 1000);
    });
    window.DimHookahExperience = { openActive, renderRecent };
})();

function startQuickPreheat() {
    if (getActiveStage()) { window.DimHookahUI?.showTab('timer'); return; }
    document.getElementById('warmup-min').value = 7;
    startWarmupSession({ allowEmptyBowl: true });
    window.DimHookahUI?.showTab('timer');
}

function toggleSessionPause() {
    const stage = getActiveStage();
    if (!['warmup', 'smoking'].includes(stage)) return;
    if (!timerPausedAt) {
        timerPausedAt = Date.now();
        stopTimerTicker(); stopKeepAliveAudio(); clearSessionAlertTimers();
    } else {
        const pausedFor = Date.now() - timerPausedAt;
        stepStartTime += pausedFor;
        if (stage === 'warmup') targetTimestamp += pausedFor;
        timerPausedAt = null;
        startTimerTicker(stage === 'warmup' ? updateWarmupTimer : updateSmokingTimer);
        if (stage === 'warmup') scheduleWarmupAlert(); else scheduleSmokingAlerts();
    }
    saveActiveSessionState(stage);
    if (stage === 'warmup') updateWarmupTimer(); else updateSmokingTimer();
}
