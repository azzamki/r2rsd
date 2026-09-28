/**
 * Browser Agent
 * Simulates real human browsing with:
 * - Random user agents
 * - Browser history simulation
 * - Human-like mouse/scroll/click behavior
 * - Referral chain
 * - Stealth mode (anti-detection)
 */
const puppeteer = require('puppeteer-extra');
const { KnownDevices } = require('puppeteer');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const config = require('../config');
const proxyManager = require('../proxy/proxyManager');

const stealth = StealthPlugin();
stealth.enabledEvasions.delete('user-agent-override');
puppeteer.use(stealth);
// NOTE: anonymize-ua & user-agent-override are intentionally NOT used —
// we set our own UA per profile via setUserAgent() to preserve mobile & desktop fingerprints.

// ──────────────────────────────────────────────────────────
// HUMAN BEHAVIOR HELPERS
// ──────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Modern mobile model tokens, kept in sync with the puppeteer.KnownDevices
// names used in config.bot.browserProfiles so the UA matches the emulated
// screen size.
const ANDROID_MODELS = {
  'Pixel 5': 'Pixel 5',
  'Pixel 7': 'Pixel 7',
  'Galaxy S9+': 'SM-G965F',
  'Galaxy S8': 'SM-G950F',
  'Galaxy S5': 'SM-G900F',
  'Galaxy S III': 'GT-I9300',
  'Nexus 5': 'Nexus 5',
  'Nexus 5X': 'Nexus 5X',
};

const MOBILE_PLATFORMS = new Set(['Android', 'iPhone', 'iPad']);

function isMobileProfile(profile) {
  return MOBILE_PLATFORMS.has(profile.platform) || Boolean(profile.device);
}

// navigator.platform values that match a mobile fingerprint
function navPlatformFor(profile) {
  if (profile.platform === 'iPhone') return 'iPhone';
  if (profile.platform === 'iPad') return 'iPad';
  if (profile.platform === 'Android') return 'Linux armv8l';
  return profile.platform;
}

// Build a realistic User-Agent string for the given browser profile.
// Puppeteer is Chromium-only, so we vary the UA *brand* (Chrome / Edge /
// Opera / Brave / Safari), OS platform and Chrome major version to diversify
// fingerprints instead of running one identical client every time.
function buildUserAgent(profile) {
  const chromeMajor = randomBetween(120, 131);
  const build = randomBetween(0, 6202);
  const patch = randomBetween(0, 250);
  const cef = `Chrome/${chromeMajor}.0.${build}.${patch}`;
  const webkit = 'AppleWebKit/537.36 (KHTML, like Gecko)';
  const safari = '537.36';

  // ── Mobile / tablet ──
  if (isMobileProfile(profile)) {
    // iOS is Safari-only: use the genuine Safari UA rather than faking a
    // Chromium brand that the (non-Chromium) engine could never produce.
    if (profile.platform === 'iPhone' || profile.platform === 'iPad') {
      const iosMajor = randomBetween(16, 17);
      const iosMinor = randomBetween(1, 6);
      const ios = `${iosMajor}_${iosMinor}`;
      const token = profile.platform === 'iPad' ? 'iPad; CPU OS' : 'iPhone; CPU iPhone OS';
      return `Mozilla/5.0 (${token} ${ios} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${iosMajor}.${iosMinor} Mobile/15E148 Safari/604.1`;
    }

    // Android — Chromium brands (Chrome / Edge / Opera / Brave)
    const model = ANDROID_MODELS[profile.device] || 'SM-G975F';
    const androidVer = randomBetween(11, 14);
    let ua = `Mozilla/5.0 (Linux; Android ${androidVer}; ${model}) ${webkit} ${cef} Mobile Safari/${safari}`;
    if (profile.browser === 'edge') {
      ua += ` Edg/${chromeMajor + 20}.0.${build}.${patch}`;
    } else if (profile.browser === 'opera') {
      ua += ` OPR/${chromeMajor - 13}.0.${build}.${patch}`;
    }
    // brave + chrome → stock Chrome UA (Brave is detected via navigator.brave)
    return ua;
  }

  // ── Desktop ──
  let platformToken;
  switch (profile.platform) {
    case 'MacIntel':
      platformToken = 'Macintosh; Intel Mac OS X 10_15_7';
      break;
    case 'Linux x86_64':
      platformToken = 'X11; Linux x86_64';
      break;
    default:
      platformToken = 'Windows NT 10.0; Win64; x64';
  }

  switch (profile.browser) {
    case 'edge': {
      const edgeMajor = chromeMajor + 20;
      return `Mozilla/5.0 (${platformToken}) ${webkit} ${cef} Safari/${safari} Edg/${edgeMajor}.0.${build}.${patch}`;
    }
    case 'opera': {
      const opMajor = chromeMajor - 13;
      return `Mozilla/5.0 (${platformToken}) ${webkit} ${cef} Safari/${safari} OPR/${opMajor}.0.${build}.${patch}`;
    }
    case 'brave':
      // Brave uses a stock Chrome UA; detection happens via navigator.brave
      return `Mozilla/5.0 (${platformToken}) ${webkit} ${cef} Safari/${safari}`;
    default:
      return `Mozilla/5.0 (${platformToken}) ${webkit} ${cef} Safari/${safari}`;
  }
}

