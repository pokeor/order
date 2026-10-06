import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* ======================================================================
   עיר הפוקימון — שלב 1 (בניינים פרוצדורליים).
   מעבר לבלנדר: מייצאים בניין כ-.glb לתיקיית ./models, ורושמים אותו ב-
   ./models/manifest.json לפי סוג הבניין, למשל {"tower": "tower.glb"}.
   חוזה המודל: ראשית הצירים במרכז הבסיס על הקרקע, החזית פונה ל-+Z (ב-Blender: -Y),
   יחידה אחת = מטר. אם יש אובייקט בשם SignAnchor — השלט יוצמד אליו.
   סוגי בניינים: tower, hall, shop, kiosk, vault, dome (ראו TYPES).
   ====================================================================== */

const WHATSAPP = '972522123345';
const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString('he-IL');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }
  catch (e) { return false; }
}
if (!hasWebGL()) {
  $('loading').classList.add('gone');
  $('nogl').hidden = false;
  throw new Error('WebGL unavailable');
}

/* ---------- data ---------- */
const [data, manifest] = await Promise.all([
  fetch('../data/products.json').then(r => r.json()),
  fetch('./models/manifest.json').then(r => (r.ok ? r.json() : {})).catch(() => ({}))
]);
const PRODUCTS = data.products;
const P = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));

/* ---------- cart ---------- */
const cart = {};
try { Object.assign(cart, JSON.parse(localStorage.getItem('dr_city_cart') || '{}')); } catch (e) {}
for (const id of Object.keys(cart)) if (!P[id]) delete cart[id];
const qtyOf = pid => cart[pid] || { units: 0, cases: 0 };
const lineTotal = (p, q) => q.units * p.unitPrice + q.cases * p.casePrice;
const cartItems = () => PRODUCTS.filter(p => cart[p.id]).map(p => ({ p, q: cart[p.id], total: lineTotal(p, cart[p.id]) }));
const cartTotal = () => cartItems().reduce((s, c) => s + c.total, 0);
const cartCount = () => cartItems().reduce((s, c) => s + c.q.units + c.q.cases, 0);
function setQty(pid, units, cases) {
  units = Math.max(0, units | 0); cases = Math.max(0, cases | 0);
  if (units || cases) cart[pid] = { units, cases }; else delete cart[pid];
  try { localStorage.setItem('dr_city_cart', JSON.stringify(cart)); } catch (e) {}
  updateFab(); updateBadge(pid);
}
function updateFab() {
  $('cart-n').textContent = cartCount();
  $('cart-t').textContent = fmt(cartTotal()) + ' ₪';
}

/* ---------- renderer / scene ---------- */
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 700);

function gradientTexture(stops) {
  const c = document.createElement('canvas'); c.width = 2; c.height = 256;
  const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 256);
  stops.forEach(([o, col]) => gr.addColorStop(o, col));
  g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
scene.background = gradientTexture([[0, '#0a1424'], [0.55, '#1c4443'], [1, '#d98f55']]);
scene.fog = new THREE.Fog(0x2a5250, 110, 330);

scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x23352b, 1.05));
const sun = new THREE.DirectionalLight(0xffd9a8, 1.25);
sun.position.set(-40, 60, 50); scene.add(sun);

const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
const basic = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, ...extra });
const noRay = o => { o.raycast = () => {}; return o; };

/* ---------- ground, roads ---------- */
function plane(w, h, mat, x, y, z) {
  const m = noRay(new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat));
  m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); scene.add(m); return m;
}
plane(900, 900, lam(0x1b2a22), 10, 0, 0);
plane(240, 15, lam(0x262b31), 10, 0.02, 0);                       // road
plane(240, 3.6, lam(0x4a5850), 10, 0.04, 8.8);                    // sidewalks
plane(240, 3.6, lam(0x4a5850), 10, 0.04, -8.8);
plane(240, 21, lam(0x24352b), 10, 0.03, 21.5);                    // plots
plane(240, 21, lam(0x24352b), 10, 0.03, -21.5);
{
  const c = document.createElement('canvas'); c.width = 64; c.height = 8;
  const g = c.getContext('2d'); g.fillStyle = '#e8c85a'; g.fillRect(0, 0, 36, 8);
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.repeat.set(40, 1); t.colorSpace = THREE.SRGBColorSpace;
  plane(240, 0.35, new THREE.MeshBasicMaterial({ map: t, transparent: true }), 10, 0.06, 0);
}
plane(1, 1, basic(0x000000), 0, -1, 0).visible = false;

