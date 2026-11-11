// Moving things between devices: save/open files where the platform allows it, and
// compact text codes (gzipped, base64) that can be copied and pasted anywhere — the
// Android app and some browsers can't download files, but every one can paste.
const isAndroidApp = () => !!(window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'android');

export async function toCode(obj, tag = 'MF1') {
  const json = JSON.stringify(obj);
  let bytes = new TextEncoder().encode(json);
  if (typeof CompressionStream !== 'undefined') {
    const cs = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(cs).arrayBuffer());
    tag += 'z';
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `${tag}:${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}
export async function fromCode(code) {
  const m = String(code || '').trim().match(/^MF1(z?):([A-Za-z0-9_-]+)$/);
  if (!m) throw new Error('That isn\'t a MechForce code');
  const b64 = m[2].replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  let bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (m[1]) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This device can\'t unpack that code');
    const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(ds).arrayBuffer());
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}

// Save a file (download dialog on PC and browsers). Returns 'saved', 'copied' or 'failed'.
export async function saveFile(name, obj) {
  const text = JSON.stringify(obj);
  if (!isAndroidApp()) {
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      a.download = name; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      return 'saved';
    } catch {}
  }
  return (await copyText(await toCode(obj))) ? 'copied' : 'failed';
}
// Pick a file and read it as JSON (or null if cancelled)
export function openFile(accept = '.json,.mfreplay,.mechforce') {
  return new Promise((resolve, reject) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.style.display = 'none';
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      inp.remove();
      if (!f) { resolve(null); return; }
      f.text().then((t) => { try { resolve(JSON.parse(t)); } catch { reject(new Error('That file isn\'t a MechForce file')); } }, reject);
    });
    document.body.appendChild(inp); inp.click();
  });
}
