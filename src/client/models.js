import * as THREE from 'three';
import { WEAPONS } from '../core/data.js';

const geoCache = new Map();
function box(w, h, d) {
  const k = `b${w.toFixed(3)},${h.toFixed(3)},${d.toFixed(3)}`;
  if (!geoCache.has(k)) {
    const g = new THREE.BoxGeometry(w, h, d);
    geoCache.set(k, g);
  }
  return geoCache.get(k);
}
function cyl(r1, r2, h, s = 8) {
  const k = `c${r1},${r2},${h},${s}`;
  if (!geoCache.has(k)) { const g = new THREE.CylinderGeometry(r1, r2, h, s); geoCache.set(k, g); }
  return geoCache.get(k);
}

function hashStr(s) { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }

function glowMat(c, k = 1.6) { return new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: k, roughness: 0.3, metalness: 0.1 }); }

export function weaponSize(t) { return [3, 5, 7, 9, 1, 3, 5, 7, 9, 2, 3, 4, 1, 2, 4, 2, 6][t] || 1; }

// One visible part per weapon, built along +Z with its muzzle at the far end.
export function weaponPart(t, s, mats) {
  const g = new THREE.Group();
  const W = WEAPONS[t];
  const along = (geo, mat, z0, len) => { const m = new THREE.Mesh(geo, mat); m.rotation.x = Math.PI / 2; m.position.z = z0 + len / 2; g.add(m); return m; };
  let len = 0.2 * s;
  if (W.kind === 'm') {
    const n = W.n, lrm = !!W.lrm;
    const cols = n <= 2 ? 2 : n <= 6 ? 3 : n <= 10 ? 4 : 5, rows = Math.ceil(Math.min(n, 20) / cols);
    const cw = 0.045 * s, w = cols * cw + 0.03 * s, h = rows * cw + 0.03 * s, d = (lrm ? 0.24 : 0.16) * s;
    const housing = new THREE.Mesh(box(w, h, d), mats.trim); housing.position.z = d / 2 - 0.02 * s; g.add(housing);
    const face = new THREE.Mesh(box(w * 0.92, h * 0.88, 0.012 * s), mats.dark); face.position.z = d - 0.015 * s; g.add(face);
    const tubeGeo = cyl(cw * 0.32, cw * 0.32, 0.01 * s, 6);
    for (let k = 0; k < Math.min(n, rows * cols); k++) {
      const tube = new THREE.Mesh(tubeGeo, mats.tube);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(((k % cols) - (cols - 1) / 2) * cw, (Math.floor(k / cols) - (rows - 1) / 2) * cw, d - 0.006 * s);
      g.add(tube);
    }
    len = d;
  } else if (t <= 3) { // autocannons
    const r = [0.022, 0.03, 0.042, 0.06][t] * s, l = [0.62, 0.5, 0.45, 0.34][t] * s;
    along(cyl(r * 1.6, r * 1.6, 0.1 * s, 10), mats.joint, 0, 0.1 * s);
    along(cyl(r, r * 1.1, l, 10), mats.barrel, 0.08 * s, l);
    if (t >= 2) { const brake = new THREE.Mesh(box(r * 3, r * 2.4, 0.06 * s), mats.barrel); brake.position.z = 0.08 * s + l; g.add(brake); }
    len = 0.08 * s + l + (t >= 2 ? 0.03 * s : 0);
  } else if (t === 4) { // machine gun: twin barrels
    for (const dx of [-1, 1]) { const b = along(cyl(0.012 * s, 0.012 * s, 0.2 * s, 6), mats.barrel, 0, 0.2 * s); b.position.x = dx * 0.018 * s; }
    const body = new THREE.Mesh(box(0.07 * s, 0.05 * s, 0.08 * s), mats.joint); body.position.z = 0.02 * s; g.add(body);
    len = 0.2 * s;
  } else if (t >= 12 && t <= 14) { // lasers
    const k = t - 12;
    const r = [0.022, 0.03, 0.04][k] * s, l = [0.16, 0.24, 0.36][k] * s;
    along(cyl(r * 1.5, r * 1.7, l * 0.4, 8), mats.joint, 0, l * 0.4);
    along(cyl(r, r, l, 8), mats.barrel, l * 0.2, l);
    along(cyl(r * 0.75, r * 0.75, 0.025 * s, 10), [mats.lensS, mats.lensM, mats.lensL][k], l * 1.2, 0.025 * s);
    len = l * 1.2 + 0.025 * s;
  } else if (t === 15) { // flamer
    along(cyl(0.03 * s, 0.05 * s, 0.14 * s, 8), mats.joint, 0, 0.14 * s);
    along(cyl(0.045 * s, 0.03 * s, 0.05 * s, 8), mats.flame, 0.14 * s, 0.05 * s);
    len = 0.19 * s;
  } else { // plasma cannon
    const l = 0.46 * s;
    along(cyl(0.035 * s, 0.045 * s, l, 10), mats.barrel, 0, l);
    for (let k = 0; k < 3; k++) along(cyl(0.06 * s, 0.06 * s, 0.03 * s, 10), mats.trim, l * (0.25 + k * 0.22), 0.03 * s);
    along(cyl(0.028 * s, 0.028 * s, 0.03 * s, 10), mats.lensB, l, 0.03 * s);
    len = l + 0.03 * s;
  }
  const mz = new THREE.Object3D(); mz.position.z = len + 0.02 * s; g.add(mz);
  return { g, mz, len };
}

