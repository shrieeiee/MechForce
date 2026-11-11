// State deltas for online play. Instead of the whole game every update, the host sends
// what changed since the last state that client received, and the client patches its copy.
// Patches are plain JSON: { key: patch } for objects, { $: value } to replace, { $d: 1 } to
// delete a key, and { $a: { index: patch }, $len, $add } for arrays. Game state never uses
// keys starting with '$'.
export function diff(a, b) {
  if (a === b) return undefined;
  const ao = typeof a === 'object' && a !== null, bo = typeof b === 'object' && b !== null;
  if (!ao || !bo || Array.isArray(a) !== Array.isArray(b)) return { $: b };
  if (Array.isArray(b)) {
    const n = Math.min(a.length, b.length);
    const ch = {};
    let c = 0;
    for (let i = 0; i < n; i++) { const d = diff(a[i], b[i]); if (d !== undefined) { ch[i] = d; c++; } }
    if (!c && a.length === b.length) return undefined;
    if (c > Math.max(4, n * 0.6)) return { $: b }; // mostly changed (a shifted list): send it whole
    const p = { $a: ch };
    if (b.length !== a.length) p.$len = b.length;
    if (b.length > a.length) p.$add = b.slice(a.length);
    return p;
  }
  const out = {};
  let c = 0;
  for (const k of Object.keys(b)) {
    if (!(k in a)) { out[k] = { $: b[k] }; c++; continue; }
    const d = diff(a[k], b[k]);
    if (d !== undefined) { out[k] = d; c++; }
  }
  for (const k of Object.keys(a)) if (!(k in b)) { out[k] = { $d: 1 }; c++; }
  return c ? out : undefined;
}

export function patch(a, p) {
  if (p === undefined) return a;
  if ('$' in p) return p.$;
  if ('$a' in p) {
    const arr = a.slice(0, p.$len ?? a.length);
    for (const [i, d] of Object.entries(p.$a)) arr[i] = patch(arr[i], d);
    if (p.$add) arr.push(...p.$add);
    return arr;
  }
  const o = { ...a };
  for (const [k, d] of Object.entries(p)) {
    if (d && d.$d === 1 && Object.keys(d).length === 1) delete o[k];
    else o[k] = patch(a ? a[k] : undefined, d);
  }
  return o;
}

export const jclone = (v) => JSON.parse(JSON.stringify(v));
