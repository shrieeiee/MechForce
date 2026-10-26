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
  const birdLeg = (h % 4 === 0) || cls === 0 && h % 2 === 0;

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
  // missile pods on the shoulders if carrying missiles
  const missiles = [...types].filter((t) => WEAPONS[t].kind === 'm');
  if (missiles.length) {
    const lrm = missiles.some((t) => WEAPONS[t].lrm);
    for (const side of [-1, 1]) {
      const podW = (lrm ? 0.24 : 0.18) * s;
      const pod = new THREE.Mesh(box(podW, 0.2 * s, 0.3 * s), mats.trim);
      pod.position.set(side * torsoW * 0.36, torsoH + 0.08 * s, -0.02 * s);
      torso.add(pod);
      const face = new THREE.Mesh(box(podW * 0.86, 0.16 * s, 0.02 * s), mats.dark);
      face.position.set(side * torsoW * 0.36, torsoH + 0.08 * s, 0.14 * s);
      torso.add(face);
      const mz = new THREE.Object3D(); mz.position.set(side * torsoW * 0.36, torsoH + 0.1 * s, 0.18 * s);
      torso.add(mz);
      muzzles[side < 0 ? 1 : 3] = mz;
    }
  }
  // torso-mounted guns (CT/H)
  const ctM = new THREE.Object3D(); ctM.position.set(0, torsoH * 0.55, torsoD / 2 + 0.06 * s); torso.add(ctM); muzzles[2] = muzzles[2] || ctM;
  const hM = new THREE.Object3D(); hM.position.set(0, torsoH + 0.12 * s, torsoD * 0.3); torso.add(hM); muzzles[0] = hM;
  if (!muzzles[1]) { const m = new THREE.Object3D(); m.position.set(-torsoW * 0.37, torsoH * 0.5, torsoD / 2 + 0.03); torso.add(m); muzzles[1] = m; }
  if (!muzzles[3]) { const m = new THREE.Object3D(); m.position.set(torsoW * 0.37, torsoH * 0.5, torsoD / 2 + 0.03); torso.add(m); muzzles[3] = m; }

  // arms
  const arms = [];
  const armLoc = { 4: spec.weapons.filter((w) => w.loc === 4), 5: spec.weapons.filter((w) => w.loc === 5) };
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
    const ws = armLoc[loc];
    const big = ws.find((w) => [2, 3, 14, 16, 0, 1].includes(w.t));
    const mz = new THREE.Object3D();
    if (big) {
      const len = ([0, 2].includes(big.t) ? 0.62 : big.t === 3 ? 0.4 : 0.5) * s;
      const rad = (big.t === 3 ? 0.07 : big.t === 16 ? 0.06 : 0.04) * s;
      const barrel = new THREE.Mesh(cyl(rad, rad * 1.2, len, 10), mats.barrel);
      barrel.position.y = -0.3 * s - len / 2;
      elbow.add(barrel);
      if (big.t === 16) { const ring = new THREE.Mesh(cyl(rad * 1.8, rad * 1.8, 0.05 * s, 10), mats.trim); ring.position.y = -0.3 * s - len * 0.7; elbow.add(ring); }
      mz.position.y = -0.3 * s - len;
    } else if (ws.length) {
      for (let i = 0; i < Math.min(2, ws.length); i++) {
        const b = new THREE.Mesh(cyl(0.022 * s, 0.022 * s, 0.26 * s, 6), mats.barrel);
        b.position.set((i - 0.5) * 0.06 * s, -0.42 * s, 0.03 * s);
        elbow.add(b);
      }
      mz.position.y = -0.56 * s;
    } else {
      const hand = new THREE.Mesh(box(0.14 * s, 0.14 * s, 0.12 * s), mats.joint);
      hand.position.y = -0.38 * s;
      elbow.add(hand);
      mz.position.y = -0.4 * s;
    }
    elbow.add(mz);
    muzzles[loc] = mz;
    arms.push({ sh, elbow, side, loc });
  }

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const height = hipY + torsoH + 0.3 * s;
  return { root, body, torso, head, legs, arms, muzzles, jets, mats, height, scale: s };
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