export function mechMaterials(colorHex) {
  const base = new THREE.Color(colorHex);
  const body = base.clone().lerp(new THREE.Color('#9aa3ad'), 0.45);
  return {
    body: new THREE.MeshStandardMaterial({ color: body, metalness: 0.55, roughness: 0.5 }),
    trim: new THREE.MeshStandardMaterial({ color: base, metalness: 0.35, roughness: 0.45, emissive: base, emissiveIntensity: 0.12 }),
    dark: new THREE.MeshStandardMaterial({ color: '#2b3036', metalness: 0.7, roughness: 0.45 }),
    joint: new THREE.MeshStandardMaterial({ color: '#4b535c', metalness: 0.8, roughness: 0.35 }),
    glass: new THREE.MeshStandardMaterial({ color: '#0b1a22', metalness: 0.2, roughness: 0.1, emissive: new THREE.Color('#58d6ff'), emissiveIntensity: 1.1 }),
    barrel: new THREE.MeshStandardMaterial({ color: '#1d2125', metalness: 0.85, roughness: 0.3 }),
    lensS: glowMat('#ff8a3c'), lensM: glowMat('#ff4d9a'), lensL: glowMat('#ff3b5c'), lensB: glowMat('#7fc8ff'), flame: glowMat('#ffb02e'), tube: glowMat('#3a1a0a', 0.4),
  };
}

