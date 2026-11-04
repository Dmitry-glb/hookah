import config from '../lib/preheat-config.js';
import { SessionService } from './session-service.mjs';

const STATE_KEY = 'preheat';
const json = (body, status = 200, headers = {}) => Response.json(body, {
    status, headers: { 'Cache-Control': 'no-store', ...headers }
});

export function statusOf(state, now = Date.now()) {
    const startedAt = state?.startedAt ?? null;
    const duration = state?.duration ?? 0;
    const remainingSeconds = startedAt === null ? 0
        : Math.max(0, Math.ceil((startedAt + duration * 1000 - now) / 1000));
    return { active: remainingSeconds > 0, startedAt, duration, remainingSeconds };
}

// One coordinator serializes writes. Production uses SQLite-backed DO storage;
// the KV adapter remains for compatibility with legacy deployments/tests.
export class PreheatCoordinator {
    constructor(ctx, env) {
        this.env = env;
        this.service = ctx.storage ? new SessionService(ctx, env) : null;
        this.state = null;
        this.ready = ctx.blockConcurrencyWhile(async () => {
            this.state = this.service ? await ctx.storage.get(STATE_KEY) : await env.PREHEAT_KV.get(STATE_KEY, 'json');
            if (this.service && !this.state && env.PREHEAT_KV) {
                this.state = await env.PREHEAT_KV.get(STATE_KEY, 'json');
                if (this.state) await ctx.storage.put(STATE_KEY, this.state);
            }
        });
        this.queue = Promise.resolve();
    }

    fetch(request) {
        if (this.service) {
            if (new URL(request.url).pathname.startsWith('/v1/')) return this.service.fetch(request);
            return this.service.serialize(async () => {
                await this.ready;
                const timer = await this.service.storage.get('timer');
                let state = await this.service.storage.get(STATE_KEY);
                const canStart = !timer?.state || timer.state.stage === 'rating' || (timer.state.stage === 'warmup' && !timer.state.pausedAt && timer.state.targetTimestamp <= Date.now());
                if (request.method === 'POST' && !statusOf(state).active && canStart) {
                    const now = Date.now();
                    const next = { stage: 'warmup', stepStartTime: now, targetTimestamp: now + config.defaultDurationSeconds * 1000, actualWarmupDuration: 0, smokeDuration: 0, activeCoalsUsed: 0, alarmAlreadyPlayed: false, bowl: '', mix: [] };
                    await this.service.handle(new Request('https://internal/v1/timer', { method: 'POST', body: JSON.stringify({ state: next, baseRevision: timer?.revision || 0, operationId: crypto.randomUUID() }) }));
                    state = await this.service.storage.get(STATE_KEY);
                }
                return json(statusOf(state));
            });
        }
        const operation = this.queue.then(async () => {
            await this.ready;
            if (request.method === 'POST' && !statusOf(this.state).active) {
                const next = { startedAt: Date.now(), duration: config.defaultDurationSeconds };
                await this.env.PREHEAT_KV.put(STATE_KEY, JSON.stringify(next));
                this.state = next;
            }
            return json(statusOf(this.state));
        });
        this.queue = operation.catch(() => {});
        return operation;
    }
    alarm() { return this.service?.alarm(); }
}

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin');
        const allowedOrigin = env.ALLOWED_ORIGIN;
        const headers = { Vary: 'Origin' };
        const allowed = (allowedOrigin || '').split(',').map(value => value.trim());
        if (origin && !allowed.includes(origin)) return json({ error: 'Origin denied' }, 403, headers);
        if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;

        const path = new URL(request.url).pathname;
        const method = path === '/preheat/start' ? 'POST' : path === '/preheat/status' ? 'GET' : path === '/v1/state' ? 'GET' : ['/v1/timer', '/v1/history', '/v1/push'].includes(path) ? 'POST' : null;
        if (!method) return json({ error: 'Not found' }, 404, headers);
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: {
                ...headers, 'Access-Control-Allow-Methods': method,
                'Access-Control-Allow-Headers': 'Authorization, Content-Type',
                'Cache-Control': 'no-store'
            } });
        }
        if (request.method !== method) return json({ error: 'Method not allowed' }, 405, { ...headers, Allow: method });
        if (method === 'POST' || path.startsWith('/v1/')) {
            if (!env.PREHEAT_TOKEN) return json({ error: 'Server not configured' }, 503, headers);
            if (request.headers.get('Authorization') !== `Bearer ${env.PREHEAT_TOKEN}`) {
                return json({ error: 'Unauthorized' }, 401, headers);
            }
        }
        try {
            const id = env.PREHEAT_COORDINATOR.idFromName('dimhookah');
            const response = await env.PREHEAT_COORDINATOR.get(id).fetch(request);
            return new Response(response.body, { status: response.status, headers: {
                ...Object.fromEntries(response.headers), ...headers
            } });
        } catch {
            return json({ error: 'Preheat storage unavailable' }, 503, headers);
        }
    }
};
