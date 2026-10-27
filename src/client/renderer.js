import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { center, DIR_ANGLE, toAxial, fromAxial, neighbor } from '../core/hex.js';
import { WEAPONS, TERRAIN } from '../core/data.js';
import { totalArmor, maxArmor, operational } from '../core/rules.js';
import { buildMech, buildItem } from './models.js';
import { sfx } from './audio.js';
import { input } from './input.js';

const ELEV = 0.42;
export const topY = (e) => 0.2 + e * ELEV;
export function hexWorld(x, y) { const c = center(x, y); return new THREE.Vector3(c.px, 0, c.py); }
const facingRot = (f) => { const a = DIR_ANGLE[f] * Math.PI / 180; return Math.atan2(Math.cos(a), Math.sin(a)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const THEMES = {
  temperate: { t: ['#6a8a45', '#55773a', '#3c5b2e', '#857f6c', '#2f6584', '#1f4a68'], side: '#54473a', ground: '#3a4630', fog: '#9fb4bd', sky: '#b9ccd4', hemi: ['#d8ecff', '#4d5b3a'], sun: '#fff1d6', tree: ['#3f6b2c', '#2f5524'], trunk: '#5a4330', rock: '#7d786a', water: '#3a7aa0', lava: false },
  desert: { t: ['#cfa96c', '#a7a25c', '#7d8443', '#b48a5c', '#3c8597', '#2a6576'], side: '#94714a', ground: '#b08b5c', fog: '#e9d1a6', sky: '#f0dcb4', hemi: ['#fff1d8', '#a07a4c'], sun: '#ffe2b0', tree: ['#7e8a3e', '#5f6b2e'], trunk: '#6b4b2e', rock: '#9c7a52', water: '#3f95a8', lava: false },
  snow: { t: ['#e4ebf1', '#b7c9bf', '#86a092', '#c3ccd6', '#7aa0bb', '#557d9b'], side: '#909eab', ground: '#c9d4de', fog: '#d6e1ea', sky: '#e3ecf3', hemi: ['#f0f6ff', '#8592a0'], sun: '#ffffff', tree: ['#3d5d4f', '#2d4a3e'], trunk: '#4e4038', rock: '#a9b4bf', water: '#8fb7d0', lava: false },
  lunar: { t: ['#8e9096', '#8e9096', '#8e9096', '#6f7178', '#55575e', '#45474d'], side: '#4b4d54', ground: '#2b2c31', fog: '#06070c', sky: '#05060a', hemi: ['#c8d0ff', '#1a1a22'], sun: '#f4f6ff', tree: ['#666', '#555'], trunk: '#444', rock: '#5d5f66', water: '#55575e', lava: false, stars: true },
  volcanic: { t: ['#3e3734', '#4a3f30', '#352d24', '#2c2523', '#ff5a1f', '#ff3d0a'], side: '#25201e', ground: '#1d1715', fog: '#3a1d14', sky: '#2a130d', hemi: ['#ffb08a', '#2a1510'], sun: '#ffc39a', tree: ['#3b3326', '#2b241b'], trunk: '#2a201a', rock: '#3a302c', water: '#ff5a1f', lava: true },
};

function radialTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Renderer {
  constructor(canvas, labelLayer) {
    this.canvas = canvas;
    this.labelLayer = labelLayer;
    this.quality = 'high';
    this.speed = 1;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
    this.cam = { target: new THREE.Vector3(0, 0, 0), want: new THREE.Vector3(0, 0, 0), yaw: 0.0, pitch: 0.92, dist: 15, wantDist: 15 };
    this.hemi = new THREE.HemisphereLight('#ffffff', '#444444', 1.0);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#ffffff', 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    this.world = new THREE.Group(); this.scene.add(this.world);
    this.fxGroup = new THREE.Group(); this.scene.add(this.fxGroup);
    this.overlayGroup = new THREE.Group(); this.scene.add(this.overlayGroup);
    this.mechs = new Map();
    this.particles = [];
    this.beams = [];
    this.tex = radialTexture();
    this.raycaster = new THREE.Raycaster();
    this.time = 0;
    this.queue = Promise.resolve();
    this.pendingAnims = 0;
    this.setupOverlays();
    this.composer = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(q) {
    this.quality = q;
    const dpr = Math.min(window.devicePixelRatio || 1, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1);
    this.gl.setPixelRatio(q === 'low' ? Math.min(1, dpr) : dpr);
    this.gl.shadowMap.enabled = q !== 'low';
    this.sun.castShadow = q !== 'low';
    this.sun.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    if (q !== 'low') {
      this.composer = new EffectComposer(this.gl);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.82);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    } else this.composer = null;
    this.resize();
    this.gl.compile(this.scene, this.camera);
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) { this.composer.setSize(w, h); this.composer.setPixelRatio(this.gl.getPixelRatio()); }
  }

  // --------------------------------------------------------------- terrain
  buildMap(map) {
    this.map = map;
    this.world.clear();
    const th = THEMES[map.theme] || THEMES.temperate;
    this.theme = th;
    this.scene.background = new THREE.Color(th.sky);
    this.scene.fog = new THREE.Fog(th.fog, 40, 110);
    this.hemi.color.set(th.hemi[0]); this.hemi.groundColor.set(th.hemi[1]);
    this.hemi.intensity = map.theme === 'lunar' ? 0.35 : 0.9;
    this.sun.color.set(th.sun);
    this.sun.intensity = map.theme === 'volcanic' ? 1.4 : 2.3;
    const { w, h } = map;
    const pos = [], col = [], idx = [];
    const lines = [];
    const tmpC = new THREE.Color();
    const rnd = (i) => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); };
    const corners = [];
    for (let i = 0; i < 6; i++) { const a = (60 * i - 30) * Math.PI / 180; corners.push([Math.cos(a), Math.sin(a)]); }
    let vi = 0;
    const waterPos = [], waterIdx = [];
    let wvi = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const t = map.t[y * w + x], e = map.e[y * w + x];
      const c = center(x, y);
      const isWater = t === 4 || t === 5;
      const top = isWater ? topY(0) - (t === 5 ? 0.3 : 0.18) : topY(e);
      const base = -0.6;
      tmpC.set(th.t[t]);
      const jitter = (rnd(x * 31 + y * 17) - 0.5) * 0.08;
      tmpC.offsetHSL(0, 0, jitter + e * 0.025);
      const side = new THREE.Color(th.side).offsetHSL(0, 0, e * 0.02 - 0.02);
      const R = 0.995;
      // top centre + ring
      pos.push(c.px, top, c.py); col.push(tmpC.r, tmpC.g, tmpC.b);
      const ci = vi++;
      for (let k = 0; k < 6; k++) {
        pos.push(c.px + corners[k][0] * R, top, c.py + corners[k][1] * R);
        const edgeShade = 0.9;
        col.push(tmpC.r * edgeShade, tmpC.g * edgeShade, tmpC.b * edgeShade);
        vi++;
      }
      for (let k = 0; k < 6; k++) idx.push(ci, ci + 1 + ((k + 1) % 6), ci + 1 + k);
      // sides
      for (let k = 0; k < 6; k++) {
        const a = corners[k], b = corners[(k + 1) % 6];
        const s0 = vi;
        pos.push(c.px + a[0] * R, top, c.py + a[1] * R, c.px + b[0] * R, top, c.py + b[1] * R, c.px + b[0] * R, base, c.py + b[1] * R, c.px + a[0] * R, base, c.py + a[1] * R);
        for (let q = 0; q < 4; q++) { const f = q < 2 ? 1 : 0.55; col.push(side.r * f, side.g * f, side.b * f); }
        vi += 4;
        idx.push(s0, s0 + 2, s0 + 1, s0, s0 + 3, s0 + 2);
      }
      // grid outline
      for (let k = 0; k < 6; k++) {
        const a = corners[k], b = corners[(k + 1) % 6];
        lines.push(c.px + a[0], top + 0.01, c.py + a[1], c.px + b[0], top + 0.01, c.py + b[1]);
      }
      if (isWater) {
        const wy = topY(0) - 0.06;
        waterPos.push(c.px, wy, c.py);
        const w0 = wvi++;
        for (let k = 0; k < 6; k++) { waterPos.push(c.px + corners[k][0], wy, c.py + corners[k][1]); wvi++; }
        for (let k = 0; k < 6; k++) waterIdx.push(w0, w0 + 1 + ((k + 1) % 6), w0 + 1 + k);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const terrain = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02, flatShading: true }));
    terrain.receiveShadow = true; terrain.castShadow = true;
    this.terrain = terrain;
    this.world.add(terrain);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    this.world.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: map.theme === 'snow' ? '#5a6878' : '#000000', transparent: true, opacity: map.theme === 'snow' ? 0.22 : 0.16 })));
    if (waterPos.length) {
      const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(waterPos, 3)); wg.setIndex(waterIdx); wg.computeVertexNormals();
      this.waterMat = new THREE.MeshStandardMaterial({ color: th.water, transparent: !th.lava, opacity: th.lava ? 1 : 0.72, roughness: th.lava ? 0.7 : 0.08, metalness: th.lava ? 0 : 0.3,
        emissive: th.lava ? new THREE.Color('#ff3c00') : new THREE.Color('#0a2a3a'), emissiveIntensity: th.lava ? 1.3 : 0.3 });
      this.world.add(new THREE.Mesh(wg, this.waterMat));
    } else this.waterMat = null;
    // ground skirt
    const c0 = center(0, 0), c1 = center(w - 1, h - 1);
    this.bounds = { x0: c0.px - 1, z0: c0.py - 1, x1: c1.px + 1, z1: c1.py + 1 };
    const cx = (this.bounds.x0 + this.bounds.x1) / 2, cz = (this.bounds.z0 + this.bounds.z1) / 2;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: th.ground, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(cx, -0.55, cz); ground.receiveShadow = true;
    this.world.add(ground);
    // trees and rocks
    const treeCount = this.quality === 'low' ? [0, 2, 3] : [0, 3, 6];
    const trees = [], rocks = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const t = map.t[y * w + x], e = map.e[y * w + x];
      const c = center(x, y);
      const n = t === 1 ? treeCount[1] : t === 2 ? treeCount[2] : 0;
      for (let i = 0; i < n; i++) {
        const r = Math.sqrt(rnd(x * 7 + y * 13 + i * 3.1)) * 0.68, a = rnd(x * 5 + y * 11 + i * 7.7) * Math.PI * 2;
        trees.push({ x: c.px + Math.cos(a) * r, z: c.py + Math.sin(a) * r, y: topY(e), s: 0.7 + rnd(x + y * 3 + i) * 0.6 * (t === 2 ? 1.25 : 1), dark: t === 2 });
      }
      if (t === 3) for (let i = 0; i < 4; i++) {
        const r = rnd(x * 3 + y * 7 + i) * 0.7, a = rnd(x * 9 + y * 2 + i * 5) * Math.PI * 2;
        rocks.push({ x: c.px + Math.cos(a) * r, z: c.py + Math.sin(a) * r, y: topY(e), s: 0.12 + rnd(x * 2 + y + i * 9) * 0.18 });
      }
    }
    const lunar = map.theme === 'lunar';
    if (trees.length && !lunar) {
      const cone = new THREE.ConeGeometry(0.22, 0.75, 6); cone.translate(0, 0.62, 0);
      const trunk = new THREE.CylinderGeometry(0.04, 0.05, 0.3, 5); trunk.translate(0, 0.15, 0);
      const im = new THREE.InstancedMesh(cone, new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }), trees.length);
      const it = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: th.trunk, roughness: 1 }), trees.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
      trees.forEach((tr, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), tr.x * 3); sc.set(tr.s, tr.s, tr.s); p.set(tr.x, tr.y, tr.z);
        m4.compose(p, q, sc); im.setMatrixAt(i, m4); it.setMatrixAt(i, m4);
        im.setColorAt(i, new THREE.Color(tr.dark ? th.tree[1] : th.tree[0]).offsetHSL(0, 0, (rnd(i) - 0.5) * 0.08));
      });
      im.castShadow = true; im.receiveShadow = true; it.castShadow = true;
      this.world.add(im, it);
    }
    if (rocks.length) {
      const rg = new THREE.DodecahedronGeometry(1, 0);
      const rm = new THREE.InstancedMesh(rg, new THREE.MeshStandardMaterial({ color: th.rock, roughness: 0.95, flatShading: true }), rocks.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
      rocks.forEach((r, i) => { q.setFromEuler(new THREE.Euler(r.x, r.z, r.x * r.z)); sc.set(r.s, r.s * 0.7, r.s); p.set(r.x, r.y + r.s * 0.3, r.z); m4.compose(p, q, sc); rm.setMatrixAt(i, m4); });
      rm.castShadow = true; rm.receiveShadow = true;
      this.world.add(rm);
    }
    if (th.stars) {
      const sp = [];
      for (let i = 0; i < 900; i++) { const a = rnd(i) * Math.PI * 2, b = rnd(i + 999) * 0.45 + 0.08; sp.push(cx + Math.cos(a) * Math.cos(b) * 160, Math.sin(b) * 160, cz + Math.sin(a) * Math.cos(b) * 160); }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
      this.world.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 0.6, fog: false })));
      const planet = new THREE.Mesh(new THREE.SphereGeometry(12, 32, 16), new THREE.MeshStandardMaterial({ color: '#3a6fb0', emissive: '#10284a', emissiveIntensity: 0.6, fog: false }));
      planet.position.set(cx - 90, 45, cz - 110); this.world.add(planet);
    }
    // sun & shadow frustum cover the map
    const span = Math.max(this.bounds.x1 - this.bounds.x0, this.bounds.z1 - this.bounds.z0) * 0.65;
    this.sun.position.set(cx - 14, 26, cz - 10);
    this.sun.target.position.set(cx, 0, cz);
    const sc = this.sun.shadow.camera;
    sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.near = 1; sc.far = 80; sc.updateProjectionMatrix();
    this.cam.want.set(cx, 0, cz); this.cam.target.copy(this.cam.want);
    this.mapCenter = new THREE.Vector3(cx, 0, cz);
    // edge markers group (mission exits)
    this.edgeGroup = new THREE.Group(); this.world.add(this.edgeGroup);
    for (const m of this.mechs.values()) { this.fxGroup.remove(m.smoke); }
    this.mechs.forEach((m) => { m.label.remove(); });
    this.mechs.clear();
    this.mechGroup = new THREE.Group(); this.world.add(this.mechGroup);
    this.itemObj = null;
  }

  tileTop(x, y) {
    const t = this.map.t[y * this.map.w + x];
    return t === 4 ? topY(0) - 0.35 : t === 5 ? topY(0) - 0.6 : topY(this.map.e[y * this.map.w + x]);
  }

  setExitEdges(edges) {
    this.edgeGroup.clear();
    if (!edges || !edges.length) return;
    const geo = new THREE.CircleGeometry(0.9, 6); geo.rotateX(-Math.PI / 2); geo.rotateY(Math.PI / 6);
    for (const { x: ex, color } of edges) {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false });
      for (let y = 0; y < this.map.h; y++) {
        const p = hexWorld(ex, y);
        const m = new THREE.Mesh(geo, mat);
        m.position.set(p.x, topY(this.map.e[y * this.map.w + ex]) + 0.025, p.z);
        this.edgeGroup.add(m);
      }
      this.edgeMat = mat;
    }
  }

  // --------------------------------------------------------------- mechs
  syncMechs(state, animateNew = false) {
    const seen = new Set();
    for (const m of state.mechs) {
      seen.add(m.id);
      let v = this.mechs.get(m.id);
      if (!v) {
        const color = state.sides[m.side].color;
        const model = buildMech({ design: m.design, tons: m.tons, cls: m.cls, weapons: m.weapons, jump: m.jumpBase }, color);
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.74, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.rotation.z = Math.PI / 6;
        model.root.add(ring);
        ring.position.y = 0.03;
        const label = document.createElement('div');
        label.className = 'mlabel';
        label.style.setProperty('--side', color);
        label.innerHTML = `<b></b><i><s class="arm"></s></i><i class="h"><s class="heat"></s></i>`;
        this.labelLayer.appendChild(label);
        v = { id: m.id, model, ring, label, prone: false, dead: false, walk: 0, torsoYaw: 0, wantYaw: 0, smoke: null, color };
        this.mechs.set(m.id, v);
        this.mechGroup.add(model.root);
      }
      v.state = m;
      if (!v.animating) this.placeMech(v, m);
      this.updateMechLook(v, m);
    }
    for (const [id, v] of this.mechs) if (!seen.has(id)) { this.mechGroup.remove(v.model.root); v.label.remove(); this.mechs.delete(id); }
    // item
    const it = state.item;
    if (it && !it.gone) {
      if (!this.itemObj) { this.itemObj = buildItem(it.name); this.world.add(this.itemObj); }
      if (it.carrier !== null && it.carrier !== undefined) {
        const cv = this.mechs.get(it.carrier);
        this.itemObj.visible = true;
        if (cv) { this.itemObj.position.copy(cv.model.root.position); this.itemObj.position.y += cv.model.height + 0.15; this.itemObj.scale.setScalar(0.7); this.itemCarrier = cv; }
      } else {
        this.itemCarrier = null;
        const p = hexWorld(it.x, it.y);
        this.itemObj.position.set(p.x, this.tileTop(it.x, it.y), p.z); this.itemObj.scale.setScalar(1); this.itemObj.visible = true;
      }
    } else if (this.itemObj) { this.itemObj.visible = false; this.itemCarrier = null; }
  }

  placeMech(v, m) {
    const p = hexWorld(m.x, m.y);
    v.model.root.position.set(p.x, this.tileTop(m.x, m.y), p.z);
    v.model.root.rotation.y = facingRot(m.f);
    v.model.root.visible = !m.exited;
    v.label.style.display = m.exited ? 'none' : '';
  }

  updateMechLook(v, m) {
    const mdl = v.model;
    const dead = m.dead;
    if (dead && !v.dead) {
      v.dead = true;
      mdl.root.traverse((o) => { if (o.isMesh && o.material && o.material.color) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.25); if (o.material.emissive) o.material.emissiveIntensity = 0; } });
      mdl.body.rotation.x = 0.5; mdl.body.rotation.z = 0.35; mdl.body.position.y = -mdl.height * 0.3;
      v.ring.visible = false;
    }
    if (!dead) {
      const proneNow = m.prone;
      if (proneNow !== v.prone) { v.prone = proneNow; mdl.body.rotation.x = proneNow ? 1.35 : 0; mdl.body.position.y = proneNow ? 0.2 : 0; }
      mdl.mats.glass.emissiveIntensity = m.shutdown || m.pilot.ko ? 0.05 : 1.1;
      // limbs blown off
      mdl.arms.forEach((a) => { a.sh.visible = !m.locGone[a.loc]; });
      mdl.legs.forEach((l, i) => { l.hip.scale.y = m.locGone[6 + (l.side < 0 ? 0 : 1)] ? 0.35 : 1; void i; });
    }
    v.damaged = !dead && totalArmor(m) / maxArmor(m) < 0.5;
    v.label.classList.toggle('dead', dead);
    v.label.querySelector('b').textContent = m.design;
    v.label.querySelector('.arm').style.width = (100 * totalArmor(m) / maxArmor(m)).toFixed(0) + '%';
    v.label.querySelector('.heat').style.width = Math.min(100, m.heat / 30 * 100).toFixed(0) + '%';
    v.label.classList.toggle('hot', m.heat >= 14);
  }

  // --------------------------------------------------------------- overlays
  setupOverlays() {
    const hexGeo = new THREE.CircleGeometry(0.9, 6); hexGeo.rotateX(-Math.PI / 2); hexGeo.rotateY(Math.PI / 6);
    this.reachMesh = new THREE.InstancedMesh(hexGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.38, depthWrite: false }), 28 * 20);
    this.reachMesh.count = 0; this.reachMesh.frustumCulled = false;
    this.overlayGroup.add(this.reachMesh);
    const ringGeo = new THREE.RingGeometry(0.78, 0.95, 6); ringGeo.rotateX(-Math.PI / 2); ringGeo.rotateY(Math.PI / 6);
    this.cursor = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.95, depthWrite: false }));
    this.cursorBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.5, 6, 1, true), new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.cursorBeam.position.y = 1.25; this.cursor.add(this.cursorBeam);
    this.overlayGroup.add(this.cursor);
    this.facingArrows = new THREE.Group();
    const arrowGeo = new THREE.ConeGeometry(0.12, 0.3, 3); arrowGeo.rotateZ(-Math.PI / 2);
    for (let f = 0; f < 6; f++) {
      const a = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false }));
      const ang = DIR_ANGLE[f] * Math.PI / 180;
      a.position.set(Math.cos(ang) * 0.68, 0.08, Math.sin(ang) * 0.68);
      a.rotation.y = -ang;
      a.userData.f = f;
      this.facingArrows.add(a);
    }
    this.facingArrows.visible = false;
    this.overlayGroup.add(this.facingArrows);
    this.pathLine = null;
    this.targetLine = null;
  }

  setReach(cells) {
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    if (!this.map) return;
    const need = this.map.w * this.map.h;
    if (this.reachMesh.instanceMatrix.count < need) {
      this.overlayGroup.remove(this.reachMesh);
      this.reachMesh = new THREE.InstancedMesh(this.reachMesh.geometry, this.reachMesh.material, need);
      this.reachMesh.frustumCulled = false;
      this.overlayGroup.add(this.reachMesh);
    }
    let n = 0;
    for (const c of cells) {
      const p = hexWorld(c.x, c.y);
      m4.makeTranslation(p.x, this.tileTopFlat(c.x, c.y) + 0.02, p.z);
      this.reachMesh.setMatrixAt(n, m4);
      this.reachMesh.setColorAt(n, col.set(c.color));
      n++;
    }
    this.reachMesh.count = n;
    this.reachMesh.instanceMatrix.needsUpdate = true;
    if (this.reachMesh.instanceColor) this.reachMesh.instanceColor.needsUpdate = true;
  }
  tileTopFlat(x, y) { const t = this.map.t[y * this.map.w + x]; return t >= 4 ? topY(0) - 0.06 : topY(this.map.e[y * this.map.w + x]); }

  setCursor(x, y, color) {
    if (x === null || x === undefined) { this.cursor.visible = false; return; }
    const p = hexWorld(x, y);
    this.cursor.visible = true;
    this.cursor.position.set(p.x, this.tileTopFlat(x, y) + 0.03, p.z);
    if (color) this.cursor.material.color.set(color);
    this.cursorHex = { x, y };
  }

  setFacing(x, y, allowed, chosen) {
    if (x === null || x === undefined) { this.facingArrows.visible = false; return; }
    const p = hexWorld(x, y);
    this.facingArrows.visible = true;
    this.facingArrows.position.set(p.x, this.tileTopFlat(x, y) + 0.06, p.z);
    this.facingArrows.children.forEach((a) => {
      const f = a.userData.f;
      a.visible = allowed.includes(f);
      a.material.opacity = f === chosen ? 1 : 0.35;
      a.material.color.set(f === chosen ? '#ffd166' : '#ffffff');
      a.scale.setScalar(f === chosen ? 1.5 : 1);
    });
  }

  setPath(points, color = '#ffd166') {
    if (this.pathLine) { this.overlayGroup.remove(this.pathLine); this.pathLine.geometry.dispose(); this.pathLine = null; }
    if (!points || points.length < 2) return;
    const pts = [];
    let last = null;
    for (const p of points) {
      if (last && last.x === p.x && last.y === p.y) continue;
      const w = hexWorld(p.x, p.y);
      pts.push(new THREE.Vector3(w.x, this.tileTopFlat(p.x, p.y) + 0.12, w.z));
      last = p;
    }
    if (pts.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2);
    const geo = new THREE.TubeGeometry(curve, pts.length * 8, 0.05, 6, false);
    this.pathLine = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
    this.overlayGroup.add(this.pathLine);
  }

  setTargetLine(fromId, toId, ok = true) {
    if (this.targetLine) { this.overlayGroup.remove(this.targetLine); this.targetLine.geometry.dispose(); this.targetLine = null; }
    if (fromId === null || toId === null || fromId === undefined || toId === undefined) return;
    const a = this.mechs.get(fromId), b = this.mechs.get(toId);
    if (!a || !b) return;
    const pa = a.model.root.position.clone(); pa.y += a.model.height * 0.75;
    const pb = b.model.root.position.clone(); pb.y += b.model.height * 0.6;
    const geo = new THREE.BufferGeometry().setFromPoints([pa, pb]);
    this.targetLine = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: ok ? '#ff5a3c' : '#777777', dashSize: 0.25, gapSize: 0.15, transparent: true, opacity: 0.9, depthTest: false }));
    this.targetLine.computeLineDistances();
    this.overlayGroup.add(this.targetLine);
  }

  setActive(id) {
    for (const v of this.mechs.values()) { v.active = v.id === id; }
  }
  setHighlight(id) { for (const v of this.mechs.values()) v.hl = v.id === id; }

  clearOverlays() {
    this.setReach([]); this.setPath(null); this.setFacing(null); this.setTargetLine(null, null);
  }

  // --------------------------------------------------------------- camera
  focusHex(x, y, instant = false) {
    const p = hexWorld(x, y);
    this.cam.want.set(p.x, this.map ? this.tileTopFlat(x, y) : 0, p.z);
    if (instant) this.cam.target.copy(this.cam.want);
  }
  focusMech(id, instant) { const v = this.mechs.get(id); if (v) this.focusHex(v.state.x, v.state.y, instant); }

  updateCamera(dt) {
    const c = this.cam;
    const speed = this.camSpeed || 1;
    if (input.cam.x || input.cam.y) { c.wantYaw = null; c.wantPitch = null; }
    c.yaw += input.cam.x * dt * 2.2 * speed;
    c.pitch = Math.max(0.42, Math.min(1.35, c.pitch + input.cam.y * dt * 1.2 * speed));
    if (c.wantYaw !== null && c.wantYaw !== undefined) {
      const d = Math.atan2(Math.sin(c.wantYaw - c.yaw), Math.cos(c.wantYaw - c.yaw));
      if (Math.abs(d) < 0.01) { c.yaw = c.wantYaw; c.wantYaw = null; } else c.yaw += d * Math.min(1, dt * 4.5);
    }
    if (c.wantPitch !== null && c.wantPitch !== undefined) {
      c.pitch += (c.wantPitch - c.pitch) * Math.min(1, dt * 4);
      if (Math.abs(c.wantPitch - c.pitch) < 0.01) { c.pitch = c.wantPitch; c.wantPitch = null; }
    }
    if (input.zoom) { c.userDist = null; c.wantDist = Math.max(6, Math.min(34, c.wantDist + input.zoom * 1.2)); input.zoom = 0; }
    c.dist += (c.wantDist - c.dist) * Math.min(1, dt * 8);
    if (this.bounds) {
      c.want.x = Math.max(this.bounds.x0, Math.min(this.bounds.x1, c.want.x));
      c.want.z = Math.max(this.bounds.z0, Math.min(this.bounds.z1, c.want.z));
    }
    c.target.lerp(c.want, Math.min(1, dt * 5));
    const off = new THREE.Vector3(Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch)).multiplyScalar(c.dist);
    this.camera.position.copy(c.target).add(off);
    this.camera.lookAt(c.target);
  }

  // Smooth 60° turns from the on-screen buttons
  rotateStep(dir) {
    const c = this.cam;
    const base = c.wantYaw ?? c.yaw;
    c.wantYaw = base + dir * Math.PI / 3;
  }
  restoreZoom() { const c = this.cam; if (c.userDist !== null && c.userDist !== undefined) { c.wantDist = c.userDist; c.userDist = null; } }
  zoomStep(dir) { this.cam.userDist = null; this.cam.wantDist = Math.max(6, Math.min(34, this.cam.wantDist + dir * 3)); }
  orbit(dx, dy) {
    const c = this.cam;
    c.wantYaw = null; c.wantPitch = null;
    c.yaw -= dx * 0.006;
    c.pitch = Math.max(0.42, Math.min(1.35, c.pitch + dy * 0.004));
  }

  // Swing the camera side-on to the line between two mechs and pull back until both are in frame.
  frameMechs(idA, idB) {
    const a = this.mechs.get(idA), b = this.mechs.get(idB);
    if (!a || !b) return;
    const pa = a.model.root.position, pb = b.model.root.position;
    const c = this.cam;
    c.want.set((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, (pa.z + pb.z) / 2);
    const dx = pb.x - pa.x, dz = pb.z - pa.z;
    const sep = Math.hypot(dx, dz);
    // camera offset direction is (sin yaw, cos yaw); perpendicular to the attack line
    const line = Math.atan2(dx, dz);
    const options = [line + Math.PI / 2, line - Math.PI / 2];
    const near = (y) => Math.abs(Math.atan2(Math.sin(y - c.yaw), Math.cos(y - c.yaw)));
    let yaw = options[0];
    if (near(options[1]) < near(options[0])) yaw = options[1];
    // only swing if the current view is looking too far along the line
    const along = Math.abs(Math.cos(c.yaw - line));
    if (along > 0.35 || sep > 3) c.wantYaw = c.yaw + Math.atan2(Math.sin(yaw - c.yaw), Math.cos(yaw - c.yaw));
    const aspect = Math.max(0.6, this.camera.aspect);
    const fit = (sep / 2 + 1.6) / Math.tan((this.camera.fov / 2) * Math.PI / 180) / Math.min(1, aspect) * 1.25;
    if (c.userDist === null || c.userDist === undefined) c.userDist = c.wantDist;
    c.wantDist = Math.max(c.wantDist, Math.min(60, Math.max(8, fit)));
    if (c.pitch < 0.75) c.wantPitch = 0.8;
    this.framed = idA + ':' + idB;
  }

  onScreen(id, margin = 40) {
    const m = this.mechs.get(id);
    if (!m) return true;
    const rect = this.canvas.getBoundingClientRect();
    const q = m.model.root.position.clone(); q.y += m.model.height * 0.6;
    const s = this.project(q);
    return !s.behind && s.x > rect.left + margin && s.x < rect.right - margin && s.y > rect.top + margin && s.y < rect.bottom - margin;
  }
  async settleFraming(a, b) {
    const t0 = performance.now();
    const settled = () => {
      const c = this.cam;
      return (c.wantYaw === null || c.wantYaw === undefined) && (c.wantPitch === null || c.wantPitch === undefined) &&
        c.target.distanceTo(c.want) < 0.3 && Math.abs(c.dist - c.wantDist) < 0.4;
    };
    while (performance.now() - t0 < 900) {
      await sleep(60);
      if (settled() && this.onScreen(a) && this.onScreen(b)) return;
    }
    // Slow frame rate or still out of view: jump the camera straight to the framed position.
    const c = this.cam;
    for (let i = 0; i < 6; i++) {
      if (c.wantYaw !== null && c.wantYaw !== undefined) { c.yaw = c.wantYaw; c.wantYaw = null; }
      if (c.wantPitch !== null && c.wantPitch !== undefined) { c.pitch = c.wantPitch; c.wantPitch = null; }
      c.target.copy(c.want); c.dist = c.wantDist;
      this.updateCamera(0); this.camera.updateMatrixWorld();
      if (this.onScreen(a) && this.onScreen(b)) return;
      if (c.wantDist >= 60) return;
      c.wantDist = Math.min(60, c.wantDist + 5);
    }
  }

  // Screen-relative step: returns best neighbour direction for a stick/dpad vector (x right, y down)
  screenDirToHex(dx, dy) {
    const yaw = this.cam.yaw;
    // camera looks toward -offset; screen right in world = (cos yaw, 0, -sin yaw); screen up = (-sin yaw, 0, -cos yaw)
    const wx = dx * Math.cos(yaw) + dy * Math.sin(yaw);
    const wz = -dx * Math.sin(yaw) + dy * Math.cos(yaw);
    const ang = Math.atan2(wz, wx) * 180 / Math.PI;
    let best = 0, bd = 999;
    for (let f = 0; f < 6; f++) { let d = Math.abs(((ang - DIR_ANGLE[f]) % 360 + 540) % 360 - 180); if (d < bd) { bd = d; best = f; } }
    return best;
  }

  pick(clientX, clientY) {
    if (!this.terrain) return null;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    // mechs first
    const mechObjs = [...this.mechs.values()].filter((v) => v.model.root.visible && !v.state.dead).map((v) => v.model.root);
    const mh = this.raycaster.intersectObjects(mechObjs, true)[0];
    if (mh) {
      let o = mh.object; while (o && !mechObjs.includes(o)) o = o.parent;
      const v = [...this.mechs.values()].find((q) => q.model.root === o);
      if (v) return { x: v.state.x, y: v.state.y, mech: v.id };
    }
    const hit = this.raycaster.intersectObject(this.terrain, false)[0];
    if (!hit) return null;
    const px = hit.point.x, pz = hit.point.z - (hit.face && hit.face.normal.y < 0.5 ? 0 : 0);
    const q = (Math.sqrt(3) / 3 * px - pz / 3), rr = 2 / 3 * pz;
    let rq = Math.round(q), rr2 = Math.round(rr), rs = Math.round(-q - rr);
    const dq = Math.abs(rq - q), dr = Math.abs(rr2 - rr), ds = Math.abs(rs + q + rr);
    if (dq > dr && dq > ds) rq = -rr2 - rs; else if (dr > ds) rr2 = -rq - rs;
    const o = fromAxial(rq, rr2);
    if (o.x < 0 || o.y < 0 || o.x >= this.map.w || o.y >= this.map.h) return null;
    return o;
  }

  project(vec) {
    const v = vec.clone().project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: (v.x + 1) / 2 * r.width + r.left, y: (1 - v.y) / 2 * r.height + r.top, behind: v.z > 1 };
  }

  // --------------------------------------------------------------- particles & effects
  spawn(pos, opts) {
    const n = opts.n || 1;
    const cap = this.quality === 'low' ? 160 : 500;
    for (let i = 0; i < n; i++) {
      if (this.particles.length > cap) { const old = this.particles.shift(); this.fxGroup.remove(old.s); }
      const mat = new THREE.SpriteMaterial({ map: this.tex, color: opts.color || '#ffaa33', transparent: true, blending: opts.normal ? THREE.NormalBlending : THREE.AdditiveBlending, depthWrite: false, opacity: opts.opacity ?? 1 });
      const s = new THREE.Sprite(mat);
      s.position.copy(pos);
      if (opts.spread) s.position.add(new THREE.Vector3((Math.random() - 0.5) * opts.spread, (Math.random() - 0.5) * opts.spread, (Math.random() - 0.5) * opts.spread));
      const size = (opts.size || 0.4) * (0.7 + Math.random() * 0.6);
      s.scale.setScalar(size);
      const sp = opts.speed ?? 2;
      const vel = new THREE.Vector3((Math.random() - 0.5) * sp, Math.random() * sp * (opts.up ?? 0.6) + (opts.rise || 0), (Math.random() - 0.5) * sp);
      if (opts.vel) vel.add(opts.vel);
      this.fxGroup.add(s);
      this.particles.push({ s, vel, life: opts.life || 0.6, age: 0, size, grow: opts.grow ?? 1.5, gravity: opts.gravity ?? 0, fade: opts.opacity ?? 1 });
    }
  }
  explosion(pos, big = 1) {
    this.spawn(pos, { n: Math.round(14 * big), color: '#ffcf6b', size: 0.5 * big, speed: 2.5 * big, life: 0.45, grow: 2 });
    this.spawn(pos, { n: Math.round(8 * big), color: '#ff6a2a', size: 0.7 * big, speed: 1.6 * big, life: 0.7, grow: 2.2 });
    this.spawn(pos, { n: Math.round(8 * big), color: '#3a3a3a', size: 0.8 * big, speed: 0.8, life: 1.6, rise: 0.8, normal: true, opacity: 0.55, grow: 2.5 });
    this.flash(pos, big);
  }
  flash(pos, big = 1) {
    const l = new THREE.PointLight('#ffb35c', 8 * big, 6 * big, 2);
    l.position.copy(pos); this.fxGroup.add(l);
    this.beams.push({ obj: l, age: 0, life: 0.25, light: true, base: 8 * big });
  }
  beam(a, b, color, width, life = 0.3) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(width, width, len, 6, 1, true); geo.translate(0, len / 2, 0); geo.rotateX(Math.PI / 2);
    const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const glowGeo = new THREE.CylinderGeometry(width * 3, width * 3, len, 8, 1, true); glowGeo.translate(0, len / 2, 0); glowGeo.rotateX(Math.PI / 2);
    const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    const g = new THREE.Group(); g.add(core, glow); g.position.copy(a); g.lookAt(b);
    this.fxGroup.add(g);
    this.beams.push({ obj: g, age: 0, life, mats: [core.material, glow.material] });
  }
  projectile(a, b, opts) {
    return new Promise((resolve) => {
      const mat = new THREE.SpriteMaterial({ map: this.tex, color: opts.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const s = new THREE.Sprite(mat); s.scale.setScalar(opts.size || 0.25); s.position.copy(a);
      this.fxGroup.add(s);
      const dur = opts.dur || 0.3;
      this.beams.push({ obj: s, age: 0, life: dur, proj: { a: a.clone(), b: b.clone(), arc: opts.arc || 0, trail: opts.trail }, done: resolve });
    });
  }

  tickFx(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) { this.fxGroup.remove(p.s); p.s.material.dispose(); this.particles.splice(i, 1); continue; }
      p.vel.y -= p.gravity * dt;
      p.s.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(1 - dt * 1.5);
      const k = p.age / p.life;
      p.s.scale.setScalar(p.size * (1 + k * p.grow));
      p.s.material.opacity = (1 - k) * p.fade;
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.age += dt;
      const k = b.age / b.life;
      if (b.proj) {
        const t = Math.min(1, k);
        b.obj.position.lerpVectors(b.proj.a, b.proj.b, t);
        b.obj.position.y += Math.sin(t * Math.PI) * b.proj.arc;
        if (b.proj.trail && Math.random() < 0.8) this.spawn(b.obj.position, { color: '#9a9a9a', size: 0.18, speed: 0.2, life: 0.6, normal: true, opacity: 0.45, grow: 2 });
      } else if (b.light) b.obj.intensity = b.base * (1 - k);
      else if (b.mats) b.mats.forEach((m, j) => { m.opacity = (1 - k) * (j ? 0.55 : 1); });
      if (k >= 1) { this.fxGroup.remove(b.obj); if (b.done) b.done(); this.beams.splice(i, 1); }
    }
  }

  // --------------------------------------------------------------- per-frame
  frame(dt) {
    this.time += dt;
    this.updateCamera(dt);
    this.tickFx(dt);
    const pulse = 0.5 + Math.sin(this.time * 5) * 0.5;
    if (this.cursor.visible) { this.cursor.material.opacity = 0.65 + pulse * 0.35; this.cursorBeam.material.opacity = 0.2 + pulse * 0.2; }
    if (this.waterMat && this.theme && this.theme.lava) this.waterMat.emissiveIntensity = 1.1 + Math.sin(this.time * 1.7) * 0.25;
    if (this.edgeMat) this.edgeMat.opacity = 0.14 + pulse * 0.14;
    if (this.itemObj && this.itemObj.visible) {
      this.itemObj.rotation.y += dt * 0.8;
      if (this.itemCarrier) { const p = this.itemCarrier.model.root.position; this.itemObj.position.set(p.x, p.y + this.itemCarrier.model.height + 0.2, p.z); }
    }
    const rect = this.canvas.getBoundingClientRect();
    for (const v of this.mechs.values()) {
      const m = v.state;
      if (!m) continue;
      v.ring.material.opacity = v.active ? 0.55 + pulse * 0.45 : v.hl ? 0.9 : 0.5;
      v.ring.scale.setScalar(v.active ? 1 + pulse * 0.08 : 1);
      // idle sway & torso tracking
      if (!v.animating && !m.dead && !v.prone) {
        v.model.torso.rotation.y += (v.wantYaw - v.model.torso.rotation.y) * Math.min(1, dt * 6);
        v.model.body.position.y = Math.sin(this.time * 1.6 + v.id) * 0.01;
      }
      if ((v.damaged || m.dead) && this.quality !== 'low' && Math.random() < dt * (m.dead ? 8 : 4)) {
        const p = v.model.root.position.clone(); p.y += v.model.height * (m.dead ? 0.4 : 0.8);
        this.spawn(p, { color: m.dead ? '#2c2c2c' : '#4a4a4a', size: 0.3, speed: 0.25, rise: 0.9, life: 2.2, normal: true, opacity: 0.5, grow: 3 });
        if (m.dead && Math.random() < 0.4) this.spawn(p, { color: '#ff7a2a', size: 0.25, speed: 0.4, rise: 0.4, life: 0.5 });
      }
      if (m.heat >= 14 && !m.dead && Math.random() < dt * 3) {
        const p = v.model.root.position.clone(); p.y += v.model.height * 0.85;
        this.spawn(p, { color: '#dfe6ea', size: 0.2, speed: 0.3, rise: 0.7, life: 1.2, normal: true, opacity: 0.35, grow: 2.5 });
      }
      // label
      const lp = v.model.root.position.clone(); lp.y += v.model.height + 0.35;
      const s = this.project(lp);
      if (s.behind || m.exited || s.x < rect.left - 50 || s.x > rect.right + 50) v.label.style.display = 'none';
      else { v.label.style.display = ''; v.label.style.transform = `translate(${s.x - rect.left}px, ${s.y - rect.top}px) translate(-50%, -100%)`; v.label.classList.toggle('act', !!v.active); }
    }
    if (this.composer && this.quality !== 'low') this.composer.render(dt);
    else this.gl.render(this.scene, this.camera);
  }

  // --------------------------------------------------------------- event animation
  play(events, state, onEvent) {
    this.pendingAnims++;
    this.queue = this.queue.then(() => this.runEvents(events, state, onEvent)).catch((e) => console.error(e)).finally(() => {
      this.pendingAnims--;
      this.syncMechs(state);
    });
    return this.queue;
  }
  get busy() { return this.pendingAnims > 0; }

  muzzleWorld(v, loc) {
    const mz = v.model.muzzles[loc] || v.model.muzzles[2];
    const p = new THREE.Vector3(); mz.getWorldPosition(p); return p;
  }
  bodyPoint(v, spread = 0.35) {
    const p = v.model.root.position.clone();
    p.y += v.model.height * (0.45 + Math.random() * 0.35);
    p.x += (Math.random() - 0.5) * spread; p.z += (Math.random() - 0.5) * spread;
    return p;
  }
  panOf(pos) { const s = this.project(pos); const r = this.canvas.getBoundingClientRect(); return Math.max(-0.8, Math.min(0.8, ((s.x - r.left) / r.width) * 2 - 1)); }

  async runEvents(events, state, onEvent) {
    this.framed = null;
    const sp = this.speed || 1;
    const instant = sp >= 8;
    for (const e of events) {
      if (onEvent) onEvent(e);
      if (instant) continue;
      const v = e.id !== undefined ? this.mechs.get(e.id) : null;
      switch (e.k) {
        case 'activate': if (v) { this.framed = null; this.restoreZoom(); this.focusMech(e.id); } break;
        case 'move': if (v) await this.animMove(v, e, sp); break;
        case 'shot': case 'melee': {
          if (!v) break;
          const key = e.id + ':' + e.target;
          if (this.framed !== key || !this.onScreen(e.id) || !this.onScreen(e.target)) { this.frameMechs(e.id, e.target); await this.settleFraming(e.id, e.target); }
          if (e.k === 'shot') await this.animShot(v, this.mechs.get(e.target), e, state, sp);
          else await this.animMelee(v, this.mechs.get(e.target), e, sp);
          break;
        }
        case 'boom': if (v) { const p = this.bodyPoint(v, 0.2); this.explosion(p, 1.6); sfx('boom', { size: 1.3, pan: this.panOf(p) }); await sleep(400 / sp); } break;
        case 'locgone': if (v) { const p = this.bodyPoint(v); this.explosion(p, 0.8); this.spawn(p, { n: 16, color: '#ffe08a', size: 0.12, speed: 5, life: 0.5, gravity: 9, grow: 0 }); } break;
        case 'crit': if (v) { this.float(v, critShort(e.code), 'crit'); } break;
        case 'fall': if (v) { v.prone = true; await this.tween(300 / sp, (k) => { v.model.body.rotation.x = 1.35 * k; v.model.body.position.y = 0.2 * k; }); sfx('melee', { pan: 0 }); this.spawn(v.model.root.position.clone().add(new THREE.Vector3(0, 0.2, 0)), { n: 12, color: '#8a7a66', size: 0.4, speed: 1.5, life: 1, normal: true, opacity: 0.5 }); } break;
        case 'destroyed': if (v) { const p = this.bodyPoint(v, 0.1); this.explosion(p, 2.2); sfx('boom', { size: 1.6, pan: this.panOf(p) }); v.state = state.mechs[e.id]; this.updateMechLook(v, state.mechs[e.id]); this.float(v, 'DESTROYED', 'kill'); await sleep(650 / sp); } break;
        case 'shutdown': if (v) { this.float(v, 'SHUTDOWN', 'crit'); v.model.mats.glass.emissiveIntensity = 0.05; sfx('alarm'); } break;
        case 'ko': if (v) this.float(v, 'PILOT KO', 'crit'); break;
        case 'pickup': if (v) { this.float(v, 'PICKED UP', 'info'); sfx('ui-ok'); } break;
        case 'exit': if (v) { await this.tween(500 / sp, (k) => { v.model.root.position.y += 0.03; v.model.root.scale.setScalar(1 - k * 0.9); }); v.model.root.visible = false; v.model.root.scale.setScalar(1); } break;
        case 'heat': if (v && e.gen !== undefined && e.heat >= 14) this.float(v, `HEAT ${e.heat}`, 'heat'); break;
        case 'psr': if (v) this.float(v, `PILOTING ${e.roll}/${e.tn}`, e.roll >= e.tn ? 'info' : 'crit'); break;
        default: break;
      }
    }
  }

  tween(ms, fn) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / ms);
        fn(k);
        if (k < 1) requestAnimationFrame(step); else resolve();
      };
      step();
    });
  }

  async animMove(v, e, sp) {
    v.animating = true;
    const path = e.path;
    const root = v.model.root;
    if (e.mode === 'jump') {
      const a = path[0], b = path[path.length - 1];
      const pa = hexWorld(a.x, a.y); pa.y = this.tileTop(a.x, a.y);
      const pb = hexWorld(b.x, b.y); pb.y = this.tileTop(b.x, b.y);
      const r0 = root.rotation.y, r1 = facingRot(b.f);
      let dr = ((r1 - r0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      sfx('jet', { pan: this.panOf(pa) });
      const height = 1.6 + pa.distanceTo(pb) * 0.25;
      this.focusHex(b.x, b.y);
      await this.tween(900 / sp, (k) => {
        const kk = k * k * (3 - 2 * k);
        root.position.lerpVectors(pa, pb, kk);
        root.position.y += Math.sin(k * Math.PI) * height;
        root.rotation.y = r0 + dr * kk;
        for (const j of v.model.jets) { const p = new THREE.Vector3(); j.getWorldPosition(p); this.spawn(p, { color: '#7fd0ff', size: 0.25, speed: 0.4, vel: new THREE.Vector3(0, -2.5, 0), life: 0.35, up: 0 }); }
        if (!v.model.jets.length && Math.random() < 0.6) this.spawn(root.position, { color: '#7fd0ff', size: 0.35, speed: 0.4, vel: new THREE.Vector3(0, -2.5, 0), life: 0.35 });
      });
      sfx('step', { gain: 1.6, rate: 0.7 });
      this.spawn(pb, { n: 10, color: '#8a7a66', size: 0.4, speed: 1.6, life: 0.8, normal: true, opacity: 0.45 });
    } else {
      const stepMs = (e.mode === 'run' ? 170 : 240) / sp;
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i];
        if (a.x === b.x && a.y === b.y) {
          const r0 = root.rotation.y, r1 = facingRot(b.f);
          const dr = ((r1 - r0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          if (i === 1 || i === path.length - 1) sfx('servo');
          await this.tween(stepMs * 0.55, (k) => { root.rotation.y = r0 + dr * k; });
          continue;
        }
        const pa = hexWorld(a.x, a.y); pa.y = this.tileTop(a.x, a.y);
        const pb = hexWorld(b.x, b.y); pb.y = this.tileTop(b.x, b.y);
        const back = neighbor(a.x, a.y, a.f + 3);
        const reverse = back.x === b.x && back.y === b.y;
        this.focusHex(b.x, b.y);
        await this.tween(stepMs, (k) => {
          root.position.lerpVectors(pa, pb, k);
          root.position.y += Math.sin(k * Math.PI) * 0.06;
          v.walk += (reverse ? -1 : 1) * 0.2;
          const sw = Math.sin(k * Math.PI * 2) * 0.55;
          v.model.legs.forEach((l, j) => { l.hip.rotation.x = (j ? sw : -sw); l.knee.rotation.x = (l.bird ? 0.7 : 0) + Math.max(0, (j ? -sw : sw)) * 0.8; });
        });
        sfx('step', { gain: 0.5 + v.state.tons / 120, rate: 1.4 - v.state.tons / 200, pan: this.panOf(pb) });
      }
      v.model.legs.forEach((l) => { l.hip.rotation.x = 0; l.knee.rotation.x = l.bird ? 0.7 : 0; });
    }
    const last = path[path.length - 1];
    root.rotation.y = facingRot(last.f);
    v.animating = false;
  }

  aimAt(v, t) {
    if (!t) return;
    const a = v.model.root.position, b = t.model.root.position;
    const world = Math.atan2(b.x - a.x, b.z - a.z);
    let rel = world - v.model.root.rotation.y;
    rel = ((rel + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    v.wantYaw = Math.max(-1.1, Math.min(1.1, rel));
  }

  async animShot(v, t, e, state, sp) {
    if (!t) return;
    this.aimAt(v, t);
    v.model.torso.rotation.y = v.wantYaw;
    const W = WEAPONS[e.wt];
    const w = state.mechs[e.id].weapons[e.w];
    const wm = w && v.model.weaponMounts && v.model.weaponMounts[w.i];
    const from = wm ? wm.muzzle.getWorldPosition(new THREE.Vector3()) : this.muzzleWorld(v, w ? w.loc : 2);
    const to = e.hit ? this.bodyPoint(t) : this.bodyPoint(t, 2.2).setY(t.model.root.position.y + Math.random() * 0.4);
    const pan = this.panOf(from);
    const impact = (p, big = 0.5) => {
      if (e.hit) { this.explosion(p, big); sfx('hit', { pan, delay: 0 }); }
      else this.spawn(p, { n: 8, color: '#9c8a70', size: 0.35, speed: 1.4, life: 0.8, normal: true, opacity: 0.5 });
    };
    const dmg = e.hits.reduce((s, h) => s + h.dmg, 0);
    switch (W.fx) {
      case 'laserS': case 'laserM': case 'laserL': {
        const size = W.fx === 'laserL' ? 1.6 : W.fx === 'laserM' ? 1.15 : 0.8;
        const color = W.fx === 'laserL' ? '#ff3b5c' : W.fx === 'laserM' ? '#ff4d9a' : '#ff8a3c';
        sfx('laser', { size, pan });
        this.beam(from, to, color, 0.025 * size, 0.28);
        impact(to, 0.35 * size);
        await sleep(260 / sp);
        break;
      }
      case 'plasma': {
        sfx('plasma', { pan });
        await this.projectile(from, to, { color: '#7fc8ff', size: 0.55, dur: 0.22 / sp });
        this.beam(from, to, '#5fb0ff', 0.03, 0.18);
        impact(to, 0.9);
        this.spawn(to, { n: 12, color: '#bfe6ff', size: 0.15, speed: 4, life: 0.4, grow: 0 });
        await sleep(200 / sp);
        break;
      }
      case 'ac': {
        const big = e.wt === 3 ? 1.4 : e.wt === 2 ? 1.1 : 0.8;
        sfx('cannon', { size: big, pan });
        this.spawn(from, { n: 6, color: '#ffd27a', size: 0.3 * big, speed: 1, life: 0.2 });
        await this.projectile(from, to, { color: '#ffe0a0', size: 0.18 * big, dur: 0.18 / sp });
        impact(to, 0.6 * big);
        await sleep(160 / sp);
        break;
      }
      case 'mg': {
        sfx('mg', { pan });
        for (let i = 0; i < 6; i++) { const tt = to.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.4)); this.projectile(from, tt, { color: '#ffe680', size: 0.1, dur: 0.12 / sp }); await sleep(45 / sp); }
        if (e.hit) this.spawn(to, { n: 10, color: '#ffe08a', size: 0.1, speed: 3, life: 0.3, grow: 0 });
        await sleep(120 / sp);
        break;
      }
      case 'lrm': case 'srm': {
        const n = Math.min(8, e.wt >= 9 ? [2, 4, 6][e.wt - 9] : 5);
        const lrm = W.fx === 'lrm';
        sfx('rocket', { count: n, pan });
        const proms = [];
        for (let i = 0; i < n; i++) {
          const tt = (e.hit && i < (e.missiles || n) ? this.bodyPoint(t, 0.5) : this.bodyPoint(t, 2.5).setY(t.model.root.position.y));
          proms.push(this.projectile(from.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.2, 0, (Math.random() - 0.5) * 0.2)), tt, { color: '#ffb36b', size: 0.14, dur: (lrm ? 0.75 : 0.35) / sp, arc: lrm ? 2.2 : 0.3, trail: true })
            .then(() => { if (e.hit && i < (e.missiles || n)) this.explosion(tt, 0.35); else this.spawn(tt, { n: 5, color: '#9c8a70', size: 0.3, speed: 1, life: 0.6, normal: true, opacity: 0.5 }); }));
          await sleep(55 / sp);
        }
        await Promise.all(proms);
        if (e.hit) sfx('hit', { pan });
        break;
      }
      case 'flamer': {
        sfx('flamer', { pan });
        for (let i = 0; i < 18; i++) {
          const k = Math.random();
          const p = from.clone().lerp(to, k);
          this.spawn(p, { color: i % 2 ? '#ff7a1a' : '#ffd04a', size: 0.25 + k * 0.4, speed: 0.6, life: 0.4, vel: to.clone().sub(from).multiplyScalar(0.6) });
          await sleep(15 / sp);
        }
        await sleep(200 / sp);
        break;
      }
      default: await sleep(200 / sp);
    }
    if (e.hit) this.float(t, (e.missiles ? `${e.missiles}× ` : '') + dmg, 'dmg');
    else this.float(t, 'MISS', 'miss');
  }

  async animMelee(v, t, e, sp) {
    if (!t) return;
    this.aimAt(v, t);
    const root = v.model.root;
    const p0 = root.position.clone();
    const dir = t.model.root.position.clone().sub(p0).multiplyScalar(0.3);
    await this.tween(180 / sp, (k) => { root.position.copy(p0).addScaledVector(dir, k); });
    if (e.hit) { const p = this.bodyPoint(t, 0.2); this.explosion(p, 0.7); sfx('melee'); this.float(t, String(e.dmg), 'dmg'); }
    else { sfx('servo'); this.float(t, 'MISS', 'miss'); }
    await this.tween(220 / sp, (k) => { root.position.copy(p0).addScaledVector(dir, 1 - k); });
  }

  float(v, text, cls) {
    if (!this.onFloat) return;
    const p = v.model.root.position.clone(); p.y += v.model.height * 0.9;
    this.onFloat(text, p, cls);
  }
}

function critShort(code) {
  if (code <= 16) return WEAPONS[code].short + ' DESTROYED';
  if (code <= 28) return 'AMMO HIT';
  if (code <= 36) return 'ARM ACTUATOR';
  if (code <= 44) return 'LEG ACTUATOR';
  return { 45: 'LIFE SUPPORT', 46: 'SENSORS', 47: 'COCKPIT', 48: 'ENGINE HIT', 49: 'GYRO HIT', 50: 'JUMP JET', 51: 'HEAT SINK', 52: 'JUMP JET' }[code] || 'CRITICAL';
}

export { TERRAIN, toAxial, operational };
