// Platform detection and the native hooks each shell provides.
// Electron (Windows / Steam Deck / Linux) exposes window.mfNative via preload.
// Android (Capacitor) exposes window.Capacitor and feeds controller state to window.__mfNativePad.
export const native = typeof window !== 'undefined' ? window.mfNative || null : null;
export const isCapacitor = typeof window !== 'undefined' && !!(window.Capacitor && (window.Capacitor.isNativePlatform ? window.Capacitor.isNativePlatform() : window.Capacitor.platform !== 'web'));
export const servedByHost = typeof location !== 'undefined' && location.protocol === 'http:' && !isCapacitor && !native && location.hostname !== '';
export const secureBrowser = typeof location !== 'undefined' && location.protocol === 'https:' && !isCapacitor;

export function platformName() {
  if (native) return native.isDeck ? 'Steam Deck' : native.platform === 'win32' ? 'Windows' : native.platform === 'darwin' ? 'Mac' : 'Linux';
  if (isCapacitor) return 'Android';
  return 'Browser';
}
export const canHost = !!(native && native.hostStart);
export const canQuit = !!(native && native.quit);

// LAN discovery. Desktop: UDP beacons via the native shell. Android & LAN browser: HTTP probes.
export async function discover(onFound, { prefixes = [], signal } = {}) {
  const found = new Map();
  const add = (h) => {
    const key = h.address + ':' + h.port;
    if (found.has(key)) return;
    found.set(key, h);
    onFound([...found.values()]);
  };
  if (native && native.discover) {
    const t0 = Date.now();
    while (Date.now() - t0 < 3500 && !(signal && signal.aborted)) {
      try { (await native.discover()).forEach(add); } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    return [...found.values()];
  }
  if (secureBrowser) return []; // https pages cannot probe plain-http LAN hosts
  const ip = await localIp();
  if (ip) prefixes = [ip.split('.').slice(0, 3).join('.'), ...prefixes];
  if (servedByHost) {
    try { const j = await (await fetch('/mf/info')).json(); add({ ...j, address: location.hostname }); } catch {}
  }
  const list = ip ? [...new Set(prefixes)] : [...new Set([...prefixes, '192.168.1', '192.168.0', '192.168.4', '192.168.5', '192.168.68', '192.168.86', '10.0.0', '10.0.1', '192.168.2', '192.168.50'])];
  const probe = async (ip) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1400);
    try {
      const r = await fetch(`http://${ip}:7373/mf/info`, { signal: ctl.signal, cache: 'no-store' });
      const j = await r.json();
      if (j.mechforce) add({ ...j, address: ip });
    } catch {} finally { clearTimeout(t); }
  };
  for (const p of list) {
    if (signal && signal.aborted) break;
    const ips = [];
    for (let i = 1; i < 255; i++) ips.push(`${p}.${i}`);
    for (let i = 0; i < ips.length; i += 64) {
      if (signal && signal.aborted) break;
      await Promise.all(ips.slice(i, i + 64).map(probe));
    }
  }
  return [...found.values()];
}

export async function localIp() {
  try {
    const p = isCapacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.MechForceNative;
    if (p) { const r = await p.localIp(); return r && r.ip ? r.ip : ''; }
  } catch {}
  return '';
}