/* plaza + monument */
{
  const m = noRay(new THREE.Mesh(new THREE.CircleGeometry(12, 56), lam(0x39493f)));
  m.rotation.x = -Math.PI / 2; m.position.set(0, 0.07, 0); scene.add(m);
  const r = noRay(new THREE.Mesh(new THREE.RingGeometry(10.4, 11.1, 64), basic(0xe8b84a)));
  r.rotation.x = -Math.PI / 2; r.position.set(0, 0.09, 0); scene.add(r);
}
const monument = new THREE.Group(); monument.position.set(0, 0, 0);
{
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.1, 1.4, 28), lam(0x56665c)); ped.position.y = 0.7; monument.add(ped);
  const ball = new THREE.Group(); ball.position.y = 4.3;
  const R = 2.7;
  const top = new THREE.Mesh(new THREE.SphereGeometry(R, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), lam(0xd23a32));
  const bot = new THREE.Mesh(new THREE.SphereGeometry(R, 40, 20, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), lam(0xf2f2ee));
  const band = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.005, R * 1.005, 0.38, 40, 1, true), lam(0x1a1a1a, { side: THREE.DoubleSide }));
  const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.5, 24), lam(0xf2f2ee)); btn.rotation.x = Math.PI / 2; btn.position.z = R - 0.1;
  const btnRing = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.13, 8, 28), lam(0x1a1a1a)); btnRing.position.z = R + 0.12;
  ball.add(top, bot, band, btn, btnRing); monument.add(ball); monument.userData.ball = ball;
}
scene.add(monument);
monument.traverse(noRay);

/* ground text decals */
function decal(title, sub, x, w) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const g = c.getContext('2d'); g.direction = 'rtl'; g.textAlign = 'center';
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const draw = () => {
    g.clearRect(0, 0, 1024, 256);
    g.fillStyle = 'rgba(242,240,230,.92)'; g.font = '700 118px "Frank Ruhl Libre", Georgia, serif'; g.fillText(title, 512, 120);
    g.fillStyle = 'rgba(232,184,74,.95)'; g.font = '600 46px Heebo, sans-serif'; g.fillText(sub, 512, 196);
    t.needsUpdate = true;
  };
  draw(); document.fonts.ready.then(draw);
  plane(w, w / 4, new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }), x, 0.08, 0);
}
decal(data.districts.preorder.title, data.districts.preorder.subtitle, -33, 36);
decal(data.districts.instock.title, data.districts.instock.subtitle, 41, 36);

