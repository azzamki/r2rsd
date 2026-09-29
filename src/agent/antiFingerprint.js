/**
 * Anti-fingerprint browser script.
 *
 * Injected via CDP `Page.addScriptToEvaluateOnNewDocument` on the agent's
 * incognito context target. We cannot use page.evaluateOnNewDocument() for
 * this — that method is silently ignored inside a puppeteer browser context
 * (verified: the hook runs on the default page but never inside a context),
 * so the whole anti-leak layer would be dead code.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The user runs one script on 10 RDPs built from the same image. Cookies are
 * isolated and WebRTC is blocked, yet the target site still reports the SAME
 * visitor id on every machine. The remaining linkable signals are
 * HARDWARE-derived and therefore identical on cloned machines:
 *
 *   • audio fingerprint   (OfflineAudioContext render hash)
 *   • hardwareConcurrency (CPU core count)
 *   • deviceMemory        (RAM)
 *   • WebGL vendor/renderer (GPU)
 *   • canvas hash
 *   • media-device ids
 *
 * An ad network hashes those together into one "device id". So each value
 * must be randomized PER VISIT from the fpKey, not per machine.
 *
 * `fpKey` is a fresh random value per agent run, substituted in at inject
 * time. Everything is derived from it via a seeded PRNG so one visit is
 * internally consistent but two visits are unlinkable.
 */

// Small seeded PRNG (mulberry32) — deterministic per fpKey, different per key.
function prngBlock(seedNum) {
  return `
  var __fpSeed = seed;
  var __fpRnd = function () {
    __fpSeed = (Math.imul(__fpSeed ^ (__fpSeed >>> 15), 1 | __fpSeed) + 0x6D2B79F5) | 0;
    __fpSeed = (Math.imul(__fpSeed ^ (__fpSeed >>> 7), 61 | __fpSeed) ^ __fpSeed) | 0;
    return (((__fpSeed ^ (__fpSeed >>> 14)) >>> 0) % 1000000) / 1000000;
  };
  var __fpPick = function (arr) { return arr[Math.floor(__fpRnd() * arr.length) % arr.length]; };
`;
}