function weightedRandom(items) {
  const total = items.reduce((s, i) => s + (i.weight || 1), 0);
  let rnd = Math.random() * total;
  for (const item of items) {
    rnd -= (item.weight || 1);
    if (rnd <= 0) return item;
  }
  return items[items.length - 1];
}

async function humanScroll(page) {
  const scrollAmount = randomBetween(300, 1200);
  const steps = randomBetween(5, 20);
  const stepSize = scrollAmount / steps;
  for (let i = 0; i < steps; i++) {
    await page.evaluate((s) => window.scrollBy(0, s), stepSize + randomBetween(-10, 10));
    await sleep(randomBetween(80, 300));
  }
  // Occasionally scroll back up a bit
  if (Math.random() < 0.3) {
    await sleep(randomBetween(500, 1500));
    await page.evaluate(() => window.scrollBy(0, -Math.floor(Math.random() * 400)));
  }
}

async function humanMouseMove(page) {
  try {
    const vp = page.viewport();
    if (!vp) return;
    const x = randomBetween(100, vp.width - 100);
    const y = randomBetween(100, vp.height - 100);
    await page.mouse.move(x, y, { steps: randomBetween(5, 25) });
  } catch {}
}

async function humanClick(page, selector = null) {
  try {
    if (selector) {
      const el = await page.$(selector);
      if (el) {
        const box = await el.boundingBox();
        if (box) {
          const x = box.x + box.width / 2 + randomBetween(-5, 5);
          const y = box.y + box.height / 2 + randomBetween(-5, 5);
          await page.mouse.move(x, y, { steps: randomBetween(5, 15) });
          await sleep(randomBetween(100, 400));
          await page.mouse.click(x, y);
          return true;
        }
      }
    }

    // ── Random click on a visible, in-viewport element ──
    // Candidates: links, buttons, or any clickable element
    const candidates = await page.$$('a[href], button, [role="button"], input[type="submit"], input[type="button"]');
    const visible = [];
    for (const el of candidates.slice(0, 30)) {
      try {
        const box = await el.boundingBox();
        if (box && box.x > 0 && box.y > 0 && box.width > 5 && box.height > 5) {
          visible.push({ el, box });
        }
      } catch {}
    }

    if (visible.length > 0) {
      const pick = visible[Math.floor(Math.random() * visible.length)];
      const x = pick.box.x + pick.box.width / 2 + randomBetween(-4, 4);
      const y = pick.box.y + pick.box.height / 2 + randomBetween(-4, 4);
      await page.mouse.move(x, y, { steps: randomBetween(8, 20) });
      await sleep(randomBetween(150, 500));
      // Actually click (random choice: left-click vs just hover, 70% chance click)
      if (Math.random() < 0.7) {
        await page.mouse.click(x, y);
        return true;
      }
    }
  } catch {}
  return false;
}

async function simulateReading(page, duration) {
  const endTime = Date.now() + duration;
  while (Date.now() < endTime) {
    const action = Math.random();
    if (action < 0.4) {
      await humanScroll(page);
    } else if (action < 0.6) {
      await humanMouseMove(page);
    } else if (action < 0.7) {
      await humanClick(page);
    } else {
      await sleep(randomBetween(500, 2000));
    }
    await sleep(randomBetween(500, 2000));
  }
}