/* ---------- textures ---------- */
function shade(hex, k) {
  const c = new THREE.Color(hex); c.multiplyScalar(1 + k); return '#' + c.getHexString();
}
const tileCache = {};
function windowTile(color, lit) {
  const key = color + (lit ? 'L' : 'D');
  if (tileCache[key]) return tileCache[key];
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  if (!lit) {
    g.fillStyle = color; g.fillRect(0, 0, 64, 64);
    g.fillStyle = shade(color, -0.45); g.fillRect(14, 10, 36, 34);
    g.fillStyle = shade(color, 0.25); g.fillRect(14, 10, 36, 3); g.fillRect(14, 41, 36, 3);
  } else {
    g.fillStyle = '#000'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#ffc870'; g.fillRect(16, 12, 32, 30);
    g.fillStyle = '#000'; g.fillRect(31, 12, 2, 30);
  }
  return (tileCache[key] = c);
}
function windowMat(color, rx, ry) {
  const map = new THREE.CanvasTexture(windowTile(color, false));
  const em = new THREE.CanvasTexture(windowTile(color, true));
  for (const t of [map, em]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; }
  return new THREE.MeshLambertMaterial({ map, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: 0.85 });
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
}
function makeSign(p) {
  const W = 640, H = 320;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  let img = null;
  const draw = () => {
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#0c1511'; roundRect(g, 0, 0, W, H, 30); g.fill();
    g.strokeStyle = p.accent; g.lineWidth = 8; roundRect(g, 6, 6, W - 12, H - 12, 26); g.stroke();
    g.fillStyle = '#1b2b24'; g.fillRect(26, 26, 250, 268);
    if (img) {
      const s = Math.min(250 / img.width, 268 / img.height);
      const w = img.width * s, h = img.height * s;
      g.drawImage(img, 26 + (250 - w) / 2, 26 + (268 - h) / 2, w, h);
    }
    g.direction = 'rtl'; g.textAlign = 'right'; g.textBaseline = 'alphabetic';
    g.fillStyle = '#ffffff'; g.font = '700 42px Heebo, sans-serif';
    const maxW = 318, words = p.name.split(' '), lines = []; let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    lines.slice(0, 3).forEach((l, i) => g.fillText(l, W - 30, 78 + i * 50));
    g.fillStyle = p.accent; g.font = '700 50px Heebo, sans-serif';
    g.fillText('מ-' + fmt(p.unitPrice) + ' ₪', W - 30, H - 36);
    tex.needsUpdate = true;
  };
  draw(); document.fonts.ready.then(draw);
  const im = new Image(); im.onload = () => { img = im; draw(); }; im.src = '../' + p.image;
  return tex;
}

function makeBadge() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(3.4, 3.4, 1); s.renderOrder = 10; s.visible = false; noRay(s);
  s.userData.draw = n => {
    const g = c.getContext('2d'); g.clearRect(0, 0, 128, 128);
    g.fillStyle = '#3fbe97'; g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#06130e'; g.lineWidth = 6; g.stroke();
    g.fillStyle = '#06130e'; g.font = '700 58px Heebo, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(n), 64, 68); t.needsUpdate = true;
  };
  return s;
}

/* ---------- buildings ---------- */
const TYPES = {
  tower: { w: 6.8, d: 6.8, h: 15, sw: 5.6 },
  hall:  { w: 9,   d: 7.5, h: 9,  sw: 6.8 },
  shop:  { w: 8,   d: 7,   h: 8.2, sw: 6.4 },
  kiosk: { w: 6,   d: 5.5, h: 6.8, sw: 4.8 },
  vault: { w: 8.4, d: 8,   h: 11, sw: 6.4 },
  dome:  { w: 8,   d: 8.4, h: 9,  sw: 5.0 }
};

function boxMesh(w, h, d, color, y) {
  const mats = [
    windowMat(color, d / 3.4, h / 3.6), windowMat(color, d / 3.4, h / 3.6),
    lam(shade(color, -0.35)), lam(shade(color, -0.5)),
    windowMat(color, w / 3.4, h / 3.6), windowMat(color, w / 3.4, h / 3.6)
  ];
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
  m.position.y = y ?? h / 2; return m;
}
function add(parent, mesh, x = 0, y = 0, z = 0) { mesh.position.set(x, y, z); parent.add(mesh); return mesh; }

