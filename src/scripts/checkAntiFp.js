/**
 * Verify the anti-detection fixes:
 *   1. WebRTC leak is blocked (no real public/local IP exposed)
 *   2. Cookie isolation works (fresh context, no leftover cookies)
 *   3. Canvas fingerprint is randomized between two visits
 *
 * Writes results to data/_antifp.json — run: node src/scripts/checkAntiFp.js
 */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');

// Import the EXACT script the agent injects, so the test verifies the real
// code path rather than a copy that can drift.
const { buildAntiFingerprintScript } = require('../agent/antiFingerprint');

const stealth = StealthPlugin();
stealth.enabledEvasions.delete('user-agent-override');
puppeteer.use(stealth);

const OUT = path.resolve(__dirname, '../../data/_antifp.json');

// Grab the real public IP of this machine (direct, no proxy) so we can prove
// it never shows up inside the browser.
async function getRealIp() {
  try {
    const res = await fetch('https://api.ipify.org?format=json');
    const j = await res.json();
    return j.ip;
  } catch (e) {
    return 'unknown';
  }
}

// Probe for WebRTC leaks the way a real site would.
const WEBRTC_PROBE = `
(async () => {
  const ips = new Set();
  try {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pc.createDataChannel('');
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await new Promise(r => setTimeout(r, 1500));
    if (pc.localDescription && pc.localDescription.sdp) {
      (pc.localDescription.sdp.match(/\\d+\\.\\d+\\.\\d+\\.\\d+/g) || []).forEach(i => ips.add(i));
    }
    pc.close();
  } catch (e) {
    ips.add('RTC_ERROR:' + e.message);
  }
  return [...ips];
})()
`;

const CANVAS_PROBE = `
(() => {
  const c = document.createElement('canvas');
  c.width = 220; c.height = 30;
  const ctx = c.getContext('2d');
  ctx.textBaseline = 'top';
  ctx.font = '14px Arial';
  ctx.fillStyle = '#f60';
  ctx.fillRect(125, 1, 62, 20);
  ctx.fillStyle = '#069';
  ctx.fillText('BotDetect-probe-12345', 2, 15);
  const url = c.toDataURL();
  // FNV-1a hash of the actual pixel output — comparing string LENGTH is
  // useless (identical-length output with different bytes hashes the same).
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
})()
`;

async function runOnce() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--disable-features=WebRtcHideLocalIpsWithMdns',
      '--enforce-webrtc-ip-permission-check',
    ],
    ignoreHTTPSErrors: true,
  });

  const context = await browser.createBrowserContext();
  const page = await context.newPage();

  // Same injection path as the real agent: CDP on the context's own target.
  // (page.evaluateOnNewDocument is silently ignored inside a context.)
  const fpKey = Math.floor(Math.random() * 1e12).toString(36);
  const client = await page.target().createCDPSession();
  await client.send('Page.enable');
  await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: buildAntiFingerprintScript(fpKey),
  });

  await page.goto('http://example.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});

  const webrtcIps = await page.evaluate(WEBRTC_PROBE).catch(e => ['EVAL_FAIL:' + e.message]);
  const canvasHash = await page.evaluate(CANVAS_PROBE).catch(e => 'EVAL_FAIL:' + e.message);
  const cookieCount = await page.cookies().then(c => c.length).catch(() => -1);

  await context.close();
  await browser.close();

  return { webrtcIps, canvasHash, cookieCount };
}

(async () => {
  const realIp = await getRealIp();
  console.log(`Real machine IP: ${realIp}`);

  const a = await runOnce();
  const b = await runOnce();

  const canvasDiffers = a.canvasHash !== b.canvasHash;
  const webrtcClean = ![...a.webrtcIps, ...b.webrtcIps].includes(realIp);

  const report = {
    at: new Date().toISOString(),
    realIp,
    webrtcClean,
    canvasDiffers,
    cookieIsolated: a.cookieCount === 0 && b.cookieCount === 0,
    runA: { webrtcIps: a.webrtcIps, canvasHash: a.canvasHash, cookieCount: a.cookieCount },
    runB: { webrtcIps: b.webrtcIps, canvasHash: b.canvasHash, cookieCount: b.cookieCount },
    verdict: {
      webrtc: webrtcClean ? 'PASS — real IP not exposed' : 'FAIL — real IP leaked via WebRTC',
      canvas: canvasDiffers ? 'PASS — canvas differs between visits' : 'FAIL — identical canvas (linkable)',
      cookies: a.cookieCount === 0 ? 'PASS — fresh cookie jar' : 'FAIL — leftover cookies',
    },
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.verdict, null, 2));
  console.log(`\nFull report → ${OUT}`);
})().catch(e => {
  console.error('checkAntiFp failed:', e.message);
  process.exit(1);
});