// ──────────────────────────────────────────────────────────
// POPUNDER HANDLER
// Detects new pages/tabs opened by the site (popunders/popups)
// and briefly interacts with them like a real user would.
// ──────────────────────────────────────────────────────────
async function handlePopunders(agentId, browser, knownPages) {
  try {
    const allPages = await browser.pages();
    const newPages = allPages.filter(p => !knownPages.has(p) && !p.isClosed());

    for (const popup of newPages) {
      knownPages.add(popup);
      try {
        const popUrl = popup.url();
        logger.info(`[Agent ${agentId}] 🪟 Popunder detected: ${popUrl || '(blank)'}`);

        // Bring popup to front (simulates user seeing it)
        await popup.bringToFront().catch(() => {});
        await sleep(randomBetween(2000, 5000));

        // Wait a moment for the popup to fully load
        await popup.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});

        const finalUrl = popup.url();
        logger.info(`[Agent ${agentId}] 🪟 Popunder loaded: ${finalUrl}`);

        // Simulate brief reading
        await humanScroll(popup).catch(() => {});
        await sleep(randomBetween(2000, 6000));
        await humanMouseMove(popup).catch(() => {});
        await sleep(randomBetween(1000, 3000));

        // Random chance to click something in the popup (40%)
        if (Math.random() < 0.4) {
          await humanClick(popup).catch(() => {});
          await sleep(randomBetween(1000, 3000));
        }

        // Close the popunder (user dismisses it)
        await popup.close().catch(() => {});
        logger.info(`[Agent ${agentId}] 🪟 Popunder closed`);
      } catch (e) {
        logger.warn(`[Agent ${agentId}] Popunder handling error: ${e.message}`);
        await popup.close().catch(() => {});
      }
    }
  } catch (e) {
    logger.warn(`[Agent ${agentId}] handlePopunders error: ${e.message}`);
  }
}

async function clickInternalAndExternalLinks(agentId, page, targetUrl, options = {}) {
  const { autoClickInternal = true, autoClickExternal = true } = options;
  if (!autoClickInternal && !autoClickExternal) return;
  if (!page || page.isClosed()) return;

  let origin;
  try {
    origin = new URL(targetUrl).origin;
  } catch (e) {
    return;
  }

  // ── 1. INTERNAL LINK CLICKING ──
  if (autoClickInternal && !page.isClosed()) {
    try {
      const internalHrefs = await page.$$eval('a[href]', (els, orig) => {
        return els
          .map(a => a.href)
          .filter(href => {
            if (!href || href.startsWith('javascript:') || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
              return false;
            }
            try {
              const u = new URL(href, window.location.href);
              return u.origin === orig && u.href !== window.location.href;
            } catch {
              return false;
            }
          });
      }, origin);

      if (internalHrefs.length > 0) {
        const targetHref = internalHrefs[Math.floor(Math.random() * internalHrefs.length)];
        logger.info(`[Agent ${agentId}] 🔗 Auto-clicking internal link: ${targetHref}`);

        const clicked = await page.evaluate((href) => {
          const el = Array.from(document.querySelectorAll('a[href]')).find(a => a.href === href);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.click();
            return true;
          }
          return false;
        }, targetHref);

        if (clicked) {
          await sleep(randomBetween(3000, 6000));
          await humanScroll(page).catch(() => {});
        }
      } else {
        logger.info(`[Agent ${agentId}] ℹ️ No internal links found on target page`);
      }
    } catch (e) {
      logger.warn(`[Agent ${agentId}] Internal link click warning: ${e.message}`);
    }
  }

  // ── 2. EXTERNAL LINK CLICKING ──
  if (autoClickExternal && !page.isClosed()) {
    // Domains to skip when auto-clicking external links
    const EXTERNAL_BLACKLIST = [
      'imamuddinwp.com',
      'blogger.com',
      'blogspot.com',
      'google.com',
      'facebook.com',
      'twitter.com',
      'instagram.com',
    ];

    try {
      const externalHrefs = await page.$$eval('a[href]', (els, orig) => {
        return els
          .map(a => a.href)
          .filter(href => {
            if (!href || href.startsWith('javascript:') || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
              return false;
            }
            try {
              const u = new URL(href, window.location.href);
              return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin !== orig;
            } catch {
              return false;
            }
          });
      }, origin);

      // Filter out blacklisted domains
      const filtered = externalHrefs.filter(href => {
        try {
          const host = new URL(href).hostname.replace(/^www\./, '');
          return !EXTERNAL_BLACKLIST.some(b => host === b || host.endsWith('.' + b));
        } catch { return true; }
      });

      // Replace externalHrefs with filtered list below
      externalHrefs.length = 0;
      filtered.forEach(h => externalHrefs.push(h));

      if (externalHrefs.length > 0) {
        const targetHref = externalHrefs[Math.floor(Math.random() * externalHrefs.length)];
        logger.info(`[Agent ${agentId}] 🌐 Auto-clicking external link: ${targetHref}`);

        const clicked = await page.evaluate((href) => {
          const el = Array.from(document.querySelectorAll('a[href]')).find(a => a.href === href);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.click();
            return true;
          }
          return false;
        }, targetHref);

        if (clicked) {
          await sleep(randomBetween(3000, 6000));
        }
      } else {
        logger.info(`[Agent ${agentId}] ℹ️ No external links found on page`);
      }
    } catch (e) {
      logger.warn(`[Agent ${agentId}] External link click warning: ${e.message}`);
    }
  }
}