function buildProcedural(def, T) {
  const g = new THREE.Group();
  const { w, d, h } = T, color = def.color, accent = def.accent;
  const roofMat = lam(shade(color, -0.55)), accentMat = lam(accent), gold = lam(0xd9a93a);
  const fz = d / 2;

  if (def.building === 'dome') {
    const r = 4;
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 28, 1), windowMat(color, 8, h / 3.6));
    cyl.position.y = h / 2; g.add(cyl);
    add(g, new THREE.Mesh(new THREE.CylinderGeometry(r + 0.3, r + 0.3, 0.55, 28), accentMat), 0, h + 0.27, 0);
    add(g, new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.4, 20), roofMat), 0, h + 0.75, 0);
    g.add(boxMesh(5.6, 7, 2.6, color, 3.5)).position.z = fz - 1.3 + 0.0;
  } else {
    g.add(boxMesh(w, h, d, color));
  }

  switch (def.building) {
    case 'tower':
      add(g, new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.6, d + 0.5), roofMat), 0, h + 0.3, 0);
      add(g, new THREE.Mesh(new THREE.BoxGeometry(w * 0.55, 2.4, d * 0.55), lam(shade(color, -0.25))), 0, h + 1.8, 0);
      add(g, new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 4.2, 8), lam(0x9aa5a0)), 0, h + 5.1, 0);
      add(g, new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), basic(0xff4d4d)), 0, h + 7.3, 0);
      break;
    case 'hall': {
      const s = new THREE.Shape(); s.moveTo(-d / 2 - 0.4, 0); s.lineTo(d / 2 + 0.4, 0); s.lineTo(0, 2.8); s.closePath();
      const geo = new THREE.ExtrudeGeometry(s, { depth: w + 0.8, bevelEnabled: false });
      geo.translate(0, 0, -(w + 0.8) / 2); geo.rotateY(Math.PI / 2);
      add(g, new THREE.Mesh(geo, lam(shade(accent, -0.35))), 0, h, 0);
      break;
    }
    case 'shop':
      add(g, new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.5, d + 0.4), roofMat), 0, h + 0.25, 0);
      add(g, new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.1, 1.6), lam(0x7f8b86)), -w * 0.25, h + 1.05, -d * 0.15);
      break;
    case 'kiosk':
      add(g, new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.35, d + 0.6), accentMat), 0, h + 0.17, 0);
      add(g, new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.4, 6), lam(0xcfd6d1)), w * 0.3, h + 1.5, -d * 0.2);
      add(g, new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), basic(accent, { side: THREE.DoubleSide })), w * 0.3 + 0.62, h + 2.3, -d * 0.2);
      break;
    case 'vault':
      add(g, new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.45, d + 0.5), gold), 0, h - 1.4, 0);
      add(g, new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.6, d + 0.4), roofMat), 0, h + 0.3, 0);
      add(g, new THREE.Mesh(new THREE.SphereGeometry(w * 0.27, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), gold), 0, h + 0.6, 0);
      for (const sx of [-1, 1]) add(g, new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.4, 3.3, 14), lam(0xe9e2cf)), sx * (w / 2 - 0.45), 1.65, fz + 0.95);
      break;
    case 'dome':
      break;
  }

  /* storefront */
  const sfW = (def.building === 'dome' ? 4.2 : w * 0.82);
  add(g, new THREE.Mesh(new THREE.PlaneGeometry(sfW + 0.35, 3.05), basic(0x0f1613)), 0, 1.55, fz + 0.03);
  add(g, new THREE.Mesh(new THREE.PlaneGeometry(sfW, 2.7), basic(0xffe0a0)), 0, 1.5, fz + 0.045);
  add(g, new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.7, 0.06), lam(0x0f1613)), 0, 1.5, fz + 0.07);
  const awn = add(g, new THREE.Mesh(new THREE.BoxGeometry(sfW + 0.7, 0.2, 1.8), accentMat), 0, 3.15, fz + 0.85);
  awn.rotation.x = 0.4;
  return g;
}

function makeBuilding(def) {
  const T = TYPES[def.building];
  const root = new THREE.Group();
  root.userData = { pid: def.id, T };
  const proc = buildProcedural(def, T);
  root.add(proc); root.userData.proc = proc;

  const sw = T.sw, sh = sw / 2;
  const signY = 3.95 + sh / 2 + 0.05, fz = T.d / 2;
  const sign = new THREE.Group(); sign.position.set(0, signY, fz + 0.1);
  sign.add(new THREE.Mesh(new THREE.PlaneGeometry(sw + 0.3, sh + 0.3), lam(def.accent)));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshBasicMaterial({ map: makeSign(def), transparent: true }));
  face.position.z = 0.03; sign.add(face);
  root.add(sign); root.userData.sign = sign;

  const badge = makeBadge(); badge.position.set(0, T.h + (def.building === 'tower' ? 9 : 3.2), 0);
  root.add(badge); root.userData.badge = badge;

  root.userData.hover = 0; root.userData.hoverT = 0;

  if (manifest[def.building]) {
    new GLTFLoader().loadAsync('./models/' + manifest[def.building]).then(gl => {
      const m = gl.scene; root.remove(proc); root.add(m);
      const anchor = m.getObjectByName('SignAnchor');
      if (anchor) sign.position.copy(anchor.position);
    }).catch(err => console.warn('GLB load failed for', def.building, err));
  }
  return root;
}

