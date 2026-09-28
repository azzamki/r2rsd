// Quick check: which device descriptors does this puppeteer expose?
const fs = require('fs');
const out = {};
try {
  const p = require('puppeteer');
  out.puppeteerKeys = Object.keys(p).slice(0, 40);
  out.devicesType = typeof p.devices;
  out.knownDevicesType = typeof p.KnownDevices;
  const d = p.devices || p.KnownDevices;
  if (d) {
    out.sample = Object.keys(d).filter(k =>
      /iPhone 1[35]|Pixel [57]|iPad Pro|Galaxy S|Nexus 5|iPhone SE/i.test(k)
    );
    if (out.sample.length) out.example = d[out.sample[0]];
  }
} catch (e) {
  out.err = e.message;
}
fs.writeFileSync('./data/_devices.json', JSON.stringify(out, null, 2));