// Connection-level errors mean the proxy itself is dead/rejected — the page
// will never load no matter how long we wait. Used to fast-fail history
// building instead of burning 6 pages × 20s on an unusable proxy.
const PROXY_DEAD_RE = /ERR_TIMED_OUT|ERR_TUNNEL_CONNECTION_FAILED|ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE|ERR_PROXY_CONNECTION_FAILED|ERR_SOCKS_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/;

function isProxyDeadError(err) {
  return PROXY_DEAD_RE.test(String(err?.message || err || ''));
}

// ──────────────────────────────────────────────────────────
// BROWSER AGENT CLASS
// ──────────────────────────────────────────────────────────
class BrowserAgent {
  constructor(agentId, options = {}) {
    this.agentId = agentId || uuidv4().substring(0, 8);
    this.options = options;
    this.browser = null;
    this.page = null;
    this.proxyInfo = null;
    this.userAgent = null;
    this.visitCount = 0;
    this.status = 'idle'; // idle | browsing | visiting | done | error
    this.currentUrl = null;
    this.stats = {
      visits: 0,
      errors: 0,
      totalTime: 0,
    };
  }

  // ──────────────────────────────
  // LAUNCH BROWSER
  // ──────────────────────────────
  async launch() {
    // Pick a random browser fingerprint (Chrome/Edge/Opera/Brave across
    // Windows/macOS/Linux with different locales & timezones).
    const profile = config.bot.browserProfiles[
      Math.floor(Math.random() * config.bot.browserProfiles.length)
    ];
    this.profile = profile;
    this.userAgent = buildUserAgent(profile);

    // Get proxy (unless the job disabled proxies)
    this.proxyInfo = this.options.useProxy === false
      ? null
      : proxyManager.getRandomProxy();

    const windowSize = profile.viewport || { width: 1280, height: 800 };

    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-infobars',
      '--disable-notifications',
      '--disable-popup-blocking',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      `--lang=en-US,en;q=0.9`,
    ];

    // Mobile devices get their size from the device descriptor (set via
    // emulate() below); --window-size is desktop-only and would only fight
    // the mobile layout on a 390px-wide screen.
    if (!isMobileProfile(profile)) {
      launchArgs.push(`--window-size=${windowSize.width},${windowSize.height}`);
    }

    if (this.proxyInfo) {
      const rawP = this.proxyInfo.proxy || '';
      let proxyArg = rawP;
      let authUser = null;
      let authPass = null;

      const authMatch = rawP.match(/^(?:(https?|socks[45]?):\/\/)?([^:]+):([^@]+)@(.+)$/i);
      if (authMatch) {
        const proto = authMatch[1] || 'http';
        authUser = authMatch[2];
        authPass = authMatch[3];
        proxyArg = `${proto}://${authMatch[4]}`;
      } else if (!/^(https?|socks[45]?):\/\//i.test(proxyArg)) {
        proxyArg = `http://${proxyArg}`;
      }

      launchArgs.push(`--proxy-server=${proxyArg}`);
      logger.info(`[Agent ${this.agentId}] Using proxy: ${proxyArg} (${this.proxyInfo.latency}ms)`);
      this._proxyAuth = authUser && authPass ? { username: authUser, password: authPass } : null;
    } else {
      logger.warn(`[Agent ${this.agentId}] No proxy available — using direct connection`);
    }

