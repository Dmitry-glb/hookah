// One-time provisioning. Secrets are stored locally in an ignored file, never in public JS.
import { createECDH, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const origin = new URL(process.argv[2] || 'https://dmitry-glb.github.io').origin;
if (new URL(origin).protocol !== 'https:') throw new Error('A deployed HTTPS app origin is required');
let existing = '';
try { existing = await readFile(new URL('.dev.vars', import.meta.url), 'utf8'); } catch {}
const vars = Object.fromEntries(existing.split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line)).map(line => { const i = line.indexOf('='); let value = line.slice(i + 1); try { value = JSON.parse(value); } catch {} return [line.slice(0, i), value]; }));
if (!vars.PREHEAT_TOKEN || vars.PREHEAT_TOKEN.length < 32) vars.PREHEAT_TOKEN = randomBytes(32).toString('base64url');
if (!vars.VAPID_PUBLIC_KEY || !vars.VAPID_PRIVATE_KEY) {
    const key = createECDH('prime256v1'); key.generateKeys();
    vars.VAPID_PUBLIC_KEY = key.getPublicKey().toString('base64url');
    vars.VAPID_PRIVATE_KEY = key.getPrivateKey().toString('base64url');
}
vars.VAPID_SUBJECT = origin;
await writeFile(new URL('.dev.vars', import.meta.url), Object.entries(vars).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
function command(args, input) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [wrangler, ...args, '--config', 'worker/wrangler.jsonc'], { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        let output = '';
        child.stdout.on('data', data => { output += data; process.stdout.write(data); });
        child.stderr.on('data', data => process.stderr.write(data));
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve(output) : reject(new Error(`Wrangler exited with ${code}`)));
        child.stdin.end(input || '');
    });
}
const output = await command(['deploy', '--var', `ALLOWED_ORIGIN:${origin},http://127.0.0.1:4173,http://localhost:4173`]);
const wranglerFile = new URL('wrangler.jsonc', import.meta.url);
const wranglerConfig = await readFile(wranglerFile, 'utf8');
await writeFile(wranglerFile, wranglerConfig.replace(/"ALLOWED_ORIGIN":\s*"[^"]*"/, `"ALLOWED_ORIGIN": ${JSON.stringify(`${origin},http://127.0.0.1:4173,http://localhost:4173`)}`));
await command(['secret', 'bulk'], JSON.stringify(vars));
const endpoint = output.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i)?.[0];
if (!endpoint) throw new Error('Worker deployed, but URL was not found in Wrangler output');
const configFile = new URL('../lib/preheat-config.js', import.meta.url);
let config = await readFile(configFile, 'utf8');
if (config.includes('cloudApiBaseUrl:')) config = config.replace(/cloudApiBaseUrl:\s*'[^']*'/, `cloudApiBaseUrl: '${endpoint}'`);
else config = config.replace('defaultDurationSeconds:', `cloudApiBaseUrl: '${endpoint}',\n        defaultDurationSeconds:`);
await writeFile(configFile, config);
await writeFile(new URL('../debug/cloud-deployment.json', import.meta.url), JSON.stringify({ endpoint, origin, deployedAt: new Date().toISOString(), secretsFile: 'worker/.dev.vars' }, null, 2));
const response = await fetch(endpoint + '/v1/state', { headers: { Authorization: `Bearer ${vars.PREHEAT_TOKEN}` } });
if (!response.ok) throw new Error(`Worker deployed, authenticated health check returned ${response.status}`);
console.log(`Ready: ${endpoint}. Access key is in worker/.dev.vars (PREHEAT_TOKEN).`);
