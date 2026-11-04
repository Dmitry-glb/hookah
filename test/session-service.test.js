'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
async function fixture() {
    const { SessionService } = await import('../worker/session-service.mjs');
    const data = new Map(); let alarm = null;
    const storage = {
        async get(key) { return structuredClone(data.get(key)); },
        async put(key, value) { if (typeof key === 'object') for (const [k,v] of Object.entries(key)) data.set(k,structuredClone(v)); else data.set(key,structuredClone(value)); },
        async delete(key) { for (const item of Array.isArray(key) ? key : [key]) data.delete(item); },
        async list({prefix}) { return new Map([...data].filter(([key])=>key.startsWith(prefix))); },
        async setAlarm(at) { alarm=at; }, async deleteAlarm() { alarm=null; }
    };
    const service = new SessionService({storage},{});
    const call = (path,body) => service.fetch(new Request('https://test'+path,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{body:JSON.stringify(body)})}));
    return { service,storage,data,call,alarm:()=>alarm };
}
test('cloud timer: absolute deadlines, pause, resume, conflict and durable restart', async()=>{
    const f=await fixture(); const now=Date.now();
    const state={stage:'warmup',stepStartTime:now,targetTimestamp:now+420000,actualWarmupDuration:0,smokeDuration:0};
    const first=await(await f.call('/v1/timer',{state,baseRevision:0,operationId:'start'})).json();
    assert.equal(first.revision,1);assert.equal(f.alarm(),state.targetTimestamp);
    assert.equal((await(await f.call('/v1/timer',{state,baseRevision:0,operationId:'start'})).json()).revision,1);
    assert.equal((await f.call('/v1/timer',{state,baseRevision:0,operationId:'old'})).status,409);
    await f.call('/v1/timer',{state:{...state,pausedAt:now+10000},baseRevision:1,operationId:'pause'});
    assert.equal(f.alarm(),null);
    const { SessionService }=await import('../worker/session-service.mjs');
    const restarted=new SessionService({storage:f.storage},{});
    assert.equal((await(await restarted.fetch(new Request('https://test/v1/state'))).json()).timer.state.pausedAt,now+10000);
    const resumed={...state,stepStartTime:now+20000,targetTimestamp:now+440000};
    await f.call('/v1/timer',{state:resumed,baseRevision:2,operationId:'resume'});assert.equal(f.alarm(),resumed.targetTimestamp);
    await f.call('/v1/timer',{state:null,baseRevision:3,operationId:'stop'});assert.equal(f.alarm(),null);
    assert.equal((await(await f.call('/v1/state')).json()).events.length,4);
});
test('cloud history: idempotent edits and tombstones do not expose data publicly',async()=>{
    const f=await fixture();const session={id:100,mix:[{brand:'Brand',flavor:'Taste',weight:0}],rating:4,smokeDuration:0};
    await f.call('/v1/history',{operations:[{id:100,session,operationId:'save'}]});
    await f.call('/v1/history',{operations:[{id:100,deleted:true,operationId:'delete'}]});
    await f.call('/v1/history',{operations:[{id:100,session,operationId:'save'}]});
    const data=await(await f.call('/v1/state')).json();assert.equal(data.history.length,1);assert.equal(data.history[0].deleted,true);
    const {default:worker}=await import('../worker/index.mjs');
    assert.equal((await worker.fetch(new Request('https://test/v1/state'),{PREHEAT_TOKEN:'secret'})).status,401);
    assert.equal((await f.call('/v1/history',{operations:[{id:100,session:{},operationId:'invalid'}]})).status,400);
});
test('cloud alarms: one event per revision, bounded receipts and SSRF protection',async()=>{
    const f=await fixture();const now=Date.now();
    await f.call('/v1/timer',{state:{stage:'warmup',stepStartTime:now-421000,targetTimestamp:now-1000},baseRevision:0,operationId:'ready'});
    await f.service.alarm();await f.service.alarm();
    assert.equal((await(await f.call('/v1/state')).json()).events.filter(event=>event.type==='warmup-ready').length,1);
    assert.equal(f.alarm(),null);
    assert.equal((await f.call('/v1/push',{subscription:{endpoint:'https://127.0.0.1/private',keys:{auth:'a'.repeat(22),p256dh:'a'.repeat(87)}}})).status,400);
});

test('web push: encrypted VAPID request is built and expired subscriptions are removed', async t => {
    const { createECDH, randomBytes } = require('node:crypto');
    const vapid = createECDH('prime256v1'); vapid.generateKeys();
    const client = createECDH('prime256v1'); client.generateKeys();
    const f = await fixture();
    Object.assign(f.service.env, { VAPID_PUBLIC_KEY: vapid.getPublicKey().toString('base64url'), VAPID_PRIVATE_KEY: vapid.getPrivateKey().toString('base64url'), VAPID_SUBJECT: 'https://example.test' });
    const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys: { p256dh: client.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
    assert.equal((await f.call('/v1/push', { subscription })).status, 200);
    let sent = null;
    t.mock.method(globalThis, 'fetch', async (url, options) => { sent = { url, options }; return new Response('', { status: 410 }); });
    const now = Date.now();
    await f.call('/v1/timer', { state: { stage: 'warmup', stepStartTime: now - 421000, targetTimestamp: now - 1000 }, baseRevision: 0, operationId: 'push-ready' });
    await f.service.alarm();
    assert.equal(sent.options.method.toUpperCase(), 'POST');
    assert.match(sent.options.headers.authorization, /^vapid /);
    assert.equal(sent.options.headers['content-encoding'], 'aes128gcm');
    assert.equal(sent.options.body.length, 4096);
    assert.equal((await f.storage.get('subscriptions')).length, 0);
});
