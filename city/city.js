import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ======================================================================
   עיר הפוקימון v2.
   מעבר לבלנדר: מייצאים בניין כ-.glb ל-./models ורושמים ב-./models/manifest.json
   לפי סוג, למשל {"tower": "tower.glb"}. חוזה: מרכז הבסיס בראשית הצירים,
   החזית ל-+Z, מטר ליחידה, גודל = TYPES × S (ראו FOOT). אובייקט בשם SignAnchor
   קובע את מיקום השלט. סוגים: tower, hall, shop, kiosk, vault, dome.
   ====================================================================== */

const WHATSAPP = '972522123345';
const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString('he-IL');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;

function hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }
  catch (e) { return false; }
}
if (!hasWebGL()) { $('loading').classList.add('gone'); $('nogl').hidden = false; throw new Error('WebGL unavailable'); }

/* ---------- quality ---------- */
const params = new URLSearchParams(location.search);
const autoLow = matchMedia('(pointer: coarse)').matches || innerWidth < 760;
const QUALITY = params.get('q') || (autoLow ? 'low' : 'high');
const HI = QUALITY === 'high';
const Q = HI
  ? { shadowMap: 2048, bloom: true, people: 38, pr: 2, treesFar: 90 }
  : { shadowMap: 1024, bloom: false, people: 18, pr: 1.5, treesFar: 40 };
$('quality').textContent = HI ? 'איכות: גבוהה' : 'איכות: חסכונית';
$('quality').onclick = () => { params.set('q', HI ? 'low' : 'high'); location.search = params.toString(); };

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
let screenDirty = true;
function setQty(pid, units, cases) {
  units = Math.max(0, units | 0); cases = Math.max(0, cases | 0);
  if (units || cases) cart[pid] = { units, cases }; else delete cart[pid];
  try { localStorage.setItem('dr_city_cart', JSON.stringify(cart)); } catch (e) {}
  updateFab(); updateBadge(pid); screenDirty = true;
}
function updateFab() { $('cart-n').textContent = cartCount(); $('cart-t').textContent = fmt(cartTotal()) + ' ₪'; }

/* ---------- renderer / scene ---------- */
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !Q.bloom, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pr));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.78;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(46, 1, 1, 6000);

/* sky + light */
const sky = new Sky(); sky.scale.setScalar(2800); scene.add(sky);
{
  const u = sky.material.uniforms;
  u.turbidity.value = 7; u.rayleigh.value = 1.7; u.mieCoefficient.value = 0.006; u.mieDirectionalG.value = 0.92;
  u.sunPosition.value.setFromSphericalCoords(1, THREE.MathUtils.degToRad(80), THREE.MathUtils.degToRad(238));
}
scene.fog = new THREE.Fog(0xb88f78, 260, 980);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.3;
scene.add(new THREE.HemisphereLight(0xb9c9ff, 0x4a5c40, 1.15));
const sun = new THREE.DirectionalLight(0xffc48a, 3.1);
{
  const dir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(62), THREE.MathUtils.degToRad(238));
  sun.position.copy(dir.multiplyScalar(420)).add(new THREE.Vector3(17, 0, 0));
  sun.target.position.set(17, 0, 0); scene.add(sun.target);
  sun.castShadow = true; sun.shadow.mapSize.set(Q.shadowMap, Q.shadowMap);
  const c = sun.shadow.camera; c.left = -170; c.right = 170; c.top = 120; c.bottom = -120; c.near = 10; c.far = 900;
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.6; scene.add(sun);
}

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o });
const basic = (color, o = {}) => new THREE.MeshBasicMaterial({ color, ...o });
const noRay = o => { o.raycast = () => {}; return o; };
function shadowify(root, cast = true, receive = true) {
  root.traverse(o => { if (o.isMesh && !(o.material && o.material.isMeshBasicMaterial)) { o.castShadow = cast; o.receiveShadow = receive; } });
  return root;
}
function shade(hex, k) { const c = new THREE.Color(hex); c.multiplyScalar(1 + k); return '#' + c.getHexString(); }
let seed0 = 11; const rnd = () => (seed0 = (seed0 * 16807) % 2147483647) / 2147483647;
const pick = a => a[Math.floor(rnd() * a.length)];
function hash(str) { let h = 2166136261; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }

