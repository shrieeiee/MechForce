// Procedural mech models. Every design gets a body type, head style and armour layout
// from its tonnage and name, and every weapon it carries is modelled where it is mounted.
// Static parts are merged per material so a whole mech is only a few dozen draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WEAPONS } from '../core/data.js';

const geoCache = new Map();
const cached = (k, make) => { if (!geoCache.has(k)) geoCache.set(k, make()); return geoCache.get(k); };
const f3 = (n) => n.toFixed(3);
function box(w, h, d) { return cached(`b${f3(w)},${f3(h)},${f3(d)}`, () => new THREE.BoxGeometry(w, h, d)); }
// Chamfered armour block
function plate(w, h, d, bev = 0.18) {
  return cached(`p${f3(w)},${f3(h)},${f3(d)},${bev}`, () => {
    const b = Math.min(w, h, d) * bev;
    const sh = new THREE.Shape();
    const x = w / 2 - b, y = h / 2 - b;
    sh.moveTo(-x, -y); sh.lineTo(x, -y); sh.lineTo(x, y); sh.lineTo(-x, y); sh.lineTo(-x, -y);
    const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.001, d - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: 1 });
    g.translate(0, 0, -(d - 2 * b) / 2);
    g.computeVertexNormals();
    return g;
  });
}
function cyl(r1, r2, h, s = 10, open = false) { return cached(`c${f3(r1)},${f3(r2)},${f3(h)},${s},${open}`, () => new THREE.CylinderGeometry(r1, r2, h, s, 1, open)); }
function sphere(r, ws = 10, hs = 8) { return cached(`s${f3(r)},${ws}`, () => new THREE.SphereGeometry(r, ws, hs)); }
function torus(r, t) { return cached(`t${f3(r)},${f3(t)}`, () => new THREE.TorusGeometry(r, t, 6, 14)); }

function hashStr(s) { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
function glowMat(c, k = 1.6) { return new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: k, roughness: 0.3, metalness: 0.1 }); }

export function weaponSize(t) { return [3, 5, 7, 9, 1, 3, 5, 7, 9, 2, 3, 4, 1, 2, 4, 2, 6][t] || 1; }

export function mechMaterials(colorHex) {
  const base = new THREE.Color(colorHex);
  const body = base.clone().lerp(new THREE.Color('#9aa3ad'), 0.5);
  return {
    body: new THREE.MeshStandardMaterial({ color: body, metalness: 0.55, roughness: 0.48 }),
    trim: new THREE.MeshStandardMaterial({ color: base, metalness: 0.4, roughness: 0.42, emissive: base, emissiveIntensity: 0.08 }),
    dark: new THREE.MeshStandardMaterial({ color: '#262b31', metalness: 0.7, roughness: 0.5 }),
    joint: new THREE.MeshStandardMaterial({ color: '#59616b', metalness: 0.85, roughness: 0.32 }),
    chrome: new THREE.MeshStandardMaterial({ color: '#b9c2cc', metalness: 1, roughness: 0.18 }),
    glass: new THREE.MeshStandardMaterial({ color: '#0b1a22', metalness: 0.3, roughness: 0.05, emissive: new THREE.Color('#58d6ff'), emissiveIntensity: 1.1 }),
    light: glowMat('#ffe9b0', 2.2),
    vent: new THREE.MeshStandardMaterial({ color: '#2a1408', emissive: new THREE.Color('#ff5a14'), emissiveIntensity: 0.25, roughness: 0.6 }),
    barrel: new THREE.MeshStandardMaterial({ color: '#1b1f23', metalness: 0.9, roughness: 0.28 }),
    hazard: new THREE.MeshStandardMaterial({ color: '#e0b02a', metalness: 0.3, roughness: 0.5 }),
    lensS: glowMat('#ff8a3c'), lensM: glowMat('#ff4d9a'), lensL: glowMat('#ff3b5c'), lensB: glowMat('#7fc8ff', 2), flame: glowMat('#ffb02e', 2.2),
    tube: new THREE.MeshStandardMaterial({ color: '#0c0d0f', roughness: 0.9 }), warhead: glowMat('#d8402a', 0.5),
  };
}

