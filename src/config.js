/**
 * AI Visitor Bot - Configuration
 */

module.exports = {
  // ===== SERVER =====
  server: {
    port: process.env.PORT || 3000,
    host: process.env.HOST || '0.0.0.0',
  },

  // ===== BOT BEHAVIOR =====
  bot: {
    // Max concurrent browser agents
    maxAgents: 5,
    // Visit duration range (ms)
    minVisitDuration: 15000,
    maxVisitDuration: 120000,
    // Scroll behavior
    scrollSpeed: { min: 100, max: 800 },
    // Click delay after page load (ms)
    clickDelay: { min: 500, max: 3000 },
    // Typing speed (ms per char)
    typingSpeed: { min: 50, max: 200 },
    // Retry failed visits
    maxRetries: 3,
    // Headless mode
    headless: true,
    // Browser window size variants (used as fallback)
    windowSizes: [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1440, height: 900 },
      { width: 1280, height: 800 },
      { width: 1600, height: 900 },
    ],

    // Browser fingerprints — each visit picks one at random so traffic
    // doesn't all look like the same Chrome-on-Windows client.
    // (Puppeteer is Chromium-only, so "browser" here means a distinct
    //  UA brand + viewport + locale + timezone combination.)
    browserProfiles: [
      // Chrome — Windows
      { browser: 'chrome', platform: 'Win32', viewport: { width: 1920, height: 1080 }, locale: 'en-US', timezone: 'America/New_York' },
      { browser: 'chrome', platform: 'Win32', viewport: { width: 1366, height: 768 }, locale: 'en-US', timezone: 'America/Chicago' },
      { browser: 'chrome', platform: 'Win32', viewport: { width: 1536, height: 864 }, locale: 'en-GB', timezone: 'Europe/London' },
      // Chrome — macOS
      { browser: 'chrome', platform: 'MacIntel', viewport: { width: 1440, height: 900 }, locale: 'en-US', timezone: 'America/Los_Angeles' },
      { browser: 'chrome', platform: 'MacIntel', viewport: { width: 1680, height: 1050 }, locale: 'en-AU', timezone: 'Australia/Sydney' },
      // Chrome — Linux
      { browser: 'chrome', platform: 'Linux x86_64', viewport: { width: 1600, height: 900 }, locale: 'en-US', timezone: 'America/Denver' },
      { browser: 'chrome', platform: 'Linux x86_64', viewport: { width: 1280, height: 800 }, locale: 'de-DE', timezone: 'Europe/Berlin' },
      // Microsoft Edge
      { browser: 'edge', platform: 'Win32', viewport: { width: 1920, height: 1080 }, locale: 'en-US', timezone: 'America/New_York' },
      { browser: 'edge', platform: 'Win32', viewport: { width: 1366, height: 768 }, locale: 'en-CA', timezone: 'America/Toronto' },
      // Opera
      { browser: 'opera', platform: 'Win32', viewport: { width: 1920, height: 1080 }, locale: 'en-US', timezone: 'America/Los_Angeles' },
      { browser: 'opera', platform: 'MacIntel', viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezone: 'Europe/Paris' },
      // Brave (Chrome UA with Brave-specific tweaks handled in agent)
      { browser: 'brave', platform: 'Win32', viewport: { width: 1920, height: 1080 }, locale: 'en-US', timezone: 'America/Denver' },
      { browser: 'brave', platform: 'MacIntel', viewport: { width: 1440, height: 900 }, locale: 'es-ES', timezone: 'Europe/Madrid' },
      // Chrome on mobile-width tablets (still desktop engine)
      { browser: 'chrome', platform: 'Win32', viewport: { width: 1024, height: 768 }, locale: 'pt-BR', timezone: 'America/Sao_Paulo' },
      { browser: 'chrome', platform: 'MacIntel', viewport: { width: 1280, height: 720 }, locale: 'it-IT', timezone: 'Europe/Rome' },

      // ── Mobile (real device emulation: touch + mobile viewport + UA) ──
      // `device` is a puppeteer.KnownDevices name; the agent applies full
      // mobile emulation and only overrides the UA brand (Chrome/Edge/Opera/
      // Brave) so the desktop-Chromium engine still looks like a phone.
      // Chrome — Android
      { browser: 'chrome', platform: 'Android', device: 'Pixel 5', locale: 'en-US', timezone: 'America/New_York' },
      { browser: 'chrome', platform: 'Android', device: 'Galaxy S9+', locale: 'en-US', timezone: 'America/Chicago' },
      { browser: 'chrome', platform: 'Android', device: 'Galaxy S5', locale: 'en-GB', timezone: 'Europe/London' },
      { browser: 'chrome', platform: 'Android', device: 'Nexus 5', locale: 'de-DE', timezone: 'Europe/Berlin' },
      // Edge — Android
      { browser: 'edge', platform: 'Android', device: 'Galaxy S8', locale: 'en-US', timezone: 'America/Los_Angeles' },
      // Opera — Android
      { browser: 'opera', platform: 'Android', device: 'Galaxy S III', locale: 'es-ES', timezone: 'Europe/Madrid' },
      // Brave — Android
      { browser: 'brave', platform: 'Android', device: 'Pixel 5', locale: 'en-AU', timezone: 'Australia/Sydney' },
      // Safari — iPhone (iOS is Safari-only; the engine is not Chromium,
      // so we keep the genuine Safari UA rather than faking a brand)
      { browser: 'safari', platform: 'iPhone', device: 'iPhone 13', locale: 'en-US', timezone: 'America/New_York' },
      { browser: 'safari', platform: 'iPhone', device: 'iPhone 15 Pro', locale: 'en-GB', timezone: 'Europe/London' },
      { browser: 'safari', platform: 'iPhone', device: 'iPhone SE (3rd gen)', locale: 'fr-FR', timezone: 'Europe/Paris' },
      // Safari — iPad
      { browser: 'safari', platform: 'iPad', device: 'iPad Pro 11', locale: 'en-US', timezone: 'America/Los_Angeles' },
      { browser: 'safari', platform: 'iPad', device: 'iPad Pro', locale: 'en-AU', timezone: 'Australia/Sydney' },
    ],
  },

  // ===== PROXY =====
  proxy: {
    // Auto grab from free providers
    autoGrab: true,
    // Check proxy before use
    autoCheck: true,
    // Proxy check timeout (ms)
    checkTimeout: 8000,
    // Max concurrent proxy checks
    checkConcurrency: 100,
    // Cap how many proxies get validated on auto-init (keeps startup fast;
    // the dashboard "Check Manual" / grab flow still checks everything)
    autoCheckLimit: 3000,
    // Rotate proxy every N requests
    rotateEvery: 1,
    // Min proxy speed (ms) - discard slower
    maxLatency: 8000,
    // Free proxy sources
    sources: [
      'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all&simplified=true',
      'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
      'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt',
      'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
      'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt',
      'https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-http.txt',
      'https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt',
    ],
    // Proxy check URL
    checkUrl: 'https://api.ipify.org?format=json',
    // Fallback check URL
    checkUrlFallback: 'http://httpbin.org/ip',
    // Reject proxies whose exit IP does not match the proxy address
    // (transparent proxies that leak your real IP are useless for this).
    requireIpMatch: false,
    // Retry a visit with a different proxy this many times before giving up
    maxProxyRetries: 5,
    // How many times a proxy may fail before it is blacklisted.
    failThreshold: 5,
    // Cooldown (ms) before a failed proxy is eligible again.
    failCooldown: 2 * 60 * 1000,
    // Persist the failed-proxy blacklist to disk so dead proxies are
    // skipped across restarts, not just within one session.
    blacklistFile: './logs/proxy-blacklist.json',
  },

  // ===== REFERRAL =====
  referral: {
    // Referral sources (simulates traffic origin)
    sources: [
      { name: 'Google', url: 'https://www.google.com', weight: 40 },
      { name: 'Bing', url: 'https://www.bing.com', weight: 15 },
      { name: 'Yahoo', url: 'https://www.yahoo.com', weight: 10 },
      { name: 'DuckDuckGo', url: 'https://www.duckduckgo.com', weight: 10 },
      { name: 'Facebook', url: 'https://www.facebook.com', weight: 12 },
      { name: 'Twitter', url: 'https://twitter.com', weight: 8 },
      { name: 'Direct', url: null, weight: 5 },
    ],
  },

  // ===== BROWSER HISTORY =====
  history: {
    // Number of pages to visit before target (build history)
    minPages: 2,
    maxPages: 6,
    // History topics (random browsing simulation)
    topics: [
      'news', 'technology', 'sports', 'entertainment',
      'shopping', 'travel', 'food', 'health', 'finance',
    ],
    // Common history sites to visit
    historySites: [
      'https://www.wikipedia.org',
      'https://news.ycombinator.com',
      'https://www.reddit.com',
      'https://medium.com',
      'https://www.bbc.com',
      'https://techcrunch.com',
      'https://www.cnn.com',
      'https://www.youtube.com',
    ],
  },

  // ===== LOGGING =====
  logging: {
    level: 'info',
    saveToFile: true,
    logDir: './logs',
  },
};