/* ---------- ground ---------- */
function noiseTexture(base, amp, size = 256, rep = 60) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); g.fillStyle = base; g.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size * 0.35; i++) {
    const v = Math.floor((Math.random() - 0.5) * amp);
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v / 255})` : `rgba(0,0,0,${-v / 255})`;
    g.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function plane(w, h, mat, x, y, z, rotZ = 0) {
  const m = noRay(new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat));
  m.rotation.x = -Math.PI / 2; m.rotation.z = rotZ; m.position.set(x, y, z); m.receiveShadow = true; scene.add(m); return m;
}
const X_MIN = -110, X_MAX = 140, XC = 15, XW = X_MAX - X_MIN;
plane(1800, 1800, std(0xffffff, { map: noiseTexture('#3b5a39', 60, 256, 220), roughness: 1 }), XC, 0, 0);
plane(XW + 40, 20, std(0xffffff, { map: noiseTexture('#2a2d33', 40, 256, 40), roughness: 0.95 }), XC, 0.03, 0);    // road
plane(XW + 40, 6.4, std(0x7a8379, { roughness: 0.9 }), XC, 0.05, 13.2);                                           // sidewalks
plane(XW + 40, 6.4, std(0x7a8379, { roughness: 0.9 }), XC, 0.05, -13.2);
for (const s of [-1, 1]) {
  const kerb = new THREE.Mesh(new THREE.BoxGeometry(XW + 40, 0.22, 0.4), std(0xb3b8ae)); kerb.position.set(XC, 0.11, s * 10.1); kerb.receiveShadow = true; scene.add(noRay(kerb));
  plane(XW + 40, 70, std(0xffffff, { map: noiseTexture('#35502f', 55, 256, 80), roughness: 1 }), XC, 0.02, s * 51.5);
}
{ // dashed centre line
  const c = document.createElement('canvas'); c.width = 64; c.height = 8; const g = c.getContext('2d'); g.fillStyle = '#e8c85a'; g.fillRect(0, 0, 34, 8);
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.repeat.set(XW / 5, 1); t.colorSpace = THREE.SRGBColorSpace;
  plane(XW + 40, 0.4, basic(0xffffff, { map: t, transparent: true }), XC, 0.06, 0);
}
const CROSS_X = [-96, -66, -34, 34, 66, 98, 128];
for (const cx of CROSS_X) for (let i = -3; i <= 3; i++) plane(1.1, 18, basic(0xe9e6da), cx + i * 1.9, 0.07, 0);

/* mountains */
{
  const mat = std(0x55657a, { roughness: 1, flatShading: true });
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rnd() * 0.2, r = 640 + rnd() * 120, h = 110 + rnd() * 190;
    const m = new THREE.Mesh(new THREE.ConeGeometry(70 + rnd() * 80, h, 5), mat);
    m.position.set(XC + Math.cos(a) * r, h / 2 - 4, Math.sin(a) * r); m.rotation.y = rnd() * 3; scene.add(noRay(m));
  }
}

/* ---------- plaza: fountain + Order Tower ---------- */
const PLAZA_R = 27;
{
  const m = noRay(new THREE.Mesh(new THREE.CircleGeometry(PLAZA_R, 72), std(0x9c9886, { roughness: 0.85 })));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.09; m.receiveShadow = true; scene.add(m);
  for (const [r0, r1, col, y] of [[PLAZA_R - 1.4, PLAZA_R, 0xe8b84a, 0.1], [PLAZA_R - 4, PLAZA_R - 3.6, 0x6d6a5c, 0.1], [17, 17.4, 0x6d6a5c, 0.1]]) {
    const r = noRay(new THREE.Mesh(new THREE.RingGeometry(r0, r1, 72), col === 0xe8b84a ? basic(col) : std(col)));
    r.rotation.x = -Math.PI / 2; r.position.y = y; scene.add(r);
  }
}
const tower = new THREE.Group(); tower.userData.tower = true;
const towerAnim = {};
{
  const podium = new THREE.Mesh(new THREE.CylinderGeometry(14, 15, 1.4, 48), std(0x6f7a72)); podium.position.y = 0.7; tower.add(podium);
  const step = new THREE.Mesh(new THREE.CylinderGeometry(12.5, 13, 1.1, 48), std(0x8b968c)); step.position.y = 1.95; tower.add(step);
  for (const sx of [-1, 1]) {
    const pil = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 24, 14), std(0xe9e2cf, { roughness: 0.5 })); pil.position.set(sx * 8.2, 14, 0); tower.add(pil);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1, 4.2), std(0xd9a93a, { metalness: 0.8, roughness: 0.35 })); cap.position.set(sx * 8.2, 26.4, 0); tower.add(cap);
  }
  // screen frame
  const frame = new THREE.Mesh(new THREE.BoxGeometry(24.4, 15.4, 2.2), std(0x101a16, { roughness: 0.4, metalness: 0.4 })); frame.position.y = 35; tower.add(frame);
  const glow = new THREE.Mesh(new THREE.BoxGeometry(25.2, 16.2, 1.8), basic(0xe8b84a)); glow.position.y = 35; glow.scale.set(1, 1, 0.9); tower.add(glow);
  frame.position.z = 0; glow.position.z = 0;
  // screen canvas
  const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 800;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const scrMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  const front = new THREE.Mesh(new THREE.PlaneGeometry(23.2, 14.5), scrMat); front.position.set(0, 35, 1.12); tower.add(front);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(23.2, 14.5), scrMat); back.position.set(0, 35, -1.12); back.rotation.y = Math.PI; tower.add(back);
  // crown
  const ball = new THREE.Group(); ball.position.y = 48.5;
  const R = 4.4;
  ball.add(new THREE.Mesh(new THREE.SphereGeometry(R, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), std(0xd23a32, { roughness: 0.35 })));
  ball.add(new THREE.Mesh(new THREE.SphereGeometry(R, 40, 20, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), std(0xf2f2ee, { roughness: 0.35 })));
  ball.add(new THREE.Mesh(new THREE.CylinderGeometry(R * 1.006, R * 1.006, 0.6, 40, 1, true), std(0x151515, { side: THREE.DoubleSide })));
  const btn = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.8, 24), std(0xf2f2ee)); btn.rotation.x = Math.PI / 2; btn.position.z = R - 0.1; ball.add(btn);
  const br = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.2, 8, 28), std(0x151515)); br.position.z = R + 0.15; ball.add(br);
  tower.add(ball); towerAnim.ball = ball;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 5, 10), std(0xd9a93a, { metalness: 0.8, roughness: 0.35 })); stem.position.y = 44.5; tower.add(stem);
  // basin + fountain
  const basin = new THREE.Mesh(new THREE.TorusGeometry(19, 1, 12, 64), std(0xcfd2c6)); basin.rotation.x = Math.PI / 2; basin.position.y = 0.9; tower.add(basin);
  const water = noRay(new THREE.Mesh(new THREE.CircleGeometry(19, 64), new THREE.MeshStandardMaterial({ color: 0x2a86a8, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.9 })));
  water.rotation.x = -Math.PI / 2; water.position.y = 0.55; tower.add(water);
  const N = 14, M = 12, pos = new Float32Array(N * M * 3);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xcfefff, size: 0.55, transparent: true, opacity: 0.85, depthWrite: false }));
  pts.frustumCulled = false; tower.add(pts); towerAnim.pts = pts; towerAnim.N = N; towerAnim.M = M;
  shadowify(tower, true, true);
  tower.traverse(o => { if (o === water || o === pts) o.castShadow = false; });
  tower.userData.screen = { cv, tex, g: cv.getContext('2d') };
}
scene.add(tower);

const imgs = {};
PRODUCTS.forEach(p => { const im = new Image(); im.onload = () => { imgs[p.id] = im; screenDirty = true; }; im.src = '../' + p.image; });
function drawScreen() {
  const { cv, tex, g } = tower.userData.screen, W = cv.width, H = cv.height;
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#0a1713'); gr.addColorStop(1, '#10261f');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(63,190,151,.35)'; g.lineWidth = 3;
  for (let x = 0; x < W; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  g.direction = 'rtl'; g.textAlign = 'right'; g.textBaseline = 'alphabetic';
  g.fillStyle = '#e8b84a'; g.font = '700 74px "Frank Ruhl Libre", Georgia, serif'; g.fillText('מגדל ההזמנות', W - 60, 105);
  g.fillStyle = '#a3b3a6'; g.font = '500 34px Heebo, sans-serif';
  const items = cartItems(), n = cartCount();
  g.fillText(n ? n + ' פריטים בעגלה' : 'העגלה ריקה', W - 60, 156);
  g.strokeStyle = '#e8b84a'; g.lineWidth = 4; g.beginPath(); g.moveTo(60, 182); g.lineTo(W - 60, 182); g.stroke();
  if (!items.length) {
    g.fillStyle = '#eef2e9'; g.font = '600 56px Heebo, sans-serif'; g.textAlign = 'center';
    g.fillText('היכנסו לחנויות בעיר', W / 2, 360); g.fillText('והוסיפו מוצרים', W / 2, 436);
    g.fillStyle = '#3fbe97'; g.font = '500 38px Heebo, sans-serif'; g.fillText('הסיכום מתעדכן כאן בזמן אמת', W / 2, 530);
  } else {
    const rows = items.slice(0, 4);
    rows.forEach((c, i) => {
      const y = 268 + i * 94;
      const im = imgs[c.p.id];
      if (im) { const s = Math.min(70 / im.width, 82 / im.height); g.drawImage(im, W - 60 - 72 + (72 - im.width * s) / 2, y - 62 + (82 - im.height * s) / 2, im.width * s, im.height * s); }
      g.textAlign = 'right'; g.fillStyle = '#eef2e9'; g.font = '700 46px Heebo, sans-serif';
      let name = c.p.name; while (g.measureText(name).width > 640 && name.length > 4) name = name.slice(0, -2);
      if (name !== c.p.name) name += '…';
      g.fillText(name, W - 150, y - 4);
      g.fillStyle = '#a3b3a6'; g.font = '500 34px Heebo, sans-serif';
      const parts = []; if (c.q.units) parts.push(c.q.units + ' יח׳'); if (c.q.cases) parts.push(c.q.cases + ' קייס');
      g.fillText(parts.join(' + '), W - 150, y + 38);
      g.textAlign = 'left'; g.fillStyle = '#eef2e9'; g.font = '700 52px Heebo, sans-serif'; g.fillText(fmt(c.total) + ' ₪', 60, y + 14);
    });
    if (items.length > 4) { g.textAlign = 'right'; g.fillStyle = '#a3b3a6'; g.font = '500 30px Heebo, sans-serif'; g.fillText('+ עוד ' + (items.length - 4) + ' מוצרים…', W - 60, 268 + 4 * 94 - 20); }
    g.textAlign = 'right'; g.fillStyle = '#a3b3a6'; g.font = '500 34px Heebo, sans-serif'; g.fillText('סה״כ', W - 60, 690);
    g.textAlign = 'left'; g.fillStyle = '#3fbe97'; g.font = '700 108px "Frank Ruhl Libre", Georgia, serif'; g.fillText(fmt(cartTotal()) + ' ₪', 60, 706);
  }
  g.textAlign = 'center'; g.fillStyle = '#25c862'; roundRect(g, W / 2 - 250, H - 78, 500, 58, 29); g.fill();
  g.fillStyle = '#04150b'; g.font = '700 32px Heebo, sans-serif'; g.fillText(items.length ? 'לחצו כאן לסיום ושליחה בוואטסאפ' : 'לחצו כאן לעגלה', W / 2, H - 38);
  tex.needsUpdate = true;
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); }

/* ---------- window textures ---------- */
function windowSet(color, key) {
  const S = 256, wall = document.createElement('canvas'), em = document.createElement('canvas');
  wall.width = wall.height = em.width = em.height = S;
  const g = wall.getContext('2d'), e = em.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, S, S); e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = shade(color, -0.18); g.fillRect(0, i * 64 + 58, S, 6);
    for (let j = 0; j < 4; j++) {
      const x = j * 64 + 12, y = i * 64 + 10, w = 40, h = 36, lit = hash(key + i + '-' + j) < 0.6;
      g.fillStyle = shade(color, -0.5); g.fillRect(x - 3, y - 3, w + 6, h + 6);
      g.fillStyle = lit ? '#6b4a22' : shade(color, -0.65); g.fillRect(x, y, w, h);
      if (lit) {
        const warm = hash(key + 'w' + i + j) < 0.25 ? '#bfe3ff' : '#ffc66e';
        e.fillStyle = warm; e.fillRect(x, y, w, h);
        e.fillStyle = '#000'; e.fillRect(x + w / 2 - 1, y, 2, h); e.fillRect(x, y + h / 2 - 1, w, 2);
      }
      g.fillStyle = shade(color, 0.3); g.fillRect(x - 5, y + h + 3, w + 10, 4);
    }
  }
  return { wall, em };
}
function faceMat(set, fw, fh) {
  const map = new THREE.CanvasTexture(set.wall), emi = new THREE.CanvasTexture(set.em);
  for (const t of [map, emi]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(fw / 13.6, fh / 14.4); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; }
  return new THREE.MeshStandardMaterial({ map, emissiveMap: emi, emissive: 0xffffff, emissiveIntensity: 0.95, roughness: 0.85, metalness: 0.02 });
}
function glassTexture(accent) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#ffe9bd'); gr.addColorStop(1, '#ffc87a'); g.fillStyle = gr; g.fillRect(0, 0, 512, 256);
  for (let r = 0; r < 3; r++) {
    g.fillStyle = 'rgba(70,40,10,.75)'; g.fillRect(0, 70 + r * 62, 512, 7);
    for (let i = 0; i < 12; i++) { g.fillStyle = hash(accent + r + i) < 0.5 ? accent : '#f2f2ee'; g.fillRect(12 + i * 41, 36 + r * 62, 28, 32); }
  }
  g.fillStyle = 'rgba(40,20,0,.85)'; g.fillRect(238, 0, 36, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function stripeTexture(a, b) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 8; const g = c.getContext('2d');
  g.fillStyle = a; g.fillRect(0, 0, 32, 8); g.fillStyle = b; g.fillRect(32, 0, 32, 8);
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.repeat.set(7, 1); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function makeSign(p) {
  const W = 640, H = 320, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  let img = null;
  const draw = () => {
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#0c1511'; roundRect(g, 0, 0, W, H, 30); g.fill();
    g.strokeStyle = p.accent; g.lineWidth = 8; roundRect(g, 6, 6, W - 12, H - 12, 26); g.stroke();
    g.fillStyle = '#1b2b24'; g.fillRect(26, 26, 250, 268);
    if (img) { const s = Math.min(250 / img.width, 268 / img.height), w = img.width * s, h = img.height * s; g.drawImage(img, 26 + (250 - w) / 2, 26 + (268 - h) / 2, w, h); }
    g.direction = 'rtl'; g.textAlign = 'right'; g.fillStyle = '#fff'; g.font = '700 42px Heebo, sans-serif';
    const words = p.name.split(' '), lines = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > 318 && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur);
    lines.slice(0, 3).forEach((l, i) => g.fillText(l, W - 30, 78 + i * 50));
    g.fillStyle = p.accent; g.font = '700 50px Heebo, sans-serif'; g.fillText('מ-' + fmt(p.unitPrice) + ' ₪', W - 30, H - 36);
    tex.needsUpdate = true;
  };
  draw(); document.fonts.ready.then(draw);
  const im = new Image(); im.onload = () => { img = im; draw(); }; im.src = '../' + p.image;
  return tex;
}
function makeBadge() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, toneMapped: false }));
  s.scale.set(4.6, 4.6, 1); s.renderOrder = 10; s.visible = false; noRay(s);
  s.userData.draw = n => {
    const g = c.getContext('2d'); g.clearRect(0, 0, 128, 128);
    g.fillStyle = '#3fbe97'; g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#06130e'; g.lineWidth = 6; g.stroke();
    g.fillStyle = '#06130e'; g.font = '700 58px Heebo, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), 64, 68); t.needsUpdate = true;
  };
  return s;
}

/* ---------- buildings ---------- */
const S = 1.25;
const TYPES = {
  tower: { w: 7.2, d: 7.2, h: 17, sw: 5.8 },
  hall:  { w: 9.4, d: 7.6, h: 9.5, sw: 7.0 },
  shop:  { w: 8.4, d: 7.2, h: 8.8, sw: 6.6 },
  kiosk: { w: 6.4, d: 5.8, h: 7.2, sw: 5.0 },
  vault: { w: 8.8, d: 8.2, h: 12, sw: 6.6 },
  dome:  { w: 8.4, d: 8.6, h: 9.5, sw: 5.2 }
};
const FOOT = T => ({ w: T.w * S, d: T.d * S, h: T.h * S });
const FRONT_Z = 24, PITCH = 17;

function put(parent, mesh, x = 0, y = 0, z = 0) { mesh.position.set(x, y, z); parent.add(mesh); return mesh; }
function box(w, h, d, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; }
function sideWall(set, w, h, d, y) {
  const mats = [faceMat(set, d, h), faceMat(set, d, h), std(shade('#555555', 0)), std(0x2b2f2c), faceMat(set, w, h), faceMat(set, w, h)];
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats); m.position.y = y; return m;
}

function buildProcedural(def, T) {
  const g = new THREE.Group();
  const { w, d, h } = T, color = def.color, accent = def.accent, fz = d / 2, set = windowSet(color, def.id);
  const roofMat = std(shade(color, -0.55)), accentMat = std(accent, { roughness: 0.5 });
  const gold = std(0xd9a93a, { metalness: 0.85, roughness: 0.32 }), trim = std(shade(color, 0.28), { roughness: 0.7 });
  g.add(box(w + 0.6, 0.9, d + 0.6, std(0x39413c), 0, 0.45, 0)); // plinth

  if (def.building === 'tower') {
    const h1 = h * 0.62, h2 = h - h1;
    g.add(sideWall(set, w, h1, d, h1 / 2));
    g.add(sideWall(set, w * 0.74, h2, d * 0.74, h1 + h2 / 2));
    g.add(box(w + 0.5, 0.45, d + 0.5, trim, 0, h1, 0));
    g.add(box(w * 0.74 + 0.5, 0.5, d * 0.74 + 0.5, roofMat, 0, h + 0.25, 0));
    g.add(box(w * 0.3, 1.8, d * 0.3, roofMat, 0, h + 1.4, 0));
    g.add(box(0.14, 5, 0.14, std(0x9aa5a0), 0, h + 4, 0));
    put(g, new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8), basic(0xff4d4d)), 0, h + 6.6, 0);
    for (const sx of [-1, 1]) g.add(box(0.9, 0.12, 1.4, trim, sx * (w / 2 + 0.3), h1 * 0.6, fz - 1.4));
  } else if (def.building === 'dome') {
    const r = 4.1;
    const tex = faceMat(set, 2 * Math.PI * r, h); tex.map.repeat.x = 8; tex.emissiveMap.repeat.x = 8;
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 32, 1), tex); cyl.position.y = h / 2; g.add(cyl);
    put(g, new THREE.Mesh(new THREE.CylinderGeometry(r + 0.35, r + 0.35, 0.6, 32), accentMat), 0, h + 0.3, 0);
    put(g, new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r + 0.1, 1.2, 32), roofMat), 0, h + 1.2, 0);
    put(g, new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.5, 20), gold), 0, h + 2.0, 0);
    const annex = sideWall(set, 5.8, 7.4, 2.8, 3.7); annex.position.z = fz - 1.4; g.add(annex);
  } else {
    g.add(sideWall(set, w, h, d, h / 2));
    g.add(box(w + 0.7, 0.5, d + 0.7, trim, 0, h + 0.25, 0));
    g.add(box(w, 0.14, 0.12, basic(accent), 0, h - 0.9, fz + 0.06));
    for (const sx of [-1, 1]) g.add(box(0.5, h, 0.5, trim, sx * (w / 2 - 0.1), h / 2, fz));
    if (def.building === 'hall') {
      const s = new THREE.Shape(); s.moveTo(-d / 2 - 0.5, 0); s.lineTo(d / 2 + 0.5, 0); s.lineTo(0, 3.2); s.closePath();
      const geo = new THREE.ExtrudeGeometry(s, { depth: w + 0.9, bevelEnabled: false }); geo.translate(0, 0, -(w + 0.9) / 2); geo.rotateY(Math.PI / 2);
      const roof = new THREE.Mesh(geo, std(shade(accent, -0.4))); roof.position.y = h + 0.5; g.add(roof);
      g.add(box(w * 0.72, h * 0.55, d * 0.55, std(shade(color, -0.2)), 0, h * 0.275, -(d / 2 + d * 0.22)));
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.6, 12), std(0x7a6a58)); tank.position.set(w * 0.25, h + 2.9, -d * 0.15); g.add(tank);
    } else if (def.building === 'shop') {
      g.add(box(2.2, 1.2, 1.8, std(0x86918b), -w * 0.25, h + 1.1, -d * 0.15));
      g.add(box(1.4, 0.8, 1.4, std(0x86918b), w * 0.2, h + 0.9, -d * 0.2));
      g.add(box(w * 0.55, h * 0.6, d * 0.5, std(shade(color, -0.25)), w * 0.1, h * 0.3, -(d / 2 + d * 0.2)));
    } else if (def.building === 'kiosk') {
      g.add(box(w + 0.8, 0.4, d + 0.8, accentMat, 0, h + 0.55, 0));
      put(g, new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3, 6), std(0xcfd6d1)), w * 0.3, h + 2.2, -d * 0.2);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.95), basic(accent, { side: THREE.DoubleSide })); flag.position.set(w * 0.3 + 0.78, h + 3.3, -d * 0.2); g.add(flag);
      g.add(box(w * 0.5, 1.4, d * 0.5, std(shade(color, -0.3)), -w * 0.2, h + 1.2, -d * 0.1));
    } else if (def.building === 'vault') {
      g.add(box(w + 0.5, 0.5, d + 0.5, gold, 0, h - 1.5, 0));
      g.add(box(w + 0.4, 0.7, d + 0.4, roofMat, 0, h + 0.35, 0));
      put(g, new THREE.Mesh(new THREE.SphereGeometry(w * 0.28, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), gold), 0, h + 0.7, 0);
      put(g, new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.4, 8), gold), 0, h + w * 0.28 + 1.5, 0);
      g.add(box(w * 0.8, h * 0.5, d * 0.5, std(shade(color, -0.25)), 0, h * 0.25, -(d / 2 + d * 0.22)));
      for (const sx of [-1, 1]) { const col = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.46, 3.5, 14), std(0xe9e2cf, { roughness: 0.5 })); col.position.set(sx * (w / 2 - 0.5), 1.75, fz + 1.0); g.add(col); }
    }
  }

  /* storefront */
  const sfW = def.building === 'dome' ? 4.2 : w * 0.8;
  g.add(box(sfW + 0.4, 3.15, 0.14, std(0x0f1613), 0, 1.6, fz + 0.02));
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(sfW, 2.75), basic(0xffffff, { map: glassTexture(accent) })); glass.position.set(0, 1.55, fz + 0.1); g.add(glass);
  const awnMat = new THREE.MeshStandardMaterial({ map: stripeTexture(accent, '#f4f1e6'), roughness: 0.7 });
  const awn = new THREE.Mesh(new THREE.BoxGeometry(sfW + 0.8, 0.18, 2.0), awnMat); awn.position.set(0, 3.25, fz + 0.95); awn.rotation.x = 0.42; g.add(awn);
  g.add(box(sfW + 0.6, 0.3, 1.4, std(0x59615b), 0, 0.15, fz + 0.75)); // step
  return g;
}

function makeForecourt(def, T, dir) {
  const F = FOOT(T), g = new THREE.Group(), front = F.d / 2;
  const pw = PITCH - 0.6, pd = FRONT_Z - 16.2;
  const col = new THREE.Color(def.accent).multiplyScalar(0.28).lerp(new THREE.Color(0x5a625b), 0.55);
  const pave = noRay(new THREE.Mesh(new THREE.PlaneGeometry(pw, pd), std(col, { roughness: 0.9 })));
  pave.rotation.x = -Math.PI / 2; pave.position.set(0, 0.06, front + pd / 2); pave.receiveShadow = true; g.add(pave);
  const lineMat = basic(def.accent);
  for (const z of [front + 0.4, front + pd - 0.4]) { const l = noRay(new THREE.Mesh(new THREE.PlaneGeometry(pw - 1.4, 0.18), lineMat)); l.rotation.x = -Math.PI / 2; l.position.set(0, 0.07, z); g.add(l); }
  // display pedestal with rotating product panel
  const dx = (hash(def.id) < 0.5 ? -1 : 1) * (F.w / 2 + 1.2 > pw / 2 - 2 ? pw / 2 - 2.6 : F.w / 2 + 1.2);
  const disp = new THREE.Group(); disp.position.set(dx, 0, front + pd * 0.55);
  put(disp, new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.9, 0.7, 24), std(0x2a312d, { roughness: 0.5 })), 0, 0.35, 0);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.07, 8, 40), basic(def.accent)); ring.rotation.x = Math.PI / 2; ring.position.y = 0.74; disp.add(ring);
  const panelMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.35 });
  const edge = std(0x1b2420);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(3, 3.8, 0.28), [edge, edge, edge, edge, panelMat, panelMat]); panel.position.y = 0.74 + 2.3; disp.add(panel);
  const im = new Image(); im.onload = () => {
    const t = new THREE.Texture(im); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; t.anisotropy = 4; panelMat.map = t; panelMat.emissiveMap = t; panelMat.needsUpdate = true;
    const a = im.width / im.height, hh = 3.8; panel.scale.x = Math.min(1.5, (hh * a) / 3);
  }; im.src = '../' + def.image;
  g.add(disp); g.userData.panel = panel;
  // planters + bench
  const px = -dx / Math.abs(dx) * (pw / 2 - 1.4);
  for (const sx of [px, -px * 0.35]) {
    const pl = new THREE.Group(); pl.position.set(sx, 0, front + pd - 1.6);
    put(pl, new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 1), std(0x6b5646)), 0, 0.4, 0);
    for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42 + rnd() * 0.15, 0), std(pick([0xe35d7a, 0xf2c14e, 0xb36cd6, 0x58c27d]), { roughness: 0.8 })); b.position.set(-0.8 + i * 0.55, 1.1, 0); pl.add(b); }
    g.add(pl);
  }
  const bench = new THREE.Group(); bench.position.set(dx * -0.85, 0, front + 1.3);
  put(bench, new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.18, 0.7), std(0x8a5f3a)), 0, 0.55, 0);
  put(bench, new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 0.12), std(0x8a5f3a)), 0, 0.95, -0.32);
  for (const sx of [-1, 1]) put(bench, new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 0.6), std(0x2a2e2b)), sx * 1.05, 0.27, 0);
  g.add(bench);
  return g;
}

function makeBuilding(def) {
  const T = TYPES[def.building], F = FOOT(T);
  const root = new THREE.Group();
  root.userData = { pid: def.id, T, F };
  const proc = buildProcedural(def, T); proc.scale.setScalar(S);
  root.add(proc); root.userData.proc = proc;
  const sw = T.sw * S, sh = sw / 2, fz = F.d / 2;
  const sign = new THREE.Group(); sign.position.set(0, (3.95 * S) + sh / 2 + 0.2, fz + 0.2);
  sign.add(new THREE.Mesh(new THREE.PlaneGeometry(sw + 0.4, sh + 0.4), basic(new THREE.Color(def.accent).multiplyScalar(1.1))));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshBasicMaterial({ map: makeSign(def), transparent: true, toneMapped: false })); face.position.z = 0.04; sign.add(face);
  root.add(sign); root.userData.sign = sign;
  const fc = makeForecourt(def, T); root.add(fc); root.userData.fc = fc;
  const badge = makeBadge(); badge.position.set(0, F.h + (def.building === 'tower' ? 11 : 4.5), 0); root.add(badge); root.userData.badge = badge;
  root.userData.hover = 0; root.userData.hoverT = 0;
  shadowify(proc, true, true);
  if (manifest[def.building]) {
    new GLTFLoader().loadAsync('./models/' + manifest[def.building]).then(gl => {
      const m = gl.scene; shadowify(m); root.remove(proc); root.add(m);
      const a = m.getObjectByName('SignAnchor'); if (a) sign.position.copy(a.position);
    }).catch(err => console.warn('GLB load failed for', def.building, err));
  }
  return root;
}

const buildings = {};
const NORTH = { preorder: ['box', 'etb', 'bundle', 'blister'], instock: ['me03etb', 'me04box', 'me05box', 'zygarde', 'greninja', 'armarouge'] };
const SOUTH = { preorder: ['bnb', 'sleeved', 'checklane', 'checklanep'], instock: ['fp1', 'fp2', 'fp3', 'moonlit', 'lumiose', 'pokeball'] };
const X0 = { preorder: -88, instock: 40 };
for (const cat of ['preorder', 'instock']) {
  [[NORTH[cat], -1], [SOUTH[cat], 1]].forEach(([ids, side]) => {
    ids.forEach((id, i) => {
      const def = P[id]; if (!def) return;
      const b = makeBuilding(def), F = b.userData.F;
      b.position.set(X0[cat] + i * PITCH, 0, side * (FRONT_Z + F.d / 2));
      b.rotation.y = side < 0 ? 0 : Math.PI;
      b.userData.facing = side < 0 ? 1 : -1; b.userData.side = side; b.userData.front = FRONT_Z;
      scene.add(b); buildings[id] = b;
    });
  });
}
const buildingRoots = Object.values(buildings);

/* ---------- instanced trees, lamps ---------- */
{
  const trees = [];
  for (const cat of ['preorder', 'instock']) for (let i = -1; i < (cat === 'preorder' ? 4 : 6); i++) for (const side of [-1, 1])
    trees.push({ x: X0[cat] + i * PITCH + PITCH / 2, z: side * 16.4, s: 0.85 + rnd() * 0.2, t: rnd() < 0.5 ? 1 : 0 });
  for (let i = 0; i < Q.treesFar; i++) {
    const side = rnd() < 0.5 ? -1 : 1;
    trees.push({ x: X_MIN - 10 + rnd() * (XW + 30), z: side * (48 + rnd() * 70), s: 1 + rnd() * 1.2, t: rnd() < 0.6 ? 0 : 1 });
  }
  const n = trees.length;
  const trunkGeo = new THREE.CylinderGeometry(0.26, 0.38, 1.8, 6); trunkGeo.translate(0, 0.9, 0);
  const pineGeo = new THREE.ConeGeometry(1.8, 4.6, 7); pineGeo.translate(0, 4, 0);
  const blobGeo = new THREE.IcosahedronGeometry(2.1, 1); blobGeo.translate(0, 3.9, 0);
  const trunk = new THREE.InstancedMesh(trunkGeo, std(0x5a3f2a), n);
  const pine = new THREE.InstancedMesh(pineGeo, std(0xffffff, { flatShading: true }), n);
  const blob = new THREE.InstancedMesh(blobGeo, std(0xffffff, { flatShading: true }), n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const pineCols = [0x1f5a3a, 0x246b43, 0x1a4d34], blobCols = [0x3f8f48, 0x5da24a, 0xc79a3a, 0x8aa83f];
  trees.forEach((t, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28); v.set(t.x, 0, t.z); sc.setScalar(t.s); m4.compose(v, q, sc);
    trunk.setMatrixAt(i, m4);
    if (t.t) { pine.setMatrixAt(i, m4); blob.setMatrixAt(i, zero); pine.setColorAt(i, new THREE.Color(pick(pineCols))); blob.setColorAt(i, new THREE.Color(0xffffff)); }
    else { blob.setMatrixAt(i, m4); pine.setMatrixAt(i, zero); blob.setColorAt(i, new THREE.Color(pick(blobCols))); pine.setColorAt(i, new THREE.Color(0xffffff)); }
  });
  for (const m of [trunk, pine, blob]) { m.castShadow = true; m.receiveShadow = true; noRay(m); scene.add(m); }

  const lamps = [];
  for (let x = X_MIN; x <= X_MAX; x += PITCH) for (const side of [-1, 1]) lamps.push({ x: x + 1.2, z: side * 10.7 });
  const poleGeo = new THREE.CylinderGeometry(0.11, 0.16, 6.4, 8); poleGeo.translate(0, 3.2, 0);
  const bulbGeo = new THREE.SphereGeometry(0.46, 10, 8);
  const poles = new THREE.InstancedMesh(poleGeo, std(0x2b3430, { metalness: 0.6, roughness: 0.4 }), lamps.length);
  const bulbs = new THREE.InstancedMesh(bulbGeo, basic(0xffe6b0), lamps.length);
  lamps.forEach((l, i) => { m4.makeTranslation(l.x, 0, l.z); poles.setMatrixAt(i, m4); m4.makeTranslation(l.x, 6.55, l.z); bulbs.setMatrixAt(i, m4); });
  poles.castShadow = true; for (const m of [poles, bulbs]) { noRay(m); scene.add(m); }
}

/* ---------- people ---------- */
const SKIN = [0xf1c9a5, 0xd9a47a, 0xb27a52, 0x7d5236, 0xfbe0c8], SHIRTS = [0xd94a4a, 0x4a7fd9, 0xe8b84a, 0x3fbe97, 0x9a5ad9, 0xf2f2ee, 0x2f3a36, 0xe07a3a, 0x4ab0c9];
const PANTS = [0x27303a, 0x3a4a63, 0x5a4a3a, 0x2b2b2b, 0x6a6f78], HAIR = [0x1b1410, 0x3b2616, 0x7a5a2a, 0xc9a24a, 0x8a8a8a, 0x5a1f1f];
const legGeo = new THREE.BoxGeometry(0.22, 0.8, 0.24); legGeo.translate(0, -0.4, 0);
const armGeo = new THREE.BoxGeometry(0.15, 0.62, 0.17); armGeo.translate(0, -0.3, 0);
const personMatCache = {};
const matFor = (key, make) => personMatCache[key] || (personMatCache[key] = make());
function tinted(geo, color) {
  const c = new THREE.Color(color), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo.index ? geo.toNonIndexed() : geo;
}
function makePerson() {
  const g = new THREE.Group(), shirt = pick(SHIRTS), pants = pick(PANTS), skin = pick(SKIN), hair = pick(HAIR);
  const parts = [
    tinted(new THREE.BoxGeometry(0.58, 0.72, 0.34).translate(0, 1.16, 0), shirt),
    tinted(new THREE.SphereGeometry(0.21, 12, 10).translate(0, 1.76, 0), skin),
    tinted(new THREE.SphereGeometry(0.225, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.8, -0.01), rnd() < 0.3 ? pick(SHIRTS) : hair)
  ];
  if (rnd() < 0.35) parts.push(tinted(new THREE.BoxGeometry(0.4, 0.5, 0.2).translate(0, 1.2, -0.27), pick(SHIRTS)));
  const upper = new THREE.Mesh(mergeGeometries(parts), matFor('vc', () => std(0xffffff, { vertexColors: true, roughness: 0.8 })));
  g.add(upper);
  const pm = matFor('p' + pants, () => std(pants)), sm = matFor('s' + shirt, () => std(shirt));
  const legL = new THREE.Mesh(legGeo, pm), legR = new THREE.Mesh(legGeo, pm); legL.position.set(-0.15, 0.82, 0); legR.position.set(0.15, 0.82, 0);
  const armL = new THREE.Mesh(armGeo, sm), armR = new THREE.Mesh(armGeo, sm); armL.position.set(-0.4, 1.46, 0); armR.position.set(0.4, 1.46, 0);
  g.add(legL, legR, armL, armR);
  g.scale.setScalar(1.35);
  g.userData = { legL, legR, armL, armR };
  if (HI) g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  noRay(g); g.traverse(noRay);
  return g;
}
const people = [];
const lerpAng = (a, b, t) => { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; };
function planPerson(p) {
  const side = p.side, r = rnd();
  const lane = side * 13.2;
  if (r < 0.5) {
    const dist = 14 + rnd() * 50; let nx = p.x + p.dir * dist;
    if (nx > X_MAX + 5) { p.dir = -1; nx = X_MAX; } if (nx < X_MIN - 5) { p.dir = 1; nx = X_MIN; }
    p.q.push({ x: nx, z: lane + (rnd() - 0.5) * 2.4 });
  } else if (r < 0.85) {
    const sideB = buildingRoots.filter(b => b.userData.side === side);
    const b = pick(sideB), F = b.userData.F;
    const bx = b.position.x + (rnd() - 0.5) * 6, bz = side * (FRONT_Z - 3.2 - rnd() * 2);
    p.q.push({ x: bx, z: side * 16.8 }, { x: bx, z: bz, wait: 3 + rnd() * 5, face: Math.atan2(0, -side) }, { x: bx, z: side * 16.8 });
  } else {
    const cx = CROSS_X.reduce((a, c) => Math.abs(c - p.x) < Math.abs(a - p.x) ? c : a, CROSS_X[0]) + (rnd() - 0.5) * 8;
    p.q.push({ x: cx, z: side * 12.6 }, { x: cx, z: -side * 12.6 });
    p.side = -side;
  }
}
for (let i = 0; i < Q.people; i++) {
  const g = makePerson(), side = rnd() < 0.5 ? -1 : 1;
  const p = { g, x: X_MIN + rnd() * XW, z: side * 13.2, side, dir: rnd() < 0.5 ? -1 : 1, q: [], speed: 2 + rnd() * 1.3, phase: rnd() * 6, wait: 0, rot: 0, walk: 0 };
  g.position.set(p.x, 0, p.z); scene.add(g); people.push(p);
}
function updatePeople(dt) {
  for (const p of people) {
    if (p.wait > 0) { p.wait -= dt; p.walk += (0 - p.walk) * Math.min(1, dt * 8); if (p.face !== undefined) p.rot = lerpAng(p.rot, p.face, Math.min(1, dt * 5)); }
    else {
      if (!p.q.length) { p.face = undefined; planPerson(p); }
      const t = p.q[0], dx = t.x - p.x, dz = t.z - p.z, dist = Math.hypot(dx, dz);
      if (dist < 0.25) { p.q.shift(); if (t.wait) { p.wait = t.wait; p.face = t.face; } }
      else {
        const step = Math.min(dist, p.speed * dt); p.x += dx / dist * step; p.z += dz / dist * step;
        p.rot = lerpAng(p.rot, Math.atan2(dx, dz), Math.min(1, dt * 7)); p.phase += step * 3.1; p.walk += (1 - p.walk) * Math.min(1, dt * 8);
      }
    }
    const u = p.g.userData, sw = Math.sin(p.phase) * 0.75 * p.walk;
    u.legL.rotation.x = sw; u.legR.rotation.x = -sw; u.armL.rotation.x = -sw * 0.8; u.armR.rotation.x = sw * 0.8;
    p.g.position.set(p.x, Math.abs(Math.sin(p.phase)) * 0.06 * p.walk, p.z); p.g.rotation.y = p.rot;
  }
}

/* ---------- marker / badges ---------- */
const marker = new THREE.Group(); marker.visible = false;
{
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 8, 64), basic(0x3fbe97)); ring.rotation.x = Math.PI / 2; ring.position.y = 0.25;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 50, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0x3fbe97, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  beam.position.y = 25; marker.add(ring, beam); marker.userData.ring = ring; marker.traverse(noRay);
}
scene.add(marker);
function updateBadge(pid) {
  const b = buildings[pid]; if (!b) return;
  const q = qtyOf(pid), n = q.units + q.cases; b.userData.badge.visible = n > 0; if (n > 0) b.userData.badge.userData.draw(n);
}
PRODUCTS.forEach(p => updateBadge(p.id)); updateFab();

/* ---------- post ---------- */
let composer = null, bloom = null;
if (Q.bloom) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.6, 0.95);
  composer.addPass(bloom); composer.addPass(new OutputPass());
}

/* ---------- camera / controls ---------- */
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 10; controls.maxDistance = 330;
controls.minPolarAngle = 0.15; controls.maxPolarAngle = 1.35; controls.rotateSpeed = 0.7; controls.zoomSpeed = 0.9; controls.screenSpacePanning = false;
const VIEWS = {
  overview: { t: [XC, 0, 0],  off: [0, 150, 185] },
  preorder: { t: [-62, 0, 0], off: [0, 56, 70] },
  instock:  { t: [79, 0, 0],  off: [0, 66, 86] },
  tower:    { t: [0, 22, 0],  off: [0, 20, 82] }
};
const aspect = () => innerWidth / innerHeight;
const aspectScale = () => { const a = aspect(); return a < 1 ? Math.min(3.3, Math.pow(1 / a, 1.1)) : 1; };
let tween = null;
function flyTo(target, pos, ms = 1000) {
  if (REDUCE) ms = 1;
  tween = { t0: performance.now(), ms, fromT: controls.target.clone(), fromP: camera.position.clone(), toT: target.clone(), toP: pos.clone() }; controls.enabled = false;
}
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function setChips(name) { document.querySelectorAll('#views .chip').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.view === name))); }
function flyToView(name, ms) {
  const v = VIEWS[name], k = aspectScale(), t = new THREE.Vector3(...v.t);
  flyTo(t, new THREE.Vector3(t.x + v.off[0] * k, v.off[1] * k, t.z + v.off[2] * k), ms); setChips(name);
}
function flyToBuilding(pid) {
  const b = buildings[pid], k = Math.min(1.6, aspectScale());
  const t = new THREE.Vector3(b.position.x, 2, b.position.z - b.userData.facing * 9);
  flyTo(t, new THREE.Vector3(t.x + 10 * k, 25 * k, t.z + b.userData.facing * 46 * k), 950); setChips(null);
}
function resize() {
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  if (composer) { composer.setSize(w, h); composer.setPixelRatio(Math.min(devicePixelRatio || 1, Q.pr)); }
}
addEventListener('resize', resize); resize();
{ const k = aspectScale(); camera.position.set(XC, 320 * k, 420 * k); controls.target.set(XC, 0, 0); controls.update(); flyToView('overview', 2600); }

/* ---------- picking ---------- */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pickAt(ev) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects([tower, ...buildingRoots], true)[0]; if (!hit) return null;
  let o = hit.object; while (o && !(o.userData && (o.userData.pid || o.userData.tower))) o = o.parent;
  return o ? (o.userData.tower ? 'tower' : o.userData.pid) : null;
}
let down = null, hovered = null;
const hideHint = () => $('hint').classList.add('gone');
canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; hideHint(); if (tween) { tween = null; controls.enabled = true; } });
canvas.addEventListener('pointerup', e => {
  if (!down) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t; down = null;
  if (moved < 8 && dt < 500) { const pid = pickAt(e); if (pid === 'tower') { closeShop(); flyToView('tower', 900); openCheckout(); } else if (pid) openShop(pid); }
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse' || down) return;
  const pid = pickAt(e);
  if (pid !== hovered) {
    if (hovered && buildings[hovered]) buildings[hovered].userData.hoverT = 0;
    hovered = pid; if (pid && buildings[pid]) buildings[pid].userData.hoverT = 1; canvas.style.cursor = pid ? 'pointer' : 'grab';
  }
});

/* ---------- UI: shop sheet ---------- */
const shopEl = $('shop'), coEl = $('checkout');
let selected = null;
const stepper = id => `<div class="stepper"><button type="button" data-d="-1" data-t="${id}" aria-label="הפחתה">–</button><input id="${id}" type="number" inputmode="numeric" min="0" step="1" value="0"><button type="button" data-d="1" data-t="${id}" aria-label="הוספה">+</button></div>`;
function selectBuilding(pid) {
  selected = pid; if (!pid) { marker.visible = false; return; }
  const b = buildings[pid], F = b.userData.F, r = Math.max(F.w, F.d) * 0.78;
  marker.position.set(b.position.x, 0, b.position.z); marker.scale.set(r, 1, r); marker.visible = true;
}
function openShop(pid) {
  const p = P[pid]; closeCheckout(); selectBuilding(pid); flyToBuilding(pid);
  const q = qtyOf(pid);
  shopEl.innerHTML = `
    <div class="sheet-head">
      <img class="sheet-img" src="../${p.image}" alt="">
      <div><h2 class="sheet-title">${p.name}</h2>
      <div class="sheet-sub">יחידה: <b>${fmt(p.unitPrice)} ₪</b><br>קייס (${p.caseQty} יחידות): <b>${fmt(p.casePrice)} ₪</b></div></div>
      <button class="close" id="shop-x" aria-label="סגור">✕</button>
    </div>
    <div class="row"><span class="lbl">יחידות</span>${stepper('q-units')}</div>
    <div class="row"><span class="lbl">קייסים (${p.caseQty} יחידות בקייס)</span>${stepper('q-cases')}</div>
    <div class="line-total" id="q-total"></div>
    <div class="btns"><button class="btn btn-ghost" id="shop-more">המשך לטייל</button><button class="btn btn-main" id="shop-cart">לעגלה ←</button></div>`;
  const u = $('q-units'), c = $('q-cases'); u.value = q.units; c.value = q.cases;
  const apply = () => {
    setQty(pid, parseInt(u.value || '0', 10) || 0, parseInt(c.value || '0', 10) || 0);
    const t = lineTotal(p, qtyOf(pid)); $('q-total').textContent = t ? 'סה״כ למוצר: ' + fmt(t) + ' ₪' : '';
  };
  shopEl.querySelectorAll('.stepper button').forEach(btn => btn.addEventListener('click', () => {
    const inp = $(btn.dataset.t); inp.value = Math.max(0, (parseInt(inp.value || '0', 10) || 0) + parseInt(btn.dataset.d, 10)); apply();
  }));
  u.addEventListener('input', apply); c.addEventListener('input', apply); apply();
  $('shop-x').onclick = $('shop-more').onclick = closeShop; $('shop-cart').onclick = () => { flyToView('tower', 1000); openCheckout(); };
  shopEl.hidden = false;
}
function closeShop() { shopEl.hidden = true; selectBuilding(null); }

/* ---------- UI: checkout ---------- */
const HEAD = { preorder: 'הזמנה מוקדמת – דלתא ריין', instock: 'זמין במלאי' };
const parts = q => { const a = []; if (q.units) a.push(q.units + ' יח׳'); if (q.cases) a.push(q.cases + ' קייס'); return a.join(' + '); };
function buildMessage() {
  const name = $('c-name').value.trim(), phone = $('c-phone').value.trim(), note = $('c-note').value.trim();
  const L = ['הזמנה – פוקימון TCG 🐉', 'שם: ' + (name || '-'), 'טלפון: ' + (phone || '-'), ''];
  for (const cat of ['preorder', 'instock']) {
    const items = cartItems().filter(c => c.p.category === cat); if (!items.length) continue;
    L.push(HEAD[cat] + ':'); items.forEach(c => L.push('• ' + c.p.name + ': ' + parts(c.q) + ' = ' + fmt(c.total) + ' ₪')); L.push('');
  }
  L.push('סה"כ: ' + fmt(cartTotal()) + ' ₪'); if (note) L.push('', 'הערה: ' + note); L.push('', '(הזמנה בלבד, ללא תשלום כעת)');
  return { text: L.join('\n'), name, phone };
}
function renderLines() {
  const items = cartItems(), el = $('c-lines');
  if (!items.length) el.innerHTML = '<div class="note">העגלה ריקה — לחצו על בניין כדי להוסיף מוצרים.</div>';
  else {
    el.innerHTML = items.map(c => `<div class="line"><span>${c.p.name} — ${parts(c.q)} <button class="rm" data-rm="${c.p.id}">הסר</button></span><span>${fmt(c.total)} ₪</span></div>`).join('');
    el.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { setQty(b.dataset.rm, 0, 0); renderLines(); }));
  }
  $('c-total').textContent = fmt(cartTotal()) + ' ₪';
}
function openCheckout() {
  closeShop(); let saved = {}; try { saved = JSON.parse(localStorage.getItem('dr_customer') || '{}') || {}; } catch (e) {}
  coEl.innerHTML = `
    <div class="sheet-head"><h2 class="sheet-title" style="flex:1;align-self:center">העגלה שלך</h2><button class="close" id="co-x" aria-label="סגור">✕</button></div>
    <div class="lines" id="c-lines"></div>
    <div class="total"><span>סה״כ</span><span class="amt" id="c-total">0 ₪</span></div>
    <div class="grid2">
      <div class="field"><label for="c-name">שם מלא</label><input id="c-name" type="text" autocomplete="name"></div>
      <div class="field"><label for="c-phone">טלפון</label><input id="c-phone" type="tel" autocomplete="tel"></div>
    </div>
    <div class="field"><label for="c-note">הערה (לא חובה)</label><input id="c-note" type="text" placeholder="אאסוף בעצמי / כתובת למשלוח"></div>
    <div class="msg" id="c-msg"></div>
    <div class="btns"><button class="btn btn-wa" id="c-send">שליחת הזמנה בוואטסאפ</button><button class="btn btn-ghost" id="c-copy">העתקה</button></div>
    <div class="note">זו הזמנה בלבד — ללא תשלום כרגע. התשלום מול המוכר אחרי אישור.</div>`;
  $('c-name').value = saved.name || ''; $('c-phone').value = saved.phone || ''; renderLines();
  const msg = (t, k) => { const m = $('c-msg'); m.textContent = t; m.className = 'msg show ' + k; };
  const check = () => { if (!cartCount()) return 'העגלה ריקה'; const d = buildMessage(); if (!d.name) return 'נא למלא שם מלא'; if (!d.phone) return 'נא למלא מספר טלפון'; return null; };
  $('c-send').onclick = () => {
    const err = check(); if (err) return msg(err, 'err'); const d = buildMessage();
    try { localStorage.setItem('dr_customer', JSON.stringify({ name: d.name, phone: d.phone })); } catch (e) {}
    window.open('https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(d.text), '_blank'); msg('נפתחה הודעת וואטסאפ מוכנה — רק לשלוח!', 'ok');
  };
  $('c-copy').onclick = async () => {
    const err = check(); if (err) return msg(err, 'err');
    try { await navigator.clipboard.writeText(buildMessage().text); msg('ההזמנה הועתקה', 'ok'); } catch (e) { msg('לא הצלחנו להעתיק אוטומטית', 'err'); }
  };
  $('co-x').onclick = closeCheckout; coEl.hidden = false;
}
function closeCheckout() { coEl.hidden = true; }
$('cart-fab').addEventListener('click', () => { if (coEl.hidden) { flyToView('tower', 1000); openCheckout(); } else closeCheckout(); });
document.querySelectorAll('#views .chip').forEach(c => c.addEventListener('click', () => { hideHint(); flyToView(c.dataset.view, 1100); }));
addEventListener('keydown', e => { if (e.key === 'Escape') { closeShop(); closeCheckout(); } });

/* ---------- loop ---------- */
let last = performance.now(), screenAt = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (tween) {
    const k = clamp((now - tween.t0) / tween.ms, 0, 1), e = ease(k);
    controls.target.lerpVectors(tween.fromT, tween.toT, e); camera.position.lerpVectors(tween.fromP, tween.toP, e);
    if (k >= 1) { tween = null; controls.enabled = true; }
  }
  controls.target.x = clamp(controls.target.x, -130, 160); controls.target.z = clamp(controls.target.z, -80, 80); controls.target.y = clamp(controls.target.y, 0, 40);
  controls.update();
  if (screenDirty && now - screenAt > 150) { drawScreen(); screenDirty = false; screenAt = now; }
  towerAnim.ball.rotation.y = now * 0.0005;
  { const a = towerAnim.pts.geometry.attributes.position, N = towerAnim.N, M = towerAnim.M;
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
      const t = ((now * 0.00055 + j / M) % 1), ang = (i / N) * Math.PI * 2, r = 17.5 - t * 8 * 0 - Math.sin(t * Math.PI) * 0 + (t - 0.5) * 9;
      a.setXYZ(i * M + j, Math.cos(ang) * r, 1 + Math.sin(t * Math.PI) * 6.5, Math.sin(ang) * r);
    }
    a.needsUpdate = true; }
  for (const b of buildingRoots) {
    const u = b.userData; u.hover += (u.hoverT - u.hover) * 0.2; const s = 1 + u.hover * 0.03; b.scale.set(s, 1 + u.hover * 0.015, s);
    u.fc.userData.panel.parent.rotation.y = now * 0.0007 + b.position.x;
    if (u.badge.visible) u.badge.position.y = u.F.h + 4.5 + Math.sin(now * 0.003 + b.position.x) * 0.35;
  }
  if (marker.visible) { const p = 1 + Math.sin(now * 0.004) * 0.04; marker.userData.ring.scale.set(p, p, p); }
  updatePeople(dt);
  if (composer) composer.render(); else renderer.render(scene, camera);
}
requestAnimationFrame(loop);
requestAnimationFrame(() => requestAnimationFrame(() => { $('bar').style.width = '100%'; setTimeout(() => $('loading').classList.add('gone'), 250); }));
window.cityDebug = { THREE, scene, camera, controls, openShop, buildings, flyToView, cart, setQty, people, renderer };