const buildings = {};
const NORTH = { preorder: ['box', 'etb', 'bundle', 'blister'], instock: ['me03etb', 'me04box', 'me05box', 'zygarde', 'greninja', 'armarouge'] };
const SOUTH = { preorder: ['bnb', 'sleeved', 'checklane', 'checklanep'], instock: ['fp1', 'fp2', 'fp3', 'moonlit', 'lumiose', 'pokeball'] };
const X0 = { preorder: -48, instock: 16 };
for (const cat of ['preorder', 'instock']) {
  [[NORTH[cat], -1], [SOUTH[cat], 1]].forEach(([ids, side]) => {
    ids.forEach((id, i) => {
      const def = P[id]; if (!def) return;
      const b = makeBuilding(def), T = b.userData.T;
      b.position.set(X0[cat] + i * 10, 0, side * (10.5 + T.d / 2));
      b.rotation.y = side < 0 ? 0 : Math.PI;
      b.userData.facing = side < 0 ? 1 : -1;
      scene.add(b); buildings[id] = b;
    });
  });
}
const buildingRoots = Object.values(buildings);

/* trees + lamps */
{
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const trunkG = new THREE.CylinderGeometry(0.22, 0.3, 1.5, 6), leafG = new THREE.ConeGeometry(1.5, 3.2, 7);
  const trunkM = lam(0x5a3f2a);
  const leafMs = [lam(0x1f5a3a), lam(0x276b44), lam(0x1a4d34)];
  const tree = (x, z, s) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s);
    add(g, new THREE.Mesh(trunkG, trunkM), 0, 0.75, 0);
    const lm = leafMs[Math.floor(rnd() * 3)];
    add(g, new THREE.Mesh(leafG, lm), 0, 2.9, 0); add(g, new THREE.Mesh(leafG, lm), 0, 4.2, 0).scale.setScalar(0.72);
    g.traverse(noRay); scene.add(g);
  };
  for (let x = -54; x <= 74; x += 10) { tree(x + 5, 8.6, 0.8 + rnd() * 0.3); tree(x + 5, -8.6, 0.8 + rnd() * 0.3); }
  for (let i = 0; i < 50; i++) {
    const side = rnd() < 0.5 ? -1 : 1;
    tree(-60 + rnd() * 140, side * (27 + rnd() * 22), 0.9 + rnd() * 0.9);
  }
  const poleG = new THREE.CylinderGeometry(0.1, 0.13, 5.2, 6), bulbG = new THREE.SphereGeometry(0.34, 10, 8);
  const poleM = lam(0x2b3430), bulbM = basic(0xffe3a8);
  for (let x = -56; x <= 76; x += 12) for (const side of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(x, 0, side * 7.3);
    add(g, new THREE.Mesh(poleG, poleM), 0, 2.6, 0); add(g, new THREE.Mesh(bulbG, bulbM), 0, 5.35, 0);
    g.traverse(noRay); scene.add(g);
  }
}

/* selection marker */
const marker = new THREE.Group(); marker.visible = false;
{
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.1, 8, 48), basic(0x3fbe97)); ring.rotation.x = Math.PI / 2; ring.position.y = 0.2;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 34, 32, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x3fbe97, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  beam.position.y = 17; marker.add(ring, beam); marker.userData.ring = ring;
  marker.traverse(noRay);
}
scene.add(marker);

function updateBadge(pid) {
  const b = buildings[pid]; if (!b) return;
  const q = qtyOf(pid), n = q.units + q.cases;
  b.userData.badge.visible = n > 0;
  if (n > 0) b.userData.badge.userData.draw(n);
}
PRODUCTS.forEach(p => updateBadge(p.id));
updateFab();

/* ---------- camera / controls ---------- */
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 9; controls.maxDistance = 150;
controls.minPolarAngle = 0.15; controls.maxPolarAngle = 1.3;
controls.rotateSpeed = 0.7; controls.zoomSpeed = 0.9; controls.screenSpacePanning = false;

