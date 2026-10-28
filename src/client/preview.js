// Mech Bay 3D viewer: turntable, idle/walk/jump animation, weapon fire demo.
import * as THREE from 'three';
import { buildMech, triggerWeaponAnim, tickWeaponAnims, rollTracks } from './models.js';
import { WEAPONS } from '../core/data.js';
import { sfx } from './audio.js';
import { input } from './input.js';

function radialTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const FX = {
  laserS: { color: '#ff8a3c', w: 0.012 }, laserM: { color: '#ff4d9a', w: 0.016 }, laserL: { color: '#ff3b5c', w: 0.024 },
  plasma: { color: '#7fc8ff', w: 0.03 },
};

export class MechPreview {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'preview-canvas';
    this.gl = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.05, 60);
    this.scene.add(new THREE.HemisphereLight('#cfe6ff', '#2a2218', 0.9));
    const key = new THREE.DirectionalLight('#fff1d6', 2.4); key.position.set(3, 6, 4); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -3; key.shadow.camera.right = 3; key.shadow.camera.top = 3; key.shadow.camera.bottom = -3;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#5fd3ff', 1.6); rim.position.set(-4, 3, -5); this.scene.add(rim);
    const amber = new THREE.PointLight('#ffb23e', 3, 6, 2); amber.position.set(-2, 0.4, 2); this.scene.add(amber);
    const fill = new THREE.DirectionalLight('#ffffff', 0.9); this.camera.add(fill); fill.position.set(0.5, 0.6, 1); this.scene.add(this.camera);
    // hex platform
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.18, 6), new THREE.MeshStandardMaterial({ color: '#1b232b', metalness: 0.6, roughness: 0.5 }));
    plat.rotation.y = Math.PI / 6; plat.position.y = -0.09; plat.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.42, 1.5, 6), new THREE.MeshBasicMaterial({ color: '#ffb23e', transparent: true, opacity: 0.8 }));
    ring.rotation.x = -Math.PI / 2; ring.rotation.z = Math.PI / 6; ring.position.y = 0.005;
    this.ring = ring;
    const grid = new THREE.PolarGridHelper(1.35, 6, 4, 36, '#3a4a58', '#26313b'); grid.position.y = 0.004;
    this.turntable = new THREE.Group();
    this.turntable.add(plat, ring, grid);
    this.scene.add(this.turntable);
    this.fx = new THREE.Group(); this.scene.add(this.fx);
    this.tex = radialTexture();
    this.effects = [];
    this.model = null;
    this.yaw = 0.6; this.spin = true; this.drag = null;
    this.mode = 'idle'; this.modeT = 0; this.t = 0;
    this.demoIdx = 0; this.demoT = 1.5; this.autoDemo = true;
    this.highlight = null;
    this.onFire = null;
    this.running = false;
    this.bindPointer();
  }

  attach(container) {
    if (this.canvas.parentElement !== container) container.prepend(this.canvas);
    this.container = container;
    this.resize();
    if (!this.running) { this.running = true; this.last = performance.now(); requestAnimationFrame((t) => this.loop(t)); }
  }
  stop() { this.running = false; }

  resize() {
    if (!this.container) return;
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    this.gl.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fit();
  }

  fit() {
    if (!this.model) return;
    const h = this.model.height;
    const dist = (h * 0.58 + 0.22) / Math.tan((this.camera.fov / 2) * Math.PI / 180) / Math.min(1.15, Math.max(0.65, this.camera.aspect * 0.9));
    this.camDist = dist;
    this.camera.position.set(0, h * 0.6 + dist * 0.2, dist);
    this.camera.lookAt(0, h * 0.5, 0);
  }

  show(tpl, color = '#d9a441') {
    if (this.model) { this.turntable.remove(this.model.root); }
    this.tpl = tpl;
    const weapons = tpl.wp.map((w, i) => ({ t: w[0], loc: w[7], i, heat: w[1], dmg: w[2], rng: w[3] }));
    this.weapons = weapons;
    this.model = buildMech({ design: tpl.n, tons: tpl.t, cls: tpl.c, weapons, jump: tpl.j, body: tpl.body, mot: tpl.mot }, color);
    this.turntable.add(this.model.root);
    this.demoIdx = 0; this.demoT = 1.2; this.mode = 'idle'; this.modeT = 0;
    this.setHighlight(null);
    this.fit();
  }

  setHighlight(i) {
    if (!this.model) return;
    if (this.highlight !== null && this.model.weaponMounts[this.highlight]) for (const m of this.model.weaponMounts[this.highlight].meshes) if (m.userData.mat) { m.material = m.userData.mat; delete m.userData.mat; }
    this.highlight = i;
    if (i === null || !this.model.weaponMounts[i]) return;
    if (!this.hlMat) this.hlMat = new THREE.MeshStandardMaterial({ color: '#a8ecff', emissive: '#3fc1ff', emissiveIntensity: 1.1, metalness: 0.3, roughness: 0.4 });
    for (const m of this.model.weaponMounts[i].meshes) { m.userData.mat = m.material; m.material = this.hlMat; }
  }

  // Fire one weapon (index into tpl.wp) with effects and optional sound
  fire(i, withSound) {
    if (!this.model) return;
    const w = this.weapons[i];
    const mt = this.model.weaponMounts[i];
    if (!w || !mt) return;
    const W = WEAPONS[w.t];
    triggerWeaponAnim(mt);
    const from = mt.muzzle.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(mt.muzzle.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const to = from.clone().addScaledVector(dir, 3.2);
    this.flash(from, W.fx === 'plasma' ? '#7fc8ff' : W.kind === 'e' ? (FX[W.fx]?.color || '#ff8a3c') : '#ffd27a', 0.18);
    if (FX[W.fx]) this.beam(from, to, FX[W.fx].color, FX[W.fx].w * this.model.scale * 1.4);
    else if (W.fx === 'flamer') for (let k = 0; k < 16; k++) this.particle(from, dir.clone().multiplyScalar(2 + Math.random() * 1.5).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, Math.random() * 0.4, (Math.random() - 0.5) * 0.6)), k % 2 ? '#ff7a1a' : '#ffd04a', 0.12, 0.5);
    else if (W.kind === 'm') {
      const n = Math.min(6, W.n);
      for (let k = 0; k < n; k++) setTimeout(() => this.projectile(from.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08, 0)), dir.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.1, 0.05 + Math.random() * 0.1, 0)), '#ffb36b', 0.06, true), k * 60);
    } else for (let k = 0; k < (w.t === 4 ? 5 : 1); k++) setTimeout(() => this.projectile(from, dir, '#ffe0a0', w.t === 4 ? 0.035 : 0.05 + w.t * 0.012, false), k * 50);
    // recoil
    mt.group.position.addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(mt.group.quaternion), 0.03 * this.model.scale);
    mt.recoil = 0.15;
    if (withSound) sfx(W.snd === 'mg' ? 'mg' : W.snd, { size: w.t === 3 ? 1.4 : w.t === 14 ? 1.6 : 1, count: Math.min(6, W.n) });
    if (this.onFire) this.onFire(i);
  }

  flash(pos, color, size) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.position.copy(pos); sp.scale.setScalar(size * 2.2);
    this.fx.add(sp);
    const l = new THREE.PointLight(color, 4, 2.5, 2); l.position.copy(pos); this.fx.add(l);
    this.effects.push({ o: sp, life: 0.15, age: 0, kind: 'fade' }, { o: l, life: 0.15, age: 0, kind: 'light', base: 4 });
  }
  beam(a, b, color, width) {
    const len = a.distanceTo(b);
    const g = new THREE.Group();
    const mk = (r, c, op) => { const geo = new THREE.CylinderGeometry(r, r, len, 6, 1, true); geo.translate(0, len / 2, 0); geo.rotateX(Math.PI / 2); return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false })); };
    g.add(mk(width, '#ffffff', 1), mk(width * 3, color, 0.5));
    g.position.copy(a); g.lookAt(b);
    this.fx.add(g);
    this.effects.push({ o: g, life: 0.3, age: 0, kind: 'beam' });
  }
  particle(pos, vel, color, size, life) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.position.copy(pos); sp.scale.setScalar(size);
    this.fx.add(sp);
    this.effects.push({ o: sp, life, age: 0, kind: 'particle', vel, size });
  }
  projectile(pos, dir, color, size, trail) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.position.copy(pos); sp.scale.setScalar(size * 2);
    this.fx.add(sp);
    this.effects.push({ o: sp, life: 0.6, age: 0, kind: 'proj', vel: dir.clone().normalize().multiplyScalar(trail ? 5 : 9), trail });
  }

  bindPointer() {
    this.canvas.addEventListener('pointerdown', (e) => { this.drag = { x: e.clientX, moved: 0 }; this.canvas.setPointerCapture(e.pointerId); this.spin = false; });
    this.canvas.addEventListener('pointermove', (e) => { if (!this.drag) return; const dx = e.clientX - this.drag.x; this.drag.x = e.clientX; this.drag.moved += Math.abs(dx); this.yaw += dx * 0.012; });
    const up = () => { if (this.drag && this.drag.moved < 5) this.spin = !this.spin; this.drag = null; };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
    this.canvas.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); this.yaw += Math.sign(e.deltaY) * 0.2; this.spin = false; }, { passive: false });
  }

  setMode(m) { this.mode = m; this.modeT = 0; }

  loop(now) {
    if (!this.running) return;
    requestAnimationFrame((t) => this.loop(t));
    if (!this.canvas.isConnected) return;
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    this.t += dt;
    const cw = this.container ? this.container.clientWidth : 0;
    if (cw && Math.abs(cw - this.canvas.width / this.gl.getPixelRatio()) > 2) this.resize();
    if (Math.abs(input.cam.x) > 0.2) { this.yaw += input.cam.x * dt * 2.4; this.spin = false; }
    if (this.spin) this.yaw += dt * 0.45;
    this.turntable.rotation.y = this.yaw;
    this.ring.material.opacity = 0.55 + Math.sin(this.t * 2.2) * 0.25;
    const m = this.model;
    if (m) {
      this.modeT += dt;
      const legs = m.legs;
      // automatic routine: idle -> walk -> idle / jump (if jump jets) / drive (if tracks)
      if (this.mode === 'idle' && this.modeT > 7) this.setMode('walk');
      else if (this.mode === 'walk' && this.modeT > 3.2) this.setMode(this.tpl.mot && Math.random() < 0.6 ? 'drive' : this.tpl.j && Math.random() < 0.6 ? 'jump' : 'idle');
      else if (this.mode === 'jump' && this.modeT > 1.6) this.setMode('idle');
      else if (this.mode === 'drive' && this.modeT > 4.2) this.setMode('idle');
      if (this.mode === 'drive' && !m.wheels.length) this.setMode('walk');
      // kneel onto the tracks (or fold into a QuadVee's tank mode), roll, then stand up
      const T = this.modeT;
      const wantV = this.mode === 'drive' ? (T < 0.8 ? T / 0.8 : T < 3.4 ? 1 : Math.max(0, 1 - (T - 3.4) / 0.8)) : 0;
      if (wantV > 0 || m.vk > 0) m.setVehicle(this.mode === 'drive' ? wantV * wantV * (3 - 2 * wantV) : Math.max(0, m.vk - dt * 2));
      if (this.mode === 'drive' && wantV >= 1) rollTracks(m, dt * 7);
      let bodyY = 0, bob = 0;
      if (this.mode === 'walk') {
        const ph = this.modeT * 5.2;
        const sw = Math.sin(ph) * 0.32;
        legs.forEach((l) => { const g = sw * l.gait; l.hip.rotation.x = g; l.knee.rotation.x = l.rest + Math.max(0, -g) * 1.1; });
        m.arms.forEach((a, j) => { a.sh.rotation.x = (j ? -sw : sw) * 0.25; });
        bob = Math.abs(Math.cos(ph)) * 0.04 * m.scale;
        if (Math.floor(ph / Math.PI) !== Math.floor((ph - dt * 5.2) / Math.PI)) sfx('step', { gain: 0.25, rate: 1.4 - this.tpl.t / 200 });
      } else if (this.mode !== 'drive' && !m.vk) {
        legs.forEach((l) => { l.hip.rotation.x *= 0.85; l.knee.rotation.x = l.rest + (l.knee.rotation.x - l.rest) * 0.85; });
        m.arms.forEach((a) => { a.sh.rotation.x *= 0.85; });
      }
      if (this.mode === 'jump') {
        const k = Math.min(1, this.modeT / 1.4);
        bodyY = Math.sin(k * Math.PI) * 0.7 * m.scale;
        if (k < 0.85) for (const j of m.jets) { const p = j.getWorldPosition(new THREE.Vector3()); this.particle(p, new THREE.Vector3((Math.random() - 0.5) * 0.3, -2.4, (Math.random() - 0.5) * 0.3), '#7fd0ff', 0.12, 0.3); }
      }
      m.body.position.y = bodyY + bob + Math.sin(this.t * 1.7) * 0.008 + m.vOffset;
      // torso scans around; arms aim when firing
      m.torso.rotation.y = Math.sin(this.t * 0.6) * 0.35;
      // fire demo
      if (this.autoDemo && this.weapons.length && this.mode !== 'jump') {
        this.demoT -= dt;
        if (this.demoT <= 0) {
          const i = this.demoIdx % this.weapons.length;
          this.setHighlight(i);
          this.fire(i, false);
          this.demoIdx++;
          this.demoT = 1.1;
        }
      }
      tickWeaponAnims(m, dt, this.t);
      m.mats.vent.emissiveIntensity = 0.6 + Math.sin(this.t * 1.3) * 0.25;
      for (const mt of Object.values(m.weaponMounts)) if (mt.recoil) { mt.recoil -= dt; mt.group.position.addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(mt.group.quaternion), dt * 0.2 * m.scale); if (mt.recoil <= 0) mt.recoil = 0; }
    }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.age += dt;
      const k = e.age / e.life;
      if (e.kind === 'fade') e.o.material.opacity = 1 - k;
      else if (e.kind === 'light') e.o.intensity = e.base * (1 - k);
      else if (e.kind === 'beam') e.o.children.forEach((c, j) => { c.material.opacity = (1 - k) * (j ? 0.5 : 1); });
      else if (e.kind === 'particle') { e.o.position.addScaledVector(e.vel, dt); e.o.scale.setScalar(e.size * (1 + k * 2)); e.o.material.opacity = 1 - k; }
      else if (e.kind === 'proj') {
        e.o.position.addScaledVector(e.vel, dt);
        if (e.trail && Math.random() < 0.9) this.particle(e.o.position.clone(), new THREE.Vector3(0, 0.2, 0), '#8a8a8a', 0.07, 0.4);
        e.o.material.opacity = 1 - k * 0.5;
      }
      if (k >= 1) { this.fx.remove(e.o); if (e.o.material) e.o.material.dispose(); this.effects.splice(i, 1); }
    }
    this.gl.render(this.scene, this.camera);
  }
}