// --------------------------------------------------------------------------- weapons
// One detailed part per weapon, built along +Z with its muzzle at the far end.
export function weaponPart(t, s, mats) {
  const g = new THREE.Group();
  const W = WEAPONS[t];
  const anim = {};
  const add = (geo, mat, x, y, z, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
  const along = (geo, mat, z0, len, x = 0, y = 0, parent = g) => { const m = new THREE.Mesh(geo, mat); m.rotation.x = Math.PI / 2; m.position.set(x, y, z0 + len / 2); parent.add(m); return m; };
  let len;
  if (t <= 3) { // ---- autocannons
    const r = [0.02, 0.028, 0.04, 0.058][t] * s, L = [0.66, 0.5, 0.44, 0.32][t] * s;
    add(plate(r * 4.2, r * 3.6, 0.14 * s), mats.dark, 0, 0, 0.05 * s);
    add(plate(r * 2.4, r * 1.6, 0.08 * s), mats.trim, 0, r * 2, 0.04 * s);
    if (t === 3) { const drum = new THREE.Mesh(cyl(r * 1.8, r * 1.8, r * 2.2, 14), mats.joint); drum.rotation.z = Math.PI / 2; drum.position.set(r * 2.6, -r * 0.6, 0.04 * s); g.add(drum); }
    along(cyl(r, r * 1.08, L, 12), mats.barrel, 0.1 * s, L);
    const jackets = t === 0 ? 2 : 3;
    for (let k = 0; k < jackets; k++) along(cyl(r * 1.45, r * 1.45, 0.035 * s, 12), mats.joint, 0.12 * s + k * L * 0.16, 0.035 * s);
    if (t === 0) for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) { const fin = add(box(0.004 * s, r * 2.4, 0.12 * s), mats.dark, Math.cos(a) * r * 1.3, Math.sin(a) * r * 1.3, 0.1 * s + L * 0.7); fin.rotation.z = a; }
    const brakeZ = 0.1 * s + L;
    if (t >= 1) {
      add(plate(r * 2.8, r * 2.2, 0.07 * s), mats.dark, 0, 0, brakeZ);
      for (const sx of [-1, 1]) add(box(0.004 * s, r * 1.2, 0.03 * s), mats.tube, sx * r * 1.42, 0, brakeZ);
    }
    len = brakeZ + (t >= 1 ? 0.035 * s : 0);
  } else if (t === 4) { // ---- rotary machine gun
    add(plate(0.075 * s, 0.065 * s, 0.09 * s), mats.dark, 0, 0, 0.03 * s);
    const spin = new THREE.Group(); spin.position.z = 0.08 * s; g.add(spin);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; along(cyl(0.007 * s, 0.007 * s, 0.17 * s, 6), mats.barrel, 0, 0.17 * s, Math.cos(a) * 0.016 * s, Math.sin(a) * 0.016 * s, spin); }
    along(cyl(0.024 * s, 0.024 * s, 0.012 * s, 10), mats.joint, 0.02 * s, 0.012 * s, 0, 0, spin);
    along(cyl(0.024 * s, 0.024 * s, 0.012 * s, 10), mats.joint, 0.15 * s, 0.012 * s, 0, 0, spin);
    anim.spin = spin; anim.spinV = 0;
    len = 0.26 * s;
  } else if (t >= 12 && t <= 14) { // ---- lasers
    const k = t - 12;
    const r = [0.02, 0.027, 0.036][k] * s, L = [0.16, 0.24, 0.34][k] * s;
    add(plate(r * 3.4, r * 3.4, L * 0.38), mats.dark, 0, 0, L * 0.16);
    along(cyl(r, r, L, 10), mats.barrel, L * 0.2, L);
    const fins = [3, 4, 5][k];
    for (let q = 0; q < fins; q++) along(cyl(r * 1.9, r * 1.9, 0.008 * s, 12), mats.joint, L * 0.32 + q * L * 0.13, 0.008 * s);
    const lens = [mats.lensS, mats.lensM, mats.lensL][k];
    along(cyl(r * 0.8, r * 0.8, 0.02 * s, 12), lens, L * 1.2, 0.02 * s);
    along(cyl(r * 1.15, r * 1.15, 0.012 * s, 12, true), mats.chrome, L * 1.18, 0.02 * s);
    if (k === 2) for (const a of [0, 2.09, 4.19]) { const prong = add(box(0.012 * s, 0.012 * s, 0.09 * s), mats.chrome, Math.cos(a) * r * 1.6, Math.sin(a) * r * 1.6, L * 1.24); prong.rotation.z = a; }
    len = L * 1.2 + 0.03 * s + (k === 2 ? 0.05 * s : 0);
  } else if (t === 15) { // ---- flamer
    const tank = new THREE.Mesh(cyl(0.03 * s, 0.03 * s, 0.14 * s, 12), mats.hazard); tank.rotation.x = Math.PI / 2; tank.position.set(0, -0.045 * s, 0.06 * s); g.add(tank);
    along(cyl(0.022 * s, 0.03 * s, 0.13 * s, 10), mats.joint, 0, 0.13 * s);
    along(cyl(0.04 * s, 0.022 * s, 0.06 * s, 10), mats.dark, 0.13 * s, 0.06 * s);
    const pilot = add(sphere(0.011 * s, 8, 6), mats.flame, 0, -0.02 * s, 0.2 * s);
    pilot.userData.keep = true;
    anim.pilot = pilot;
    len = 0.21 * s;
  } else if (t === 16) { // ---- plasma cannon: twin rails, coils and a charging core
    const L = 0.46 * s;
    const coreMat = mats.lensB.clone(); coreMat.userData.base = coreMat.emissiveIntensity;
    add(plate(0.1 * s, 0.09 * s, 0.12 * s), mats.dark, 0, 0, 0.04 * s);
    const core = add(sphere(0.032 * s, 12, 10), coreMat, 0, 0, 0.05 * s); core.userData.keep = true;
    for (const sx of [-1, 1]) add(plate(0.018 * s, 0.03 * s, L), mats.chrome, sx * 0.028 * s, 0, 0.1 * s + L / 2);
    for (let q = 0; q < 4; q++) { const c = add(torus(0.042 * s, 0.006 * s), coreMat, 0, 0, 0.14 * s + q * L * 0.22); c.userData.keep = true; }
    const tip = add(sphere(0.02 * s, 10, 8), coreMat, 0, 0, 0.1 * s + L); tip.userData.keep = true;
    anim.charge = coreMat; anim.chargeT = 0;
    len = 0.12 * s + L;
  } else if (W.kind === 'm') { // ---- missile racks
    const n = W.n, lrm = !!W.lrm;
    const cols = n <= 2 ? 2 : n <= 6 ? 3 : n <= 10 ? 4 : 5, rows = Math.ceil(Math.min(n, 20) / cols);
    const cw = (lrm ? 0.042 : 0.05) * s, w = cols * cw + 0.035 * s, h = rows * cw + 0.035 * s, d = (lrm ? 0.24 : 0.17) * s;
    add(plate(w, h, d, 0.12), mats.trim, 0, 0, d / 2 - 0.02 * s);
    add(plate(w * 0.92, h * 0.88, 0.012 * s), mats.dark, 0, 0, d - 0.018 * s);
    for (let k = 0; k < Math.min(n, rows * cols); k++) {
      const x = ((k % cols) - (cols - 1) / 2) * cw, y = (Math.floor(k / cols) - (rows - 1) / 2) * cw;
      along(cyl(cw * 0.34, cw * 0.34, 0.02 * s, 8), mats.tube, d - 0.03 * s, 0.02 * s, x, y);
      if (!lrm) along(sphere(cw * 0.26, 8, 6), mats.warhead, d - 0.022 * s, 0.001, x, y);
    }
    if (lrm) { // armoured hatch that flips up when the rack fires
      const hinge = new THREE.Group(); hinge.position.set(0, h / 2, d - 0.01 * s); g.add(hinge);
      const lid = new THREE.Mesh(plate(w * 1.02, h * 1.02, 0.018 * s), mats.trim); lid.position.set(0, -h / 2, 0.012 * s); hinge.add(lid);
      for (const sx of [-1, 1]) { const st = new THREE.Mesh(box(0.008 * s, h * 0.6, 0.006 * s), mats.hazard); st.position.set(sx * w * 0.3, -h / 2, 0.023 * s); hinge.add(st); }
      anim.hatch = hinge; anim.hatchT = 0;
    } else add(plate(w * 0.5, h * 0.3, 0.04 * s), mats.dark, 0, -h / 2 - 0.01 * s, d * 0.4);
    len = d;
  } else len = 0.2 * s;
  const mz = new THREE.Object3D(); mz.position.z = len + 0.02 * s; g.add(mz);
  return { g, mz, len, anim };
}