function buildAntiFingerprintScript(fpKey) {
  // Mobile GPUs only — this bot is mobile-only. A "NVIDIA RTX 3080" WebGL
  // renderer on an Android Pixel UA is an instant bot tell.
  const GL_VENDORS = ['Qualcomm', 'ARM', 'Imagination Technologies', 'Apple Inc.'];
  const GL_RENDERERS = [
    'Adreno (TM) 650',
    'Adreno (TM) 640',
    'Adreno (TM) 730',
    'Mali-G78',
    'Mali-G77',
    'Mali-G76',
    'PowerVR Rogue GE8320',
    'Apple GPU',
  ];
  const CORES = [4, 6, 8, 8, 12];
  const MEM = [2, 3, 4, 6, 8];
  const TOUCH = [1, 5, 5, 10];

  const seedNum = String(fpKey).split('').reduce((s, c) => (s * 31 + c.charCodeAt(0)) | 0, 7);

  return `
(function (fpKey, seed) {
  var noop = function () {};
  try { Object.defineProperty(navigator, 'webdriver', { get: function () { return undefined; } }); } catch (e) {}
  try { window.__fpInjected = fpKey; } catch (e) {}
${prngBlock(seedNum)}
  // ── 1. WEBRTC: no STUN/ICE candidate can ever leave the page ──
  // --proxy-server does NOT route WebRTC. Without this block a page opens an
  // RTCPeerConnection, runs STUN and reads the machine's real public + local
  // IP regardless of the configured proxy — the #1 cause of "IP terdeteksi
  // sama". Replace the constructor so no ICE gathering can ever happen.
  var FakeRTC = function () {
    this.createDataChannel = function () { return { close: noop, send: noop }; };
    this.createOffer = function () { return Promise.resolve({ type: 'offer', sdp: '' }); };
    this.createAnswer = function () { return Promise.resolve({ type: 'answer', sdp: '' }); };
    this.setLocalDescription = function () { return Promise.resolve(); };
    this.setRemoteDescription = function () { return Promise.resolve(); };
    this.addIceCandidate = function () { return Promise.resolve(); };
    this.close = noop;
    this.addEventListener = noop;
    this.removeEventListener = noop;
    this.onicecandidate = null;
    this.onconnectionstatechange = null;
  };
  try {
    if (window.RTCPeerConnection) FakeRTC.prototype = window.RTCPeerConnection.prototype;
    window.RTCPeerConnection = FakeRTC;
  } catch (e) {}
  try { window.webkitRTCPeerConnection = FakeRTC; } catch (e) {}
  try { window.mozRTCPeerConnection = FakeRTC; } catch (e) {}

  // ── 2. HARDWARE: CPU cores / RAM / touch ──
  // Identical on every cloned RDP — these are the biggest contributors to a
  // stable device id. Pick a plausible mobile value per visit instead.
  try {
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: function () { return __fpPick([${CORES.join(',')}]); },
      configurable: true,
    });
  } catch (e) {}
  try {
    Object.defineProperty(navigator, 'deviceMemory', {
      get: function () { return __fpPick([${MEM.join(',')}]); },
      configurable: true,
    });
  } catch (e) {}
  try {
    Object.defineProperty(navigator, 'maxTouchPoints', {
      get: function () { return __fpPick([${TOUCH.join(',')}]); },
      configurable: true,
    });
  } catch (e) {}

  // ── 3. MEDIA DEVICES: per-visit randomized device list ──
  // Real hardware device ids are constant per machine; return a per-visit
  // randomized set instead so the device list can never be linked.
  try {
    Object.defineProperty(navigator, 'mediaDevices', {
      get: function () {
        return {
          enumerateDevices: function () {
            return Promise.resolve([
              { kind: 'audioinput', deviceId: fpKey + 'a1', groupId: fpKey + 'g1', label: '' },
              { kind: 'audiooutput', deviceId: fpKey + 'a2', groupId: fpKey + 'g1', label: '' },
              { kind: 'videoinput', deviceId: fpKey + 'v1', groupId: fpKey + 'g2', label: '' },
            ]);
          },
          getUserMedia: function () { return Promise.reject(new Error('Permission denied')); },
        };
      },
      configurable: true,
    });
  } catch (e) {}

  // ── 4. CANVAS: deterministic per-visit pixel noise ──
  // Ad networks hash the rendered canvas. Shift a few pixels by ±1 — invisible
  // to the eye, enough to change the resulting hash completely.
  try {
    var origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    var origToBlob = HTMLCanvasElement.prototype.toBlob;
    var origGetImageData = CanvasRenderingContext2D.prototype.getImageData;

    function noiseCanvas(canvas) {
      try {
        var ctx = canvas.getContext('2d');
        if (!ctx || !canvas.width || !canvas.height) return;
        var img = origGetImageData.call(ctx, 0, 0, canvas.width, canvas.height);
        var d = img.data;
        for (var j = 0; j < d.length; j += 4 * 97) {
          d[j] = (d[j] + ((seed + j) % 3) - 1) & 0xff;
        }
        ctx.putImageData(img, 0, 0);
      } catch (e) {}
    }

    HTMLCanvasElement.prototype.toDataURL = function () {
      noiseCanvas(this);
      return origToDataURL.apply(this, arguments);
    };
    HTMLCanvasElement.prototype.toBlob = function () {
      noiseCanvas(this);
      return origToBlob.apply(this, arguments);
    };
  } catch (e) {}

  // ── 5. WEBGL: mobile GPU vendor/renderer per visit ──
  // On cloned machines the GPU string is identical; on headless it is
  // "Google Inc. (SwiftShader)" which is also a bot tell. Both are linkable.
  try {
    var glVendor = __fpPick(${JSON.stringify(GL_VENDORS)});
    var glRenderer = __fpPick(${JSON.stringify(GL_RENDERERS)});
    var origGetParameter = WebGLRenderingContext.prototype.getParameter;
    var origGetParameter2 = WebGL2RenderingContext.prototype.getParameter;
    var UNMASKED_VENDOR = 0x9245;
    var UNMASKED_RENDERER = 0x9246;

    function spoofedGetParameter(orig, param) {
      if (param === UNMASKED_VENDOR) return glVendor;
      if (param === UNMASKED_RENDERER) return glRenderer;
      return orig.call(this, param);
    }
    WebGLRenderingContext.prototype.getParameter = function (p) {
      return spoofedGetParameter.call(this, origGetParameter, p);
    };
    try {
      WebGL2RenderingContext.prototype.getParameter = function (p) {
        return spoofedGetParameter.call(this, origGetParameter2, p);
      };
    } catch (e) {}
  } catch (e) {}

  // ── 6. AUDIO: per-visit noise on the rendered buffer ──
  // The audio fingerprint samples the output of an OfflineAudioContext. Add a
  // tiny per-visit value to the rendered samples so the hash changes every
  // visit while staying inaudible.
  try {
    var AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (AC) {
      var origStartRendering = AC.prototype.startRendering;
      AC.prototype.startRendering = function () {
        var self = this;
        return origStartRendering.apply(self, arguments).then(function (buffer) {
          try {
            var n = __fpRnd() * 1e-7;
            for (var ch = 0; ch < buffer.numberOfChannels; ch++) {
              var d = buffer.getChannelData(ch);
              for (var i = 4500; i < 5000 && i < d.length; i++) {
                d[i] = d[i] + n;
              }
            }
          } catch (e) {}
          return buffer;
        });
      };
    }
  } catch (e) {}
})(${JSON.stringify(String(fpKey))}, ${seedNum});
`;
}

module.exports = { buildAntiFingerprintScript };
