import { buildPushPayload } from '@block65/webcrypto-web-push';

const reply = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const MAX_HISTORY = 2000;
const MAX_EVENTS = 200;
export class SessionService {
    constructor(ctx, env) {
        this.storage = ctx.storage;
        this.env = env;
        this.queue = Promise.resolve();
    }
    serialize(operation) {
        const result = this.queue.then(operation);
        this.queue = result.catch(() => {});
        return result;
    }
    fetch(request) { return this.serialize(() => this.handle(request)); }
    async handle(request) {
        const path = new URL(request.url).pathname;
        if (path === '/v1/state' && request.method === 'GET') return reply({
            timer: await this.storage.get('timer') || null,
            history: await this.storage.get('history') || [],
            events: await this.storage.get('events') || [], serverTime: Date.now(),
            pushAvailable: Boolean(this.env.VAPID_PUBLIC_KEY && this.env.VAPID_PRIVATE_KEY),
            publicKey: this.env.VAPID_PUBLIC_KEY || ''
        });
        if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
        const text = await request.text();
        if (text.length > 1024 * 1024) return reply({ error: 'Request too large' }, 413);
        let body;
        try { body = JSON.parse(text); } catch { return reply({ error: 'Invalid JSON' }, 400); }
        if (path === '/v1/timer') {
            const previous = await this.storage.get('timer');
            if (body.operationId && previous?.operationId === body.operationId) return reply(previous);
            if ((body.baseRevision || 0) !== (previous?.revision || 0)) return reply({ error: 'Timer changed on another device', timer: previous }, 409);
            const state = body.state;
            if (state !== null && (!state || !['warmup', 'smoking', 'rating'].includes(state.stage) || !Number.isFinite(state.stepStartTime) || !Number.isFinite(state.targetTimestamp) || state.targetTimestamp < 0 || !Number.isFinite(state.actualWarmupDuration || 0) || !Number.isFinite(state.smokeDuration || 0) || JSON.stringify(state).length > 32768)) return reply({ error: 'Invalid timer' }, 400);
            const timer = { state, revision: (previous?.revision || 0) + 1, updatedAt: Date.now(), operationId: String(body.operationId || '').slice(0, 100) };
            await this.storage.put('timer', timer);
            // Legacy Siri status is intentionally restricted to non-personal timing fields.
            await this.storage.put('preheat', state?.stage === 'warmup' && !state.pausedAt ? { startedAt: state.stepStartTime, duration: Math.max(0, (state.targetTimestamp - state.stepStartTime) / 1000) } : null);
            await this.event(state ? state.pausedAt ? 'paused' : state.stage : 'stopped', timer.revision);
            await this.schedule(state);
            return reply(timer);
        }
        if (path === '/v1/history') {
            if (!Array.isArray(body.operations) || body.operations.length > 100) return reply({ error: 'Invalid operations' }, 400);
            const history = await this.storage.get('history') || [];
            const byId = new Map(history.map(entry => [String(entry.id), entry]));
            const receipts = await this.storage.get('receipts') || [];
            for (const operation of body.operations) {
                if (!operation.operationId || receipts.includes(operation.operationId)) continue;
                if (!Number.isSafeInteger(operation.id) || (!operation.deleted && (!operation.session || operation.session.id !== operation.id || !Array.isArray(operation.session.mix) || operation.session.mix.length > 30 || JSON.stringify(operation.session).length > 16384))) return reply({ error: 'Invalid session' }, 400);
                byId.set(String(operation.id), { id: operation.id, session: operation.deleted ? null : operation.session, deleted: Boolean(operation.deleted), updatedAt: Date.now() });
                receipts.push(String(operation.operationId).slice(0, 100));
            }
            if (byId.size > MAX_HISTORY) return reply({ error: 'History limit reached. Export a local backup.' }, 409);
            const next = [...byId.values()];
            await this.storage.put({ history: next, receipts: receipts.slice(-500) });
            return reply({ history: next });
        }
        if (path === '/v1/push') {
            const subscription = body.subscription;
            let endpoint;
            try { endpoint = new URL(subscription?.endpoint); } catch { return reply({ error: 'Invalid subscription' }, 400); }
            // Do not allow authenticated endpoints to become an arbitrary HTTP proxy.
            const allowed = endpoint.protocol === 'https:' && (endpoint.hostname === 'fcm.googleapis.com' || endpoint.hostname.endsWith('.push.services.mozilla.com') || endpoint.hostname === 'updates.push.services.mozilla.com' || endpoint.hostname === 'web.push.apple.com' || endpoint.hostname.endsWith('.notify.windows.com'));
            if (!allowed || !/^[A-Za-z0-9_-]{80,100}$/.test(subscription.keys?.p256dh || '') || !/^[A-Za-z0-9_-]{20,30}$/.test(subscription.keys?.auth || '')) return reply({ error: 'Unsupported push subscription' }, 400);
            const subscriptions = await this.storage.get('subscriptions') || [];
            const next = subscriptions.filter(item => item.endpoint !== subscription.endpoint);
            if (!body.remove) next.push(subscription);
            if (next.length > 10) return reply({ error: 'Too many devices' }, 409);
            await this.storage.put('subscriptions', next);
            return reply({ subscribed: !body.remove });
        }
        return reply({ error: 'Not found' }, 404);
    }
    async event(type, revision) {
        const events = await this.storage.get('events') || [];
        events.push({ type, revision, at: Date.now() });
        await this.storage.put('events', events.slice(-MAX_EVENTS));
    }
    async schedule(state) {
        let at = null;
        if (state && !state.pausedAt) {
            if (state.stage === 'warmup' && !state.alarmAlreadyPlayed && state.targetTimestamp > Date.now()) at = state.targetTimestamp;
            if (state.stage === 'smoking') at = [3600, 5400].map(seconds => state.stepStartTime + seconds * 1000).find(time => time > Date.now());
        }
        if (at) await this.storage.setAlarm(at); else await this.storage.deleteAlarm();
    }
    alarm() { return this.serialize(async () => {
        const timer = await this.storage.get('timer');
        const state = timer?.state;
        if (!state || state.pausedAt || !['warmup', 'smoking'].includes(state.stage)) return;
        const elapsed = Math.floor((Date.now() - state.stepStartTime) / 1000);
        const type = state.stage === 'warmup' ? 'warmup-ready' : elapsed >= 5400 ? 'smoking-90' : 'smoking-60';
        const key = `${timer.revision}:${type}`;
        if (await this.storage.get(`delivered:${key}`)) return;
        const subscriptions = await this.storage.get('subscriptions') || [];
        const keep = [];
        for (const subscription of subscriptions) {
            if (this.env.VAPID_PUBLIC_KEY && this.env.VAPID_PRIVATE_KEY) {
                const data = JSON.stringify({ title: type === 'warmup-ready' ? 'Чаша прогрелась' : 'Покур продолжается', body: type === 'warmup-ready' ? 'Можно начинать. Открой DimHookah.' : 'Проверь сессию и не забудь остановить таймер.', tag: key, url: '#timer' });
                const payload = await buildPushPayload({ data, options: { ttl: 300 } }, subscription, { subject: this.env.VAPID_SUBJECT || 'https://example.com', publicKey: this.env.VAPID_PUBLIC_KEY, privateKey: this.env.VAPID_PRIVATE_KEY });
                const result = await fetch(subscription.endpoint, { ...payload, redirect: 'error' });
                if (result.status === 404 || result.status === 410) continue;
                if (!result.ok) throw new Error('Push delivery failed');
            }
            keep.push(subscription);
        }
        await this.storage.put('subscriptions', keep);
        await this.storage.put(`delivered:${key}`, true);
        // Delivery receipts are bounded alongside the event journal.
        const receipts = await this.storage.list({ prefix: 'delivered:' });
        if (receipts.size > MAX_EVENTS) await this.storage.delete([...receipts.keys()].slice(0, receipts.size - MAX_EVENTS));
        await this.event(type, timer.revision);
        await this.schedule(type === 'warmup-ready' ? { ...state, alarmAlreadyPlayed: true } : state);
    }); }
}