// Kick off a weapon's firing animation (spin-up, hatch, charge glow)
export function triggerWeaponAnim(mount) {
  const a = mount && mount.anim;
  if (!a) return;
  if (a.spin) a.spinV = 40;
  if (a.hatch) a.hatchT = 1.2;
  if (a.charge) a.chargeT = 0.5;
}
export function tickWeaponAnims(model, dt, time) {
  for (const mt of Object.values(model.weaponMounts)) {
    const a = mt.anim;
    if (!a) continue;
    if (a.spin) { a.spin.rotation.z += a.spinV * dt; a.spinV *= Math.pow(0.25, dt); }
    if (a.hatch) {
      a.hatchT = Math.max(0, a.hatchT - dt);
      const want = a.hatchT > 0 ? -1.9 : 0;
      a.hatch.rotation.x += (want - a.hatch.rotation.x) * Math.min(1, dt * 9);
    }
    if (a.charge) {
      a.chargeT = Math.max(0, a.chargeT - dt);
      a.charge.emissiveIntensity = (a.charge.userData.base || 2) * (0.75 + Math.sin(time * 6 + mt.group.id) * 0.25) + a.chargeT * 9;
    }
    if (a.pilot) a.pilot.scale.setScalar(0.8 + Math.random() * 0.5);
  }
}

// --------------------------------------------------------------------------- body
function mergeStatic(obj) {
  for (const c of obj.children) if (!c.isMesh) mergeStatic(c);
  const byMat = new Map();
  for (const c of obj.children) if (c.isMesh && !c.userData.keep) { const k = c.material.uuid; if (!byMat.has(k)) byMat.set(k, []); byMat.get(k).push(c); }
  for (const list of byMat.values()) {
    if (list.length < 2) continue;
    const geos = list.map((m) => {
      m.updateMatrix();
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.clearGroups();
      g.applyMatrix4(m.matrix);
      return g;
    });
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, list[0].material);
    obj.add(mesh);
    for (const m of list) obj.remove(m);
  }
}

// Track unit bolted to a shin: a loop of tread links running round a drive sprocket, an
// idler and road wheels. Standing, it's shin armour; kneeling (tracked or QuadVee vehicle
// mode) the shin swings flat and the tread runs along the ground. The links are one
// instanced mesh so they can roll round the loop cheaply.
const TREAD_MAT = new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.75, roughness: 0.55 });
const TREAD_A = new THREE.Color('#5d646d'), TREAD_B = new THREE.Color('#33383e');
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
function trackPod(knee, legW, legLen, s, mats, M, back = false) {
  const pod = new THREE.Group();
  const L = legLen * 0.92, T = legW * 0.92, W = legW * 1.6;
  const R = T / 2, a = L / 2 - R;
  const dir = back ? -1 : 1;
  pod.position.set(0, -legLen * 0.5, dir * (legW * 0.6 + R));
  knee.add(pod);
  // frame between the wheels, bolted to the shin
  M(plate(W * 0.5, L * 0.86, T * 0.5, 0.2), mats.dark, 0, 0, -dir * R * 0.45, pod);
  M(plate(W * 0.18, L * 0.7, T * 0.3), mats.hazard, 0, 0, -dir * R * 0.1, pod);
  const wheels = [];
  const wheel = (y, r, kind) => {
    const g = new THREE.Group(); g.position.set(0, y, 0); pod.add(g);
    const tyre = new THREE.Mesh(cyl(r, r, W * 0.82, 16), mats.joint); tyre.rotation.z = Math.PI / 2; tyre.userData.keep = true; g.add(tyre);
    for (const sx of [-1, 1]) {
      const hub = new THREE.Mesh(cyl(r * 0.55, r * 0.55, 0.012 * s, 10), mats.chrome); hub.rotation.z = Math.PI / 2; hub.position.x = sx * W * 0.42; hub.userData.keep = true; g.add(hub);
      for (let k = 0; k < (kind === 'sprocket' ? 3 : 2); k++) { const sp = new THREE.Mesh(box(0.016 * s, r * 1.5, r * 0.22), mats.trim); sp.rotation.x = k * Math.PI / (kind === 'sprocket' ? 3 : 2); sp.position.x = sx * W * 0.43; sp.userData.keep = true; g.add(sp); }
    }
    if (kind === 'sprocket') for (let k = 0; k < 10; k++) { const t = new THREE.Mesh(box(W * 0.3, r * 0.22, r * 0.22), mats.trim); const ang = k / 10 * Math.PI * 2; t.position.set(0, Math.cos(ang) * r * 1.02, Math.sin(ang) * r * 1.02); t.rotation.x = ang; t.userData.keep = true; g.add(t); }
    wheels.push({ g, r, sign: back ? -1 : 1 });
  };
  wheel(a, R * 0.86, 'sprocket');
  wheel(-a, R * 0.8, 'idler');
  const nRoad = Math.max(2, Math.round((2 * a) / (R * 1.5)) - 1);
  for (let k = 1; k <= nRoad; k++) wheel(a - (2 * a) * k / (nRoad + 1), R * 0.62, 'road');
  // tread links round the loop
  const P = 4 * a + 2 * Math.PI * R;
  const n = Math.max(16, Math.round(P / (0.042 * s)));
  const step = P / n;
  const links = new THREE.InstancedMesh(box(W, step * 0.8, R * 0.3), TREAD_MAT, n);
  for (let i = 0; i < n; i++) links.setColorAt(i, i % 2 ? TREAD_B : TREAD_A);
  links.userData.keep = true; links.castShadow = true; links.frustumCulled = false;
  pod.add(links);
  // position u (0..P) round the stadium: outer run (ground side when kneeling) first
  const at = (u) => {
    u = ((u % P) + P) % P;
    let y, z, ty, tz;
    if (u < 2 * a) { y = a - u; z = dir * R; ty = -1; tz = 0; }
    else if ((u -= 2 * a) < Math.PI * R) { const th = u / R; y = -a - R * Math.sin(th); z = dir * R * Math.cos(th); ty = -Math.cos(th); tz = -dir * Math.sin(th); }
    else if ((u -= Math.PI * R) < 2 * a) { y = -a + u; z = -dir * R; ty = 1; tz = 0; }
    else { u -= 2 * a; const th = u / R; y = a + R * Math.sin(th); z = -dir * R * Math.cos(th); ty = Math.cos(th); tz = dir * Math.sin(th); }
    return { y, z, r: Math.atan2(tz, ty) };
  };
  // +dist = rolling forward. A QuadVee's front legs fold the other way, so their loop runs backwards.
  const tread = { links, n, step, phase: 0, at, sign: back ? -1 : 1 };
  const place = () => {
    for (let i = 0; i < n; i++) {
      const q = at(i * step + tread.phase);
      _m4.compose(_v.set(0, q.y, q.z), _q.setFromEuler(_e.set(q.r, 0, 0)), _one);
      links.setMatrixAt(i, _m4);
    }
    links.instanceMatrix.needsUpdate = true;
  };
  tread.place = place;
  place();
  return { pod, wheels, tread, below: legW * 0.6 + T };
}