// Build a mech model. Faces +Z. Returns handles for animation and effects.
export function buildMech(spec, colorHex) {
  const { design, tons, cls } = spec;
  const types = new Set(spec.weapons.map((w) => w.t));
  const h = hashStr(design);
  const s = 0.62 + tons / 260 + cls * 0.03; // overall scale
  const mats = mechMaterials(colorHex);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const legLen = (0.52 + (h % 7) * 0.02 + (cls === 0 ? 0.08 : 0)) * s;
  const torsoW = (0.62 + cls * 0.07 + (h % 5) * 0.02) * s;
  const torsoH = (0.42 + cls * 0.04) * s;
  const torsoD = (0.42 + (h % 3) * 0.04) * s;
  const hipY = legLen * 1.9;
  const birdLeg = cls <= 1 && (h % 4 === 0 || (cls === 0 && h % 2 === 0));

  // legs
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * torsoW * 0.28, hipY, 0);
    const thigh = new THREE.Mesh(box(0.18 * s, legLen, 0.22 * s), mats.body);
    thigh.position.y = -legLen / 2;
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -legLen;
    hip.add(knee);
    const kneeCap = new THREE.Mesh(box(0.2 * s, 0.14 * s, 0.24 * s), mats.joint);
    knee.add(kneeCap);
    const shin = new THREE.Mesh(box(0.16 * s, legLen * 0.95, 0.2 * s), mats.trim);
    shin.position.y = -legLen * 0.47;
    knee.add(shin);
    const foot = new THREE.Mesh(box(0.24 * s, 0.08 * s, 0.38 * s), mats.dark);
    foot.position.set(0, -legLen * 0.92, 0.04 * s);
    knee.add(foot);
    if (birdLeg) { thigh.rotation.x = -0.35; knee.rotation.x = 0.7; }
    body.add(hip);
    legs.push({ hip, knee, side, bird: birdLeg });
  }

  // pelvis
  const pelvis = new THREE.Mesh(box(torsoW * 0.62, 0.16 * s, torsoD * 0.7), mats.joint);
  pelvis.position.y = hipY;
  body.add(pelvis);

  // torso (twists)
  const torso = new THREE.Group();
  torso.position.y = hipY + 0.08 * s;
  body.add(torso);
  const ct = new THREE.Mesh(box(torsoW * 0.46, torsoH, torsoD), mats.body);
  ct.position.y = torsoH / 2;
  torso.add(ct);
  const chest = new THREE.Mesh(box(torsoW * 0.36, torsoH * 0.55, 0.05 * s), mats.trim);
  chest.position.set(0, torsoH * 0.55, torsoD / 2 + 0.02 * s);
  torso.add(chest);
  for (const side of [-1, 1]) {
    const st = new THREE.Mesh(box(torsoW * 0.3, torsoH * 0.86, torsoD * 0.92), mats.body);
    st.position.set(side * torsoW * 0.37, torsoH * 0.45, -0.01);
    torso.add(st);
    const stripe = new THREE.Mesh(box(torsoW * 0.31, torsoH * 0.12, torsoD * 0.94), mats.trim);
    stripe.position.set(side * torsoW * 0.37, torsoH * 0.18, -0.01);
    torso.add(stripe);
  }
  // cockpit / head
  const head = new THREE.Group();
  head.position.set(0, torsoH + 0.02 * s, torsoD * 0.12);
  torso.add(head);
  const headBox = new THREE.Mesh(box(0.26 * s, 0.16 * s, 0.26 * s), mats.body);
  headBox.position.y = 0.08 * s;
  head.add(headBox);
  const glass = new THREE.Mesh(box(0.2 * s, 0.06 * s, 0.04 * s), mats.glass);
  glass.position.set(0, 0.1 * s, 0.13 * s);
  head.add(glass);
  if (h % 3 === 1) { // antenna
    const ant = new THREE.Mesh(cyl(0.008 * s, 0.008 * s, 0.35 * s, 4), mats.dark);
    ant.position.set(0.09 * s, 0.3 * s, -0.05 * s); head.add(ant);
  }
  // back: reactor vents / jump jets
  const pack = new THREE.Mesh(box(torsoW * 0.5, torsoH * 0.6, 0.14 * s), mats.dark);
  pack.position.set(0, torsoH * 0.5, -torsoD / 2 - 0.06 * s);
  torso.add(pack);
  const jets = [];
  if (spec.jump > 0) {
    for (const side of [-1, 1]) {
      const j = new THREE.Mesh(cyl(0.06 * s, 0.08 * s, 0.22 * s, 8), mats.joint);
      j.position.set(side * torsoW * 0.18, torsoH * 0.25, -torsoD / 2 - 0.15 * s);
      torso.add(j);
      const nozzle = new THREE.Object3D(); nozzle.position.set(side * torsoW * 0.18, torsoH * 0.1, -torsoD / 2 - 0.15 * s);
      torso.add(nozzle); jets.push(nozzle);
    }
  }

  const muzzles = {};
  const weaponMounts = {};
  const byLoc = (loc) => spec.weapons.filter((w) => w.loc === loc);
  const mount = (w, parent, pos, alongDown) => {
    const part = weaponPart(w.t, s, mats);
    if (alongDown) part.g.rotation.x = Math.PI / 2; // build axis +Z -> arm axis -Y
    part.g.position.copy(pos);
    parent.add(part.g);
    const meshes = [];
    part.g.traverse((o) => { if (o.isMesh) meshes.push(o); });
    weaponMounts[w.i] = { muzzle: part.mz, meshes, group: part.g };
    if (!muzzles[w.loc]) muzzles[w.loc] = part.mz;
  };
  // side torsos: missile racks ride on the shoulders, guns poke out of the front
  for (const [side, loc] of [[-1, 1], [1, 3]]) {
    const ws = byLoc(loc);
    let mi = 0, gi = 0;
    for (const w of ws) {
      if (WEAPONS[w.t].kind === 'm') {
        const x = side * (torsoW * 0.3 + (mi % 2) * 0.13 * s), z = -0.12 * s + Math.floor(mi / 2) * 0.0;
        mount(w, torso, new THREE.Vector3(x, torsoH + 0.04 * s + Math.floor(mi / 2) * 0.17 * s, z), false);
        mi++;
      } else {
        const x = side * (torsoW * 0.3 + (gi % 2) * 0.09 * s), y = torsoH * (0.7 - Math.floor(gi / 2) * 0.28);
        mount(w, torso, new THREE.Vector3(x, y, torsoD / 2 * 0.92), false);
        gi++;
      }
    }
  }
  // center torso: a row of chest guns (missiles get a chest launcher)
  byLoc(2).forEach((w, k) => {
    const n = byLoc(2).length;
    const x = (k - (n - 1) / 2) * 0.09 * s;
    mount(w, torso, new THREE.Vector3(x, torsoH * (WEAPONS[w.t].kind === 'm' ? 0.3 : 0.42), torsoD / 2 + 0.02 * s), false);
  });
  // head-mounted
  byLoc(0).forEach((w, k) => mount(w, head, new THREE.Vector3((k - 0.5) * 0.07 * s + (byLoc(0).length === 1 ? 0.035 * s : 0), 0.04 * s, 0.12 * s), false));
  // legs (rare): fire from the thigh
  for (const [loc, li] of [[6, 0], [7, 1]]) byLoc(loc).forEach((w, k) => mount(w, legs[li].hip, new THREE.Vector3(0, -0.2 * s - k * 0.12 * s, 0.12 * s), false));
  if (!muzzles[2]) { const m = new THREE.Object3D(); m.position.set(0, torsoH * 0.55, torsoD / 2 + 0.06 * s); torso.add(m); muzzles[2] = m; }
  if (!muzzles[0]) { const m = new THREE.Object3D(); m.position.set(0, torsoH + 0.12 * s, torsoD * 0.3); torso.add(m); muzzles[0] = m; }

  // arms: every arm weapon is clustered around the forearm
  const arms = [];
  const ARM_SLOTS = [[0, 0], [-0.075, 0.07], [0.075, 0.07], [0, 0.13], [-0.075, -0.06], [0.075, -0.06]];
  for (const [side, loc] of [[-1, 4], [1, 5]]) {
    const sh = new THREE.Group();
    sh.position.set(side * (torsoW * 0.52 + 0.06 * s), torsoH * 0.78, 0);
    torso.add(sh);
    const shoulder = new THREE.Mesh(box(0.2 * s, 0.2 * s, 0.26 * s), mats.trim);
    sh.add(shoulder);
    const upper = new THREE.Mesh(box(0.13 * s, 0.34 * s, 0.15 * s), mats.body);
    upper.position.y = -0.24 * s;
    sh.add(upper);
    const elbow = new THREE.Group(); elbow.position.y = -0.42 * s; sh.add(elbow);
    elbow.rotation.x = -1.2;
    const fore = new THREE.Mesh(box(0.15 * s, 0.34 * s, 0.17 * s), mats.dark);
    fore.position.y = -0.15 * s;
    elbow.add(fore);
    const ws = byLoc(loc).slice().sort((a, b) => weaponSize(b.t) - weaponSize(a.t));
    if (!ws.length) {
      const hand = new THREE.Mesh(box(0.14 * s, 0.14 * s, 0.12 * s), mats.joint);
      hand.position.y = -0.38 * s;
      elbow.add(hand);
    }
    ws.forEach((w, k) => {
      const [dx, dz] = ARM_SLOTS[k % ARM_SLOTS.length];
      mount(w, elbow, new THREE.Vector3(dx * s * side, -0.3 * s, dz * s), true);
    });
    if (!muzzles[loc]) { const mz = new THREE.Object3D(); mz.position.y = -0.4 * s; elbow.add(mz); muzzles[loc] = mz; }
    arms.push({ sh, elbow, side, loc });
  }

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const height = hipY + torsoH + 0.3 * s;
  return { root, body, torso, head, legs, arms, muzzles, weaponMounts, jets, mats, height, scale: s };
}

// Items and props
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
