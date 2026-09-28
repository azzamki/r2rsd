/**
 * Diagnostic: figure out WHY so few proxies pass validation.
 * Samples proxies from the running pool and classifies failure reasons.
 * Writes results to data/_diag.json (console.log is not captured reliably).
 */
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const path = require('path');
const fs = require('fs');

const CHECK_HTTPS = 'https://api.ipify.org?format=json';
const CHECK_HTTP = 'http://httpbin.org/ip';

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function tryFetch(url, proxy, timeout) {
  const agent = new HttpsProxyAgent(`http://${proxy}`, { timeout });
  const start = Date.now();
  try {
    const res = await axios.get(url, {
      httpsAgent: agent,
      httpAgent: agent,
      proxy: false,
      timeout,
      signal: AbortSignal.timeout(timeout),
      validateStatus: () => true,
    });
    const latency = Date.now() - start;
    const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    const ip = (res.data?.ip || res.data?.origin || '').toString();
    return { ok: true, latency, ip, status: res.status, body: body.slice(0, 120) };
  } catch (e) {
    return { ok: false, latency: Date.now() - start, err: e.code || e.message };
  }
}

(async () => {
  // Pull the live proxy list from the running server
  const list = await axios.get('http://localhost:3000/api/proxy/list', { timeout: 10000 });
  const working = (list.data?.working || []).map(w => w.proxy);
  const all = working; // endpoint only exposes working proxies

  const sample = shuffle(all).slice(0, 60);
  console.log(`pool: ${all.length} total, ${working.length} working | sampling ${sample.length}`);

  const results = [];
  for (const p of sample) {
    const https = await tryFetch(CHECK_HTTPS, p, 6000);
    const http = https.ok ? null : await tryFetch(CHECK_HTTP, p, 6000);
    results.push({
      proxy: p,
      https: https.ok ? `OK ${https.latency}ms ip=${https.ip}` : `FAIL ${https.err}`,
      http: http ? (http.ok ? `OK ${http.latency}ms ip=${http.ip}` : `FAIL ${http.err}`) : 'skip',
      ipMatch: https.ok ? (https.ip === p.split(':')[0] ? 'match' : `MISMATCH(${https.ip})`) : '-',
    });
  }

  // Tally
  const tally = {};
  for (const r of results) {
    const key = r.https.startsWith('OK')
      ? (r.ipMatch === 'match' ? 'PASS+ipMatch' : 'PASS+ipMismatch')
      : `https:${r.https.split(' ')[1]}`;
    tally[key] = (tally[key] || 0) + 1;
  }

  const out = {
    at: new Date().toISOString(),
    poolTotal: all.length,
    poolWorking: working.length,
    sample: results.length,
    tally,
    rows: results,
  };

  fs.mkdirSync(path.resolve(__dirname, '../../data'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, '../../data/_diag.json'), JSON.stringify(out, null, 2));
  console.log('wrote data/_diag.json');
  console.log(JSON.stringify(tally, null, 2));
})().catch(e => { console.error('DIAG FAILED:', e.message); process.exit(1); });