export function buildMech(spec, colorHex) {
  const { design, tons, cls } = spec;
  const body3 = spec.body || 'biped';
  const quad = body3 === 'quad', tripod = body3 === 'tripod';
  const h = hashStr(design);
  const s = 0.62 + Math.min(tons, 140) / 260 + cls * 0.03;
  const mats = mechMaterials(colorHex);
  const arche = quad ? 'humanoid' : (cls <= 1 && h % 4 === 0) ? 'walker' : (cls === 3 || (cls === 2 && h % 3 === 0)) ? 'brute' : 'humanoid';
  const brute = arche === 'brute', walker = arche === 'walker';
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const M = (geo, mat, x, y, z, parent) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };

  const legLen = (0.5 + (h % 5) * 0.02 + (walker ? 0.1 : cls === 0 ? 0.06 : 0) - (brute ? 0.03 : 0)) * s * (quad ? 0.82 : 1);
  const torsoW = (0.6 + cls * 0.08 + (h % 5) * 0.02 + (brute ? 0.12 : 0)) * s * (quad ? 0.92 : 1);
  const torsoH = (0.42 + cls * 0.04 + (brute ? 0.05 : 0)) * s * (quad ? 0.78 : 1);
  const torsoD = (0.4 + (h % 3) * 0.04) * s * (quad ? 1.9 : tripod ? 1.15 : 1);
  const hipY = legLen * (quad ? 1.75 : 1.9);
  const legW = (0.16 + cls * 0.02 + (brute ? 0.03 : 0)) * s;
  const qv = spec.mot === 'quadvee';

  // ---- legs. Bipeds alternate; four-legged mechs trot (diagonal pairs move together);
  // a tripod's centre leg sits behind and moves with the right leg.
  const LEGS = quad ? [
    { side: -1, x: -torsoW * 0.47, z: torsoD * 0.33, loc: 4, gait: -1 }, { side: 1, x: torsoW * 0.47, z: torsoD * 0.33, loc: 5, gait: 1 },
    { side: -1, x: -torsoW * 0.47, z: -torsoD * 0.33, loc: 6, gait: 1, bird: true }, { side: 1, x: torsoW * 0.47, z: -torsoD * 0.33, loc: 7, gait: -1, bird: true },
  ] : tripod ? [
    { side: -1, x: -torsoW * 0.33, z: torsoD * 0.12, loc: 6, gait: -1 }, { side: 1, x: torsoW * 0.33, z: torsoD * 0.12, loc: 7, gait: 1 },
    { side: 0, x: 0, z: -torsoD * 0.52, loc: 8, gait: 0.8, bird: true },
  ] : [{ side: -1, x: -torsoW * 0.27, z: 0, loc: 6, gait: -1 }, { side: 1, x: torsoW * 0.27, z: 0, loc: 7, gait: 1 }];
  const legs = [];
  for (const L of LEGS) {
    const side = L.side;
    const bird = walker || !!L.bird;
    const hip = new THREE.Group();
    hip.position.set(L.x, hipY, L.z);
    const hj = M(cyl(0.085 * s, 0.085 * s, 0.12 * s, 12), mats.joint, side * 0.02 * s, 0, 0, hip); hj.rotation.z = Math.PI / 2;
    const thigh = new THREE.Group(); hip.add(thigh);
    if (bird) thigh.rotation.x = -0.35;
    M(plate(legW, legLen, legW * 1.35), mats.body, 0, -legLen / 2, 0, thigh);
    M(plate(legW * 1.1, legLen * 0.6, 0.05 * s), mats.trim, 0, -legLen * 0.42, legW * 0.72, thigh);
    M(cyl(0.016 * s, 0.016 * s, legLen * 0.8, 6), mats.chrome, 0, -legLen * 0.5, -legW * 0.85, thigh);
    const knee = new THREE.Group();
    knee.position.y = -legLen;
    hip.add(knee);
    if (bird) { knee.position.z = -Math.sin(0.35) * legLen; knee.position.y = -Math.cos(0.35) * legLen; }
    const kj = M(cyl(0.075 * s, 0.075 * s, legW * 1.2, 12), mats.joint, 0, 0, 0, knee); kj.rotation.z = Math.PI / 2;
    const guard = M(plate(legW * 1.2, 0.16 * s, 0.09 * s), mats.trim, 0, 0.02 * s, legW * 0.6, knee); guard.rotation.x = -0.35;
    M(plate(legW * 0.92, legLen * 0.95, legW * 1.2), mats.dark, 0, -legLen * 0.47, 0, knee);
    M(plate(legW * 1.0, legLen * 0.62, 0.05 * s), mats.body, 0, -legLen * 0.42, legW * 0.66, knee);
    for (let v = 0; v < 3; v++) M(box(legW * 0.7, 0.008 * s, 0.01 * s), mats.vent, 0, -legLen * (0.25 + v * 0.06), -legW * 0.62, knee);
    const ankle = new THREE.Group(); ankle.position.y = -legLen * 0.92; knee.add(ankle);
    M(sphere(0.06 * s), mats.joint, 0, 0, 0, ankle);
    M(plate(legW * 1.45, 0.07 * s, 0.3 * s), mats.dark, 0, -0.03 * s, 0.05 * s, ankle);
    for (const a of [-0.45, 0, 0.45]) { const toe = M(plate(0.05 * s, 0.05 * s, 0.14 * s), mats.body, Math.sin(a) * 0.08 * s, -0.035 * s, 0.2 * s + Math.cos(a) * 0.02 * s, ankle); toe.rotation.y = a; }
    const heel = M(plate(0.05 * s, 0.05 * s, 0.12 * s), mats.body, 0, -0.035 * s, -0.13 * s, ankle); heel.rotation.x = 0.3;
    if (bird) { ankle.rotation.x = -0.35; knee.rotation.x = 0.7; }
    // A QuadVee folds its legs flat under the hull: front legs fold back (tracks on the backs
    // of the shins), rear legs fold forward (tracks on the fronts)
    const front = quad && (L.loc === 4 || L.loc === 5);
    const pod = spec.mot ? trackPod(knee, legW, legLen, s, mats, M, qv && front) : null;
    if (quad && !qv) hip.rotation.z = side * 0.12;
    body.add(hip);
    legs.push({ hip, knee, side, bird, loc: L.loc, gait: L.gait, rest: bird ? 0.7 : 0, pod, fold: qv ? (front ? 1 : -1) : 0, splay: quad && !qv ? side * 0.12 : 0 });
  }

  // ---- pelvis & skirts
  M(plate(torsoW * (quad ? 0.8 : 0.6), 0.15 * s, torsoD * 0.72), mats.joint, 0, hipY, 0, body);
  const skirtF = M(plate(torsoW * 0.36, 0.14 * s, 0.04 * s), mats.trim, 0, hipY - 0.07 * s, torsoD * 0.4, body); skirtF.rotation.x = 0.25;
  for (const side of [-1, 1]) { const sk = M(plate(0.04 * s, 0.15 * s, torsoD * 0.6), mats.body, side * torsoW * 0.36, hipY - 0.06 * s, 0, body); sk.rotation.z = side * 0.25; }

  // ---- torso
  const torso = new THREE.Group();
  torso.position.y = hipY + 0.08 * s;
  body.add(torso);
  M(cyl(0.1 * s, 0.13 * s, 0.12 * s, 12), mats.joint, 0, 0, 0, torso);
  const coreH = walker ? torsoH * 0.82 : torsoH;
  M(plate(torsoW * 0.48, coreH, torsoD), mats.body, 0, coreH / 2, 0, torso);
  const chest = M(plate(torsoW * 0.4, coreH * 0.62, 0.06 * s), mats.trim, 0, coreH * 0.56, torsoD / 2 + 0.01 * s, torso); chest.rotation.x = -0.12;
  M(plate(0.05 * s, coreH * 0.5, 0.08 * s), mats.body, 0, coreH * 0.58, torsoD / 2 + 0.04 * s, torso);
  for (const side of [-1, 1]) {
    M(plate(torsoW * 0.3, torsoH * 0.86, torsoD * 0.94), mats.body, side * torsoW * 0.37, torsoH * 0.45, -0.01, torso);
    M(plate(torsoW * 0.31, torsoH * 0.12, torsoD * 0.96), mats.trim, side * torsoW * 0.37, torsoH * 0.16, -0.01, torso);
    M(plate(0.03 * s, torsoH * 0.6, torsoD * 0.7), mats.dark, side * torsoW * 0.53, torsoH * 0.48, 0, torso);
    for (let v = 0; v < 3; v++) M(box(0.012 * s, 0.012 * s, torsoD * 0.5), mats.vent, side * torsoW * 0.545, torsoH * (0.34 + v * 0.1), 0, torso);
    M(sphere(0.016 * s, 8, 6), mats.light, side * torsoW * 0.46, torsoH * 0.82, torsoD / 2 + 0.005, torso);
  }
  // back: reactor pack, exhaust stacks and glowing heat vents
  M(plate(torsoW * 0.52, torsoH * 0.66, 0.16 * s), mats.dark, 0, torsoH * 0.5, -torsoD / 2 - 0.06 * s, torso);
  for (let v = 0; v < 4; v++) M(box(torsoW * 0.36, 0.014 * s, 0.01 * s), mats.vent, 0, torsoH * (0.3 + v * 0.09), -torsoD / 2 - 0.145 * s, torso);
  const stacks = brute ? 3 : 2;
  for (let k = 0; k < stacks; k++) {
    const x = (k - (stacks - 1) / 2) * 0.1 * s;
    M(cyl(0.028 * s, 0.032 * s, 0.22 * s, 10), mats.joint, x, torsoH * 0.95, -torsoD / 2 - 0.07 * s, torso);
    M(cyl(0.02 * s, 0.02 * s, 0.01 * s, 10), mats.tube, x, torsoH * 0.95 + 0.11 * s, -torsoD / 2 - 0.07 * s, torso);
  }
  const jets = [];
  if (spec.jump > 0) {
    for (const side of [-1, 1]) {
      M(cyl(0.05 * s, 0.075 * s, 0.2 * s, 12), mats.joint, side * torsoW * 0.2, torsoH * 0.22, -torsoD / 2 - 0.17 * s, torso);
      M(cyl(0.055 * s, 0.055 * s, 0.03 * s, 12, true), mats.vent, side * torsoW * 0.2, torsoH * 0.11, -torsoD / 2 - 0.17 * s, torso);
      const nozzle = new THREE.Object3D(); nozzle.position.set(side * torsoW * 0.2, torsoH * 0.08, -torsoD / 2 - 0.17 * s);
      torso.add(nozzle); jets.push(nozzle);
    }
  }

  // ---- head / cockpit
  const head = new THREE.Group();
  torso.add(head);
  const headStyle = quad || walker ? 'nose' : brute ? 'sunk' : ['dome', 'slit', 'canopy'][h % 3];
  if (headStyle === 'nose') {
    head.position.set(0, coreH * 0.62, torsoD / 2 + 0.06 * s);
    const n = M(plate(torsoW * 0.36, 0.17 * s, 0.24 * s), mats.body, 0, 0, 0.06 * s, head); n.rotation.x = 0.12;
    const cg = M(plate(torsoW * 0.3, 0.07 * s, 0.16 * s), mats.glass, 0, 0.065 * s, 0.07 * s, head); cg.rotation.x = 0.35;
    M(box(torsoW * 0.32, 0.012 * s, 0.17 * s), mats.dark, 0, 0.075 * s, 0.05 * s, head);
  } else if (headStyle === 'sunk') {
    head.position.set(0, torsoH - 0.02 * s, torsoD * 0.1);
    M(plate(torsoW * 0.5, 0.12 * s, torsoD * 0.6), mats.dark, 0, 0.02 * s, -0.04 * s, head);
    M(plate(0.24 * s, 0.13 * s, 0.22 * s), mats.body, 0, 0.07 * s, 0.06 * s, head);
    M(box(0.18 * s, 0.025 * s, 0.02 * s), mats.glass, 0, 0.09 * s, 0.17 * s, head);
  } else {
    head.position.set(0, torsoH + 0.02 * s, torsoD * 0.12);
    M(cyl(0.06 * s, 0.07 * s, 0.05 * s, 10), mats.joint, 0, 0.02 * s, 0, head);
    if (headStyle === 'dome') {
      M(sphere(0.12 * s, 14, 10), mats.body, 0, 0.12 * s, 0, head).scale.set(1, 0.8, 1.05);
      M(torus(0.105 * s, 0.018 * s), mats.glass, 0, 0.13 * s, 0, head).rotation.x = Math.PI / 2;
    } else if (headStyle === 'slit') {
      M(plate(0.25 * s, 0.17 * s, 0.26 * s), mats.body, 0, 0.11 * s, 0, head);
      M(plate(0.27 * s, 0.05 * s, 0.1 * s), mats.trim, 0, 0.2 * s, 0.06 * s, head);
      M(box(0.2 * s, 0.025 * s, 0.02 * s), mats.glass, 0, 0.12 * s, 0.13 * s, head);
    } else {
      M(plate(0.26 * s, 0.15 * s, 0.24 * s), mats.body, 0, 0.1 * s, -0.02 * s, head);
      const cnp = M(plate(0.2 * s, 0.1 * s, 0.14 * s), mats.glass, 0, 0.14 * s, 0.07 * s, head); cnp.rotation.x = -0.4;
    }
    if (h % 3 === 1) M(cyl(0.006 * s, 0.006 * s, 0.36 * s, 4), mats.chrome, 0.09 * s, 0.32 * s, -0.06 * s, head);
    if (h % 5 === 2) { const lamp = M(cyl(0.03 * s, 0.024 * s, 0.05 * s, 10), mats.dark, -0.15 * s, 0.12 * s, 0.05 * s, head); lamp.rotation.x = Math.PI / 2; M(cyl(0.022 * s, 0.022 * s, 0.006 * s, 10), mats.light, -0.15 * s, 0.12 * s, 0.078 * s, head).rotation.x = Math.PI / 2; }
  }

  // ---- weapons
  const muzzles = {};
  const weaponMounts = {};
  const byLoc = (loc) => spec.weapons.filter((w) => w.loc === loc);
  const isBig = (t) => [2, 3, 7, 8, 14, 16].includes(t);
  const mount = (w, parent, pos, alongDown, scale = 1) => {
    const part = weaponPart(w.t, s * scale, mats);
    if (alongDown) part.g.rotation.x = Math.PI / 2;
    part.g.position.copy(pos);
    parent.add(part.g);
    weaponMounts[w.i] = { muzzle: part.mz, meshes: [], group: part.g, anim: part.anim };
    if (!muzzles[w.loc]) muzzles[w.loc] = part.mz;
  };
  for (const [side, loc] of [[-1, 1], [1, 3]]) {
    let top = 0, port = 0;
    for (const w of byLoc(loc)) {
      if (isBig(w.t) || WEAPONS[w.t].kind === 'm') { // shoulder turret
        const turret = new THREE.Group();
        turret.position.set(side * (torsoW * 0.3 + (top % 2) * 0.15 * s), torsoH + 0.02 * s + Math.floor(top / 2) * 0.16 * s, -0.08 * s);
        torso.add(turret);
        M(plate(0.1 * s, 0.05 * s, 0.12 * s), mats.joint, 0, 0, 0.02 * s, turret);
        mount(w, turret, new THREE.Vector3(0, 0.06 * s, 0), false);
        top++;
      } else {
        const x = side * (torsoW * 0.3 + (port % 2) * 0.09 * s), y = torsoH * (0.68 - Math.floor(port / 2) * 0.26);
        M(cyl(0.035 * s, 0.035 * s, 0.03 * s, 10), mats.dark, x, y, torsoD / 2 * 0.95, torso).rotation.x = Math.PI / 2;
        mount(w, torso, new THREE.Vector3(x, y, torsoD / 2 * 0.95), false);
        port++;
      }
    }
  }
  byLoc(2).forEach((w, k, arr) => mount(w, torso, new THREE.Vector3((k - (arr.length - 1) / 2) * 0.1 * s, coreH * (WEAPONS[w.t].kind === 'm' ? 0.28 : 0.4), torsoD / 2 + 0.03 * s), false));
  byLoc(0).forEach((w, k, arr) => mount(w, head, new THREE.Vector3(arr.length === 1 ? 0.14 * s : (k - 0.5) * 0.28 * s, 0.1 * s, 0.06 * s), false, 0.9));
  for (const lg of legs) if (!(lg.loc <= 5 && !quad)) byLoc(lg.loc).forEach((w, k) => mount(w, lg.hip, new THREE.Vector3((lg.side || 1) * legW * 0.8, -0.18 * s - k * 0.12 * s, 0.1 * s), false, 0.85));
  if (!muzzles[2]) { const m = new THREE.Object3D(); m.position.set(0, torsoH * 0.55, torsoD / 2 + 0.06 * s); torso.add(m); muzzles[2] = m; }
  if (!muzzles[0]) { const m = new THREE.Object3D(); m.position.set(0, torsoH + 0.12 * s, torsoD * 0.3); torso.add(m); muzzles[0] = m; }
  if (!muzzles[1]) { const m = new THREE.Object3D(); m.position.set(-torsoW * 0.37, torsoH * 0.5, torsoD / 2 + 0.03); torso.add(m); muzzles[1] = m; }
  if (!muzzles[3]) { const m = new THREE.Object3D(); m.position.set(torsoW * 0.37, torsoH * 0.5, torsoD / 2 + 0.03); torso.add(m); muzzles[3] = m; }

  // ---- arms (none on a four-legged mech: its locations 4/5 are the front legs)
  const arms = [];
  const ARM_SLOTS = [[0, 0], [-0.08, 0.07], [0.08, 0.07], [0, 0.14], [-0.08, -0.07], [0.08, -0.07]];
  for (const [side, loc] of quad ? [] : [[-1, 4], [1, 5]]) {
    const sh = new THREE.Group();
    sh.position.set(side * (torsoW * 0.52 + 0.06 * s), torsoH * 0.78, 0);
    torso.add(sh);
    M(sphere(0.09 * s, 12, 10), mats.joint, 0, 0, 0, sh);
    const pd = brute ? 1.35 : walker ? 0.8 : 1;
    const paul = M(plate(0.22 * s * pd, 0.12 * s * pd, 0.3 * s * pd), mats.trim, side * 0.03 * s, 0.07 * s, 0, sh); paul.rotation.z = side * -0.3;
    M(plate(0.2 * s * pd, 0.03 * s, 0.28 * s * pd), mats.hazard, side * 0.05 * s, 0.135 * s * pd, 0, sh).rotation.z = side * -0.3;
    const upLen = (walker ? 0.24 : 0.34) * s;
    M(plate(0.13 * s, upLen, 0.15 * s), mats.body, 0, -upLen / 2 - 0.06 * s, 0, sh);
    M(cyl(0.012 * s, 0.012 * s, upLen * 0.8, 6), mats.chrome, side * 0.075 * s, -upLen / 2 - 0.06 * s, 0, sh);
    const elbow = new THREE.Group(); elbow.position.y = -upLen - 0.08 * s; sh.add(elbow);
    elbow.rotation.x = -1.2;
    const ej = M(cyl(0.06 * s, 0.06 * s, 0.15 * s, 10), mats.joint, 0, 0, 0, elbow); ej.rotation.z = Math.PI / 2;
    const ws = byLoc(loc).slice().sort((a, b) => weaponSize(b.t) - weaponSize(a.t));
    const single = ws.length === 1 && isBig(ws[0].t);
    if (!single) {
      M(plate(0.15 * s, 0.32 * s, 0.17 * s), mats.dark, 0, -0.16 * s, 0, elbow);
      M(plate(0.16 * s, 0.2 * s, 0.04 * s), mats.body, 0, -0.18 * s, 0.09 * s, elbow);
    }
    if (!ws.length) { // hand with fingers
      M(plate(0.13 * s, 0.1 * s, 0.11 * s), mats.joint, 0, -0.36 * s, 0, elbow);
      for (let f = 0; f < 3; f++) { const fg = M(plate(0.028 * s, 0.09 * s, 0.035 * s), mats.dark, (f - 1) * 0.04 * s, -0.44 * s, 0.03 * s, elbow); fg.rotation.x = 0.4; }
      const th = M(plate(0.028 * s, 0.07 * s, 0.035 * s), mats.dark, side * -0.07 * s, -0.4 * s, 0.03 * s, elbow); th.rotation.z = side * 0.5;
    }
    ws.forEach((w, k) => {
      if (single) { M(plate(0.17 * s, 0.14 * s, 0.17 * s), mats.dark, 0, -0.08 * s, 0, elbow); mount(w, elbow, new THREE.Vector3(0, -0.14 * s, 0), true, 1.25); return; }
      const [dx, dz] = ARM_SLOTS[k % ARM_SLOTS.length];
      mount(w, elbow, new THREE.Vector3(dx * s * side, -0.3 * s, dz * s), true);
    });
    if (!muzzles[loc]) { const mz = new THREE.Object3D(); mz.position.y = -0.4 * s; elbow.add(mz); muzzles[loc] = mz; }
    arms.push({ sh, elbow, side, loc });
  }

  // ---- merge static geometry, then collect weapon meshes for highlighting
  mergeStatic(root);
  for (const wm of Object.values(weaponMounts)) wm.group.traverse((o) => { if (o.isMesh) wm.meshes.push(o); });
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  for (const lg of legs) if (!muzzles[lg.loc]) { const mz = new THREE.Object3D(); mz.position.set(0, -0.2 * s, 0.12 * s); lg.hip.add(mz); muzzles[lg.loc] = mz; }
  const height = hipY + torsoH + 0.3 * s;
  // Kneeling pose for tracks / QuadVee vehicle mode: thighs straight down, shins swung back
  // flat so the track pods carry the mech, body lowered onto them.
  const pods = legs.filter((l) => l.pod);
  const kneelDrop = !pods.length ? 0 : qv ? hipY - pods[0].pod.below - 0.02 * s : Math.min(...pods.map((l) => hipY + l.knee.position.y - l.pod.below));
  const wheels = pods.flatMap((l) => l.pod.wheels);
  const treads = pods.map((l) => l.pod.tread);
  const trackGauge = pods.length ? Math.max(...pods.map((l) => Math.abs(l.hip.position.x))) : 0;
  const model = { root, body, torso, head, legs, arms, muzzles, weaponMounts, jets, mats, height, scale: s, quad, tripod, wheels, treads, trackGauge, vk: 0 };
  model.setVehicle = (k) => {
    model.vk = k;
    if (!pods.length) return;
    for (const l of legs) {
      if (l.fold) { // thigh flat (back for front legs, forward for rear legs), shin folded under it
        l.hip.rotation.x = l.fold * (Math.PI / 2) * k;
        l.knee.rotation.x = l.rest + (-l.fold * Math.PI - l.rest) * k;
        l.hip.rotation.z = 0;
      } else {
        l.hip.rotation.x = 0;
        l.knee.rotation.x = l.rest + (Math.PI / 2 - l.rest) * k;
      }
    }
    model.vOffset = -kneelDrop * k;
    body.position.y = model.vOffset;
  };
  model.vOffset = 0;
  return model;
}
// Drive the tracks: dist is how far the mech rolled (world units); links run round the
// loop and every wheel turns to match
export function rollTracks(model, dist) {
  for (const w of model.wheels) w.g.rotation.x -= w.sign * dist / w.r;
  for (const t of model.treads) { t.phase += t.sign * dist; t.place(); }
}

