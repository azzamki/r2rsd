// Verify every browser profile produces a valid MOBILE user agent and that
// mobile profiles resolve to a real puppeteer device descriptor.
const fs = require('fs');
const { KnownDevices } = require('puppeteer');
const config = require('../config');

const out = { total: config.bot.browserProfiles.length, rows: [], problems: [] };

const MOBILE_PLATFORMS = new Set(['Android', 'iPhone', 'iPad']);

for (const p of config.bot.browserProfiles) {
  // buildUserAgent is module-private, so re-derive the essentials here
  const isMobile = MOBILE_PLATFORMS.has(p.platform) || Boolean(p.device);
  let ua;
  if (isMobile && (p.platform === 'iPhone' || p.platform === 'iPad')) {
    ua = `Mozilla/5.0 (${p.platform === 'iPad' ? 'iPad; CPU OS' : 'iPhone; CPU iPhone OS'} 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1`;
  } else if (isMobile) {
    ua = `Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36`;
  } else {
    ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36`;
  }

  const row = {
    browser: p.browser,
    platform: p.platform,
    device: p.device || null,
    deviceKnown: p.device ? Boolean(KnownDevices[p.device]) : null,
    mobile: isMobile,
    ua,
  };
  if (!isMobile) out.problems.push(`Desktop profile still present: ${p.platform}`);
  if (p.device && !KnownDevices[p.device]) {
    out.problems.push(`Unknown device: ${p.device}`);
  }
  out.rows.push(row);
}

fs.writeFileSync('./data/_profiles.json', JSON.stringify(out, null, 2));
console.log(`profiles=${out.total} problems=${out.problems.length}`);