const VIEWS = {
  overview: { t: [10, 0, 0], off: [0, 80, 100] },
  preorder: { t: [-33, 1, 0], off: [0, 34, 44] },
  instock:  { t: [41, 1, 0],  off: [0, 40, 52] }
};
function aspectScale() { const a = innerWidth / innerHeight; return a < 1 ? Math.min(2.7, Math.pow(1 / a, 0.9)) : 1; }

let tween = null;
function flyTo(target, pos, ms = 1000) {
  tween = { t0: performance.now(), ms, fromT: controls.target.clone(), fromP: camera.position.clone(), toT: target.clone(), toP: pos.clone() };
  controls.enabled = false;
}
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function flyToView(name, ms) {
  const v = VIEWS[name], k = aspectScale();
  const t = new THREE.Vector3(...v.t);
  flyTo(t, new THREE.Vector3(t.x + v.off[0] * k, v.off[1] * k, t.z + v.off[2] * k), ms);
  document.querySelectorAll('#views .chip').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.view === name)));
}
function flyToBuilding(pid) {
  const b = buildings[pid], k = Math.min(1.5, aspectScale());
  const t = new THREE.Vector3(b.position.x, 0.5, b.position.z);
  flyTo(t, new THREE.Vector3(t.x + 6 * k, 13 * k, t.z + b.userData.facing * 21 * k), 900);
  document.querySelectorAll('#views .chip').forEach(c => c.setAttribute('aria-pressed', 'false'));
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

/* intro: start high and far, glide in */
{
  const k = aspectScale();
  camera.position.set(10, 150 * k, 190 * k); controls.target.set(10, 0, 0); controls.update();
  flyToView('overview', 2200);
}

/* ---------- picking ---------- */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pickAt(ev) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(buildingRoots, true)[0];
  if (!hit) return null;
  let o = hit.object; while (o && !(o.userData && o.userData.pid)) o = o.parent;
  return o ? o.userData.pid : null;
}
let down = null, hovered = null;
function hideHint() { $('hint').classList.add('gone'); }
canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; hideHint(); if (tween) { tween = null; controls.enabled = true; } });
canvas.addEventListener('pointerup', e => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t; down = null;
  if (moved < 8 && dt < 500) { const pid = pickAt(e); if (pid) openShop(pid); }
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse' || down) return;
  const pid = pickAt(e);
  if (pid !== hovered) {
    if (hovered) buildings[hovered].userData.hoverT = 0;
    hovered = pid; if (pid) buildings[pid].userData.hoverT = 1;
    canvas.style.cursor = pid ? 'pointer' : 'grab';
  }
});

/* ---------- UI: shop sheet ---------- */
const shopEl = $('shop'), coEl = $('checkout');
let selected = null;
const stepper = id => `<div class="stepper"><button type="button" data-d="-1" data-t="${id}" aria-label="הפחתה">–</button><input id="${id}" type="number" inputmode="numeric" min="0" step="1" value="0"><button type="button" data-d="1" data-t="${id}" aria-label="הוספה">+</button></div>`;