export function buildItem(kind) {
  const g = new THREE.Group();
  const glow = new THREE.MeshStandardMaterial({ color: '#ffd166', emissive: '#ffb23e', emissiveIntensity: 1.4, metalness: 0.2, roughness: 0.4 });
  if (kind === 'Last Pepsi') {
    const bottle = new THREE.Mesh(cyl(0.12, 0.14, 0.42, 14), new THREE.MeshStandardMaterial({ color: '#1f3fa8', metalness: 0.3, roughness: 0.2, emissive: '#16308a', emissiveIntensity: 0.6 }));
    bottle.position.y = 0.25; g.add(bottle);
    const label = new THREE.Mesh(cyl(0.145, 0.145, 0.12, 14), new THREE.MeshStandardMaterial({ color: '#e02b2b', emissive: '#a01010', emissiveIntensity: 0.6 }));
    label.position.y = 0.24; g.add(label);
    const neck = new THREE.Mesh(cyl(0.05, 0.11, 0.16, 12), bottle.material); neck.position.y = 0.53; g.add(neck);
  } else if (kind === 'Spy') {
    const mat = new THREE.MeshStandardMaterial({ color: '#2f3136', emissive: '#ff5a3c', emissiveIntensity: 0.25 });
    const bodyM = new THREE.Mesh(cyl(0.06, 0.08, 0.3, 8), mat); bodyM.position.y = 0.2; g.add(bodyM);
    const headM = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), mat); headM.position.y = 0.42; g.add(headM);
    const hat = new THREE.Mesh(cyl(0.1, 0.1, 0.02, 12), mat); hat.position.y = 0.47; g.add(hat);
  } else if (kind === 'Datapack') {
    const wreck = new THREE.Mesh(box(0.9, 0.14, 0.3), new THREE.MeshStandardMaterial({ color: '#4a4f55', metalness: 0.6, roughness: 0.6 }));
    wreck.rotation.set(0.2, 0.6, 0.15); wreck.position.y = 0.1; g.add(wreck);
    const wing = new THREE.Mesh(box(0.15, 0.04, 0.8), wreck.material); wing.position.set(0.1, 0.12, 0); wing.rotation.y = 0.5; g.add(wing);
    const pack = new THREE.Mesh(box(0.2, 0.14, 0.16), glow); pack.position.set(-0.2, 0.2, 0.1); g.add(pack);
  } else {
    const cell = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), glow); cell.position.y = 0.4; g.add(cell);
    const base = new THREE.Mesh(cyl(0.22, 0.28, 0.12, 6), new THREE.MeshStandardMaterial({ color: '#3b4148', metalness: 0.7, roughness: 0.4 }));
    base.position.y = 0.06; g.add(base);
  }
  const beam = new THREE.Mesh(cyl(0.05, 0.05, 6, 8, true), new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
  beam.position.y = 3; g.add(beam);
  return g;
}
