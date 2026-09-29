/**
 * Find which fingerprint signals are STILL identical between two visits.
 *
 * The user runs one script on 10 RDPs (likely cloned from the same image)
 * and the target site reports the same visitor id ("1656") everywhere.
 * WebRTC + cookies are already isolated, so the remaining linkable signals
 * are hardware-derived: canvas, WebGL renderer, audio, CPU cores, memory,
 * screen, fonts. This script enumerates all of them through the SAME code
 * path the real agent uses (incognito context + CDP inject) and diffs two
 * runs so we fix only what is actually static.
 *
 * Run: node src/scripts/checkFp.js   →  data/_fp.json
 */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');
const { buildAntiFingerprintScript } = require('../agent/antiFingerprint');

const stealth = StealthPlugin();
stealth.enabledEvasions.delete('user-agent-override');
puppeteer.use(stealth);

const OUT = path.resolve(__dirname, '../../data/_fp.json');

// Collect every signal an ad network uses to link visits.
const COLLECT = `
(async () => {
  const out = {};

  // ── CANVAS (2d) ──
  // NOTE: compare a hash of the CONTENT, not the string length. A ±1 pixel
  // shift changes the bytes but often compresses to the same PNG length, so
  // a length check falsely reports "identical".
  try {
    const c = document.createElement('canvas');
    c.width = 240; c.height = 60;
    const ctx = c.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '16px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('BotDetect-probe-12345', 2, 15);
    const url = c.toDataURL();
    let h = 0x811c9dc5;
    for (let i = 0; i < url.length; i++) {
      h ^= url.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    out.canvas2d = (h >>> 0).toString(16);
  } catch (e) { out.canvas2d = 'ERR:' + e.message; }

  // ── CANVAS (webgl) ──
  // Probe on a FRESH canvas created before any 2d noise ran, so the webgl
  // context is not affected by the canvas-noise hook above.
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      out.webglVendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : 'no-ext';
      out.webglRenderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'no-ext';
    } else {
      out.webglRenderer = 'NO_WEBGL';
    }
  } catch (e) { out.webglRenderer = 'ERR:' + e.message; }

  // ── AUDIO ──
  try {
    const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ac = new AC(1, 44100, 44100);
    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 1000;
    const comp = ac.createDynamicsCompressor();
    osc.connect(comp);
    comp.connect(ac.destination);
    osc.start(0);
    const buf = await ac.startRendering();
    const d = buf.getChannelData(0);
    let s = 0;
    for (let i = 4500; i < 5000; i++) s += Math.abs(d[i]);
    out.audio = s.toString();
    out.audioSampleRate = ac.sampleRate;
    out.audioMaxCh = ac.maxChannelCount;
  } catch (e) { out.audio = 'ERR:' + e.message; }

  // ── HARDWARE ──
  out.hardwareConcurrency = navigator.hardwareConcurrency;
  out.deviceMemory = navigator.deviceMemory || null;

  // ── SCREEN ──
  out.screen = screen.width + 'x' + screen.height + 'x' + screen.colorDepth;
  out.dpr = window.devicePixelRatio;
  out.availScreen = screen.availWidth + 'x' + screen.availHeight;

  // ── PLATFORM / LANG / TZ ──
  out.platform = navigator.platform;
  out.languages = JSON.stringify(navigator.languages);
  try { out.tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { out.tz = 'ERR'; }
  out.ua = navigator.userAgent;

  // ── PLUGINS / MEDIA ──
  out.plugins = navigator.plugins ? navigator.plugins.length : -1;
  out.maxTouchPoints = navigator.maxTouchPoints;

  // Is our injected script actually alive in this page?
  out.injected = !!window.__fpInjected;
  try {
    out.toDataURLHooked = /noiseCanvas/.test(HTMLCanvasElement.prototype.toDataURL.toString());
  } catch (e) { out.toDataURLHooked = 'ERR:' + e.message; }

  return out;
})()
`;

async function runOnce(fpKey) {
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

  const client = await page.target().createCDPSession();
  await client.send('Page.enable');
  await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: buildAntiFingerprintScript(fpKey),
  });

  await page.goto('http://example.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  const sig = await page.evaluate(COLLECT).catch(e => ({ EVAL_FAIL: e.message }));

  await context.close();
  await browser.close();
  return sig;
}

(async () => {
  const keyA = Math.floor(Math.random() * 1e12).toString(36);
  const keyB = Math.floor(Math.random() * 1e12).toString(36);

  const a = await runOnce(keyA);
  const b = await runOnce(keyB);

  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const identical = [];
  const different = [];
  for (const k of keys) {
    if (JSON.stringify(a[k]) === JSON.stringify(b[k])) identical.push(k);
    else different.push(k);
  }

  const report = {
    at: new Date().toISOString(),
    note: 'identical = still linkable across visits (same machine). These are what produce the same visitor id on every RDP.',
    identical,
    different,
    runA: a,
    runB: b,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('IDENTICAL (still linkable):', identical.join(', '));
  console.log('DIFFERENT (ok):', different.join(', '));
  console.log(`\nFull report → ${OUT}`);
})().catch(e => {
  console.error('checkFp failed:', e.message);
  process.exit(1);
});