function selectBuilding(pid) {
  selected = pid;
  if (!pid) { marker.visible = false; return; }
  const b = buildings[pid], T = b.userData.T;
  const r = Math.max(T.w, T.d) * 0.72;
  marker.position.set(b.position.x, 0, b.position.z); marker.scale.set(r, 1, r); marker.visible = true;
}
function openShop(pid) {
  const p = P[pid]; closeCheckout();
  selectBuilding(pid); flyToBuilding(pid);
  const q = qtyOf(pid);
  shopEl.innerHTML = `
    <div class="sheet-head">
      <img class="sheet-img" src="../${p.image}" alt="">
      <div>
        <h2 class="sheet-title">${p.name}</h2>
        <div class="sheet-sub">יחידה: <b>${fmt(p.unitPrice)} ₪</b><br>קייס (${p.caseQty} יחידות): <b>${fmt(p.casePrice)} ₪</b></div>
      </div>
      <button class="close" id="shop-x" aria-label="סגור">✕</button>
    </div>
    <div class="row"><span class="lbl">יחידות</span>${stepper('q-units')}</div>
    <div class="row"><span class="lbl">קייסים (${p.caseQty} יחידות בקייס)</span>${stepper('q-cases')}</div>
    <div class="line-total" id="q-total"></div>
    <div class="btns">
      <button class="btn btn-ghost" id="shop-more">המשך לטייל</button>
      <button class="btn btn-main" id="shop-cart">לעגלה ←</button>
    </div>`;
  const u = $('q-units'), c = $('q-cases');
  u.value = q.units; c.value = q.cases;
  const apply = () => {
    const uu = parseInt(u.value || '0', 10) || 0, cc = parseInt(c.value || '0', 10) || 0;
    setQty(pid, uu, cc);
    const t = lineTotal(p, qtyOf(pid)); $('q-total').textContent = t ? 'סה״כ למוצר: ' + fmt(t) + ' ₪' : '';
  };
  shopEl.querySelectorAll('.stepper button').forEach(btn => btn.addEventListener('click', () => {
    const inp = $(btn.dataset.t); inp.value = Math.max(0, (parseInt(inp.value || '0', 10) || 0) + parseInt(btn.dataset.d, 10)); apply();
  }));
  u.addEventListener('input', apply); c.addEventListener('input', apply); apply();
  $('shop-x').onclick = $('shop-more').onclick = closeShop;
  $('shop-cart').onclick = openCheckout;
  shopEl.hidden = false;
}
function closeShop() { shopEl.hidden = true; selectBuilding(null); }

