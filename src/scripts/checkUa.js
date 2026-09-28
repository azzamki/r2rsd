// Smoke-test the real buildUserAgent() from browserAgent.js across every
// profile, plus a synthetic desktop profile to prove the mobile-only guard.
// Writes results to data/_ua-check.json (console output is unreliable here).
const fs = require('fs');
const config = require('../config');
const { buildUserAgent } = require('../agent/browserAgent');

const DESKTOP_RE = /Windows NT|Macintosh|X11; Linux x86_64/;
const MOBILE_RE = /Android|iPhone|iPad/;

const results = [];
const problems = [];

for (const p of config.bot.browserProfiles) {
  // Sample several UAs per profile since the version/model are randomized
  for (let i = 0; i < 5; i++) {
    const ua = buildUserAgent(p);
    const desktop = DESKTOP_RE.test(ua);
    const mobile = MOBILE_RE.test(ua);
    results.push({ browser: p.browser, platform: p.platform, device: p.device, mobile, desktop, ua });
    if (desktop || !mobile) problems.push(`${p.browser}/${p.platform}: ${ua}`);
  }
}

// A stray desktop profile must still get a mobile UA — launch() forces it
// onto an Android profile before calling buildUserAgent.
const forcedUa = buildUserAgent({ browser: 'chrome', platform: 'Android', device: 'Pixel 5' });
if (DESKTOP_RE.test(forcedUa)) problems.push(`stray desktop profile: ${forcedUa}`);

fs.writeFileSync('./data/_ua-check.json', JSON.stringify({
  total: results.length,
  problems,
  sample: results.slice(0, 8),
  strayProfileForcedMobile: forcedUa,
}, null, 2));

console.log(`checked=${results.length} problems=${problems.length}`);
if (problems.length) console.log(problems.slice(0, 5).join('\n'));
