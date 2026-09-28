/**
 * Proxy Manager
 * - Grabs proxies from free sources
 * - Checks/validates proxies
 * - Rotates proxies for agents
 */
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const pLimit = require('p-limit');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const config = require('../config');
const EventEmitter = require('events');

// Matches ip:port, optional protocol prefix (http/https/socks4/socks5)
const PROXY_RE = /^(?:https?|socks[45]):\/\/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{2,5})$/;
const PLAIN_PROXY_RE = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{2,5})$/;

function parseProxyLine(line) {
  const raw = String(line || '').trim();
  if (!raw) return null;
  const m = raw.match(PROXY_RE);
  if (m) return m[1];
  if (PLAIN_PROXY_RE.test(raw)) return raw;
  return null;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class ProxyManager extends EventEmitter {
  constructor() {
    super();
    this.proxies = [];         // All raw proxies (deduped)
    this.workingProxies = [];  // Validated working proxies
    this.blacklist = new Set(); // Proxies known to fail — never re-used
    this.blacklistReason = {};  // proxy -> reason
    this.failCount = {};        // proxy -> consecutive failure strikes
    this.lastFailAt = {};       // proxy -> timestamp of last failure
    this.usedCount = {};       // Usage counter per proxy
    this.currentIndex = 0;
    this.isGrabbing = false;
    this.isChecking = false;
    this.stats = {
      total: 0,
      working: 0,
      failed: 0,
      blacklisted: 0,
      lastGrab: null,
      lastCheck: null,
    };
    this._loadBlacklist();
  }

  // ──────────────────────────────────────────
  // PERSISTENT BLACKLIST (dead proxies are skipped across restarts)
  // ──────────────────────────────────────────
  _blacklistPath() {
    return path.resolve(config.proxy.blacklistFile || './logs/proxy-blacklist.json');
  }

  _loadBlacklist() {
    try {
      const file = this._blacklistPath();
      if (fs.existsSync(file)) {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        const entries = Array.isArray(raw) ? raw : (raw.entries || []);
        entries.forEach(e => {
          const p = typeof e === 'string' ? e : e.proxy;
          this.blacklist.add(p);
          this.blacklistReason[p] = typeof e === 'string' ? 'failed' : (e.reason || 'failed');
        });
        this.stats.blacklisted = this.blacklist.size;
        logger.info(`⛔ Loaded ${this.blacklist.size} blacklisted proxies from disk`);
      }
    } catch (e) {
      logger.warn(`Could not load proxy blacklist: ${e.message}`);
    }
  }

  _saveBlacklist() {
    try {
      const file = this._blacklistPath();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const data = [...this.blacklist].map(p => ({ proxy: p, reason: this.blacklistReason[p] || 'failed' }));
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (e) {
      logger.warn(`Could not save proxy blacklist: ${e.message}`);
    }
  }

  isBlacklisted(proxy) {
    return this.blacklist.has(proxy);
  }

  // ──────────────────────────────────────────
  // GRAB PROXIES FROM FREE SOURCES
  // ──────────────────────────────────────────
  async grabProxies() {
    if (this.isGrabbing) return this.proxies;
    this.isGrabbing = true;
    logger.info('🔍 Grabbing proxies from free sources...');

    // Merge into existing list so manual proxies survive a re-grab.
    // Blacklisted proxies stay out forever.
    const allProxies = new Set(this.proxies.filter(p => !this.blacklist.has(p)));
    const sources = config.proxy.sources;

    const fetches = sources.map(async (url) => {
      try {
        const res = await axios.get(url, {
          timeout: 15000,
          proxy: false,
          signal: AbortSignal.timeout(15000),
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProxyGrabber/1.0)' },
        });
        const lines = String(res.data || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        let added = 0, skipped = 0;
        lines.forEach(line => {
          const clean = parseProxyLine(line);
          if (!clean) return;
          if (this.blacklist.has(clean)) { skipped++; return; }
          if (!allProxies.has(clean)) {
            allProxies.add(clean);
            added++;
          }
        });
        logger.info(`  ✅ ${url.substring(0, 60)}... → ${lines.length} lines (+${added} new, ${skipped} blacklisted)`);
        return added;
      } catch (e) {
        logger.warn(`  ❌ Failed: ${url.substring(0, 60)}... (${e.message})`);
        return 0;
      }
    });

    await Promise.all(fetches);

    this.proxies = [...allProxies];
    this.stats.total = this.proxies.length;
    this.stats.blacklisted = this.blacklist.size;
    this.stats.lastGrab = new Date();
    this.isGrabbing = false;

    logger.info(`🔢 Total unique proxies: ${this.proxies.length} (${this.blacklist.size} blacklisted)`);
    this.emit('grabbed', this.proxies.length);
    return this.proxies;
  }

  // ──────────────────────────────────────────
  // ADD MANUAL PROXIES
  // ──────────────────────────────────────────
  addProxies(proxyList) {
    if (!Array.isArray(proxyList)) return 0;
    const existing = new Set(this.proxies);
    let added = 0, blacklisted = 0;

    proxyList.forEach(p => {
      const clean = parseProxyLine(p);
      if (!clean) return;
      if (this.blacklist.has(clean)) { blacklisted++; return; }
      if (!existing.has(clean)) {
        this.proxies.push(clean);
        existing.add(clean);
        added++;
      }
    });

    this.stats.total = this.proxies.length;
    logger.info(`Added ${added} manual proxies (total: ${this.proxies.length}${blacklisted ? `, ${blacklisted} blacklisted skipped` : ''})`);
    return added;
  }

  // ──────────────────────────────────────────
  // CHECK / VALIDATE PROXIES
  // ──────────────────────────────────────────
  async checkProxy(proxy) {
    const timeout = config.proxy.checkTimeout;
    const proxyUrl = `http://${proxy}`;
    const agent = new HttpsProxyAgent(proxyUrl, { timeout });

    const start = Date.now();
    try {
      const res = await axios.get(config.proxy.checkUrl, {
        httpsAgent: agent,
        httpAgent: agent,
        proxy: false,                 // never fall back to env proxies
        timeout,
        signal: AbortSignal.timeout(timeout),  // hard cap: axios timeout alone
                                               // does NOT fire on ETIMEDOUT
        validateStatus: () => true,
      });
      const latency = Date.now() - start;
      const ip = res.data?.ip || res.data?.origin;

      if (res.status !== 200 || !ip) {
        return { proxy, working: false, latency: null, reason: `status ${res.status}` };
      }

      // Reject transparent proxies that leak the real IP: the exit IP must
      // match the proxy address, otherwise it isn't hiding anything.
      if (config.proxy.requireIpMatch && ip !== proxy.split(':')[0]) {
        return { proxy, working: false, latency: null, reason: `ip mismatch (${ip})`, leakedIp: ip };
      }

      return { proxy, working: true, latency, ip };
    } catch (e) {
      return { proxy, working: false, latency: null, reason: e.code || e.message };
    }
  }

  async checkAllProxies(proxiesToCheck = null) {
    // Serialize check runs. If a check is already in flight, wait for it and
    // then run the caller's list instead of silently returning an empty list.
    if (this.isChecking) {
      await new Promise((resolve) => this.once('checked', resolve));
    }
    if (this.isChecking) return this.workingProxies;
    this.isChecking = true;

    const list = (proxiesToCheck || this.proxies).filter(p => !this.blacklist.has(p));
    if (list.length === 0) {
      this.isChecking = false;
      this.workingProxies = [];
      this.stats.working = 0;
      this.stats.failed = 0;
      this.stats.lastCheck = new Date();
      this.emit('checked', 0);
      return this.workingProxies;
    }

    logger.info(`🔄 Checking ${list.length} proxies (concurrency: ${config.proxy.checkConcurrency})...`);

    let done = 0;
    const limit = pLimit(config.proxy.checkConcurrency);
    const results = await Promise.all(
      list.map(p => limit(async () => {
        const r = await this.checkProxy(p);
        if (++done % 500 === 0 || done === list.length) {
          logger.info(`   ⟳ ${done}/${list.length} checked...`);
          this.emit('checkProgress', { done, total: list.length });
        }
        return r;
      }))
    );

    // Preserve already-working proxies that were not re-checked this round
    const checkedSet = new Set(list);
    const preserved = this.workingProxies.filter(w => !checkedSet.has(w.proxy));

    this.workingProxies = [
      ...results
        .filter(r => r.working && r.latency <= config.proxy.maxLatency)
        .sort((a, b) => a.latency - b.latency)
        .map(r => ({ ...r })),
      ...preserved,
    ];

    this.stats.working = this.workingProxies.length;
    this.stats.failed = list.length - results.filter(r => r.working).length;
    this.stats.lastCheck = new Date();
    this.isChecking = false;

    logger.info(`✅ Working proxies: ${this.workingProxies.length}/${list.length}`);
    this.emit('checked', this.workingProxies.length);
    return this.workingProxies;
  }

  // ──────────────────────────────────────────
  // GET NEXT PROXY (ROUND ROBIN)
  // ──────────────────────────────────────────
  getProxy() {
    const pool = this._usablePool();
    if (pool.length === 0) return null;
    // Advance past any blacklisted entries without burning the rotation
    let safety = pool.length;
    let proxy;
    do {
      proxy = pool[this.currentIndex++ % pool.length];
    } while (proxy && this.blacklist.has(proxy.proxy) && --safety > 0);
    if (!proxy || this.blacklist.has(proxy.proxy)) return null;
    this.usedCount[proxy.proxy] = (this.usedCount[proxy.proxy] || 0) + 1;
    return proxy;
  }

  getRandomProxy() {
    const pool = this._usablePool();
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  _usablePool() {
    const cooldown = config.proxy.failCooldown ?? 5 * 60 * 1000;
    const now = Date.now();
    return this.workingProxies.filter(p => {
      if (this.blacklist.has(p.proxy)) return false;
      const lastFail = this.lastFailAt[p.proxy];
      // Skip proxies that are still cooling down after a transient failure
      if (lastFail && now - lastFail < cooldown) return false;
      return true;
    });
  }

  // Mark proxy as failed. Free proxies are flaky, so we use a strike system:
  // - 1st/2nd failure → cooldown (proxy is temporarily skipped, not dropped)
  // - failThreshold failures → permanent blacklist (never used again)
  markFailed(proxy, reason = 'visit failed') {
    if (!proxy || proxy === 'direct') return;
    const wasWorking = this.workingProxies.some(p => p.proxy === proxy);

    const fails = (this.failCount[proxy] || 0) + 1;
    this.failCount[proxy] = fails;
    this.lastFailAt[proxy] = Date.now();

    const threshold = config.proxy.failThreshold ?? 3;
    const cooldown = config.proxy.failCooldown ?? 5 * 60 * 1000;

    if (fails >= threshold) {
      // Permanent blacklist — this proxy is genuinely dead
      this.workingProxies = this.workingProxies.filter(p => p.proxy !== proxy);
      if (!this.blacklist.has(proxy)) {
        this.blacklist.add(proxy);
        this.blacklistReason[proxy] = `${reason} (×${fails})`;
        this.stats.blacklisted = this.blacklist.size;
        this._saveBlacklist();
        logger.warn(`⛔ Proxy blacklisted: ${proxy} (${reason} ×${fails}) — ${this._usablePool().length} usable`);
        this.emit('proxyFailed', { proxy, reason });
      }
      return;
    }

    // Transient failure — cool it down but keep it in the pool
    if (wasWorking) {
      logger.warn(`⚠️ Proxy flaky (${fails}/${threshold}): ${proxy} — ${reason} — cooling down ${Math.round(cooldown / 1000)}s`);
    }
  }

  // Reset a proxy's failure counter after a successful visit so an
  // occasionally-flaky proxy doesn't accumulate strikes forever.
  markSuccess(proxy) {
    if (!proxy || proxy === 'direct') return;
    if (this.failCount[proxy]) delete this.failCount[proxy];
    if (this.lastFailAt[proxy]) delete this.lastFailAt[proxy];
  }

  // ──────────────────────────────────────────
  // AUTO INIT: GRAB + CHECK
  // ──────────────────────────────────────────
  async initialize(manualProxies = []) {
    if (manualProxies.length > 0) {
      this.addProxies(manualProxies);
    }
    if (config.proxy.autoGrab) {
      await this.grabProxies();
    }
    if (config.proxy.autoCheck && this.proxies.length > 0) {
      // Cap the auto-check list so startup stays fast; manual "Check"
      // from the dashboard still validates the full list.
      const cap = config.proxy.autoCheckLimit;
      const list = cap && this.proxies.length > cap
        ? shuffle(this.proxies).slice(0, cap)
        : this.proxies;
      await this.checkAllProxies(list);
    }
    return this.workingProxies;
  }

  getStats() {
    return {
      total: this.proxies.length,
      working: this.workingProxies.length,
      usable: this._usablePool().length,
      failed: this.stats.failed,
      blacklisted: this.blacklist.size,
      lastGrab: this.stats.lastGrab,
      lastCheck: this.stats.lastCheck,
      isGrabbing: this.isGrabbing,
      isChecking: this.isChecking,
    };
  }
}

module.exports = new ProxyManager();