/* ---------- UI: checkout sheet ---------- */
const HEAD = { preorder: 'הזמנה מוקדמת – דלתא ריין', instock: 'זמין במלאי' };
function parts(q) { const a = []; if (q.units) a.push(q.units + ' יח׳'); if (q.cases) a.push(q.cases + ' קייס'); return a.join(' + '); }
function buildMessage() {
  const name = $('c-name').value.trim(), phone = $('c-phone').value.trim(), note = $('c-note').value.trim();
  const L = ['הזמנה – פוקימון TCG 🐉', 'שם: ' + (name || '-'), 'טלפון: ' + (phone || '-'), ''];
  for (const cat of ['preorder', 'instock']) {
    const items = cartItems().filter(c => c.p.category === cat); if (!items.length) continue;
    L.push(HEAD[cat] + ':');
    items.forEach(c => L.push('• ' + c.p.name + ': ' + parts(c.q) + ' = ' + fmt(c.total) + ' ₪'));
    L.push('');
  }
  L.push('סה"כ: ' + fmt(cartTotal()) + ' ₪');
  if (note) L.push('', 'הערה: ' + note);
  L.push('', '(הזמנה בלבד, ללא תשלום כעת)');
  return { text: L.join('\n'), name, phone };
}
function renderLines() {
  const items = cartItems(), el = $('c-lines');
  if (!items.length) { el.innerHTML = '<div class="note">העגלה ריקה — לחצו על בניין כדי להוסיף מוצרים.</div>'; }
  else {
    el.innerHTML = items.map(c => `<div class="line"><span>${c.p.name} — ${parts(c.q)} <button class="rm" data-rm="${c.p.id}">הסר</button></span><span>${fmt(c.total)} ₪</span></div>`).join('');
    el.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { setQty(b.dataset.rm, 0, 0); renderLines(); }));
  }
  $('c-total').textContent = fmt(cartTotal()) + ' ₪';
}
function openCheckout() {
  closeShop();
  let saved = {}; try { saved = JSON.parse(localStorage.getItem('dr_customer') || '{}') || {}; } catch (e) {}
  coEl.innerHTML = `
    <div class="sheet-head"><h2 class="sheet-title" style="flex:1;align-self:center">העגלה שלך</h2><button class="close" id="co-x" aria-label="סגור">✕</button></div>
    <div class="lines" id="c-lines"></div>
    <div class="total"><span>סה״כ</span><span class="amt" id="c-total">0 ₪</span></div>
    <div class="grid2">
      <div class="field"><label for="c-name">שם מלא</label><input id="c-name" type="text" autocomplete="name" value=""></div>
      <div class="field"><label for="c-phone">טלפון</label><input id="c-phone" type="tel" autocomplete="tel" value=""></div>
    </div>
    <div class="field"><label for="c-note">הערה (לא חובה)</label><input id="c-note" type="text" placeholder="אאסוף בעצמי / כתובת למשלוח"></div>
    <div class="msg" id="c-msg"></div>
    <div class="btns">
      <button class="btn btn-wa" id="c-send">שליחת הזמנה בוואטסאפ</button>
      <button class="btn btn-ghost" id="c-copy">העתקה</button>
    </div>
    <div class="note">זו הזמנה בלבד — ללא תשלום כרגע. התשלום מול המוכר אחרי אישור.</div>`;
  $('c-name').value = saved.name || ''; $('c-phone').value = saved.phone || '';
  renderLines();
  const msg = (t, k) => { const m = $('c-msg'); m.textContent = t; m.className = 'msg show ' + k; };
  const check = () => {
    if (!cartCount()) return 'העגלה ריקה';
    const d = buildMessage(); if (!d.name) return 'נא למלא שם מלא'; if (!d.phone) return 'נא למלא מספר טלפון'; return null;
  };
  $('c-send').onclick = () => {
    const err = check(); if (err) return msg(err, 'err');
    const d = buildMessage();
    try { localStorage.setItem('dr_customer', JSON.stringify({ name: d.name, phone: d.phone })); } catch (e) {}
    window.open('https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(d.text), '_blank');
    msg('נפתחה הודעת וואטסאפ מוכנה — רק לשלוח!', 'ok');
  };
  $('c-copy').onclick = async () => {
    const err = check(); if (err) return msg(err, 'err');
    try { await navigator.clipboard.writeText(buildMessage().text); msg('ההזמנה הועתקה', 'ok'); }
    catch (e) { msg('לא הצלחנו להעתיק אוטומטית', 'err'); }
  };
  $('co-x').onclick = closeCheckout;
  coEl.hidden = false;
}
function closeCheckout() { coEl.hidden = true; }
$('cart-fab').addEventListener('click', () => (coEl.hidden ? openCheckout() : closeCheckout()));
document.querySelectorAll('#views .chip').forEach(c => c.addEventListener('click', () => { hideHint(); flyToView(c.dataset.view, 1100); }));
addEventListener('keydown', e => { if (e.key === 'Escape') { closeShop(); closeCheckout(); } });

/* ---------- loop ---------- */
const tmp = new THREE.Vector3();
function loop(now) {
  requestAnimationFrame(loop);
  if (tween) {
    const k = clamp((now - tween.t0) / tween.ms, 0, 1), e = ease(k);
    controls.target.lerpVectors(tween.fromT, tween.toT, e);
    camera.position.lerpVectors(tween.fromP, tween.toP, e);
    if (k >= 1) { tween = null; controls.enabled = true; }
  }
  controls.target.x = clamp(controls.target.x, -80, 100);
  controls.target.z = clamp(controls.target.z, -50, 50);
  controls.target.y = clamp(controls.target.y, 0, 20);
  controls.update();

  monument.userData.ball.rotation.y = now * 0.0004;
  for (const b of buildingRoots) {
    const u = b.userData; u.hover += (u.hoverT - u.hover) * 0.2;
    const s = 1 + u.hover * 0.035; b.scale.set(s, 1 + u.hover * 0.02, s);
    if (u.badge.visible) u.badge.position.y += (Math.sin(now * 0.003 + b.position.x) * 0.004);
  }
  if (marker.visible) { const p = 1 + Math.sin(now * 0.004) * 0.05; marker.userData.ring.scale.set(p, p, p); }
  renderer.render(scene, camera);
}
requestAnimationFrame(loop);
requestAnimationFrame(() => requestAnimationFrame(() => { $('bar').style.width = '100%'; setTimeout(() => $('loading').classList.add('gone'), 250); }));

window.cityDebug = { THREE, scene, camera, controls, openShop, buildings, flyToView, cart };
