'use strict';
(function () {
    const KEY = 'hookah_cloud_v1';
    const QUEUE = 'hookah_cloud_queue_v1';
    const byId = id => document.getElementById(id);
    const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } };
    let config = read(KEY, {});
    let pending = read(QUEUE, { history: [] });
    let revision = Number(config.revision) || 0;
    let applying = false, working = null, remoteTimer = null;
    const status = message => { byId('cloud-status').textContent = message; };
    const persistQueue = () => localStorage.setItem(QUEUE, JSON.stringify(pending));
    const connected = () => Boolean(config.url && config.token);
    const api = async (path, body) => {
        const response = await fetch(config.url + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${config.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(8000) });
        const result = await response.json();
        if (!response.ok) { const error = new Error(result.error || `Ошибка сервера ${response.status}`); error.status = response.status; error.result = result; throw error; }
        return result;
    };
    function queueHistory(sessions, previous = []) {
        if (applying || !config.history || !connected()) return;
        const before = new Map(previous.map(session => [session.id, session]));
        const after = new Map(sessions.map(session => [session.id, session]));
        for (const id of new Set([...before.keys(), ...after.keys()])) {
            if (JSON.stringify(before.get(id)) === JSON.stringify(after.get(id))) continue;
            pending.history = pending.history.filter(operation => operation.id !== id);
            pending.history.push({ id, session: after.get(id) || null, deleted: !after.has(id), operationId: crypto.randomUUID() });
        }
        persistQueue();
    }
    function importTimer(timer) {
        if (!timer) return;
        applying = true;
        if (timer.state) {
            localStorage.setItem('hookah_active_session', JSON.stringify(timer.state));
            restoreActiveSessionIfAny();
            window.DimHookahExperience.openActive();
        } else {
            const wasActive = Boolean(getActiveStage());
            stopTimerTicker(); stopKeepAliveAudio(); clearSessionAlertTimers(); clearActiveSessionState();
            byId('active-session').classList.add('hidden'); setStartButtonActive(false);
            if (wasActive) window.DimHookahUI.showTab('home');
        }
        applying = false;
        revision = timer.revision;
        config.revision = revision;
        localStorage.setItem(KEY, JSON.stringify(config));
    }
    async function mergeHistory(records) {
        if (!config.history) return;
        const dirty = new Set(pending.history.map(operation => operation.id));
        const local = await new Promise(resolve => loadAllData(resolve));
        const merged = new Map(local.map(session => [session.id, session]));
        const known = new Set(config.knownHistory || []);
        for (const entry of records) {
            if (dirty.has(entry.id)) continue;
            if (entry.deleted) { if (known.has(entry.id)) merged.delete(entry.id); }
            else if (!merged.has(entry.id) || known.has(entry.id)) merged.set(entry.id, entry.session);
            known.add(entry.id);
        }
        const next = [...merged.values()];
        if (JSON.stringify(next) !== JSON.stringify(local)) {
            applying = true;
            await new Promise(resolve => saveSessionsToStorage(next, resolve));
            renderData(next); applying = false;
        }
        config.knownHistory = [...known];
    }
    async function sync() {
        if (!connected() || document.visibilityState === 'hidden') return;
        if (working) return working;
        working = (async () => {
            try {
                status('Синхронизация…');
                if (pending.timer) {
                    try {
                        const sent = pending.timer;
                        const timer = await api('/v1/timer', sent); revision = timer.revision;
                        if (pending.timer?.operationId === sent.operationId) delete pending.timer;
                        else if (pending.timer) pending.timer.baseRevision = revision;
                        persistQueue();
                    }
                    catch (error) {
                        if (error.status !== 409) throw error;
                        remoteTimer = error.result.timer;
                        status('Таймер изменён на другом устройстве. Локальная сессия сохранена.');
                        byId('cloud-adopt').classList.remove('hidden');
                        return;
                    }
                }
                while (pending.history.length && config.history) {
                    const batch = pending.history.slice(0, 100);
                    await api('/v1/history', { operations: batch });
                    const ids = new Set(batch.map(operation => operation.operationId));
                    pending.history = pending.history.filter(operation => !ids.has(operation.operationId)); persistQueue();
                }
                const server = await api('/v1/state');
                remoteTimer = server.timer;
                if (server.timer && server.timer.revision !== revision) {
                    if (!getActiveStage()) importTimer(server.timer);
                    else if (revision === 0 && !server.timer.state) {
                        // First connection to an idle server must keep an existing local timer.
                        revision = server.timer.revision;
                    } else {
                        status('Есть серверный таймер. Выбери, какую сессию продолжить.');
                        byId('cloud-adopt').classList.remove('hidden');
                        return;
                    }
                }
                revision = server.timer?.revision || 0;
                await mergeHistory(server.history);
                config.publicKey = server.publicKey;
                config.revision = revision;
                localStorage.setItem(KEY, JSON.stringify(config));
                byId('cloud-events').replaceChildren(...server.events.slice(-12).reverse().map(event => {
                    const item = document.createElement('li');
                    const labels = { warmup: 'Прогрев', smoking: 'Покур', rating: 'Оценка', paused: 'Пауза', stopped: 'Остановка', 'warmup-ready': 'Чаша прогрелась', 'smoking-60': 'Покур: 1 час', 'smoking-90': 'Покур: 1,5 часа' };
                    item.textContent = `${new Date(event.at).toLocaleString('ru-RU')} · ${labels[event.type] || event.type}`; return item;
                }));
                status(`Подключено · ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}${server.pushAvailable ? '' : ' · Серверные push ещё не настроены'}`);
                if (pending.timer) setTimeout(sync, 0);
            } catch (error) { status(`${error.message}. Локальные данные и очередь сохранены.`); }
        })().finally(() => { working = null; });
        return working;
    }
    window.addEventListener('dimhookah:timer-change', event => {
        if (applying || !connected()) return;
        pending.timer = { state: event.detail.state, baseRevision: revision, operationId: crypto.randomUUID() };
        persistQueue(); sync();
    });
    window.addEventListener('dimhookah:history-write', event => {
        queueHistory(event.detail.sessions, event.detail.previous);
        // Let localStorage/IndexedDB finish before reading back the local history.
        setTimeout(sync, 0);
    });
    window.addEventListener('online', sync);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
    byId('cloud-url').value = config.url || window.DimHookahPreheatConfig?.cloudApiBaseUrl || window.DimHookahPreheatConfig?.apiBaseUrl || '';
    byId('cloud-token').value = config.token || '';
    byId('cloud-history').checked = Boolean(config.history);
    byId('cloud-connect').onclick = async () => {
        let url;
        try { url = new URL(byId('cloud-url').value.trim()); if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error(); }
        catch { status('Введи HTTPS-адрес своего Worker.'); return; }
        const token = byId('cloud-token').value.trim();
        if (!token) { status('Введи ключ доступа к своему серверу.'); return; }
        const changed = config.url !== url.origin || config.token !== token;
        if (changed) { pending = { history: [] }; revision = 0; config = {}; persistQueue(); }
        config = { ...config, url: url.origin, token, history: byId('cloud-history').checked };
        localStorage.setItem(KEY, JSON.stringify(config));
        if (config.history) {
            const sessions = await new Promise(resolve => loadAllData(resolve));
            queueHistory(sessions);
        }
        await sync();
        if (!remoteTimer?.state && getActiveStage()) {
            pending.timer = { state: read('hookah_active_session', null), baseRevision: revision, operationId: crypto.randomUUID() }; persistQueue(); await sync();
        }
    };
    byId('cloud-disconnect').onclick = async () => {
        // Remove this device's subscription before forgetting its credentials.
        try { const registration = await navigator.serviceWorker?.getRegistration(); const subscription = await registration?.pushManager?.getSubscription(); if (subscription) { try { await api('/v1/push', { subscription, remove: true }); } finally { await subscription.unsubscribe(); } } }
        catch { status('Сервер недоступен. Разрешение уведомлений можно отключить в настройках браузера.'); }
        config = {}; pending = { history: [] }; revision = 0;
        remoteTimer = null; byId('cloud-adopt').classList.add('hidden');
        localStorage.removeItem(KEY); persistQueue(); byId('cloud-token').value = ''; status('Локальный режим');
    };
    byId('cloud-adopt').onclick = () => {
        if (!remoteTimer) return;
        delete pending.timer; persistQueue(); importTimer(remoteTimer);
        byId('cloud-adopt').classList.add('hidden'); sync();
    };
    byId('cloud-push').onclick = async () => {
        if (!connected()) { status('Сначала подключи свой Worker.'); return; }
        if (!('PushManager' in window) || !('Notification' in window)) { status('Этот браузер не поддерживает Web Push. На iPhone добавь приложение на экран «Домой».'); return; }
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') { status('Уведомления не разрешены.'); return; }
        try {
            const server = await api('/v1/state');
            if (!server.publicKey || !server.pushAvailable) { status('Добавь VAPID-ключи в секреты Worker по инструкции проекта.'); return; }
            const registration = await navigator.serviceWorker.ready;
            const key = Uint8Array.from(atob(server.publicKey.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0));
            const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
            await api('/v1/push', { subscription });
            config.pushEnabled = true;
            localStorage.setItem(KEY, JSON.stringify(config));
            status('Фоновые уведомления подключены на этом устройстве.');
        } catch (error) { status(`Не удалось включить уведомления: ${error.message}`); }
    };
    window.DimHookahCloud = { sync, isConnected: connected, usesPush: () => connected() && config.pushEnabled && !pending.timer && 'Notification' in window && Notification.permission === 'granted' };
    document.addEventListener('DOMContentLoaded', () => initialHistoryReady.then(sync));
})();