    this.browser = await puppeteer.launch({
      headless: config.bot.headless ? 'new' : false,
      args: launchArgs,
      // Mobile profiles get their exact viewport from the device descriptor
      // via page.emulate() below; passing it here too would conflict.
      defaultViewport: isMobileProfile(profile)
        ? null
        : { width: windowSize.width, height: windowSize.height },
      ignoreHTTPSErrors: true,
    });

    this.page = await this.browser.newPage();
    if (this._proxyAuth) {
      await this.page.authenticate(this._proxyAuth).catch(e => {
        logger.warn(`[Agent ${this.agentId}] Proxy auth error: ${e.message}`);
      });
    }

    // Full mobile emulation (viewport + deviceScaleFactor + hasTouch +
    // isMobile) from puppeteer's device descriptors.
    if (isMobileProfile(profile)) {
      const device = KnownDevices[profile.device];
      if (device) {
        await this.page.emulate(device).catch(() => {});
      } else {
        logger.warn(`[Agent ${this.agentId}] Unknown device "${profile.device}" — falling back to generic mobile viewport`);
        await this.page.setViewport({
          width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
        }).catch(() => {});
      }
    }

    // Emulate the chosen locale / timezone so the fingerprint is consistent
    await this.page.emulateTimezone(profile.timezone).catch(() => {});

    // Set user agent
    await this.page.setUserAgent(this.userAgent);

    // Override navigator properties to avoid detection
    await this.page.evaluateOnNewDocument((platform, brand, isMobile) => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'platform', { get: () => platform });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

