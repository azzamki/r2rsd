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

    // ── MOBILE-ONLY FINGERPRINTS ──
    // This bot targets mobile traffic only: Android (Chrome/Edge/Opera/
    // Brave) and iPhone (Safari). Desktop Windows/macOS/Linux profiles are
    // intentionally absent. Every entry carries a real puppeteer.KnownDevices
    // `device` name, so the agent applies full mobile emulation (touch +
    // mobile viewport) and only overrides the UA brand.
    // Android pairs with Chrome 120+ ("mobile 12+"); iPhones use the genuine
    // Safari UA because iOS is not a Chromium engine.
    browserProfiles: [
      // Chrome — Android
      { browser: 'chrome', platform: 'Android', device: 'Pixel 5', locale: 'en-US', timezone: 'America/New_York' },
      { browser: 'chrome', platform: 'Android', device: 'Pixel 4a (5G)', locale: 'en-US', timezone: 'America/Chicago' },
      { browser: 'chrome', platform: 'Android', device: 'Pixel 4', locale: 'en-GB', timezone: 'Europe/London' },
      { browser: 'chrome', platform: 'Android', device: 'Galaxy S9+', locale: 'en-US', timezone: 'America/Los_Angeles' },
      { browser: 'chrome', platform: 'Android', device: 'Galaxy Note 3', locale: 'de-DE', timezone: 'Europe/Berlin' },
      { browser: 'chrome', platform: 'Android', device: 'Nexus 5X', locale: 'es-ES', timezone: 'Europe/Madrid' },
      { browser: 'chrome', platform: 'Android', device: 'Moto G4', locale: 'pt-BR', timezone: 'America/Sao_Paulo' },
      // Edge — Android
      { browser: 'edge', platform: 'Android', device: 'Pixel 5', locale: 'en-US', timezone: 'America/Denver' },
      { browser: 'edge', platform: 'Android', device: 'Galaxy S9+', locale: 'en-CA', timezone: 'America/Toronto' },
      // Opera — Android
      { browser: 'opera', platform: 'Android', device: 'Galaxy Note 3', locale: 'fr-FR', timezone: 'Europe/Paris' },
      // Brave — Android (stock Chrome UA; detected via navigator.brave)
      { browser: 'brave', platform: 'Android', device: 'Pixel 4a (5G)', locale: 'en-AU', timezone: 'Australia/Sydney' },
      // Safari — iPhone (iPhone 12+ / "mobile 12+")
      { browser: 'safari', platform: 'iPhone', device: 'iPhone 12', locale: 'en-US', timezone: 'America/New_York' },
      { browser: 'safari', platform: 'iPhone', device: 'iPhone 12 Pro', locale: 'en-US', timezone: 'America/Chicago' },
      { browser: 'safari', platform: 'iPhone', device: 'iPhone 13', locale: 'en-GB', timezone: 'Europe/London' },
      { browser: 'safari', platform: 'iPhone', device: 'iPhone 13 Pro', locale: 'en-US', timezone: 'America/Los_Angeles' },
      { browser: 'safari', platform: 'iPhone', device: 'iPhone 14', locale: 'en-AU', timezone: 'Australia/Sydney' },
      { browser: 'safari', platform: 'iPhone', device: 'iPhone 14 Pro', locale: 'de-DE', timezone: 'Europe/Berlin' },
      { browser: 'safari', platform: 'iPhone', device: 'iPhone 15', locale: 'en-US', timezone: 'America/Denver' },
      { browser: 'safari', platform: 'iPhone', device: 'iPhone 15 Pro', locale: 'fr-FR', timezone: 'Europe/Paris' },
      { browser: 'safari', platform: 'iPhone', device: 'iPhone SE (3rd gen)', locale: 'es-ES', timezone: 'Europe/Madrid' },
    ],
  },

  // ===== PROXY =====
  proxy: {
    // Auto grab from free providers
    autoGrab: true,
    // Continuously grab + check fresh proxies on a timer so the pool never
    // goes stale (free proxies die quickly). 0 disables the scheduler.
    refreshInterval: 10 * 60 * 1000,
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
    // NOTE: static GitHub proxy lists are deliberately excluded — they are
    // the same few thousand IPs everyone else's bot uses, they die within
    // hours, and they are almost all transparent (they leak your real IP).
    // Instead we query rotating aggregator APIs that return a *different*
    // list on every request, so each grab yields fresh proxies.
    sources: [
      // ── Rotating endpoints (different list every call) ──
      // ProxyScrape v3 — randomize order & add a cache-buster so each grab
      // returns a different slice of their pool.
      'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=elite,anonymous&simplified=true&rand=yes',
      'https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=protocolipport&format=text&protocol=http&timeout=10000&country=all&ssl=all&anonymity=elite,anonymous&rand=yes',
      // ProxyScrape "premium" public endpoint (rotating, higher quality)
      'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all&simplified=true',
      // Monosans mirror (rotated by their backend)
      'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
      // ── Rotating JSON APIs (parsed for the "elite"/"anonymous" field) ──
      'https://www.proxy-list.download/api/v1/get?type=https&anon=elite',
      'https://www.proxy-list.download/api/v1/get?type=http&anon=elite',
      'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&protocol=https&timeout=10000&country=all&ssl=all&anonymity=elite&simplified=true&rand=yes',
    ],
    // Extra rotating endpoints that need JSON parsing (not plain ip:port).
    // Each entry returns a different set on every request.
    jsonSources: [
      // geonode — paginated, random page each grab for variety
      'https://proxylist.geonode.com/api/proxy-list?limit=500&page=1&sort_by=lastChecked&sort_type=desc&protocols=http%2Chttps&anonymityLevel=elite%2Canonymous',
      'https://proxylist.geonode.com/api/proxy-list?limit=500&page=2&sort_by=lastChecked&sort_type=desc&protocols=http%2Chttps&anonymityLevel=elite%2Canonymous',
    ],
    // Reject proxies that advertise themselves as transparent (they append
    // X-Forwarded-For / Via and leak your real IP to the target site).
    rejectTransparent: true,
    // Require the proxy to actually tunnel HTTPS (CONNECT). A proxy that only
    // does plain HTTP is useless for https:// targets and is how "same IP"
    // leaks happen — the browser falls back to a direct connection.
    requireHttpsTunnel: true,
    // Proxy check URL (MUST be https — we need to prove CONNECT works)
    checkUrl: 'https://api.ipify.org?format=json',
    // Fallback check URL
    checkUrlFallback: 'https://httpbin.org/ip',
    // Reject proxies whose exit IP does not match the proxy address
    // (transparent proxies that leak your real IP are useless for this).
    requireIpMatch: false,    // Retry a visit with a different proxy this many times before giving up
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
