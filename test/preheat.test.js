'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../lib/preheat-config');

async function fixture() {
    const { default: worker, PreheatCoordinator } = await import('../worker/index.mjs');
    const data = new Map();
    let writes = 0;
    const env = {
        PREHEAT_TOKEN: 'test-secret', ALLOWED_ORIGIN: 'https://dmitry-glb.github.io',
        PREHEAT_KV: {
            async get(key) { return data.has(key) ? JSON.parse(data.get(key)) : null; },
            async put(key, value) { writes++; await new Promise(resolve => setTimeout(resolve, 5)); data.set(key, value); }
        }
    };
    const object = new PreheatCoordinator({ blockConcurrencyWhile: fn => fn() }, env);
    env.PREHEAT_COORDINATOR = { idFromName: () => 'one', get: () => object };
    const call = (path, method = 'GET', headers = {}) => worker.fetch(new Request(`https://worker.test${path}`, { method, headers }), env);
    return { call, data, env, writes: () => writes };
}

test('preheat API: empty, authenticated start, idempotent concurrent starts, persisted status', async () => {
    const { call, writes, data } = await fixture();
    assert.deepEqual(await (await call('/preheat/status')).json(), {
        active: false, startedAt: null, duration: 0, remainingSeconds: 0
    });
    assert.equal((await call('/preheat/start', 'POST')).status, 401);
    assert.equal((await call('/preheat/start', 'POST', { Authorization: 'Bearer wrong' })).status, 401);
    assert.equal(writes(), 0);
    const results = await Promise.all(Array.from({ length: 10 }, async () =>
        (await call('/preheat/start', 'POST', { Authorization: 'Bearer test-secret' })).json()));
    assert.equal(writes(), 1);
    assert.equal(new Set(results.map(value => value.startedAt)).size, 1);
    assert.equal(results[0].duration, config.defaultDurationSeconds);
    assert.equal(results[0].active, true);
    assert.equal(results[0].remainingSeconds, 420);
    assert.deepEqual(JSON.parse(data.get('preheat')), {
        startedAt: results[0].startedAt, duration: 420
    });
    assert.equal((await (await call('/preheat/status')).json()).startedAt, results[0].startedAt);
});

test('preheat API: expiry, CORS, routing and storage errors', async () => {
    const { statusOf, PreheatCoordinator } = await import('../worker/index.mjs');
    assert.deepEqual(statusOf({ startedAt: 1000, duration: 420 }, 421000), {
        active: false, startedAt: 1000, duration: 420, remainingSeconds: 0
    });
    assert.equal(statusOf({ startedAt: 1000, duration: 420 }, 2401).remainingSeconds, 419);
    const { call, env, data } = await fixture();
    const allowed = { Origin: env.ALLOWED_ORIGIN };
    const response = await call('/preheat/status', 'GET', allowed);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), env.ALLOWED_ORIGIN);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const denied = await call('/preheat/status', 'GET', { Origin: 'https://evil.test' });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal((await call('/preheat/start', 'OPTIONS', allowed)).status, 204);
    assert.equal((await call('/missing')).status, 404);
    assert.equal((await call('/preheat/start')).status, 405);
    data.set('preheat', JSON.stringify({ startedAt: 1000, duration: 420 }));
    const object = new PreheatCoordinator({ blockConcurrencyWhile: fn => fn() }, env);
    env.PREHEAT_COORDINATOR.get = () => object;
    const renewed = await (await call('/preheat/start', 'POST', { Authorization: 'Bearer test-secret' })).json();
    assert.equal(renewed.active, true);
    assert.ok(renewed.startedAt > 1000);
    env.PREHEAT_KV.put = async () => { throw new Error('offline'); };
    object.state = null;
    assert.equal((await call('/preheat/start', 'POST', { Authorization: 'Bearer test-secret' })).status, 503);
    assert.equal((await call('/preheat/status')).status, 200, 'queue recovers after failed write');
    delete env.PREHEAT_TOKEN;
    assert.equal((await call('/preheat/start', 'POST')).status, 503);
});