      if (isMobile) {
        // Phones/tablets have no classic plug-in array and expose a mobile
        // touch pointer — claiming otherwise is an instant bot tell.
        Object.defineProperty(navigator, 'plugins', { get: () => [] });
        Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
      } else {
        Object.defineProperty(navigator, 'plugins', {
          get: () => [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
            { name: 'Native Client', filename: 'internal-nacl-plugin' },
          ],
        });
      }
      window.chrome = { runtime: {} };
      // Brave exposes navigator.brave
      if (brand === 'brave') {
        window.navigator.brave = { isBrave: () => Promise.resolve(true) };
      }
    }, navPlatformFor(profile), profile.browser, isMobileProfile(profile));

    // Set extra headers
    await this.page.setExtraHTTPHeaders({
      'Accept-Language': `${profile.locale},en;q=0.9`,
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
    });

    logger.info(`[Agent ${this.agentId}] Browser launched | ${profile.browser}/${profile.platform}${profile.device ? ` ${profile.device}` : ''} ${isMobileProfile(profile) ? '(mobile)' : `${windowSize.width}x${windowSize.height}`} | UA: ${this.userAgent.substring(0, 50)}...`);
    this.status = 'idle';
  }

  // ──────────────────────────────
  // BUILD BROWSER HISTORY
  // ──────────────────────────────
  async buildHistory() {
    const historySites = config.history.historySites;
    const numPages = randomBetween(config.history.minPages, config.history.maxPages);
    
    logger.info(`[Agent ${this.agentId}] Building history (${numPages} pages)...`);
    this.status = 'browsing';

    for (let i = 0; i < numPages; i++) {
      // The browser can die mid-history (proxy dropped, OOM kill, crash).
      // Without this guard the loop keeps hammering a dead page and throws
      // "Cannot read properties of null", which aborted the whole visit.
      if (!this.page || this.page.isClosed()) {
        logger.warn(`[Agent ${this.agentId}] Page gone — stopping history build`);
        return;
      }
      const site = historySites[Math.floor(Math.random() * historySites.length)];
      try {
        await this.page.goto(site, { waitUntil: 'domcontentloaded', timeout: 20000 });
        this.currentUrl = site;
        const dwellTime = randomBetween(3000, 12000);
        await sleep(dwellTime);
        await humanScroll(this.page);
        await humanMouseMove(this.page);
        logger.info(`[Agent ${this.agentId}] History page ${i + 1}/${numPages}: ${site}`);
      } catch (e) {
        logger.warn(`[Agent ${this.agentId}] History page failed: ${site} - ${e.message}`);
        // A dead proxy fails the same way on every site. Stop wasting time
        // on the remaining history pages and go straight to the target —
        // if the proxy is really gone, the target fails fast and runVisit
        // moves on to a fresh proxy instead of stalling for minutes.
        if (isProxyDeadError(e)) {
          logger.warn(`[Agent ${this.agentId}] Proxy looks dead (${e.message}) — skipping remaining history`);
          return;
        }
      }
    }
  }

  // ──────────────────────────────
  // SIMULATE REFERRAL
  // ──────────────────────────────
  async simulateReferral(referralSource) {
    if (!referralSource || !referralSource.url) return;
    if (!this.page || this.page.isClosed()) {
      logger.warn(`[Agent ${this.agentId}] Page gone — skipping referral`);
      return;
    }
    try {
      logger.info(`[Agent ${this.agentId}] Navigating from referral: ${referralSource.name}`);
      await this.page.goto(referralSource.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(randomBetween(2000, 5000));
      await humanScroll(this.page);
    } catch (e) {
      logger.warn(`[Agent ${this.agentId}] Referral nav failed: ${e.message}`);
      // Same fast-fail logic as buildHistory: a dead proxy can't reach the
      // referral site either, so don't stall here before the real target.
      if (isProxyDeadError(e)) {
        logger.warn(`[Agent ${this.agentId}] Proxy looks dead (${e.message}) — skipping referral`);
        return;
      }
    }
  }

  // ──────────────────────────────
  // VISIT TARGET URL
  // ──────────────────────────────
  async visitTarget(targetUrl, options = {}) {
    const startTime = Date.now();
    this.status = 'visiting';
    this.currentUrl = targetUrl;

    const {
      referral = null,
      duration = null,
      minDuration = null,
      maxDuration = null,
      clickSelectors = [],
      autoClickInternal = true,
      autoClickExternal = true,
      handlePopunder = true,
    } = options;

    // Snapshot of existing pages BEFORE visiting target (for popunder detection)
    const knownPages = new Set(handlePopunder ? await this.browser.pages() : []);

    // Get referral source
    const referralSource = referral || weightedRandom(config.referral.sources);

    // Set referrer header if referral has URL
    if (referralSource && referralSource.url) {
      // Page can be null if the browser died during history/referral.
      // Bail with a real error so runVisit retries with a fresh proxy
      // instead of throwing a confusing "null.setExtraHTTPHeaders".
      if (!this.page || this.page.isClosed()) {
        throw new Error('browser closed before target visit');
      }
      await this.page.setExtraHTTPHeaders({
        'Referer': referralSource.url,
      });
    }

    // Navigate to target
    logger.info(`[Agent ${this.agentId}] Visiting: ${targetUrl} (via ${referralSource?.name || 'Direct'})`);
    
    try {
      await this.page.goto(targetUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });
    } catch (e) {
      // Try with domcontentloaded if networkidle2 fails
      try {
        await this.page.goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
      } catch (e2) {
        throw new Error(`Failed to load ${targetUrl}: ${e2.message}`);
      }
    }

    // Wait after load
    await sleep(randomBetween(config.bot.clickDelay.min, config.bot.clickDelay.max));

    // Click specific selectors if provided
    if (clickSelectors.length > 0) {
      for (const selector of clickSelectors) {
        await humanClick(this.page, selector);
        await sleep(randomBetween(500, 2000));
      }
    }

    // Auto click internal & external links if enabled
    if (autoClickInternal || autoClickExternal) {
      await clickInternalAndExternalLinks(this.agentId, this.page, targetUrl, options);
    }

    // Handle popunders opened during/after load
    if (handlePopunder && this.browser) {
      await handlePopunders(this.agentId, this.browser, knownPages);
    }

    // Calculate visit duration
    const visitDuration = duration ||
      randomBetween(
        minDuration || config.bot.minVisitDuration,
        maxDuration || config.bot.maxVisitDuration
      );

    // Simulate reading behavior (also check for popunders mid-session)
    const readingEnd = Date.now() + visitDuration;
    while (Date.now() < readingEnd) {
      const remaining = readingEnd - Date.now();
      if (remaining <= 0) break;

      const action = Math.random();
      if (action < 0.4) {
        await humanScroll(this.page).catch(() => {});
      } else if (action < 0.6) {
        await humanMouseMove(this.page).catch(() => {});
      } else if (action < 0.72) {
        await humanClick(this.page).catch(() => {});
      } else {
        await sleep(randomBetween(500, 2000));
      }

      // Periodically check for new popunders during session
      if (handlePopunder && this.browser && Math.random() < 0.3) {
        await handlePopunders(this.agentId, this.browser, knownPages);
      }

      await sleep(randomBetween(500, 2000));
    }

    const elapsed = Date.now() - startTime;
    this.stats.visits++;
    this.stats.totalTime += elapsed;
    this.visitCount++;
    this.status = 'done';

    logger.info(`[Agent ${this.agentId}] ✅ Visit complete: ${targetUrl} (${Math.round(elapsed / 1000)}s)`);
    // A successful visit clears any transient failure strikes on this proxy
    if (this.proxyInfo?.proxy) proxyManager.markSuccess(this.proxyInfo.proxy);
    return {
      agentId: this.agentId,
      url: targetUrl,
      proxy: this.proxyInfo?.proxy || 'direct',
      duration: elapsed,
      referral: referralSource?.name,
      success: true,
    };
  }

  // ──────────────────────────────
  // FULL VISIT FLOW (with proxy retry)
  // ──────────────────────────────
  async runVisit(targetUrl, options = {}) {
    const maxRetries = config.proxy.maxProxyRetries ?? 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Fresh browser + fresh proxy for every attempt
      await this.close();
      this.proxyInfo = null;
      this.browser = null;
      this.page = null;

      // Skip proxies that are already known-dead or still cooling down.
      // getRandomProxy() draws from the usable pool, so a proxy that just
      // failed (and was cooled down above) is not picked again.
      if (options.useProxy !== false && !proxyManager._usablePool().length) {
        logger.warn(`[Agent ${this.agentId}] No usable proxies left — giving up`);
        break;
      }

      try {
        await this.launch();

        // Build history first
        if (options.buildHistory !== false) {
          await this.buildHistory();
        }

        // Simulate referral navigation
        const referralSource = weightedRandom(config.referral.sources);
        if (referralSource.url) {
          await this.simulateReferral(referralSource);
        }

        // Visit the target
        const result = await this.visitTarget(targetUrl, {
          ...options,
          referral: referralSource,
        });

        if (result.success) return result;

        lastError = result.error || 'visit failed';
        logger.warn(`[Agent ${this.agentId}] Attempt ${attempt}/${maxRetries} failed: ${lastError}`);
      } catch (e) {
        lastError = e.message;
        this.status = 'error';
        logger.warn(`[Agent ${this.agentId}] Attempt ${attempt}/${maxRetries} crashed: ${e.message}`);
      }

      // Blacklist/cool down the proxy that just failed BEFORE the next
      // attempt, so the retry actually gets a different proxy. Previously
      // this ran after the loop, so every retry reused the same dead proxy.
      const badProxy = this.proxyInfo?.proxy;
      if (badProxy) {
        proxyManager.markFailed(badProxy, lastError);
      }
    }

    this.status = 'error';
    this.stats.errors++;
    logger.error(`[Agent ${this.agentId}] Visit failed after retries: ${targetUrl} — ${lastError}`);
    return { agentId: this.agentId, url: targetUrl, success: false, error: lastError };
  }

  async close() {
    try {
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
        this.page = null;
      }
    } catch {}
    this.status = 'idle';
  }

  getStatus() {
    return {
      agentId: this.agentId,
      status: this.status,
      currentUrl: this.currentUrl,
      proxy: this.proxyInfo?.proxy || 'direct',
      proxyIp: this.proxyInfo?.ip,
      browser: this.profile?.browser,
      platform: this.profile?.platform,
      visitCount: this.visitCount,
      stats: this.stats,
    };
  }
}

module.exports = BrowserAgent;
