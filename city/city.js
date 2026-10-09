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
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { createNet } from './net.js';
import { createMarket } from './market.js';

/* ======================================================================
   עיר הפוקימון v3 — עיר עגולה.
   מעבר לבלנדר: מייצאים בניין כ-.glb ל-./models ורושמים ב-./models/manifest.json
   לפי סוג, למשל {"tower": "tower.glb"}. חוזה: מרכז הבסיס בראשית הצירים,
   החזית ל-+Z, מטר ליחידה, גודל = TYPES × S (ראו FOOT). אובייקט בשם SignAnchor
   קובע את מיקום השלט. סוגים: tower, hall, shop, kiosk, vault, dome.
   ====================================================================== */

const WHATSAPP = '972522123345';
const MV = '?v=20261007b';
const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString('he-IL');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FONT_D = '"Secular One", "Rubik", sans-serif';
const FONT_B = 'Rubik, "Heebo", sans-serif';

function hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }
  catch (e) { return false; }
}
if (!hasWebGL()) { $('loading').classList.add('gone'); $('nogl').hidden = false; throw new Error('WebGL unavailable'); }

/* fonts must be ready before anything is drawn onto a canvas */
await Promise.race([
  Promise.all(['400 40px "Secular One"', '400 30px Rubik', '500 30px Rubik', '600 30px Rubik', '700 30px Rubik'].map(f => document.fonts.load(f, 'אבגדהוזחטיכלמנסעפצקרשת Aa0'))),
  new Promise(r => setTimeout(r, 3500))
]);

/* ---------- quality ---------- */
const params = new URLSearchParams(location.search);
const autoLow = matchMedia('(pointer: coarse)').matches || innerWidth < 760;
const QUALITY = params.get('q') || (autoLow ? 'low' : 'high');
const HI = QUALITY === 'high';
const Q = HI
  ? { shadowMap: 4096, bloom: true, people: 38, pr: 2, treesFar: 120, sky: 80 }
  : { shadowMap: 1024, bloom: false, people: 20, pr: 1.5, treesFar: 50, sky: 40 };
$('quality').textContent = HI ? 'איכות: גבוהה' : 'איכות: חסכונית';
$('quality').onclick = () => { params.set('q', HI ? 'low' : 'high'); location.search = params.toString(); };

/* ---------- data ---------- */
const [data, manifest] = await Promise.all([
  fetch('../data/products.json').then(r => r.json()),
  fetch('./models/manifest.json' + MV).then(r => (r.ok ? r.json() : {})).catch(() => ({}))
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
  const before = cart[pid] ? cart[pid].units + cart[pid].cases : 0, after = units + cases;
  if (typeof sfx !== 'undefined') { if (after > before) sfx.chime(); else if (after < before) sfx.tick(); }
  if (units || cases) cart[pid] = { units, cases }; else delete cart[pid];
  try { localStorage.setItem('dr_city_cart', JSON.stringify(cart)); } catch (e) {}
  updateFab(); updateBadge(pid); screenDirty = true;
}
function updateFab() { $('cart-n').textContent = cartCount(); $('cart-t').textContent = fmt(cartTotal()) + ' ₪'; }

/* ---------- geometry of the ring city ---------- */
/* market quarter: a paved square outside the ring, reached by a boulevard through the gap at 90deg (south) */
const MK = { cx: 0, cz: 182, r: 36 }, LOTS = 23, CORR_HW = 4.5, CORR_Z = [76, MK.cz - MK.r + 4], WALK_R = [22, 83];
function stallSlot(k) { // lots 0-14: outer ring facing the centre, 15-22: inner ring facing out
  let x, z, fx, fz;
  if (k < 15) { const a = (270 + 22.5 * (k + 1)) * Math.PI / 180; x = MK.cx + 27 * Math.cos(a); z = MK.cz + 27 * Math.sin(a); fx = MK.cx - x; fz = MK.cz - z; }
  else { const a = (45 * (k - 15) + 22.5) * Math.PI / 180; x = MK.cx + 12 * Math.cos(a); z = MK.cz + 12 * Math.sin(a); fx = Math.cos(a); fz = Math.sin(a); }
  return { x, z, ry: Math.atan2(fx, fz) };
}
function clampRing(v) { // nearest point of: ring annulus, boulevard, market square
  let bd = 1e9, bx = v.x, bz = v.z;
  const t = (x, z) => { const d = (x - v.x) ** 2 + (z - v.z) ** 2; if (d < bd) { bd = d; bx = x; bz = z; } };
  const r = Math.hypot(v.x, v.z), c = clamp(r, WALK_R[0], WALK_R[1]); if (r > 0.001) t(v.x * c / r, v.z * c / r); else t(WALK_R[0], 0);
  t(clamp(v.x, -CORR_HW, CORR_HW), clamp(v.z, CORR_Z[0], CORR_Z[1]));
  const dx = v.x - MK.cx, dz = v.z - MK.cz, dr = Math.hypot(dx, dz), cr = Math.min(dr, MK.r - 2); if (dr > 0.001) t(MK.cx + dx * cr / dr, MK.cz + dz * cr / dr); else t(MK.cx, MK.cz);
  v.x = bx; v.z = bz; return v;
}
const R_PLAZA = 27, R_PARK = 44, R_IN_WALK = [44, 50], R_ROAD = [50, 70], R_OUT_WALK = [70, 76], R_FORE = [76, 84], R_FRONT = 84;
const R_ROAD_MID = 60, R_LANE_IN = 47, R_LANE_OUT = 73;
const polar = (r, a) => new THREE.Vector3(r * Math.cos(a), 0, r * Math.sin(a));
const deg = d => d * Math.PI / 180;

/* ---------- renderer / scene ---------- */
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !Q.bloom, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pr));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.78;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(46, 1, 0.5, 6000);

const sky = new Sky(); sky.scale.setScalar(2800); scene.add(sky);
{
  const u = sky.material.uniforms;
  u.turbidity.value = 7; u.rayleigh.value = 1.7; u.mieCoefficient.value = 0.006; u.mieDirectionalG.value = 0.92;
  u.sunPosition.value.setFromSphericalCoords(1, deg(80), deg(238));
}
scene.fog = new THREE.Fog(0xb88f78, 300, 950);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;
scene.add(new THREE.HemisphereLight(0xb9c9ff, 0x4a5c40, 0.8));
{ const fill = new THREE.DirectionalLight(0x86a8ff, 0.7); fill.position.set(-300, 140, -240); scene.add(fill); }
const sun = new THREE.DirectionalLight(0xffc48a, 3.5);
{
  const dir = new THREE.Vector3().setFromSphericalCoords(1, deg(62), deg(238));
  sun.position.copy(dir.multiplyScalar(420));
  scene.add(sun.target);
  sun.castShadow = true; sun.shadow.mapSize.set(Q.shadowMap, Q.shadowMap);
  const c = sun.shadow.camera; c.left = -150; c.right = 150; c.top = 150; c.bottom = -150; c.near = 10; c.far = 900;
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
function roundRect(g, x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); }
function put(parent, mesh, x = 0, y = 0, z = 0) { mesh.position.set(x, y, z); parent.add(mesh); return mesh; }

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
function flat(geo, mat, y) {
  const m = noRay(new THREE.Mesh(geo, mat)); m.rotation.x = -Math.PI / 2; m.position.y = y; m.receiveShadow = true; scene.add(m); return m;
}
const disc = (r, mat, y) => flat(new THREE.CircleGeometry(r, 96), mat, y);
const ring = (r0, r1, mat, y) => flat(new THREE.RingGeometry(r0, r1, 128, 1), mat, y);
const texLoader = new THREE.TextureLoader();
function pbrTex(file, rep, srgb = false) {
  const t = texLoader.load('./tex/' + file); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}
disc(1800, std(0xffffff, { map: pbrTex('leafy_grass_diff.jpg', 170, true), normalMap: pbrTex('leafy_grass_nor_gl.jpg', 170), color: 0x9bb98a, roughness: 1 }), 0);
function wetMap() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 26; i++) { const x = Math.random() * 256, y = Math.random() * 256, r = 14 + Math.random() * 38, gr = g.createRadialGradient(x, y, 2, x, y, r); gr.addColorStop(0, 'rgba(40,40,40,.95)'); gr.addColorStop(1, 'rgba(40,40,40,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 10); return t;
}
function tileTexture(base, line) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = line; g.lineWidth = 3; g.strokeRect(1.5, 1.5, 125, 125); for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`; g.fillRect(Math.random() * 128, Math.random() * 128, 3, 3); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(70, 3); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
ring(R_ROAD[0], R_ROAD[1], std(0xffffff, { map: pbrTex('asphalt_05_diff.jpg', 30, true), normalMap: pbrTex('asphalt_05_nor_gl.jpg', 30), roughnessMap: pbrTex('asphalt_05_rough.jpg', 30), color: 0xb8b8bc, roughness: 0.78, metalness: 0.1 }), 0.03);
ring(R_IN_WALK[0], R_IN_WALK[1], std(0xffffff, { map: pbrTex('concrete_pavers_diff.jpg', 36, true), normalMap: pbrTex('concrete_pavers_nor_gl.jpg', 36), roughnessMap: pbrTex('concrete_pavers_rough.jpg', 36), color: 0xd8d4cc }), 0.05);
ring(R_OUT_WALK[0], R_OUT_WALK[1], std(0xffffff, { map: pbrTex('concrete_pavers_diff.jpg', 46, true), normalMap: pbrTex('concrete_pavers_nor_gl.jpg', 46), roughnessMap: pbrTex('concrete_pavers_rough.jpg', 46), color: 0xd8d4cc }), 0.05);
ring(R_PLAZA, R_PARK, std(0xffffff, { map: noiseTexture('#44683f', 50, 256, 30), roughness: 1 }), 0.04);
ring(R_FORE[0] - 0.01, R_FORE[1] + 0.01, std(0x3d4a3f), 0.045);
for (const r of [R_ROAD[0], R_ROAD[1], R_IN_WALK[0], R_OUT_WALK[1]]) ring(r - 0.1, r + 0.14, std(0xb3b8ae), 0.14);

const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), v3 = new THREE.Vector3(), sc3 = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);
function instances(geo, mat, list, cast = false) {
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  list.forEach((it, i) => { qt.setFromAxisAngle(Y, it.ry || 0); v3.set(it.x, it.y || 0, it.z); sc3.setScalar(it.s || 1); m4.compose(v3, qt, sc3); m.setMatrixAt(i, m4); });
  m.castShadow = cast; m.receiveShadow = true; noRay(m); scene.add(m); sc3.set(1, 1, 1); return m;
}
{ // centre dashes + crosswalks + park paths
  const dashes = []; for (let i = 0; i < 120; i++) { const a = (i / 120) * Math.PI * 2, p = polar(R_ROAD_MID, a); dashes.push({ x: p.x, y: 0.06, z: p.z, ry: -(a + Math.PI / 2) }); }
  const dg = new THREE.PlaneGeometry(3.4, 0.45); dg.rotateX(-Math.PI / 2);
  instances(dg, basic(0xe8c85a), dashes);
  const stripes = [], paths = [];
  for (let k = 0; k < 10; k++) {
    const a = deg(k * 36);
    for (let i = -3; i <= 3; i++) { const p = polar(R_ROAD_MID, a), t = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(i * 1.9); stripes.push({ x: p.x + t.x, y: 0.07, z: p.z + t.z, ry: -a }); }
    const pm = polar((R_PLAZA + R_PARK) / 2, a); paths.push({ x: pm.x, y: 0.06, z: pm.z, ry: -a });
  }
  const sg = new THREE.PlaneGeometry(18.5, 1.1); sg.rotateX(-Math.PI / 2); instances(sg, basic(0xe9e6da), stripes);
  const pg = new THREE.PlaneGeometry(R_PARK - R_PLAZA + 1, 4.2); pg.rotateX(-Math.PI / 2); instances(pg, std(0xb7ab92), paths);
}
{ // mountains
  const mat = std(0x55657a, { roughness: 1, flatShading: true });
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2 + rnd() * 0.2, r = 700 + rnd() * 120, h = 120 + rnd() * 200;
    const m = new THREE.Mesh(new THREE.ConeGeometry(80 + rnd() * 90, h, 5), mat);
    m.position.set(Math.cos(a) * r, h / 2 - 4, Math.sin(a) * r); m.rotation.y = rnd() * 3; scene.add(noRay(m));
  }
}

/* ---------- plaza: fountain + Order Tower ---------- */
{
  disc(R_PLAZA, std(0x9c9886, { roughness: 0.85 }), 0.09);
  for (const [r0, r1, col, y] of [[R_PLAZA - 1.4, R_PLAZA, 0xe8b84a, 0.1], [R_PLAZA - 4, R_PLAZA - 3.6, 0x6d6a5c, 0.1], [21.5, 21.9, 0x6d6a5c, 0.1]]) ring(r0, r1, col === 0xe8b84a ? basic(col) : std(col), y);
}
const tower = new THREE.Group(); tower.userData.tower = true;
const towerAnim = {};
{
  put(tower, new THREE.Mesh(new THREE.CylinderGeometry(14, 15, 1.4, 48), std(0x6f7a72)), 0, 0.7, 0);
  put(tower, new THREE.Mesh(new THREE.CylinderGeometry(12.5, 13, 1.1, 48), std(0x8b968c)), 0, 1.95, 0);
  for (const sx of [-1, 1]) {
    put(tower, new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 24, 14), std(0xe9e2cf, { roughness: 0.5 })), sx * 8.2, 14, 0);
    put(tower, new THREE.Mesh(new THREE.BoxGeometry(4.2, 1, 4.2), std(0xd9a93a, { metalness: 0.8, roughness: 0.35 })), sx * 8.2, 26.4, 0);
  }
  put(tower, new THREE.Mesh(new THREE.BoxGeometry(24.4, 15.4, 2.2), std(0x101a16, { roughness: 0.4, metalness: 0.4 })), 0, 35, 0);
  put(tower, new THREE.Mesh(new THREE.BoxGeometry(25.2, 16.2, 1.6), basic(0xe8b84a)), 0, 35, 0);
  const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 800;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const scrMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  put(tower, new THREE.Mesh(new THREE.PlaneGeometry(23.2, 14.5), scrMat), 0, 35, 1.12);
  const back = put(tower, new THREE.Mesh(new THREE.PlaneGeometry(23.2, 14.5), scrMat), 0, 35, -1.12); back.rotation.y = Math.PI;
  const ball = new THREE.Group(); ball.position.y = 48.5; const R = 4.4;
  ball.add(new THREE.Mesh(new THREE.SphereGeometry(R, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), std(0xd23a32, { roughness: 0.35 })));
  ball.add(new THREE.Mesh(new THREE.SphereGeometry(R, 40, 20, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), std(0xf2f2ee, { roughness: 0.35 })));
  ball.add(new THREE.Mesh(new THREE.CylinderGeometry(R * 1.006, R * 1.006, 0.6, 40, 1, true), std(0x151515, { side: THREE.DoubleSide })));
  const btn = put(ball, new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.8, 24), std(0xf2f2ee)), 0, 0, R - 0.1); btn.rotation.x = Math.PI / 2;
  put(ball, new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.2, 8, 28), std(0x151515)), 0, 0, R + 0.15);
  tower.add(ball); towerAnim.ball = ball;
  put(tower, new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 5, 10), std(0xd9a93a, { metalness: 0.8, roughness: 0.35 })), 0, 44.5, 0);
  const basin = put(tower, new THREE.Mesh(new THREE.TorusGeometry(19, 1, 12, 64), std(0xcfd2c6)), 0, 0.9, 0); basin.rotation.x = Math.PI / 2;
  const water = noRay(put(tower, new THREE.Mesh(new THREE.CircleGeometry(19, 64), new THREE.MeshStandardMaterial({ color: 0x2a86a8, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.9 })), 0, 0.55, 0));
  water.rotation.x = -Math.PI / 2;
  const N = 16, M = 12, pos = new Float32Array(N * M * 3);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xcfefff, size: 0.55, transparent: true, opacity: 0.85, depthWrite: false }));
  pts.frustumCulled = false; tower.add(pts); towerAnim.pts = pts; towerAnim.N = N; towerAnim.M = M;
  shadowify(tower, true, true); tower.traverse(o => { if (o === water || o === pts) o.castShadow = false; });
  tower.userData.screen = { cv, tex, g: cv.getContext('2d') };
}
scene.add(tower);

const imgs = {};
PRODUCTS.forEach(p => { const im = new Image(); im.onload = () => { imgs[p.id] = im; screenDirty = true; }; im.src = '../' + p.image; });
function drawScreen() {
  const { cv, tex, g } = tower.userData.screen, W = cv.width, H = cv.height;
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#0a1713'); gr.addColorStop(1, '#10261f');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(63,190,151,.28)'; g.lineWidth = 2;
  for (let x = 0; x < W; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  g.direction = 'rtl'; g.textAlign = 'right'; g.textBaseline = 'alphabetic';
  g.fillStyle = '#e8b84a'; g.font = `400 84px ${FONT_D}`; g.fillText('מגדל ההזמנות', W - 60, 112);
  g.fillStyle = '#a3b3a6'; g.font = `500 36px ${FONT_B}`;
  const items = cartItems(), n = cartCount();
  g.fillText(n ? n + ' פריטים בעגלה' : 'העגלה ריקה', W - 60, 164);
  g.strokeStyle = '#e8b84a'; g.lineWidth = 4; g.beginPath(); g.moveTo(60, 190); g.lineTo(W - 60, 190); g.stroke();
  if (!items.length) {
    g.fillStyle = '#eef2e9'; g.font = `400 70px ${FONT_D}`; g.textAlign = 'center';
    g.fillText('היכנסו לחנויות בעיר', W / 2, 370); g.fillText('והוסיפו מוצרים', W / 2, 460);
    g.fillStyle = '#3fbe97'; g.font = `500 38px ${FONT_B}`; g.fillText('הסיכום מתעדכן כאן בזמן אמת', W / 2, 550);
  } else {
    items.slice(0, 4).forEach((c, i) => {
      const y = 272 + i * 94, im = imgs[c.p.id];
      if (im) { const s = Math.min(70 / im.width, 82 / im.height); g.drawImage(im, W - 60 - 72 + (72 - im.width * s) / 2, y - 62 + (82 - im.height * s) / 2, im.width * s, im.height * s); }
      g.textAlign = 'right'; g.fillStyle = '#eef2e9'; g.font = `600 44px ${FONT_B}`;
      let name = c.p.name; while (g.measureText(name).width > 640 && name.length > 4) name = name.slice(0, -2);
      if (name !== c.p.name) name += '…';
      g.fillText(name, W - 150, y - 4);
      g.fillStyle = '#a3b3a6'; g.font = `500 32px ${FONT_B}`;
      const parts = []; if (c.q.units) parts.push(c.q.units + ' יח׳'); if (c.q.cases) parts.push(c.q.cases + ' קייס');
      g.fillText(parts.join(' + '), W - 150, y + 38);
      g.textAlign = 'left'; g.fillStyle = '#eef2e9'; g.font = `400 56px ${FONT_D}`; g.fillText(fmt(c.total) + ' ₪', 60, y + 14);
    });
    if (items.length > 4) { g.textAlign = 'right'; g.fillStyle = '#a3b3a6'; g.font = `500 30px ${FONT_B}`; g.fillText('+ עוד ' + (items.length - 4) + ' מוצרים…', W - 60, 268 + 4 * 94 - 20); }
    g.textAlign = 'right'; g.fillStyle = '#a3b3a6'; g.font = `500 36px ${FONT_B}`; g.fillText('סה״כ', W - 60, 690);
    g.textAlign = 'left'; g.fillStyle = '#3fbe97'; g.font = `400 118px ${FONT_D}`; g.fillText(fmt(cartTotal()) + ' ₪', 60, 712);
  }
  g.textAlign = 'center'; g.fillStyle = '#25c862'; roundRect(g, W / 2 - 270, H - 80, 540, 60, 30); g.fill();
  g.fillStyle = '#04150b'; g.font = `600 32px ${FONT_B}`; g.fillText(items.length ? 'לחצו כאן לסיום ושליחה בוואטסאפ' : 'לחצו כאן לעגלה', W / 2, H - 39);
  tex.needsUpdate = true;
}

/* ---------- textures ---------- */
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
        e.fillStyle = hash(key + 'w' + i + j) < 0.25 ? '#bfe3ff' : '#ffc66e'; e.fillRect(x, y, w, h);
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
function wrapLines(g, text, maxW) {
  const words = text.split(' '), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}
function makeSign(p) {
  const W = 800, H = 400, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  let img = null;
  const draw = () => {
    g.clearRect(0, 0, W, H);
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#0f1b16'); bg.addColorStop(1, '#14261e');
    g.fillStyle = bg; roundRect(g, 0, 0, W, H, 36); g.fill();
    g.strokeStyle = p.accent; g.lineWidth = 9; roundRect(g, 7, 7, W - 14, H - 14, 30); g.stroke();
    const fr = g.createRadialGradient(165, 200, 20, 165, 200, 220); fr.addColorStop(0, 'rgba(255,255,255,.16)'); fr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = '#1a2b23'; roundRect(g, 28, 28, 262, 344, 22); g.fill(); g.fillStyle = fr; g.fillRect(28, 28, 262, 344);
    if (img) { const s = Math.min(236 / img.width, 316 / img.height), w = img.width * s, h = img.height * s; g.drawImage(img, 28 + (262 - w) / 2, 28 + (344 - h) / 2, w, h); }
    g.direction = 'rtl'; g.textAlign = 'right'; g.textBaseline = 'alphabetic'; g.fillStyle = '#ffffff';
    let size = 52, lines; do { g.font = `400 ${size}px ${FONT_D}`; lines = wrapLines(g, p.name, 440); size -= 4; } while (lines.length > 2 && size > 30);
    lines.slice(0, 3).forEach((l, i) => g.fillText(l, W - 34, 84 + i * (size + 14)));
    // price bar: unit (filled) + case (outlined)
    g.textAlign = 'center';
    g.fillStyle = p.accent; roundRect(g, 546, H - 156, 220, 124, 26); g.fill();
    g.fillStyle = '#0a1410'; g.font = `600 27px ${FONT_B}`; g.fillText('יחידה', 656, H - 122);
    g.font = `400 62px ${FONT_D}`; g.fillText(fmt(p.unitPrice) + ' ₪', 656, H - 58);
    g.fillStyle = '#0f1b16'; roundRect(g, 318, H - 156, 216, 124, 26); g.fill();
    g.strokeStyle = p.accent; g.lineWidth = 5; roundRect(g, 320, H - 154, 212, 120, 24); g.stroke();
    g.fillStyle = p.accent; g.font = `600 25px ${FONT_B}`; g.fillText('קייס · ' + p.caseQty + ' יח׳', 426, H - 124);
    g.fillStyle = '#ffffff'; g.font = `400 50px ${FONT_D}`; g.fillText(fmt(p.casePrice) + ' ₪', 426, H - 64);
    tex.needsUpdate = true;
  };
  draw();
  const im = new Image(); im.onload = () => { img = im; draw(); }; im.src = '../' + p.image;
  return tex;
}
function makePriceTag(p) {
  const c = document.createElement('canvas'); c.width = 360; c.height = 170; const g = c.getContext('2d');
  g.fillStyle = '#0a1410'; roundRect(g, 4, 4, 352, 162, 40); g.fill();
  g.fillStyle = p.accent; roundRect(g, 10, 10, 340, 150, 34); g.fill();
  g.fillStyle = '#0a1410'; g.direction = 'rtl'; g.textAlign = 'center';
  g.font = `600 30px ${FONT_B}`; g.fillText('החל מ־', 180, 52);
  g.font = `400 88px ${FONT_D}`; g.fillText(fmt(p.unitPrice) + ' ₪', 180, 136);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, toneMapped: false })); sp.scale.set(7.4, 3.5, 1); noRay(sp); return sp;
}
function makeBadge() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, toneMapped: false }));
  s.scale.set(4.6, 4.6, 1); s.renderOrder = 10; s.visible = false; noRay(s);
  s.userData.draw = n => {
    const g = c.getContext('2d'); g.clearRect(0, 0, 128, 128);
    g.fillStyle = '#3fbe97'; g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#06130e'; g.lineWidth = 6; g.stroke();
    g.fillStyle = '#06130e'; g.font = `400 64px ${FONT_D}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), 64, 68); t.needsUpdate = true;
  };
  return s;
}

/* ---------- buildings ---------- */
const S = 1.5;
const TYPES = {
  tower: { w: 7.2, d: 7.2, h: 17, sw: 5.8 },
  hall:  { w: 9.4, d: 7.6, h: 9.5, sw: 7.0 },
  shop:  { w: 8.4, d: 7.2, h: 8.8, sw: 6.6 },
  kiosk: { w: 6.4, d: 5.8, h: 7.2, sw: 5.0 },
  vault: { w: 8.8, d: 8.2, h: 12, sw: 6.6 },
  dome:  { w: 8.4, d: 8.6, h: 9.5, sw: 5.2 }
};
const FOOT = T => ({ w: T.w * S, d: T.d * S, h: T.h * S });
function sideWall(set, w, h, d, y) {
  const mats = [faceMat(set, d, h), faceMat(set, d, h), std(0x555555), std(0x2b2f2c), faceMat(set, w, h), faceMat(set, w, h)];
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats); m.position.y = y; return m;
}
function buildProcedural(def, T) {
  const g = new THREE.Group();
  const { w, d, h } = T, color = def.color, accent = def.accent, fz = d / 2, set = windowSet(color, def.id);
  const roofMat = std(shade(color, -0.55)), accentMat = std(accent, { roughness: 0.5 });
  const gold = std(0xd9a93a, { metalness: 0.85, roughness: 0.32 }), trim = std(shade(color, 0.28), { roughness: 0.7 });
  const B = (bw, bh, bd, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat); m.position.set(x || 0, y || 0, z || 0); g.add(m); return m; };
  B(w + 0.6, 0.9, d + 0.6, std(0x39413c), 0, 0.45, 0);

  if (def.building === 'tower') {
    const h1 = h * 0.62, h2 = h - h1;
    g.add(sideWall(set, w, h1, d, h1 / 2)); g.add(sideWall(set, w * 0.74, h2, d * 0.74, h1 + h2 / 2));
    B(w + 0.5, 0.45, d + 0.5, trim, 0, h1, 0); B(w * 0.74 + 0.5, 0.5, d * 0.74 + 0.5, roofMat, 0, h + 0.25, 0);
    B(w * 0.3, 1.8, d * 0.3, roofMat, 0, h + 1.4, 0); B(0.14, 5, 0.14, std(0x9aa5a0), 0, h + 4, 0);
    put(g, new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8), basic(0xff4d4d)), 0, h + 6.6, 0);
    for (const sx of [-1, 1]) B(0.9, 0.12, 1.4, trim, sx * (w / 2 + 0.3), h1 * 0.6, fz - 1.4);
  } else if (def.building === 'dome') {
    const r = 4.1, tex = faceMat(set, 2 * Math.PI * r, h); tex.map.repeat.x = 8; tex.emissiveMap.repeat.x = 8;
    put(g, new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 32, 1), tex), 0, h / 2, 0);
    put(g, new THREE.Mesh(new THREE.CylinderGeometry(r + 0.35, r + 0.35, 0.6, 32), accentMat), 0, h + 0.3, 0);
    put(g, new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r + 0.1, 1.2, 32), roofMat), 0, h + 1.2, 0);
    put(g, new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.5, 20), gold), 0, h + 2.0, 0);
    const annex = sideWall(set, 5.8, 7.4, 2.8, 3.7); annex.position.z = fz - 1.4; g.add(annex);
  } else {
    g.add(sideWall(set, w, h, d, h / 2));
    B(w + 0.7, 0.5, d + 0.7, trim, 0, h + 0.25, 0); B(w, 0.14, 0.12, basic(accent), 0, h - 0.9, fz + 0.06);
    for (const sx of [-1, 1]) B(0.5, h, 0.5, trim, sx * (w / 2 - 0.1), h / 2, fz);
    if (def.building === 'hall') {
      const s = new THREE.Shape(); s.moveTo(-d / 2 - 0.5, 0); s.lineTo(d / 2 + 0.5, 0); s.lineTo(0, 3.2); s.closePath();
      const geo = new THREE.ExtrudeGeometry(s, { depth: w + 0.9, bevelEnabled: false }); geo.translate(0, 0, -(w + 0.9) / 2); geo.rotateY(Math.PI / 2);
      put(g, new THREE.Mesh(geo, std(shade(accent, -0.4))), 0, h + 0.5, 0);
      B(w * 0.72, h * 0.55, d * 0.55, std(shade(color, -0.2)), 0, h * 0.275, -(d / 2 + d * 0.22));
      put(g, new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.6, 12), std(0x7a6a58)), w * 0.25, h + 2.9, -d * 0.15);
    } else if (def.building === 'shop') {
      B(2.2, 1.2, 1.8, std(0x86918b), -w * 0.25, h + 1.1, -d * 0.15); B(1.4, 0.8, 1.4, std(0x86918b), w * 0.2, h + 0.9, -d * 0.2);
      B(w * 0.55, h * 0.6, d * 0.5, std(shade(color, -0.25)), w * 0.1, h * 0.3, -(d / 2 + d * 0.2));
    } else if (def.building === 'kiosk') {
      B(w + 0.8, 0.4, d + 0.8, accentMat, 0, h + 0.55, 0);
      put(g, new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3, 6), std(0xcfd6d1)), w * 0.3, h + 2.2, -d * 0.2);
      put(g, new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.95), basic(accent, { side: THREE.DoubleSide })), w * 0.3 + 0.78, h + 3.3, -d * 0.2);
      B(w * 0.5, 1.4, d * 0.5, std(shade(color, -0.3)), -w * 0.2, h + 1.2, -d * 0.1);
    } else if (def.building === 'vault') {
      B(w + 0.5, 0.5, d + 0.5, gold, 0, h - 1.5, 0); B(w + 0.4, 0.7, d + 0.4, roofMat, 0, h + 0.35, 0);
      put(g, new THREE.Mesh(new THREE.SphereGeometry(w * 0.28, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), gold), 0, h + 0.7, 0);
      put(g, new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.4, 8), gold), 0, h + w * 0.28 + 1.5, 0);
      B(w * 0.8, h * 0.5, d * 0.5, std(shade(color, -0.25)), 0, h * 0.25, -(d / 2 + d * 0.22));
      for (const sx of [-1, 1]) put(g, new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.46, 3.5, 14), std(0xe9e2cf, { roughness: 0.5 })), sx * (w / 2 - 0.5), 1.75, fz + 1.0);
    }
  }
  const sfW = def.building === 'dome' ? 4.2 : w * 0.8;
  B(sfW + 0.4, 3.15, 0.14, std(0x0f1613), 0, 1.6, fz + 0.02);
  put(g, new THREE.Mesh(new THREE.PlaneGeometry(sfW, 2.75), basic(0xffffff, { map: glassTexture(accent) })), 0, 1.55, fz + 0.1);
  const awn = put(g, new THREE.Mesh(new THREE.BoxGeometry(sfW + 0.8, 0.18, 2.0), new THREE.MeshStandardMaterial({ map: stripeTexture(accent, '#f4f1e6'), roughness: 0.7 })), 0, 3.25, fz + 0.95);
  awn.rotation.x = 0.42;
  B(sfW + 0.6, 0.3, 1.4, std(0x59615b), 0, 0.15, fz + 0.75);
  return g;
}

const FORE_D = R_FORE[1] - R_FORE[0], FORE_W = 22;
const forecourtMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
function makeForecourt(def, T) {
  const F = FOOT(T), g = new THREE.Group(), front = F.d / 2, pw = FORE_W, pd = FORE_D;
  const parts = [], dm = new THREE.Object3D();
  const piece = (geo, x, y, z, hex, rx = 0, ry = 0) => {
    const gg = geo.index ? geo.toNonIndexed() : geo.clone(); dm.position.set(x, y, z); dm.rotation.set(rx, ry, 0); dm.updateMatrix(); gg.applyMatrix4(dm.matrix);
    const c = new THREE.Color(hex), n = gg.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    gg.setAttribute('color', new THREE.BufferAttribute(col, 3)); parts.push(gg);
  };
  const paveCol = new THREE.Color(def.accent).multiplyScalar(0.28).lerp(new THREE.Color(0x5a625b), 0.55);
  piece(new THREE.PlaneGeometry(pw, pd), 0, 0.07, front + pd / 2, paveCol, -Math.PI / 2);
  for (const z of [front + 0.5, front + pd - 0.5]) piece(new THREE.PlaneGeometry(pw - 1.4, 0.2), 0, 0.08, z, def.accent, -Math.PI / 2);
  const dx = (hash(def.id) < 0.5 ? -1 : 1) * Math.min(pw / 2 - 2.8, F.w / 2 + 1.4);
  const px = (dx > 0 ? -1 : 1) * (pw / 2 - 1.6);
  const boxG = new THREE.BoxGeometry(2.4, 0.9, 1.1), ballG = new THREE.IcosahedronGeometry(0.5, 0), seatG = new THREE.BoxGeometry(2.6, 0.2, 0.75), backG = new THREE.BoxGeometry(2.6, 0.65, 0.13), legG = new THREE.BoxGeometry(0.13, 0.6, 0.65);
  for (const sx of [px, px * 0.2]) {
    piece(boxG, sx, 0.45, front + pd - 1.7, 0x6b5646);
    for (let i = 0; i < 4; i++) piece(ballG, sx - 0.85 + i * 0.58, 1.2, front + pd - 1.7, pick([0xe35d7a, 0xf2c14e, 0xb36cd6, 0x58c27d]));
  }
  const bx = -dx * 0.8, bz = front + 1.4;
  piece(seatG, bx, 0.58, bz, 0x8a5f3a); piece(backG, bx, 1.0, bz - 0.34, 0x8a5f3a);
  for (const sx of [-1, 1]) piece(legG, bx + sx * 1.15, 0.29, bz, 0x2a2e2b);
  const merged = new THREE.Mesh(mergeGeometries(parts, false), forecourtMat); merged.receiveShadow = true; noRay(merged); g.add(merged);

  const disp = new THREE.Group(); disp.position.set(dx, 0, front + pd * 0.55);
  put(disp, new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.1, 0.8, 24), std(0x2a312d, { roughness: 0.5 })), 0, 0.4, 0);
  const rg = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.08, 8, 40), basic(def.accent)); rg.rotation.x = Math.PI / 2; rg.position.y = 0.84; disp.add(rg);
  const panelMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.35 }), edge = std(0x1b2420);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(3.4, 4.3, 0.3), [edge, edge, edge, edge, panelMat, panelMat]); panel.position.y = 0.84 + 2.6; disp.add(panel);
  const im = new Image(); im.onload = () => {
    const t = new THREE.Texture(im); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; t.anisotropy = 4; panelMat.map = t; panelMat.emissiveMap = t; panelMat.needsUpdate = true;
    panel.scale.x = Math.min(1.5, (4.3 * (im.width / im.height)) / 3.4);
  }; im.src = '../' + def.image;
  put(disp, makePriceTag(def), 0, 0.84 + 4.3 + 2.4, 0);
  g.add(disp); g.userData.disp = disp;
  return g;
}
const gltfLoader = new GLTFLoader();
{ const d = new DRACOLoader(); d.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/'); gltfLoader.setDRACOLoader(d); }
const bTex = { roofN: pbrTex('clay_roof_tiles_nor_gl.jpg', 1), roofR: pbrTex('clay_roof_tiles_rough.jpg', 1), wallN: pbrTex('white_stucco_nor_gl.jpg', 1), wallR: pbrTex('white_stucco_rough.jpg', 1) };
/* merge a loaded building into 5 draw calls: opaque (vertex colours), roof, accent, ball, glass */
const uberOpaque = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0.02, normalMap: bTex.wallN, roughnessMap: bTex.wallR, normalScale: new THREE.Vector2(0.7, 0.7) });
function ensureAttrs(g) {
  g = g.index ? g : g;
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  if (g.attributes.color.itemSize === 4) { const a = g.attributes.color, o = new Float32Array(a.count * 3); for (let i = 0; i < a.count; i++) { o[i * 3] = a.getX(i); o[i * 3 + 1] = a.getY(i); o[i * 3 + 2] = a.getZ(i); } g.setAttribute('color', new THREE.BufferAttribute(o, 3)); }
  return g;
}
function consolidate(root, def) {
  root.updateMatrixWorld(true);
  const cls = { opaque: [], roof: [], accent: [], ball: [], glass: [] };
  root.traverse(o => {
    if (!o.isMesh) return; const nm = o.material.name, g = ensureAttrs(o.geometry.clone()); g.applyMatrix4(o.matrixWorld);
    const k = nm === 'Roof' ? 'roof' : nm === 'Accent' ? 'accent' : nm.startsWith('Ball') ? 'ball' : (nm.startsWith('Glass') || nm === 'Lantern' || nm === 'Beacon') ? 'glass' : 'opaque';
    cls[k].push(g);
  });
  const out = new THREE.Group(), add = (arr, mat, cast, recv) => { if (!arr.length) return; const m = new THREE.Mesh(mergeGeometries(arr, false), mat); m.castShadow = cast; m.receiveShadow = recv; out.add(m); };
  const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: def.color, normalMap: bTex.roofN, roughnessMap: bTex.roofR, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.9 });
  const accMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: def.accent, roughness: 0.55 });
  const ballMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, envMapIntensity: 0.6 });
  const glassMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.7, 1.7, 1.7), toneMapped: false });
  add(cls.opaque, uberOpaque, true, true); add(cls.roof, roofMat, true, true); add(cls.accent, accMat, true, true); add(cls.ball, ballMat, true, false); add(cls.glass, glassMat, false, false);
  return out;
}
function makeBuilding(def) {
  const T = TYPES[def.building], F = FOOT(T), root = new THREE.Group();
  root.userData = { pid: def.id, T, F };
  const sw = T.sw * S, sh = sw / 2, fz = F.d / 2;
  const sign = new THREE.Group(); sign.position.set(0, 3.95 * S + sh / 2 + 0.2, fz + 0.2);
  sign.add(new THREE.Mesh(new THREE.PlaneGeometry(sw + 0.5, sh + 0.5), basic(new THREE.Color(def.accent).multiplyScalar(1.1))));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshBasicMaterial({ map: makeSign(def), transparent: true, toneMapped: false })); face.position.z = 0.04; sign.add(face);
  root.add(sign); root.userData.sign = sign;
  const fc = makeForecourt(def, T); root.add(fc); root.userData.fc = fc;
  const badge = makeBadge(); badge.position.set(0, F.h + 6, 0); root.add(badge); root.userData.badge = badge;
  root.userData.hover = 0; root.userData.hoverT = 0;
  const fallback = () => { const pr = buildProcedural(def, T); pr.scale.setScalar(S); shadowify(pr, true, true); root.add(pr); };
  if (manifest[def.building]) {
    gltfLoader.loadAsync('./models/' + manifest[def.building] + MV).then(gl => {
      const a = gl.scene.getObjectByName('SignAnchor'); if (a) sign.position.copy(a.position);
      root.add(consolidate(gl.scene, def));
    }).catch(err => { console.warn('GLB load failed for', def.building, err); fallback(); });
  } else fallback();
  return root;
}

/* ring layout: 20 slots, 18° apart. Preorder = west arc (8), in-stock = east arc (12), gates between */
const buildings = {};
const SLOT = 18, ORDER = {
  preorder: { centre: 180, ids: ['box', 'etb', 'bundle', 'blister', 'bnb', 'sleeved', 'checklane', 'checklanep'] },
  instock:  { centre: 0,   ids: ['me03etb', 'me04box', 'me05box', 'zygarde', 'greninja', 'armarouge', 'fp1', 'fp2', 'fp3', 'moonlit', 'lumiose', 'pokeball'] }
};
const districtArc = {};
for (const [cat, o] of Object.entries(ORDER)) {
  const n = o.ids.length; districtArc[cat] = o.centre;
  o.ids.forEach((id, i) => {
    const def = P[id]; if (!def) return;
    const a = deg(o.centre + (i - (n - 1) / 2) * SLOT), b = makeBuilding(def), F = b.userData.F;
    b.position.copy(polar(R_FRONT + F.d / 2, a)); b.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a));
    b.userData.angle = a; b.userData.dirIn = new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a));
    scene.add(b); buildings[id] = b;
  });
}
const buildingRoots = Object.values(buildings);

/* gates */
function makeGateTexture(title, sub) {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 256; const g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 1024, 0); gr.addColorStop(0, '#0f1b16'); gr.addColorStop(1, '#173026'); g.fillStyle = gr; roundRect(g, 0, 0, 1024, 256, 40); g.fill();
  g.strokeStyle = '#e8b84a'; g.lineWidth = 10; roundRect(g, 8, 8, 1008, 240, 34); g.stroke();
  g.direction = 'rtl'; g.textAlign = 'center'; g.fillStyle = '#ffffff'; g.font = `400 118px ${FONT_D}`; g.fillText(title, 512, 140);
  g.fillStyle = '#e8b84a'; g.font = `500 44px ${FONT_B}`; g.fillText(sub, 512, 212);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function makeGate(angleDeg, ahead) { // ahead[0]: district when travelling +angle, ahead[1]: when travelling -angle
  const a = deg(angleDeg), g = new THREE.Group(); g.position.copy(polar(R_ROAD_MID, a)); g.rotation.y = -a;
  const pil = std(0xe9e2cf, { roughness: 0.5 }), goldM = std(0xd9a93a, { metalness: 0.8, roughness: 0.35 });
  for (const sx of [-1, 1]) {
    put(g, new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, 17, 14), pil), sx * 12.8, 8.5, 0);
    put(g, new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 3.2), goldM), sx * 12.8, 17.2, 0);
  }
  put(g, new THREE.Mesh(new THREE.BoxGeometry(30, 1.3, 2.4), std(0x1a2520, { roughness: 0.4 })), 0, 17.7, 0);
  put(g, new THREE.Mesh(new THREE.BoxGeometry(30.4, 0.3, 2.8), basic(0xe8b84a)), 0, 18.5, 0);
  put(g, new THREE.Mesh(new THREE.BoxGeometry(24.6, 6.6, 0.5), std(0x0d1612)), 0, 22, 0);
  for (const [dir, key] of [[1, ahead[1]], [-1, ahead[0]]]) {
    const d = data.districts[key], pl = new THREE.Mesh(new THREE.PlaneGeometry(24, 6), new THREE.MeshBasicMaterial({ map: makeGateTexture(d.title, d.subtitle), toneMapped: false, transparent: true }));
    pl.position.set(0, 22, dir * 0.3); if (dir < 0) pl.rotation.y = Math.PI; g.add(pl);
  }
  g.traverse(o => { if (o.isMesh && !o.material.isMeshBasicMaterial) { o.castShadow = true; } });
  scene.add(g); return g;
}
makeGate(108, ['preorder', 'instock']);
makeGate(252, ['instock', 'preorder']);

/* ---------- living surroundings ---------- */
const animators = [];
function neonTexture(text, sub, col) {
  const c = document.createElement('canvas'); c.width = 768; c.height = 360; const g = c.getContext('2d');
  g.fillStyle = '#070b12'; roundRect(g, 0, 0, 768, 360, 30); g.fill();
  g.strokeStyle = col; g.lineWidth = 12; g.shadowColor = col; g.shadowBlur = 26; roundRect(g, 14, 14, 740, 332, 24); g.stroke();
  g.direction = 'rtl'; g.textAlign = 'center'; g.fillStyle = '#fff'; g.shadowBlur = 34; g.font = `400 112px ${FONT_D}`; g.fillText(text, 384, 190);
  g.shadowBlur = 16; g.fillStyle = col; g.font = `600 46px ${FONT_B}`; g.fillText(sub, 384, 270);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const skySpots = [];
{
  const SK = [
    { name: 'stepped', h: 59, roof: 49, r: 20, bb: false }, { name: 'slab', h: 27, roof: 24.8, r: 24, bb: true },
    { name: 'apartment', h: 32, roof: 26, r: 18, bb: false }, { name: 'round', h: 49, roof: 36, r: 18, bb: false }, { name: 'mall', h: 15, roof: 12.8, r: 26, bb: true }
  ];
  const tints = [0xe6d9c8, 0xc9d3e0, 0xe8c9b8, 0xc4d8cc, 0xd6c8e0], taken = [{ x: MK.cx, z: MK.cz, r: 56 }], glassMats = [], beaconMats = [];
  const per = Math.ceil(Q.sky / SK.length);
  for (const t of SK) {
    const list = []; let guard = 0;
    while (list.length < per && guard++ < 1400) {
      const a = rnd() * Math.PI * 2, r = 170 + rnd() * 150, p = polar(r, a);
      if (taken.some(q => Math.hypot(q.x - p.x, q.z - p.z) < q.r + t.r)) continue;
      taken.push({ x: p.x, z: p.z, r: t.r }); list.push({ p, ry: Math.atan2(-p.x, -p.z) + (rnd() - 0.5) * 0.4 });
      skySpots.push({ x: p.x, z: p.z, h: t.roof, r, bb: t.bb });
    }
    const gl = await gltfLoader.loadAsync(`./models/sk_${t.name}.glb${MV}`).catch(err => { console.warn('skyline model missing', t.name, err); return null; });
    if (!gl) continue;
    gl.scene.updateMatrixWorld(true);
    gl.scene.traverse(o => {
      if (!o.isMesh) return; const mt = o.material, im = new THREE.InstancedMesh(o.geometry, mt, list.length);
      list.forEach((it, i) => {
        qt.setFromAxisAngle(Y, it.ry); v3.set(it.p.x, 0, it.p.z); sc3.set(1, 1, 1); m4.compose(v3, qt, sc3); m4.multiply(o.matrixWorld); im.setMatrixAt(i, m4);
        if (mt.name === 'Wall') im.setColorAt(i, new THREE.Color(pick(tints)));
      });
      if (mt.name.startsWith('Glass') && mt.emissiveIntensity > 0 && !glassMats.includes(mt)) glassMats.push(mt);
      if (mt.name === 'Beacon' && !beaconMats.includes(mt)) beaconMats.push(mt);
      im.castShadow = HI && mt.name === 'Wall'; im.receiveShadow = true; noRay(im); scene.add(im);
    });
  }
  animators.push(now => {
    glassMats.forEach((m, i) => { m.emissiveIntensity = 0.85 + 0.35 * Math.sin(now * 0.0011 + i * 1.9); });
    beaconMats.forEach((m, i) => { m.emissiveIntensity = (Math.floor(now / 900 + i) % 2) ? 3.2 : 0.15; });
  });
  // rooftop neon billboards facing the centre
  const SIGNS = [['פוקימון TCG', 'מלאי · בוסטרים · קלפים', '#37e8ff'], ['הזמנות מוקדמות', 'דלתא ריין עכשיו', '#ff4fd8'], ['מלאי חדש!', 'ETB · בוקסים', '#ffd23a'], ['דלתא ריין', 'הגעה 6.11', '#7dff6a'], ['אספנות', 'קלפי פוקימון', '#ff8a3a']];
  const picks = skySpots.filter(q => q.bb && q.r < 280).sort(() => rnd() - 0.5).slice(0, HI ? 12 : 6), neon = [];
  picks.forEach((sp, i) => {
    const [t1, t2, col] = SIGNS[i % SIGNS.length], g = new THREE.Group(); g.position.set(sp.x, sp.h, sp.z);
    g.rotation.y = Math.atan2(-sp.x, -sp.z);
    const mt = new THREE.MeshBasicMaterial({ map: neonTexture(t1, t2, col), toneMapped: false });
    put(g, new THREE.Mesh(new THREE.PlaneGeometry(15, 7), mt), 0, 8.6, 0);
    for (const sx of [-1, 1]) put(g, new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 5.2, 6), std(0x30363a)), sx * 6, 2.6, -0.1);
    noRay(g); g.traverse(noRay); scene.add(g); neon.push(mt);
  });
  animators.push(now => neon.forEach((mt, i) => { const f = 0.8 + 0.2 * Math.sin(now * 0.004 + i * 1.7) + (Math.sin(now * 0.021 + i) > 0.97 ? -0.4 : 0); mt.color.setScalar(clamp(f, 0.3, 1.1)); }));
}

/* outer ring road with distant traffic */
{
  ring(131, 139, std(0xffffff, { map: noiseTexture('#2a2d33', 40, 256, 18), roughness: 0.9 }), 0.03);
  const N = HI ? 30 : 14, cars = [];
  for (let i = 0; i < N; i++) cars.push({ a: rnd() * Math.PI * 2, sp: (0.05 + rnd() * 0.05) * (i % 2 ? 1 : -1), r: i % 2 ? 133.5 : 136.5 });
  const body = new THREE.InstancedMesh(new THREE.BoxGeometry(3.6, 1.3, 1.7), std(0xffffff, { roughness: 0.4, metalness: 0.3 }), N);
  const lamp = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.4, 1.3), basic(0xfff1c8, { toneMapped: false }), N);
  const tail = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.4, 1.3), basic(0xff3030, { toneMapped: false }), N);
  cars.forEach((c, i) => body.setColorAt(i, new THREE.Color(pick([0xd94a4a, 0x4a7fd9, 0xe8b84a, 0xf2f2ee, 0x3fbe97, 0x9a5ad9, 0x2f3a36]))));
  for (const m of [body, lamp, tail]) { noRay(m); scene.add(m); } body.castShadow = HI;
  const dummy = new THREE.Object3D();
  animators.push((now, dt) => cars.forEach((c, i) => {
    c.a += c.sp * dt; const p = polar(c.r, c.a), hd = -(c.a + (c.sp > 0 ? Math.PI / 2 : -Math.PI / 2));
    dummy.position.set(p.x, 0.9, p.z); dummy.rotation.set(0, hd, 0); dummy.updateMatrix(); body.setMatrixAt(i, dummy.matrix);
    dummy.position.set(p.x + Math.cos(hd) * 1.8, 0.95, p.z - Math.sin(hd) * 1.8); dummy.updateMatrix(); lamp.setMatrixAt(i, dummy.matrix);
    dummy.position.set(p.x - Math.cos(hd) * 1.8, 0.95, p.z + Math.sin(hd) * 1.8); dummy.updateMatrix(); tail.setMatrixAt(i, dummy.matrix);
    if (i === cars.length - 1) { body.instanceMatrix.needsUpdate = lamp.instanceMatrix.needsUpdate = tail.instanceMatrix.needsUpdate = true; }
  }));
}

/* blimp with a banner, circling the city */
{
  const blimp = new THREE.Group(), R = 1;
  const bc = document.createElement('canvas'); bc.width = 256; bc.height = 128; const bg = bc.getContext('2d');
  bg.fillStyle = '#e53b32'; bg.fillRect(0, 0, 256, 56); bg.fillStyle = '#151515'; bg.fillRect(0, 56, 256, 16); bg.fillStyle = '#f6f6f2'; bg.fillRect(0, 72, 256, 56);
  const bt = new THREE.CanvasTexture(bc); bt.colorSpace = THREE.SRGBColorSpace; bt.wrapS = THREE.RepeatWrapping; bt.repeat.set(2, 1);
  const hull = new THREE.Mesh(new THREE.SphereGeometry(R, 40, 20), std(0xffffff, { map: bt, roughness: 0.5 })); hull.scale.set(15, 5.6, 5.6); blimp.add(hull);
  put(blimp, new THREE.Mesh(new THREE.BoxGeometry(5, 1.6, 2.2), std(0x30363a)), 0, -6.6, 0);
  for (const [rz, ry] of [[0, 0], [Math.PI / 2, 0], [Math.PI / 4, 0], [-Math.PI / 4, 0]]) { const f = put(blimp, new THREE.Mesh(new THREE.BoxGeometry(5, 0.3, 4.4), std(0xd23a32)), -14, 0, 0); f.rotation.x = rz; }
  const ban = document.createElement('canvas'); ban.width = 1024; ban.height = 200; const bgx = ban.getContext('2d');
  bgx.fillStyle = '#0f1b16'; roundRect(bgx, 0, 0, 1024, 200, 30); bgx.fill(); bgx.strokeStyle = '#e8b84a'; bgx.lineWidth = 10; roundRect(bgx, 8, 8, 1008, 184, 24); bgx.stroke();
  bgx.direction = 'rtl'; bgx.textAlign = 'center'; bgx.fillStyle = '#fff'; bgx.font = `400 92px ${FONT_D}`; bgx.fillText('הזמנות מוקדמות פתוחות!', 512, 128);
  const bnt = new THREE.CanvasTexture(ban); bnt.colorSpace = THREE.SRGBColorSpace; bnt.anisotropy = 4;
  const bm = new THREE.MeshBasicMaterial({ map: bnt, side: THREE.DoubleSide, toneMapped: false });
  put(blimp, new THREE.Mesh(new THREE.PlaneGeometry(32, 6.2), bm), -34, -1, 0);
  noRay(blimp); blimp.traverse(noRay); scene.add(blimp);
  animators.push(now => { const th = now * 0.00005, r = 152, p = polar(r, th); blimp.position.set(p.x, 88 + Math.sin(now * 0.0004) * 3, p.z); blimp.rotation.y = -(th + Math.PI / 2); });
}

/* birds */
{
  const N = HI ? 34 : 14, wingGeo = new THREE.BoxGeometry(0.9, 0.05, 0.38);
  const L = new THREE.InstancedMesh(wingGeo, basic(0x20252b), N), Rr = new THREE.InstancedMesh(wingGeo, basic(0x20252b), N);
  const birds = Array.from({ length: N }, () => ({ r: 25 + rnd() * 95, h: 22 + rnd() * 50, sp: (0.12 + rnd() * 0.25) * (rnd() < 0.5 ? 1 : -1), a: rnd() * 6.28, f: 6 + rnd() * 4, ph: rnd() * 6 }));
  noRay(L); noRay(Rr); scene.add(L, Rr);
  const dummy = new THREE.Object3D();
  animators.push((now, dt) => {
    birds.forEach((b, i) => {
      b.a += b.sp * dt; const p = polar(b.r, b.a), hd = -(b.a + (b.sp > 0 ? Math.PI / 2 : -Math.PI / 2)), fl = Math.sin(now * 0.001 * b.f + b.ph) * 0.7;
      for (const [mesh, side] of [[L, -1], [Rr, 1]]) {
        dummy.position.set(p.x, b.h + Math.sin(now * 0.0007 + b.ph) * 2, p.z); dummy.rotation.set(0, hd, side * fl, 'YXZ'); dummy.updateMatrix();
        dummy.matrix.multiply(new THREE.Matrix4().makeTranslation(side * 0.45, 0, 0)); mesh.setMatrixAt(i, dummy.matrix);
      }
    });
    L.instanceMatrix.needsUpdate = Rr.instanceMatrix.needsUpdate = true;
  });
}

/* ---------- market quarter: boulevard, square, gates, bunting, monument ---------- */
const mkAnim = {};
{
  const T = (f, srgb) => { const t = pbrTex(f, 1, srgb); t.repeat.set(2, 15); return t; };
  const stone = (rep, tint) => std(0xffffff, { map: pbrTex('concrete_pavers_diff.jpg', rep, true), normalMap: pbrTex('concrete_pavers_nor_gl.jpg', rep), roughnessMap: pbrTex('concrete_pavers_rough.jpg', rep), color: tint, roughness: 0.9 });
  const at = (m, x, z) => { m.position.x = x; m.position.z = z; return m; };
  at(flat(new THREE.CircleGeometry(MK.r, 96), stone(14, 0xe6dcc2), 0.05), MK.cx, MK.cz);
  at(ring(MK.r - 1.8, MK.r, basic(0xe8b84a), 0.08), MK.cx, MK.cz);
  at(ring(18.8, 19.3, basic(0xe8b84a), 0.08), MK.cx, MK.cz); at(ring(6.6, 7.1, std(0x6d6a5c), 0.08), MK.cx, MK.cz);
  { const g = new THREE.PlaneGeometry(2 * CORR_HW, CORR_Z[1] - CORR_Z[0] + 2); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, std(0xffffff, { map: T('concrete_pavers_diff.jpg', true), normalMap: T('concrete_pavers_nor_gl.jpg'), color: 0xdcd2b8, roughness: 0.9 })); m.position.set(0, 0.055, (CORR_Z[0] + CORR_Z[1]) / 2 + 1); m.receiveShadow = true; noRay(m); scene.add(m);
    // gold kerb lines
    for (const sx of [-1, 1]) { const k = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.14, CORR_Z[1] - CORR_Z[0]), basic(0xe8b84a)); k.position.set(sx * (CORR_HW + 0.2), 0.07, (CORR_Z[0] + CORR_Z[1]) / 2); noRay(k); scene.add(k); }
    // zebra over the outer ring road
    const zs = []; for (let i = -3; i <= 3; i++) zs.push({ x: i * 1.3, y: 0.075, z: 135, ry: 0 });
    const zg = new THREE.PlaneGeometry(0.8, 8.4); zg.rotateX(-Math.PI / 2); instances(zg, basic(0xf0ece0), zs);
  }
  const archTex = (title, sub) => makeGateTexture(title, sub);
  function arch(z, title, sub, scale = 1) {
    const g = new THREE.Group(); g.position.set(0, 0, z); g.scale.setScalar(scale);
    const pil = std(0xe9e2cf, { roughness: 0.5 }), gold = std(0xd9a93a, { metalness: 0.8, roughness: 0.35 }), dark = std(0x1a2520, { roughness: 0.4 });
    for (const sx of [-1, 1]) { put(g, new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 12, 14), pil), sx * 8.2, 6, 0); put(g, new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.8, 2.6), gold), sx * 8.2, 12.3, 0); }
    put(g, new THREE.Mesh(new THREE.BoxGeometry(18.6, 1.1, 1.8), dark), 0, 12.9, 0); put(g, new THREE.Mesh(new THREE.BoxGeometry(19, 0.28, 2.1), basic(0xe8b84a)), 0, 13.6, 0);
    put(g, new THREE.Mesh(new THREE.BoxGeometry(15.4, 4.2, 0.5), dark), 0, 16.0, 0);
    const mt = new THREE.MeshBasicMaterial({ map: archTex(title, sub), toneMapped: false, transparent: true }); g.userData.neon = mt;
    for (const d of [1, -1]) { const pl = new THREE.Mesh(new THREE.PlaneGeometry(15, 3.75), mt); pl.position.set(0, 16.0, d * 0.28); if (d < 0) pl.rotation.y = Math.PI; g.add(pl); }
    g.traverse(o => { if (o.isMesh && !o.material.isMeshBasicMaterial) o.castShadow = true; }); scene.add(g); return g;
  }
  const gate = arch(104, 'רובע השוק', 'חנויות הקהילה · לייבים · מציאות', 1.9); mkAnim.gateMat = gate.userData.neon; arch(MK.cz - MK.r + 2.5, 'ברוכים הבאים', 'כל דוכן — חנות של מישהו מהעיר', 0.82);
  // boulevard lamps
  { const L = []; for (const z of [110, 122, 143]) for (const sx of [-1, 1]) L.push({ x: sx * (CORR_HW + 1.1), z });
    const pg = new THREE.CylinderGeometry(0.1, 0.15, 6, 8); pg.translate(0, 3, 0);
    const poles = new THREE.InstancedMesh(pg, std(0x2b3430, { metalness: 0.6, roughness: 0.4 }), L.length), bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.46, 10, 8), basic(0xffe6b0), L.length);
    L.forEach((l, i) => { m4.makeTranslation(l.x, 0, l.z); poles.setMatrixAt(i, m4); m4.makeTranslation(l.x, 6.15, l.z); bulbs.setMatrixAt(i, m4); }); poles.castShadow = true; for (const m of [poles, bulbs]) { noRay(m); scene.add(m); } }
  // bunting around the square
  { const N = 30, poles = [], top = i => { const a = (i / N) * Math.PI * 2, r = MK.r - 2.4; return new THREE.Vector3(MK.cx + r * Math.cos(a), 7.4, MK.cz + r * Math.sin(a)); };
    const gap = a => { let d = Math.abs(((a * 180 / Math.PI) % 360 + 360) % 360 - 270); return d < 18; };
    const keep = []; for (let i = 0; i < N; i++) keep.push(!gap((i / N) * Math.PI * 2));
    const pg = new THREE.CylinderGeometry(0.12, 0.17, 7.4, 8); pg.translate(0, 3.7, 0);
    const pm = new THREE.InstancedMesh(pg, std(0x6d5a45, { roughness: 0.8 }), N), bm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.4, 10, 8), basic(0xffe6b0), N);
    for (let i = 0; i < N; i++) { const t = top(i); if (!keep[i]) { m4.makeScale(0, 0, 0); pm.setMatrixAt(i, m4); bm.setMatrixAt(i, m4); continue; } m4.makeTranslation(t.x, 0, t.z); pm.setMatrixAt(i, m4); m4.makeTranslation(t.x, 7.6, t.z); bm.setMatrixAt(i, m4); }
    pm.castShadow = true; for (const m of [pm, bm]) { noRay(m); scene.add(m); }
    const tri = new THREE.BufferGeometry(); tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.34, 0, 0, 0.34, 0, 0, 0, -0.85, 0]), 3)); tri.computeVertexNormals();
    const per = 7, segs = []; for (let i = 0; i < N; i++) if (keep[i] && keep[(i + 1) % N]) segs.push(i);
    const flags = new THREE.InstancedMesh(tri, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), segs.length * per), lines = [];
    const cols = [0xe35d7a, 0xf2c14e, 0x58c27d, 0x4fa3e8, 0xb36cd6, 0xff8a3a], sag = u => Math.sin(u * Math.PI) * 1.5; let fi = 0;
    for (const i of segs) {
      const A = top(i), B = top((i + 1) % N), ry = Math.atan2(B.x - A.x, B.z - A.z) + Math.PI / 2;
      for (let k = 0; k < 14; k++) { const u0 = k / 14, u1 = (k + 1) / 14; lines.push(A.x + (B.x - A.x) * u0, 7.2 - sag(u0), A.z + (B.z - A.z) * u0, A.x + (B.x - A.x) * u1, 7.2 - sag(u1), A.z + (B.z - A.z) * u1); }
      for (let f = 0; f < per; f++) { const u = (f + 0.5) / per; qt.setFromAxisAngle(Y, ry); v3.set(A.x + (B.x - A.x) * u, 7.2 - sag(u), A.z + (B.z - A.z) * u); sc3.set(1, 1, 1); m4.compose(v3, qt, sc3); flags.setMatrixAt(fi, m4); flags.setColorAt(fi, new THREE.Color(cols[(fi + i) % cols.length])); fi++; }
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lines), 3));
    const ls = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x3a3028 })); noRay(ls); noRay(flags); scene.add(ls, flags);
    mkAnim.flags = flags; }
  // trees around the square
  { const sp = []; for (let i = 0; i < 34; i++) { const a = (i / 34) * Math.PI * 2, d = Math.abs(((a * 180 / Math.PI) % 360 + 360) % 360 - 270); if (d < 22) continue; const r = MK.r + 5 + (i % 3) * 4; sp.push({ x: MK.cx + r * Math.cos(a), z: MK.cz + r * Math.sin(a), s: 1 + (i % 4) * 0.18 }); }
    const tg = new THREE.CylinderGeometry(0.26, 0.38, 1.8, 6); tg.translate(0, 0.9, 0); const fg = new THREE.IcosahedronGeometry(2.1, 1); fg.translate(0, 3.9, 0);
    const tr = new THREE.InstancedMesh(tg, std(0x5a3f2a), sp.length), fo = new THREE.InstancedMesh(fg, std(0xffffff, { flatShading: true }), sp.length);
    sp.forEach((t, i) => { qt.setFromAxisAngle(Y, i * 1.7); v3.set(t.x, 0, t.z); sc3.setScalar(t.s); m4.compose(v3, qt, sc3); tr.setMatrixAt(i, m4); fo.setMatrixAt(i, m4); fo.setColorAt(i, new THREE.Color([0x3f8f48, 0x5da24a, 0xc79a3a, 0x8aa83f][i % 4])); });
    sc3.set(1, 1, 1); for (const m of [tr, fo]) { m.castShadow = true; m.receiveShadow = true; noRay(m); scene.add(m); } }
  // central monument: Pokeball on a plinth
  { const g = new THREE.Group(); g.position.set(MK.cx, 0, MK.cz);
    put(g, new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5.2, 1.2, 32), std(0xcfc6ad, { roughness: 0.7 })), 0, 0.6, 0); put(g, new THREE.Mesh(new THREE.CylinderGeometry(4.0, 4.0, 0.3, 32), basic(0xe8b84a)), 0, 1.3, 0);
    const ball = new THREE.Group(); ball.position.y = 5.0;
    put(ball, new THREE.Mesh(new THREE.SphereGeometry(3.3, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), std(0xd23a32, { roughness: 0.25, metalness: 0.1 })));
    put(ball, new THREE.Mesh(new THREE.SphereGeometry(3.3, 40, 20, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), std(0xf4f1ea, { roughness: 0.3 })));
    put(ball, new THREE.Mesh(new THREE.CylinderGeometry(3.34, 3.34, 0.5, 40), std(0x1b1b1f, { roughness: 0.5 })));
    const bt = put(ball, new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.4, 24), std(0xffffff, { roughness: 0.2 })), 0, 0, 3.3); bt.rotation.x = Math.PI / 2;
    g.add(ball); g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); noRay(g); g.traverse(noRay); scene.add(g); mkAnim.ball = ball; }
  // --- make the entrance impossible to miss: golden arrows from the plaza, light beam, floating sign, plaza signpost ---
  { const sh = new THREE.Shape(); sh.moveTo(-1.9, -1); sh.lineTo(0, 0.7); sh.lineTo(1.9, -1); sh.lineTo(1.9, -1.9); sh.lineTo(0, -0.2); sh.lineTo(-1.9, -1.9); sh.closePath();
    const cg = new THREE.ShapeGeometry(sh); cg.rotateX(Math.PI / 2);
    const zs = []; for (let z = 32; z <= 146; z += 6) { if (z > 100 && z < 106) continue; zs.push(z); }
    const ch = new THREE.InstancedMesh(cg, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), zs.length);
    zs.forEach((z, i) => { m4.makeTranslation(0, 0.13, z); ch.setMatrixAt(i, m4); ch.setColorAt(i, new THREE.Color(0xe8b84a)); }); noRay(ch); scene.add(ch);
    const tint = new THREE.Color(), gold = new THREE.Color(0xffc83a); mkAnim.chev = (now) => { for (let i = 0; i < zs.length; i++) { const k = 0.25 + 0.75 * Math.max(0, Math.sin(now * 0.0045 - i * 0.6)); tint.copy(gold).multiplyScalar(k * 1.5); ch.setColorAt(i, tint); } ch.instanceColor.needsUpdate = true; }; }
  { const cv = document.createElement('canvas'); cv.width = 16; cv.height = 256; const g = cv.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(255,200,58,0)'); gr.addColorStop(1, 'rgba(255,200,58,.9)'); g.fillStyle = gr; g.fillRect(0, 0, 16, 256);
    const bm = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, opacity: 0.55, fog: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.4, 96, 20, 1, true), bm); beam.position.set(MK.cx, 62, MK.cz); noRay(beam); scene.add(beam); mkAnim.beam = bm;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: neonTexture('🏪 רובע השוק', 'חנויות הקהילה · לייבים', '#ffd23a'), toneMapped: false, fog: false })); sp.scale.set(34, 15.9, 1); sp.position.set(MK.cx, 66, MK.cz); noRay(sp); scene.add(sp); mkAnim.sp = sp; }
  { const g = new THREE.Group(); g.position.set(0, 0, 31);
    put(g, new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 5.4, 8), std(0x2b3430, { metalness: 0.6 })), -3.2, 2.7, 0); put(g, new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 5.4, 8), std(0x2b3430, { metalness: 0.6 })), 3.2, 2.7, 0);
    const mt = new THREE.MeshBasicMaterial({ map: makeGateTexture('רובע השוק', 'עקבו אחרי החצים הזהובים'), toneMapped: false, transparent: true });
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 1.9), mt); pl.position.set(0, 5.2, 0); pl.rotation.y = Math.PI; g.add(pl);
    const bk = new THREE.Mesh(new THREE.BoxGeometry(7.8, 2.1, 0.2), std(0x14201b)); bk.position.set(0, 5.2, 0.14); g.add(bk);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; }); scene.add(g); }
  animators.push((now) => { if (mkAnim.chev) mkAnim.chev(now); if (mkAnim.beam) mkAnim.beam.opacity = (0.42 + 0.18 * Math.sin(now * 0.002)) * clamp((Math.hypot(camera.position.x - MK.cx, camera.position.z - MK.cz) - 35) / 45, 0, 1); if (mkAnim.gateMat) mkAnim.gateMat.color.setScalar(0.9 + 0.1 * Math.sin(now * 0.005)); if (mkAnim.sp) mkAnim.sp.position.y = 66 + Math.sin(now * 0.0015) * 1.2; if (mkAnim.ball) mkAnim.ball.rotation.y = now * 0.0006; if (mkAnim.flags) mkAnim.flags.position.y = Math.sin(now * 0.002) * 0.03; });
}

/* ---------- trees, lamps, benches ---------- */
{
  const trees = [];
  for (let k = 0; k < 20; k++) { const a = deg(k * 18); trees.push({ p: polar(R_FORE[0] + 1, a), s: 0.9 + rnd() * 0.25, t: rnd() < 0.5 }); trees.push({ p: polar(R_IN_WALK[0] + 0.8, a), s: 0.8 + rnd() * 0.2, t: rnd() < 0.5 }); }
  for (let i = 0; i < 46; i++) { const a = rnd() * Math.PI * 2, r = R_PLAZA + 3 + rnd() * (R_PARK - R_PLAZA - 6); trees.push({ p: polar(r, a), s: 0.9 + rnd() * 0.8, t: rnd() < 0.4 }); }
  for (let i = 0; i < Q.treesFar; i++) { const a = rnd() * Math.PI * 2, r = 100 + rnd() * 24, tp = polar(r, a); if (Math.abs(tp.x) < 11 && tp.z > 70) continue; trees.push({ p: tp, s: 1 + rnd() * 1.2, t: rnd() < 0.55 }); }
  const n = trees.length;
  const trunkGeo = new THREE.CylinderGeometry(0.26, 0.38, 1.8, 6); trunkGeo.translate(0, 0.9, 0);
  const pineGeo = new THREE.ConeGeometry(1.8, 4.6, 7); pineGeo.translate(0, 4, 0);
  const blobGeo = new THREE.IcosahedronGeometry(2.1, 1); blobGeo.translate(0, 3.9, 0);
  const trunk = new THREE.InstancedMesh(trunkGeo, std(0x5a3f2a), n), pine = new THREE.InstancedMesh(pineGeo, std(0xffffff, { flatShading: true }), n), blob = new THREE.InstancedMesh(blobGeo, std(0xffffff, { flatShading: true }), n);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0), pineCols = [0x1f5a3a, 0x246b43, 0x1a4d34], blobCols = [0x3f8f48, 0x5da24a, 0xc79a3a, 0x8aa83f];
  trees.forEach((t, i) => {
    qt.setFromAxisAngle(Y, rnd() * 6.28); v3.copy(t.p); sc3.setScalar(t.s); m4.compose(v3, qt, sc3); trunk.setMatrixAt(i, m4);
    if (t.t) { pine.setMatrixAt(i, m4); blob.setMatrixAt(i, zero); pine.setColorAt(i, new THREE.Color(pick(pineCols))); blob.setColorAt(i, new THREE.Color(0xffffff)); }
    else { blob.setMatrixAt(i, m4); pine.setMatrixAt(i, zero); blob.setColorAt(i, new THREE.Color(pick(blobCols))); pine.setColorAt(i, new THREE.Color(0xffffff)); }
  });
  sc3.set(1, 1, 1);
  for (const m of [trunk, pine, blob]) { m.castShadow = true; m.receiveShadow = true; noRay(m); scene.add(m); }
  const lamps = [];
  for (let k = 0; k < 40; k++) { const a = deg(k * 9 + 4.5); lamps.push(polar(R_ROAD[1] + 0.9, a), polar(R_ROAD[0] - 0.9, a)); }
  const poleGeo = new THREE.CylinderGeometry(0.11, 0.16, 6.4, 8); poleGeo.translate(0, 3.2, 0);
  const bulbGeo = new THREE.SphereGeometry(0.46, 10, 8);
  const poles = new THREE.InstancedMesh(poleGeo, std(0x2b3430, { metalness: 0.6, roughness: 0.4 }), lamps.length), bulbs = new THREE.InstancedMesh(bulbGeo, basic(0xffe6b0), lamps.length);
  lamps.forEach((l, i) => { m4.makeTranslation(l.x, 0, l.z); poles.setMatrixAt(i, m4); m4.makeTranslation(l.x, 6.55, l.z); bulbs.setMatrixAt(i, m4); });
  poles.castShadow = true; for (const m of [poles, bulbs]) { noRay(m); scene.add(m); }
  { // warm light pools under lamps
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 2, 64, 64, 64); gr.addColorStop(0, 'rgba(255,214,150,.75)'); gr.addColorStop(1, 'rgba(255,214,150,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const pm = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.55 });
    const pg = new THREE.PlaneGeometry(15, 15); pg.rotateX(-Math.PI / 2);
    const pools = new THREE.InstancedMesh(pg, pm, lamps.length);
    lamps.forEach((l, i) => { m4.makeTranslation(l.x, 0.2, l.z); pools.setMatrixAt(i, m4); }); noRay(pools); scene.add(pools);
  }
  { // grass tufts + bushes
    const gn = HI ? 2600 : 900, tuft = new THREE.InstancedMesh(new THREE.ConeGeometry(0.22, 0.9, 4), std(0xffffff, { flatShading: true }), gn);
    for (let i = 0; i < gn; i++) { const a = rnd() * Math.PI * 2, r = R_PLAZA + 2 + rnd() * (R_PARK - R_PLAZA - 3); const q = rnd() < 0.55 ? polar(r, a) : polar(86 + rnd() * 38, a); if (Math.abs(q.x) < 7 && q.z > 70) continue;
      qt.setFromAxisAngle(Y, rnd() * 6); v3.set(q.x, 0.4, q.z); sc3.set(0.8 + rnd(), 0.8 + rnd() * 1.2, 0.8 + rnd()); m4.compose(v3, qt, sc3); tuft.setMatrixAt(i, m4); tuft.setColorAt(i, new THREE.Color(pick([0x4f8a43, 0x62a24c, 0x3f7a3b, 0x7ab356]))); }
    sc3.set(1, 1, 1); noRay(tuft); tuft.receiveShadow = true; scene.add(tuft);
    const bn = 120, bush = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.4, 1), std(0xffffff, { flatShading: true }), bn);
    for (let i = 0; i < bn; i++) { const a = deg(i * (360 / bn) + rnd() * 2), onIn = i % 2, p = polar(onIn ? R_IN_WALK[0] - 1.0 : R_FORE[0] - 0.3, a); qt.setFromAxisAngle(Y, rnd() * 6); v3.set(p.x, 0.8, p.z); sc3.set(0.9 + rnd() * 0.5, 0.7 + rnd() * 0.4, 0.9 + rnd() * 0.5); m4.compose(v3, qt, sc3); bush.setMatrixAt(i, m4); bush.setColorAt(i, new THREE.Color(pick([0x2f7a3e, 0x3f8f48, 0x2a6b3a]))); }
    sc3.set(1, 1, 1); bush.castShadow = true; bush.receiveShadow = true; noRay(bush); scene.add(bush);
  }
  const benches = []; for (let k = 0; k < 10; k++) { const a = deg(k * 36 + 18), p = polar(R_PLAZA + 3.2, a); benches.push({ x: p.x, z: p.z, ry: -a + Math.PI / 2, y: 0.4 }); }
  instances(new THREE.BoxGeometry(2.6, 0.5, 0.8), std(0x8a5f3a), benches, true);
  const fl = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.7, 0), std(0xffffff), 120);
  for (let i = 0; i < 120; i++) { const a = rnd() * Math.PI * 2, r = R_PLAZA + 4 + rnd() * 10, p = polar(r, a); m4.makeTranslation(p.x, 0.5, p.z); fl.setMatrixAt(i, m4); fl.setColorAt(i, new THREE.Color(pick([0xe35d7a, 0xf2c14e, 0xb36cd6, 0x58c27d, 0xffffff]))); }
  noRay(fl); scene.add(fl);
}

/* ---------- people ---------- */
const SKIN = [0xf1c9a5, 0xd9a47a, 0xb27a52, 0x7d5236, 0xfbe0c8], SHIRTS = [0xd94a4a, 0x4a7fd9, 0xe8b84a, 0x3fbe97, 0x9a5ad9, 0xf2f2ee, 0x2f3a36, 0xe07a3a, 0x4ab0c9];
const PANTS = [0x27303a, 0x3a4a63, 0x5a4a3a, 0x2b2b2b, 0x6a6f78], HAIR = [0x1b1410, 0x3b2616, 0x7a5a2a, 0xc9a24a, 0x8a8a8a, 0x5a1f1f];
const legGeo = new THREE.BoxGeometry(0.22, 0.8, 0.24); legGeo.translate(0, -0.4, 0);
const armGeo = new THREE.BoxGeometry(0.15, 0.62, 0.17); armGeo.translate(0, -0.3, 0);
const personMatCache = {}, matFor = (key, make) => personMatCache[key] || (personMatCache[key] = make());
function tinted(geo, color) {
  const c = new THREE.Color(color), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo.index ? geo.toNonIndexed() : geo;
}
const PERSON_KEYS = ['Skin', 'Shirt', 'Pants', 'Hair', 'Shoe', 'Accent', 'Eye', 'Pupil', 'Lip'];
const ACCENTS = [0xe8b84a, 0xd94a4a, 0x3fbe97, 0xf2f2ee, 0x9a5ad9, 0x4a7fd9];
function mergePerson(gltf) { // one skinned mesh per person (1 draw call): primitives merged, material id kept per vertex
  const geos = [], olds = []; let first = null, parent = null;
  gltf.scene.traverse(o => { if (o.isSkinnedMesh) { first = first || o; parent = parent || o.parent; olds.push(o); } });
  for (const o of olds) {
    const g = o.geometry.clone(), n = g.attributes.position.count;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight'].includes(k)) g.deleteAttribute(k);
    g.setAttribute('mid', new THREE.BufferAttribute(new Float32Array(n).fill(Math.max(0, PERSON_KEYS.indexOf(o.material.name.replace(/\.\d+$/, '')))), 1)); geos.push(g);
  }
  const merged = new THREE.SkinnedMesh(mergeGeometries(geos, false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
  for (const o of olds) o.parent.remove(o);
  parent.add(merged); merged.bind(first.skeleton, first.bindMatrix); merged.frustumCulled = false;
}
const personVariants = [];
{
  const meta = await fetch('./models/people.json' + MV).then(r => r.json()).catch(() => null), files = meta ? meta.variants : [];
  const gl = await Promise.all(files.map(v => gltfLoader.loadAsync('./models/' + v.file + MV).catch(err => { console.warn('person model failed', v.file, err); return null; })));
  gl.forEach((gltf, i) => { if (gltf) { mergePerson(gltf); personVariants.push({ gltf, scale: files[i].scale || 1 }); } });
}
const NBODIES = Math.max(1, personVariants.length);
function makePerson(look, vi) {
  if (!personVariants.length) return makeBoxPerson();
  const body = (vi !== undefined && vi !== null ? vi : Math.floor(Math.random() * NBODIES)) % NBODIES, V = personVariants[body];
  const root = SkeletonUtils.clone(V.gltf.scene), g = new THREE.Group(); g.add(root);
  const base = look ? [look.skin, look.shirt, look.pants, look.hair, look.shoe] : [pick(SKIN), pick(SHIRTS), pick(PANTS), pick(HAIR), pick([0xf2f2ee, 0x222222, 0xd94a4a, 0x4a7fd9, 0xe8b84a])];
  const pal = base.map(h => new THREE.Color(h));
  pal.push(look ? pal[1].clone().offsetHSL(0.07, 0.05, -0.2) : new THREE.Color(pick(ACCENTS)), new THREE.Color(0xf4f4f0), new THREE.Color(0x15151a), pal[0].clone().lerp(new THREE.Color(0xb5504a), 0.45));
  root.traverse(o => {
    if (!o.isSkinnedMesh) return; const geo = o.geometry.clone(), mid = geo.attributes.mid.array, col = new Float32Array(mid.length * 3);
    for (let i = 0; i < mid.length; i++) { const c = pal[mid[i]]; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); o.geometry = geo; o.frustumCulled = false; o.castShadow = HI;
  });
  const clips = V.gltf.animations, mixer = new THREE.AnimationMixer(root), act = n => mixer.clipAction(THREE.AnimationClip.findByName(clips, n) || clips[0]);
  const walkA = act('Walk'), idleA = act('Idle'), waveA = act('Wave'), browseA = act('Browse');
  for (const a of [walkA, idleA, waveA, browseA]) { a.play(); a.time = Math.random() * a.getClip().duration; }
  waveA.setEffectiveWeight(0); browseA.setEffectiveWeight(0);
  g.scale.setScalar(1.5 * V.scale); g.userData = { mixer, walkA, idleA, waveA, browseA, body, wv: 0, waveUntil: 0 }; g.traverse(noRay); return g;
}
function setAnim(u, walkW, brW, dt) { // blend Walk / Idle / Browse / Wave
  const now = performance.now(), rest = 1 - walkW; u.wv += ((now < u.waveUntil ? 1 : 0) - u.wv) * Math.min(1, dt * 7);
  u.walkA.setEffectiveWeight(walkW); u.idleA.setEffectiveWeight(rest * (1 - brW) * (1 - u.wv)); u.browseA.setEffectiveWeight(rest * brW * (1 - u.wv)); u.waveA.setEffectiveWeight(rest * u.wv); u.mixer.update(dt);
}
function makeBoxPerson() {
  const g = new THREE.Group(), shirt = pick(SHIRTS), pants = pick(PANTS), skin = pick(SKIN), hair = pick(HAIR);
  const parts = [
    tinted(new THREE.BoxGeometry(0.58, 0.72, 0.34).translate(0, 1.16, 0), shirt),
    tinted(new THREE.SphereGeometry(0.21, 12, 10).translate(0, 1.76, 0), skin),
    tinted(new THREE.SphereGeometry(0.225, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.8, -0.01), rnd() < 0.3 ? pick(SHIRTS) : hair)
  ];
  if (rnd() < 0.35) parts.push(tinted(new THREE.BoxGeometry(0.4, 0.5, 0.2).translate(0, 1.2, -0.27), pick(SHIRTS)));
  g.add(new THREE.Mesh(mergeGeometries(parts), matFor('vc', () => std(0xffffff, { vertexColors: true, roughness: 0.8 }))));
  const pm = matFor('p' + pants, () => std(pants)), sm = matFor('s' + shirt, () => std(shirt));
  const legL = new THREE.Mesh(legGeo, pm), legR = new THREE.Mesh(legGeo, pm); legL.position.set(-0.15, 0.82, 0); legR.position.set(0.15, 0.82, 0);
  const armL = new THREE.Mesh(armGeo, sm), armR = new THREE.Mesh(armGeo, sm); armL.position.set(-0.4, 1.46, 0); armR.position.set(0.4, 1.46, 0);
  g.add(legL, legR, armL, armR); g.scale.setScalar(1.5); g.userData = { legL, legR, armL, armR };
  if (HI) g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.traverse(noRay); return g;
}
const lerpAng = (a, b, t) => { const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; };
const arcPts = (r, a0, a1, step = deg(5)) => { const out = [], n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / step)); for (let i = 1; i <= n; i++) { const p = polar(r, a0 + (a1 - a0) * i / n); out.push({ x: p.x, z: p.z }); } return out; };
const angleOf = p => Math.atan2(p.z, p.x);
const nearestCross = a => Math.round(a / deg(36)) * deg(36);
const people = [];
const MK_LANE = 20.5, mkAng = p => Math.atan2(p.z - MK.cz, p.x - MK.cx);
const mkPt = (r, a) => ({ x: MK.cx + r * Math.cos(a), z: MK.cz + r * Math.sin(a) });
function planMarket(p) {
  const r = Math.random(), a = mkAng(p.pos), d = Math.hypot(p.pos.x - MK.cx, p.pos.z - MK.cz);
  const toLane = () => { if (Math.abs(d - MK_LANE) > 1.2) p.q.push(mkPt(MK_LANE, a)); };
  if (r < 0.62 && market.occupied().length) {                       // visit a stall
    const k = pick(market.occupied()), sl = stallSlot(k), fx = Math.sin(sl.ry), fz = Math.cos(sl.ry), off = 2.6 + Math.random() * 1.4;
    const spot = { x: sl.x + fx * off + (Math.random() - 0.5) * 3 * fz, z: sl.z + fz * off - (Math.random() - 0.5) * 3 * fx };
    const ak = Math.atan2(sl.z - MK.cz, sl.x - MK.cx), diff = Math.atan2(Math.sin(ak - a), Math.cos(ak - a));
    toLane(); p.q.push(...arcPts2(MK_LANE, a, a + diff)); p.q.push({ x: spot.x, z: spot.z, wait: 4 + Math.random() * 7, face: Math.atan2(-fx, -fz) }, mkPt(MK_LANE, ak));
  } else if (r < 0.82) {                                              // stroll the lane
    toLane(); p.q.push(...arcPts2(MK_LANE, a, a + deg(30 + Math.random() * 90) * (Math.random() < 0.5 ? -1 : 1)));
  } else if (r < 0.92) {                                              // linger by the monument
    toLane(); p.q.push(mkPt(MK_LANE, a), { ...mkPt(9, a), wait: 3 + Math.random() * 6, face: Math.atan2(MK.cx - mkPt(9, a).x, MK.cz - mkPt(9, a).z) }, mkPt(MK_LANE, a));
  } else {                                                            // walk the boulevard and back
    const ae = deg(270), diff = Math.atan2(Math.sin(ae - a), Math.cos(ae - a)); toLane(); p.q.push(...arcPts2(MK_LANE, a, a + diff));
    const x1 = (Math.random() - 0.5) * 5, x2 = (Math.random() - 0.5) * 5;
    p.q.push({ x: x1, z: MK.cz - MK.r + 3 }, { x: x1, z: 118 + Math.random() * 20 }, { x: x2, z: 88, wait: 2 + Math.random() * 3, face: Math.PI }, { x: x2, z: MK.cz - MK.r + 3 }, mkPt(MK_LANE, ae));
  }
}
const arcPts2 = (r, a0, a1, step = deg(8)) => { const out = [], n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / step)); for (let i = 1; i <= n; i++) out.push(mkPt(r, a0 + (a1 - a0) * i / n)); return out; };
function planPerson(p) {
  if (p.zone === 'market') return planMarket(p);
  const a = angleOf(p.pos), outer = p.lane === R_LANE_OUT, r = Math.random();
  if (r < 0.5) {
    p.q.push(...arcPts(p.lane, a, a + deg(18 + Math.random() * 60) * p.dir));
  } else if (r < 0.85 && outer) {
    const b = pick(buildingRoots), ab = b.userData.angle;
    const d = Math.atan2(Math.sin(ab - a), Math.cos(ab - a)); p.dir = d >= 0 ? 1 : -1;
    p.q.push(...arcPts(R_LANE_OUT, a, a + d));
    const edge = polar(R_FORE[0] + 0.5, ab), spot = polar(R_FORE[0] + 3.2 + Math.random() * 1.6, ab + (Math.random() - 0.5) * deg(7)), home = polar(R_LANE_OUT, ab);
    p.q.push({ x: edge.x, z: edge.z }, { x: spot.x, z: spot.z, wait: 3 + Math.random() * 5, face: Math.atan2(-Math.cos(ab), -Math.sin(ab)) }, { x: edge.x, z: edge.z }, { x: home.x, z: home.z });
  } else {
    const ca = nearestCross(a), to = outer ? R_LANE_IN : R_LANE_OUT, e = polar(to, ca);
    p.q.push(...arcPts(p.lane, a, ca), { x: e.x, z: e.z }); p.lane = to;
  }
}
for (let i = 0; i < Q.people; i++) {
  const g = makePerson(), lane = Math.random() < 0.6 ? R_LANE_OUT : R_LANE_IN, pos = polar(lane, Math.random() * Math.PI * 2);
  const p = { g, pos, lane, dir: Math.random() < 0.5 ? -1 : 1, q: [], speed: 2.1 + Math.random() * 1.3, phase: Math.random() * 6, wait: 0, rot: 0, walk: 0, face: undefined };
  g.position.copy(pos); scene.add(g); people.push(p);
}
for (let i = 0; i < (HI ? 16 : 8); i++) {
  const g = makePerson(), a = Math.random() * Math.PI * 2, pos = new THREE.Vector3(MK.cx + MK_LANE * Math.cos(a), 0, MK.cz + MK_LANE * Math.sin(a));
  const p = { g, pos, lane: 0, zone: 'market', dir: 1, q: [], speed: 1.6 + Math.random() * 1.1, phase: Math.random() * 6, wait: Math.random() * 4, rot: 0, walk: 0, face: undefined };
  g.position.copy(pos); scene.add(g); people.push(p);
}
function updatePeople(dt) {
  for (const p of people) {
    if (p.wait > 0) { p.wait -= dt; p.walk += (0 - p.walk) * Math.min(1, dt * 8); if (p.face !== undefined) p.rot = lerpAng(p.rot, p.face, Math.min(1, dt * 5)); }
    else {
      if (!p.q.length) { p.face = undefined; planPerson(p); }
      const t = p.q[0], dx = t.x - p.pos.x, dz = t.z - p.pos.z, dist = Math.hypot(dx, dz);
      if (dist < 0.3) { p.q.shift(); if (t.wait) { p.wait = t.wait; p.face = t.face; } }
      else {
        const step = Math.min(dist, p.speed * dt); p.pos.x += dx / dist * step; p.pos.z += dz / dist * step;
        p.rot = lerpAng(p.rot, Math.atan2(dx, dz), Math.min(1, dt * 7)); p.phase += step * 3.1; p.walk += (1 - p.walk) * Math.min(1, dt * 8);
      }
    }
    const u = p.g.userData;
    if (u.mixer) {
      p.br = (p.br || 0) + (((p.wait > 0 && p.face !== undefined) ? 1 : 0) - (p.br || 0)) * Math.min(1, dt * 4); u.walkA.timeScale = p.speed / 2.0; setAnim(u, p.walk, p.br, dt);
      p.g.position.set(p.pos.x, 0, p.pos.z); p.g.rotation.y = p.rot; continue;
    }
    const sw = Math.sin(p.phase) * 0.75 * p.walk;
    u.legL.rotation.x = sw; u.legR.rotation.x = -sw; u.armL.rotation.x = -sw * 0.8; u.armR.rotation.x = sw * 0.8;
    p.g.position.set(p.pos.x, Math.abs(Math.sin(p.phase)) * 0.06 * p.walk, p.pos.z); p.g.rotation.y = p.rot;
  }
}

/* ---------- multiplayer: avatars, presence, chat ---------- */
const net = await createNet();
const SHOES = [0xf2f2ee, 0x222222, 0xd94a4a, 0x4a7fd9, 0xe8b84a];
const LOOKS = { skin: SKIN, shirt: SHIRTS, pants: PANTS, hair: HAIR, shoe: SHOES };
const rpick = a => a[Math.floor(Math.random() * a.length)];
const randomLook = () => ({ skin: rpick(SKIN), shirt: rpick(SHIRTS), pants: rpick(PANTS), hair: rpick(HAIR), shoe: rpick(SHOES), body: Math.floor(Math.random() * NBODIES) });
const cleanName = t => String(t || '').replace(/[<>&"'`]/g, '').trim().slice(0, 14);
const cleanLook = l => { const o = {}, ok = v => Number.isInteger(v) && v >= 0 && v <= 0xffffff; for (const k of ['skin', 'shirt', 'pants', 'hair', 'shoe']) o[k] = l && ok(l[k]) ? l[k] : LOOKS[k][0]; o.body = l && Number.isInteger(l.body) && l.body >= 0 && l.body < 6 ? l.body : ((o.shirt ^ o.hair) >>> 0) % 6; return o; };
const cleanText = t => String(t || '').replace(/https?:\/\/\S+|www\.\S+/gi, '[קישור]').replace(/[<>]/g, '').trim().slice(0, 100);
const me = (() => { let sv = null; try { sv = JSON.parse(localStorage.getItem('dr_avatar') || 'null'); } catch (e) {} return { name: cleanName(sv && sv.name) || 'אורח-' + net.id.slice(0, 3).toUpperCase(), look: cleanLook(sv ? sv.look : randomLook()), av: null }; })();
const saveMe = () => { try { localStorage.setItem('dr_avatar', JSON.stringify({ name: me.name, look: me.look })); } catch (e) {} };
saveMe();

function pillTexture(text, font, pad, fill, ink) {
  const c = document.createElement('canvas'), g = c.getContext('2d'); g.font = font; const w = Math.ceil(g.measureText(text).width) + pad * 2, h = 76;
  c.width = Math.max(120, w); c.height = h; g.font = font; g.direction = 'rtl'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = fill; roundRect(g, 2, 2, c.width - 4, h - 4, 34); g.fill(); g.fillStyle = ink; g.fillText(text, c.width / 2, h / 2 + 3);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return { t, w: c.width, h };
}
function makeTag(name) {
  const { t, w, h } = pillTexture(name, `400 40px ${FONT_D}`, 22, 'rgba(8,16,12,.82)', '#fff');
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, toneMapped: false })); sp.renderOrder = 12; sp.scale.set(w / h * 0.62, 0.62, 1); noRay(sp); return sp;
}
function makeBubble(text) {
  const c = document.createElement('canvas'); c.width = 520; const g = c.getContext('2d'); g.font = `500 34px ${FONT_B}`; g.direction = 'rtl';
  const lines = wrapLines(g, text, 440).slice(0, 3), h = 40 + lines.length * 44 + 30; c.height = h; g.font = `500 34px ${FONT_B}`; g.direction = 'rtl'; g.textAlign = 'center';
  g.fillStyle = 'rgba(255,255,255,.96)'; roundRect(g, 4, 4, 512, h - 34, 30); g.fill(); g.beginPath(); g.moveTo(240, h - 31); g.lineTo(260, h - 4); g.lineTo(282, h - 31); g.fill();
  g.fillStyle = '#10201a'; lines.forEach((l, i) => g.fillText(l, 260, 44 + i * 44 + 10));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, toneMapped: false })); sp.renderOrder = 13; sp.scale.set(4.4, 4.4 * h / 520, 1); sp.center.set(0.5, 0); noRay(sp); return sp;
}
function makeAvatar(look, name) {
  const root = new THREE.Group(), g = makePerson(look, look && look.body); root.add(g);
  const tag = makeTag(name); tag.position.y = 3.2; root.add(tag);
  return { root, g, tag, bubble: null, bubbleUntil: 0, name };
}
function setAvatarAnim(av, walkW, dt) {
  const u = av.g.userData; if (!u.mixer) return; u.walkA.timeScale = 1.45; setAnim(u, walkW, 0, dt);
}
function showBubble(av, text) {
  if (av.bubble) { av.root.remove(av.bubble); av.bubble.material.map.dispose(); av.bubble.material.dispose(); }
  if (av.g.userData.mixer) av.g.userData.waveUntil = performance.now() + 2600;
  av.bubble = makeBubble(text); av.bubble.position.y = 3.65; av.root.add(av.bubble); av.bubbleUntil = performance.now() + 6500;
}
function rebuildMeAvatar() {
  if (me.av) { scene.remove(me.av.root); }
  me.av = makeAvatar(me.look, me.name); me.av.root.visible = false; me.av.walkW = 0; scene.add(me.av.root);
}
rebuildMeAvatar();

const peers = new Map(), chatLog = $('chatlog');
function pushLog(name, text) {
  const d = document.createElement('div'); d.className = 'cl'; const b = document.createElement('b'); b.textContent = name + ': '; d.append(b, document.createTextNode(text));
  chatLog.append(d); while (chatLog.children.length > 6) chatLog.firstChild.remove(); setTimeout(() => d.classList.add('old'), 9000); setTimeout(() => d.remove(), 14000);
}
function rebuildPeer(p) {
  if (p.av) scene.remove(p.av.root); if (!p.look) return;
  p.av = makeAvatar(p.look, p.name); p.av.root.position.set(p.x, 0, p.z); p.av.root.visible = p.shown; scene.add(p.av.root);
}
function removePeer(p) { if (p.av) scene.remove(p.av.root); peers.delete(p.id); }
const num = v => (Number.isFinite(v) ? v : 0);
const hello = () => net.send({ t: 'hello', name: me.name, look: me.look });
net.on('msg', m => {
  if (!m || m.id === net.id || typeof m.id !== 'string') return; const now = performance.now(); let p = peers.get(m.id);
  if (!p) { p = { id: m.id, name: 'אורח', look: null, av: null, x: 0, z: 0, yaw: 0, tx: 0, tz: 0, tyaw: 0, mv: 0, seen: now, shown: false, walkW: 0, spawned: false }; peers.set(m.id, p); hello(); }
  p.seen = now;
  if (m.t === 'hello') { const nm = cleanName(m.name) || 'אורח', lk = cleanLook(m.look); if (!p.look || p.name !== nm || JSON.stringify(p.look) !== JSON.stringify(lk)) { p.name = nm; p.look = lk; rebuildPeer(p); } }
  else if (m.t === 'state') {
    const cp = clampRing(new THREE.Vector3(num(m.x), 0, num(m.z))); p.tx = cp.x; p.tz = cp.z; p.tyaw = num(m.yaw); p.mv = m.mv ? 1 : 0; p.shown = !m.hide;
    if (!p.spawned) { p.x = p.tx; p.z = p.tz; p.yaw = p.tyaw; p.spawned = true; }
    if (p.av) p.av.root.visible = p.shown; else if (p.look) rebuildPeer(p);
  } else if (m.t === 'chat') { const tx = cleanText(m.text); if (tx) { pushLog(p.name, tx); if (p.av && p.shown) showBubble(p.av, tx); } }
  else if (m.t === 'bye') removePeer(p);
});
let lastSend = 0, wasWalking = false, lastHello = 0;
function updateMultiplayer(now, dt) {
  if (now - lastHello > 4000) { lastHello = now; hello(); }
  if (walk.on) { if (now - lastSend > 140) { lastSend = now; net.send({ t: 'state', x: +walk.pos.x.toFixed(2), z: +walk.pos.z.toFixed(2), yaw: +(me.av.root.children[0].rotation.y).toFixed(3), mv: walk.moving ? 1 : 0 }); } wasWalking = true; }
  else if (wasWalking) { wasWalking = false; net.send({ t: 'state', x: 0, z: 0, yaw: 0, mv: 0, hide: true }); }
  // own avatar (third person only)
  const show = walk.on && !walk.firstPerson; me.av.root.visible = show;
  if (show) {
    const k = 1 - Math.exp(-dt * 10), tgt = walk.yaw + Math.PI; const g0 = me.av.root.children[0];
    g0.rotation.y = lerpAng(g0.rotation.y, tgt, k); me.av.root.position.set(walk.pos.x, 0, walk.pos.z);
    me.av.walkW += ((walk.moving ? 1 : 0) - me.av.walkW) * Math.min(1, dt * 9); setAvatarAnim(me.av, me.av.walkW, dt);
    if (me.av.bubble && now > me.av.bubbleUntil) { me.av.root.remove(me.av.bubble); me.av.bubble = null; }
  }
  for (const p of [...peers.values()]) {
    if (now - p.seen > 14000) { removePeer(p); continue; }
    if (!p.av || !p.shown) continue;
    const k = 1 - Math.exp(-dt * 9), dx = p.tx - p.x, dz = p.tz - p.z; p.x += dx * k; p.z += dz * k;
    const moving = Math.hypot(dx, dz) > 0.08 || p.mv; p.walkW += ((moving ? 1 : 0) - p.walkW) * Math.min(1, dt * 9);
    p.av.root.position.set(p.x, 0, p.z); const g0 = p.av.root.children[0]; g0.rotation.y = lerpAng(g0.rotation.y, p.tyaw, k); setAvatarAnim(p.av, p.walkW, dt);
    if (p.av.bubble && now > p.av.bubbleUntil) { p.av.root.remove(p.av.bubble); p.av.bubble = null; }
  }
  const n = peers.size + 1; if (now - (updateMultiplayer.t || 0) > 1000) { updateMultiplayer.t = now; $('online').textContent = net.mode === 'local' ? `👥 ${n} · מקומי` : `👥 ${n}`; $('online').title = net.mode === 'online' ? 'מחובר לעיר' : net.mode === 'local' ? 'מצב בדיקה: רואים רק לשוניות באותו דפדפן' : net.mode; }
}

/* chat + avatar editor */
let lastChat = 0;
function sendChat() {
  const inp = $('chat-in'), tx = cleanText(inp.value), now = performance.now(); if (!tx || now - lastChat < 1400) return; lastChat = now; inp.value = '';
  net.send({ t: 'chat', text: tx }); pushLog(me.name, tx); if (walk.on) showBubble(me.av, tx);
}
$('chat-send').addEventListener('click', sendChat);
$('chat-in').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') sendChat(); if (e.key === 'Escape') $('chat-in').blur(); });
$('chat-in').addEventListener('keyup', e => e.stopPropagation());
addEventListener('keydown', e => { if (e.key === 'Enter' && walk.on && document.activeElement !== $('chat-in')) { $('chat-in').focus(); e.preventDefault(); } if ((e.key === 'v' || e.key === 'V') && walk.on && !/INPUT|TEXTAREA/.test(e.target.tagName)) togglePov(); });
function togglePov() { walk.firstPerson = !walk.firstPerson; $('pov').setAttribute('aria-pressed', String(walk.firstPerson)); $('pov').textContent = walk.firstPerson ? '👁 גוף ראשון' : '🧍 גוף שלישי'; }
$('pov').addEventListener('click', togglePov);

const avatarEl = $('avatar');
function openAvatar() {
  closeShop(); closeCheckout();
  const rows = [['skin', 'עור'], ['shirt', 'חולצה'], ['pants', 'מכנסיים'], ['hair', 'שיער'], ['shoe', 'נעליים']];
  avatarEl.innerHTML = `<div class="sheet-head"><h2 class="sheet-title" style="flex:1;align-self:center">הדמות שלי</h2><button class="close" id="av-x" aria-label="סגור">✕</button></div>
    <div class="field"><label for="av-name">שם בעיר</label><input id="av-name" type="text" maxlength="14" autocomplete="off"></div>
    <div class="swrow"><span class="lbl">גוף</span><div class="sw" id="av-body">${['🧑', '👩', '🧢', '🙋‍♀️', '🧒', '👓'].slice(0, NBODIES).map((e, i) => `<button type="button" class="bodyb" data-b="${i}" aria-label="גוף ${i + 1}">${e}</button>`).join('')}</div></div>
    ${rows.map(([k, l]) => `<div class="swrow"><span class="lbl">${l}</span><div class="sw" data-k="${k}">${LOOKS[k].map(c => `<button type="button" class="swb" data-c="${c}" style="background:#${c.toString(16).padStart(6, '0')}" aria-label="${l}"></button>`).join('')}</div></div>`).join('')}
    <div class="btns"><button class="btn btn-ghost" id="av-rand">🎲 אקראי</button><button class="btn btn-main" id="av-ok">סיום</button></div>
    <div class="note">${net.mode === 'online' ? 'אתה מופיע לכל מי שנמצא כרגע בעיר (במצב טיול ברחוב).' : 'בינתיים אתה מופיע רק ללשוניות באותו דפדפן — מתחברים לשרת ואז כולם רואים אחד את השני.'}</div>`;
  const paint = () => { avatarEl.querySelectorAll('.bodyb').forEach(b => b.classList.toggle('on', Number(b.dataset.b) === me.look.body)); avatarEl.querySelectorAll('.sw').forEach(sw => sw.querySelectorAll('.swb').forEach(b => b.classList.toggle('on', Number(b.dataset.c) === me.look[sw.dataset.k]))); };
  $('av-name').value = me.name; paint();
  const apply = () => { saveMe(); rebuildMeAvatar(); hello(); paint(); };
  $('av-name').addEventListener('input', e => { me.name = cleanName(e.target.value) || me.name; });
  $('av-name').addEventListener('change', apply);
  avatarEl.querySelectorAll('.swb').forEach(b => b.addEventListener('click', () => { me.look[b.parentElement.dataset.k] = Number(b.dataset.c); apply(); }));
  avatarEl.querySelectorAll('.bodyb').forEach(b => b.addEventListener('click', () => { me.look.body = Number(b.dataset.b); apply(); }));
  $('av-rand').onclick = () => { me.look = randomLook(); apply(); };
  $('av-ok').onclick = $('av-x').onclick = () => { avatarEl.hidden = true; saveMe(); hello(); };
  avatarEl.hidden = false;
}
$('avatar-btn').addEventListener('click', () => (avatarEl.hidden ? openAvatar() : (avatarEl.hidden = true)));
$('online').addEventListener('click', () => { /* reserved for the people list */ });

/* ---------- marker / badges ---------- */
const marker = new THREE.Group(); marker.visible = false;
{
  const rg = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 8, 64), basic(0x3fbe97)); rg.rotation.x = Math.PI / 2; rg.position.y = 0.25;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 60, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0x3fbe97, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  beam.position.y = 30; marker.add(rg, beam); marker.userData.ring = rg; marker.traverse(noRay);
}
scene.add(marker);
function updateBadge(pid) {
  const b = buildings[pid]; if (!b) return;
  const q = qtyOf(pid), n = q.units + q.cases; b.userData.badge.visible = n > 0; if (n > 0) b.userData.badge.userData.draw(n);
}
PRODUCTS.forEach(p => updateBadge(p.id)); updateFab();

/* ---------- post ---------- */
let composer = null, gradePass = null;
if (Q.bloom) {
  composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
  try { const ao = new GTAOPass(scene, camera, innerWidth, innerHeight); ao.updateGtaoMaterial({ radius: 4.5, scale: 1.4, thickness: 5 }); composer.addPass(ao); } catch (e) { console.warn('GTAO unavailable', e); }
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.38, 0.6, 0.95));
  composer.addPass(new OutputPass());
  const GradeShader = {
    uniforms: { tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(innerWidth, innerHeight) }, uBlur: { value: 1.5 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uBlur; varying vec2 vUv;
      void main(){
        vec2 px = 1.0 / uRes; float d = abs(vUv.y - 0.46); float b = smoothstep(0.24, 0.52, d) * uBlur;
        vec4 c = texture2D(tDiffuse, vUv);
        if (b > 0.05) { vec4 s = c; for (int i = 0; i < 8; i++) { float a = float(i) * 0.785398; s += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * px * b * (1.0 + float(i - (i / 2) * 2))); } c = s / 9.0; }
        vec3 col = c.rgb; float l = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(vec3(l), col, 1.14);
        col *= mix(vec3(0.95, 1.0, 1.07), vec3(1.07, 1.0, 0.93), smoothstep(0.2, 0.8, l));
        col = (col - 0.5) * 1.06 + 0.5;
        vec2 q = vUv - 0.5; col *= 1.0 - dot(q, q) * 0.95;
        gl_FragColor = vec4(col, c.a);
      }`
  };
  gradePass = new ShaderPass(GradeShader); composer.addPass(gradePass);
  composer.addPass(new SMAAPass());
}

/* ---------- camera / controls (free zoom) ---------- */
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.07;
controls.minDistance = 2.5; controls.maxDistance = 600;
controls.minPolarAngle = 0; controls.maxPolarAngle = Math.PI / 2 - 0.02;
controls.rotateSpeed = 0.75; controls.zoomSpeed = 1.25; controls.panSpeed = 1.1;
controls.zoomToCursor = true; controls.screenSpacePanning = true;
controls.listenToKeyEvents(window);
const arcCentre = cat => polar(R_FRONT - 20, deg(districtArc[cat]));
const VIEWS = {
  overview: () => ({ t: new THREE.Vector3(0, 0, 0), off: new THREE.Vector3(0, 250, 300) }),
  preorder: () => ({ t: arcCentre('preorder'), off: new THREE.Vector3(-60, 95, 110) }),
  instock:  () => ({ t: arcCentre('instock'), off: new THREE.Vector3(70, 105, 125) }),
  tower:    () => ({ t: new THREE.Vector3(0, 20, 0), off: new THREE.Vector3(0, 22, 88) }),
  market:   () => ({ t: new THREE.Vector3(MK.cx, 0, MK.cz - 14), off: new THREE.Vector3(0, 66, -92) })
};
const aspectScale = () => { const a = innerWidth / innerHeight; return a < 1 ? Math.min(2.6, Math.pow(1 / a, 0.85)) : 1; };
const walk = { firstPerson: false, on: false, yaw: 0, pitch: -0.14, pos: new THREE.Vector3(), keys: {}, joy: { x: 0, y: 0 }, goto: null, bob: 0 };
let tween = null;
function flyTo(target, pos, ms = 1000, onDone = null) {
  if (REDUCE) ms = 1;
  tween = { t0: performance.now(), ms, fromT: controls.target.clone(), fromP: camera.position.clone(), toT: target.clone(), toP: pos.clone(), onDone }; controls.enabled = false;
}
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function setChips(name) { document.querySelectorAll('#views .chip').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.view === name))); }
function flyToView(name, ms) { leaveWalk(); const v = VIEWS[name](), k = aspectScale(); flyTo(v.t, v.t.clone().add(v.off.clone().multiplyScalar(k)), ms); setChips(name); }
function flyToBuilding(pid) {
  leaveWalk(); const b = buildings[pid], k = Math.min(1.7, aspectScale()), t = b.position.clone().addScaledVector(b.userData.dirIn, -10); t.y = 3;
  const tang = new THREE.Vector3(-b.userData.dirIn.z, 0, b.userData.dirIn.x);
  const wrap = x => Math.atan2(Math.sin(x), Math.cos(x));
  const dg = [deg(108), deg(252)].map(g => wrap(g - b.userData.angle)).sort((p, q) => Math.abs(p) - Math.abs(q))[0];
  tang.multiplyScalar(dg > 0 ? -1 : 1);
  flyTo(t, t.clone().addScaledVector(b.userData.dirIn, 70 * k).addScaledVector(tang, 16 * k).add(new THREE.Vector3(0, 36 * k, 0)), 950); setChips(null);
}
const market = createMarket({ THREE, mergeGeometries, scene, net, $, fmt, polar, deg, FONT_D, FONT_B, HI, stallSlot, LOTS, flyTo, walk, animators,
  sfx: { pop: () => sfx.pop(), success: () => sfx.success() }, closeOthers: () => { closeShop(); closeCheckout(); avatarEl.hidden = true; } });
if (!market.enabled) { $('market-btn').style.display = 'none'; document.querySelector('[data-view="market"]').style.display = 'none'; }
$('market-btn').addEventListener('click', () => market.toggleAccount());
function resize() {
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  if (composer) { composer.setSize(w, h); composer.setPixelRatio(Math.min(devicePixelRatio || 1, Q.pr)); if (gradePass) gradePass.uniforms.uRes.value.set(w * Math.min(devicePixelRatio || 1, Q.pr), h * Math.min(devicePixelRatio || 1, Q.pr)); }
}
addEventListener('resize', resize); resize();
{ const k = aspectScale(); camera.position.set(0, 520 * k, 640 * k); controls.target.set(0, 0, 0); controls.update(); flyToView('overview', 2800); }

/* ---------- walk mode (street level) ---------- */
const EYE = 2.9;
function setWalkUI(on) { document.body.classList.toggle('walk', on); $('walk-btn').textContent = on ? '🛰 מבט על' : '🚶 טיול ברחוב'; $('walk-btn').setAttribute('aria-pressed', String(on)); }
function enterWalk(at, yawOv) {
  if (walk.on) return; closeCheckout();
  const a = at ? Math.atan2(at.z, at.x) : Math.atan2(camera.position.z, camera.position.x);
  const p = at ? clampRing(at.clone()) : polar(66, a); p.y = EYE;
  const yaw = yawOv !== undefined ? yawOv : Math.atan2(-Math.cos(a), -Math.sin(a)) + Math.PI * 0.0 + (at ? 0 : Math.PI * 0.5);
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  walk.pos.copy(p); walk.yaw = yaw; walk.pitch = walk.firstPerson ? -0.04 : -0.16; walk.goto = null;
  setChips(null); setWalkUI(true);
  flyTo(p.clone().addScaledVector(fwd, 10).setY(EYE - 0.4), p, 1100, () => { walk.on = true; controls.enabled = false; camera.fov = 62; camera.updateProjectionMatrix(); $('hint').textContent = 'WASD / חצים לתנועה · גרירה להסתכלות · לחיצה על הרצפה כדי ללכת · לחיצה על חנות כדי להזמין'; $('hint').classList.remove('gone'); });
}
function leaveWalk() {
  if (!walk.on && !document.body.classList.contains('walk')) return;
  const fwd = new THREE.Vector3(-Math.sin(walk.yaw), 0, -Math.cos(walk.yaw));
  const wasOn = walk.on; walk.on = false; walk.goto = null; setWalkUI(false);
  camera.fov = 46; camera.updateProjectionMatrix();
  if (wasOn) { controls.target.copy(walk.pos).addScaledVector(fwd, 14).setY(0); controls.enabled = true; controls.update(); }
  $('hint').textContent = 'גררו כדי להסתובב · צבטו לזום · לחצו על בניין כדי להזמין';
}
$('walk-btn').addEventListener('click', () => { if (document.body.classList.contains('walk')) { const fwd = new THREE.Vector3(-Math.sin(walk.yaw), 0, -Math.cos(walk.yaw)); const t = walk.pos.clone().addScaledVector(fwd, 16).setY(0); leaveWalk(); flyTo(t, t.clone().add(new THREE.Vector3(0, 42, 44)), 1000); } else enterWalk(); });
addEventListener('keydown', e => { if (!walk.on || /INPUT|TEXTAREA/.test(e.target.tagName)) return; const k = e.key.toLowerCase(); if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) { walk.keys[k] = true; walk.goto = null; if (k.startsWith('arrow')) e.preventDefault(); } });
addEventListener('keyup', e => { delete walk.keys[e.key.toLowerCase()]; });
{ // joystick
  const joy = $('joy'), knob = joy.firstElementChild; let id = null;
  const set = e => { const r = joy.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; let dx = (e.clientX - cx) / (r.width / 2), dy = (e.clientY - cy) / (r.height / 2); const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; } walk.joy.x = dx; walk.joy.y = -dy; walk.goto = null; knob.style.transform = `translate(${dx * 34}px,${dy * 34}px)`; };
  joy.addEventListener('pointerdown', e => { id = e.pointerId; joy.setPointerCapture(id); set(e); });
  joy.addEventListener('pointermove', e => { if (e.pointerId === id) set(e); });
  const end = e => { if (e.pointerId === id) { id = null; walk.joy.x = walk.joy.y = 0; knob.style.transform = ''; } };
  joy.addEventListener('pointerup', end); joy.addEventListener('pointercancel', end);
}
function updateWalk(dt, now) {
  const k = walk.keys; let f = (k.w || k.arrowup ? 1 : 0) - (k.s || k.arrowdown ? 1 : 0) + walk.joy.y, st = (k.d ? 1 : 0) - (k.a ? 1 : 0) + walk.joy.x;
  if (k.arrowleft) walk.yaw += 1.7 * dt; if (k.arrowright) walk.yaw -= 1.7 * dt;
  const fw = new THREE.Vector3(-Math.sin(walk.yaw), 0, -Math.cos(walk.yaw)), rt = new THREE.Vector3(Math.cos(walk.yaw), 0, -Math.sin(walk.yaw));
  let moving = false, speed = (k.shift ? 30 : 15);
  if (walk.goto) {
    const dx = walk.goto.x - walk.pos.x, dz = walk.goto.z - walk.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.6) walk.goto = null; else { const step = Math.min(d, speed * dt); walk.pos.x += dx / d * step; walk.pos.z += dz / d * step; const th = Math.atan2(-dx, -dz); walk.yaw += Math.atan2(Math.sin(th - walk.yaw), Math.cos(th - walk.yaw)) * Math.min(1, dt * 4); moving = true; }
  }
  if (f || st) { const m = Math.hypot(f, st) > 1 ? Math.hypot(f, st) : 1; walk.pos.addScaledVector(fw, f / m * speed * dt).addScaledVector(rt, st / m * speed * dt); moving = true; }
  clampRing(walk.pos); walk.moving = moving; if (moving) walk.bob += dt * 9;
  if (walk.firstPerson) { camera.position.set(walk.pos.x, EYE + Math.sin(walk.bob) * (moving ? 0.07 : 0), walk.pos.z); }
  else {
    const cp = Math.cos(walk.pitch), dist = 8.5, tx = walk.pos.x, tz = walk.pos.z;
    camera.position.set(tx + Math.sin(walk.yaw) * cp * dist, Math.max(1.2, 3.1 - Math.sin(walk.pitch) * dist), tz + Math.cos(walk.yaw) * cp * dist);
    const wz = walk.pos.z;
    if (wz > 84 && wz < CORR_Z[1] - 4 && Math.abs(walk.pos.x) < CORR_HW + 3) camera.position.x = clamp(camera.position.x, -CORR_HW - 2, CORR_HW + 2);   // boulevard: keep camera between the buildings
    else if (!(wz > 84 && Math.hypot(walk.pos.x - MK.cx, walk.pos.z - MK.cz) < MK.r + 8)) { const cr = Math.hypot(camera.position.x, camera.position.z); if (cr > 85) { camera.position.x *= 85 / cr; camera.position.z *= 85 / cr; } }
  }
  camera.rotation.set(walk.pitch, walk.yaw, 0, 'YXZ');
}

/* ---------- minimap ---------- */
const mini = $('mini'), mg = mini.getContext('2d'), MC = { x: 0, z: 0, R: 112 };
const mw = (x, z) => { const s = mini.width / 2 - 10, k = s / MC.R; return [mini.width / 2 + (x - MC.x) * k, mini.height / 2 + (z - MC.z) * k]; };
const mUn = (px, py) => { const s = mini.width / 2 - 10, k = s / MC.R; return new THREE.Vector3((px - mini.width / 2) / k + MC.x, 0, (py - mini.height / 2) / k + MC.z); };
const inMarketMap = () => (walk.on ? walk.pos.z : controls.target.z) > 100;
let miniAt = 0;
function drawMini(now) {
  if (now - miniAt < 90) return; miniAt = now; const W = mini.width, c = W / 2, mm = inMarketMap(); if (mm) { MC.x = 0; MC.z = 168; MC.R = 74; } else { MC.x = 0; MC.z = 0; MC.R = 112; }
  mg.clearRect(0, 0, W, W); mg.save(); mg.beginPath(); mg.arc(c, c, c - 2, 0, 7); mg.clip();
  mg.fillStyle = 'rgba(10,20,16,.82)'; mg.fillRect(0, 0, W, W);
  const ringPx = (r, w, col) => { const [ox, oy] = mw(0, 0); mg.beginPath(); mg.arc(ox, oy, (c - 10) * r / MC.R, 0, 7); mg.lineWidth = w; mg.strokeStyle = col; mg.stroke(); };
  ringPx(60, (c - 10) * 20 / MC.R, 'rgba(70,76,84,.9)'); ringPx(21, (c - 10) * 12 / MC.R, 'rgba(150,148,130,.5)');
  for (const g2 of [108, 252]) { const [x, y] = mw(60 * Math.cos(deg(g2)), 60 * Math.sin(deg(g2))); mg.fillStyle = '#e8b84a'; mg.fillRect(x - 4, y - 4, 8, 8); }
  if (mm) { // market square, boulevard, stalls
    const [sx, sy] = mw(MK.cx, MK.cz), k = (c - 10) / MC.R;
    mg.fillStyle = 'rgba(190,176,140,.55)'; mg.beginPath(); mg.arc(sx, sy, MK.r * k, 0, 7); mg.fill(); mg.strokeStyle = '#e8b84a'; mg.lineWidth = 3; mg.stroke();
    const [bx0, by0] = mw(-CORR_HW, CORR_Z[0]), [bx1, by1] = mw(CORR_HW, CORR_Z[1]); mg.fillStyle = 'rgba(190,176,140,.55)'; mg.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
    mg.fillStyle = '#d23a32'; mg.beginPath(); mg.arc(sx, sy, 5, 0, 7); mg.fill();
    const lc = market.lotColors(); for (let kk = 0; kk < LOTS; kk++) { const sl = stallSlot(kk), [x, y] = mw(sl.x, sl.z); mg.fillStyle = lc.get(kk) || 'rgba(255,255,255,.28)'; mg.beginPath(); mg.arc(x, y, lc.has(kk) ? 5 : 3, 0, 7); mg.fill(); if (lc.has(kk)) { mg.strokeStyle = '#fff'; mg.lineWidth = 1.5; mg.stroke(); } }
  }
  { const [x, y] = mw(0, 100); mg.fillStyle = '#e8b84a'; mg.beginPath(); mg.arc(x, y, 10, 0, 7); mg.fill(); mg.fillStyle = '#14201b'; mg.font = '700 12px Rubik, sans-serif'; mg.textAlign = 'center'; mg.fillText(mm ? 'עיר' : 'שוק', x, y + 4); }
  mg.fillStyle = '#d23a32'; { const [ox, oy] = mw(0, 0); mg.beginPath(); mg.arc(ox, oy, 6, 0, 7); mg.fill(); mg.fillStyle = '#fff'; mg.fillRect(ox - 6, oy - 1, 12, 2); }
  for (const b of buildingRoots) { const [x, y] = mw(b.position.x, b.position.z), q = qtyOf(b.userData.pid), n = q.units + q.cases; mg.fillStyle = n ? '#3fbe97' : (P[b.userData.pid].category === 'preorder' ? '#e8b84a' : '#9fb5ff'); mg.beginPath(); mg.arc(x, y, n ? 6 : 4.5, 0, 7); mg.fill(); if (b.userData.pid === selectedPid) { mg.strokeStyle = '#fff'; mg.lineWidth = 2; mg.stroke(); } }
  const cp = walk.on ? walk.pos : camera.position, [cx, cy] = mw(cp.x, cp.z);
  let hx, hz; if (walk.on) { hx = -Math.sin(walk.yaw); hz = -Math.cos(walk.yaw); } else { const d = controls.target.clone().sub(camera.position); hx = d.x; hz = d.z; const m = Math.hypot(hx, hz) || 1; hx /= m; hz /= m; }
  const ang = Math.atan2(hz, hx); mg.fillStyle = 'rgba(255,255,255,.28)'; mg.beginPath(); mg.moveTo(cx, cy); mg.arc(cx, cy, 26, ang - 0.5, ang + 0.5); mg.fill();
  mg.fillStyle = '#fff'; mg.beginPath(); mg.arc(cx, cy, 4, 0, 7); mg.fill(); mg.strokeStyle = '#06130e'; mg.lineWidth = 2; mg.stroke();
  mg.restore();
}
mini.addEventListener('pointerdown', e => {
  const r = mini.getBoundingClientRect(), px = (e.clientX - r.left) * mini.width / r.width, py = (e.clientY - r.top) * mini.height / r.height, w = mUn(px, py);
  { const [mx, my] = mw(0, 100); if (Math.hypot(mx - px, my - py) < 18) { if (inMarketMap()) goCity(); else goMarket(); return; } }
  let best = null, bd = 1e9; for (const b of buildingRoots) { const [x, y] = mw(b.position.x, b.position.z), d = Math.hypot(x - px, y - py); if (d < bd) { bd = d; best = b; } }
  if (best && bd < 15) { openShop(best.userData.pid); return; }
  if (walk.on) { walk.goto = clampRing(w.clone()); } else { const t = new THREE.Vector3(w.x, 0, w.z); flyTo(t, t.clone().add(new THREE.Vector3(0, 55, 62)), 900); setChips(null); }
});

/* ---------- picking ---------- */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function setNdc(ev) { const r = canvas.getBoundingClientRect(); ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); }
function pickAt(ev) {
  setNdc(ev); const hit = ray.intersectObjects([tower, ...buildingRoots, market.group], true)[0]; if (!hit) return null;
  { const lot = market.lotAt(hit); if (lot !== null) return lot >= 0 ? 'lot:' + lot : null; }
  let o = hit.object; while (o && !(o.userData && (o.userData.pid || o.userData.tower || o.userData.shopId))) o = o.parent;
  return o ? (o.userData.tower ? 'tower' : o.userData.shopId ? 'shop:' + o.userData.shopId : o.userData.pid) : null;
}
let down = null, hovered = null, lastPtr = null, selectedPid = null;
const tip = $('tip');
const hideHint = () => $('hint').classList.add('gone');
canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; lastPtr = { x: e.clientX, y: e.clientY }; hideHint(); if (tween && !walk.on && !tween.onDone) { tween = null; controls.enabled = true; } });
canvas.addEventListener('wheel', e => { if (tween && !tween.onDone) { tween = null; controls.enabled = true; } hideHint(); if (walk.on) { walk.pos.addScaledVector(new THREE.Vector3(-Math.sin(walk.yaw), 0, -Math.cos(walk.yaw)), -e.deltaY * 0.04); clampRing(walk.pos); walk.goto = null; } }, { passive: true });
canvas.addEventListener('pointerup', e => {
  if (!down) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t; down = null; lastPtr = null;
  if (moved < 8 && dt < 500) {
    const pid = pickAt(e);
    if (pid === 'tower') { closeShop(); flyToView('tower', 900); openCheckout(); }
    else if (pid && pid.startsWith('shop:')) market.openShop(pid.slice(5));
    else if (pid && pid.startsWith('lot:')) market.showAccount();
    else if (pid) openShop(pid);
    else if (walk.on) { setNdc(e); const pt = new THREE.Vector3(); if (ray.ray.intersectPlane(groundPlane, pt)) walk.goto = clampRing(pt); }
  }
});
canvas.addEventListener('pointermove', e => {
  if (walk.on && down && lastPtr) { const dx = e.clientX - lastPtr.x, dy = e.clientY - lastPtr.y; if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { walk.yaw -= dx * 0.0042; walk.pitch = clamp(walk.pitch - dy * 0.0034, -1.15, 1.0); walk.goto = null; } lastPtr = { x: e.clientX, y: e.clientY }; }
  if (e.pointerType !== 'mouse' || down) { tip.style.display = 'none'; return; }
  const pid = pickAt(e);
  if (pid !== hovered) {
    if (hovered && buildings[hovered]) buildings[hovered].userData.hoverT = 0;
    hovered = pid; if (pid && buildings[pid]) buildings[pid].userData.hoverT = 1; canvas.style.cursor = pid ? 'pointer' : (walk.on ? 'crosshair' : 'grab');
  }
  if (pid && P[pid]) { const p = P[pid]; tip.innerHTML = `${p.name}<br>יחידה <b>${fmt(p.unitPrice)} ₪</b> · קייס <b>${fmt(p.casePrice)} ₪</b>`; tip.style.display = 'block'; tip.style.left = Math.min(innerWidth - 270, e.clientX + 16) + 'px'; tip.style.top = (e.clientY + 16) + 'px'; }
  else if (pid && pid.startsWith('lot:')) { tip.innerHTML = '<b>מגרש פנוי</b><br>לחצו כדי לפתוח כאן חנות'; tip.style.display = 'block'; tip.style.left = Math.min(innerWidth - 270, e.clientX + 16) + 'px'; tip.style.top = (e.clientY + 16) + 'px'; }
  else if (pid && pid.startsWith('shop:') && market.tooltip(pid.slice(5))) { tip.innerHTML = market.tooltip(pid.slice(5)); tip.style.display = 'block'; tip.style.left = Math.min(innerWidth - 270, e.clientX + 16) + 'px'; tip.style.top = (e.clientY + 16) + 'px'; }
  else if (pid === 'tower') { tip.innerHTML = 'מגדל ההזמנות<br>לחצו לסיום ושליחה'; tip.style.display = 'block'; tip.style.left = Math.min(innerWidth - 270, e.clientX + 16) + 'px'; tip.style.top = (e.clientY + 16) + 'px'; }
  else tip.style.display = 'none';
});

/* ---------- UI: shop sheet ---------- */
const shopEl = $('shop'), coEl = $('checkout');
const stepper = id => `<div class="stepper"><button type="button" data-d="-1" data-t="${id}" aria-label="הפחתה">–</button><input id="${id}" type="number" inputmode="numeric" min="0" step="1" value="0"><button type="button" data-d="1" data-t="${id}" aria-label="הוספה">+</button></div>`;
function selectBuilding(pid) {
  selectedPid = pid;
  if (!pid) { marker.visible = false; return; }
  const b = buildings[pid], F = b.userData.F, r = Math.max(F.w, F.d) * 0.78;
  marker.position.set(b.position.x, 0, b.position.z); marker.scale.set(r, 1, r); marker.visible = true;
}
function openShop(pid) {
  sfx.pop(); const p = P[pid]; market.close(); closeCheckout(); selectBuilding(pid); if (!walk.on) flyToBuilding(pid);
  const q = qtyOf(pid);
  shopEl.innerHTML = `
    <div class="sheet-head">
      <img class="sheet-img" src="../${p.image}" alt="">
      <div><h2 class="sheet-title">${p.name}</h2>
      <div class="prices"><div class="price"><span>יחידה</span><b>${fmt(p.unitPrice)} ₪</b></div><div class="price alt"><span>קייס · ${p.caseQty} יח׳</span><b>${fmt(p.casePrice)} ₪</b></div></div></div>
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
  market.close(); closeShop(); let saved = {}; try { saved = JSON.parse(localStorage.getItem('dr_customer') || '{}') || {}; } catch (e) {}
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
    sfx.success(); window.open('https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(d.text), '_blank'); msg('נפתחה הודעת וואטסאפ מוכנה — רק לשלוח!', 'ok');
  };
  $('c-copy').onclick = async () => {
    const err = check(); if (err) return msg(err, 'err');
    try { await navigator.clipboard.writeText(buildMessage().text); msg('ההזמנה הועתקה', 'ok'); } catch (e) { msg('לא הצלחנו להעתיק אוטומטית', 'err'); }
  };
  $('co-x').onclick = closeCheckout; coEl.hidden = false;
}
function closeCheckout() { coEl.hidden = true; }
$('cart-fab').addEventListener('click', () => { if (coEl.hidden) { flyToView('tower', 1000); openCheckout(); } else closeCheckout(); });
function goCity() {
  hideHint(); sfx.pop();
  if (walk.on) { walk.pos.set(0, EYE, 84); walk.yaw = 0; walk.pitch = -0.1; walk.goto = null; } else flyToView('overview', 1100);
}
function goMarket() {
  hideHint(); sfx.pop(); market.close(); closeShop(); closeCheckout();
  if (walk.on) { walk.pos.set(0, EYE, 90); walk.yaw = Math.PI; walk.pitch = -0.1; walk.goto = new THREE.Vector3(0, 0, 130); }
  else enterWalk(new THREE.Vector3(0, 0, 88), Math.PI);
}
document.querySelectorAll('#views .chip[data-view]').forEach(c => c.addEventListener('click', () => { hideHint(); if (c.dataset.view === 'market') goMarket(); else flyToView(c.dataset.view, 1100); }));
addEventListener('keydown', e => { if (e.key === 'Escape') { closeShop(); closeCheckout(); } });

/* ---------- sound (synthesised, no files) ---------- */
const audio = { ctx: null, master: null, amb: null, noise: null, on: (() => { try { return localStorage.getItem('dr_sound') !== '0'; } catch (e) { return true; } })(), nextBird: 0, stepT: 0 };
function startAudio() {
  if (!audio.on) return;
  if (audio.ctx) { if (audio.ctx.state === 'suspended') audio.ctx.resume(); return; }
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)(); audio.ctx = ctx;
    audio.master = ctx.createGain(); audio.master.gain.value = 0.85; audio.master.connect(ctx.destination);
    const nb = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate), d = nb.getChannelData(0); let lastv = 0;
    for (let i = 0; i < d.length; i++) { lastv = (lastv + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = lastv * 3.4; }
    audio.noise = nb;
    const src = ctx.createBufferSource(); src.buffer = nb; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    audio.amb = ctx.createGain(); audio.amb.gain.value = 0; src.connect(lp); lp.connect(audio.amb); audio.amb.connect(audio.master); src.start();
    const src3 = ctx.createBufferSource(); src3.buffer = nb; src3.loop = true; src3.playbackRate.value = 0.9;
    const bp3 = ctx.createBiquadFilter(); bp3.type = 'bandpass'; bp3.frequency.value = 650; bp3.Q.value = 0.9; audio.crowd = ctx.createGain(); audio.crowd.gain.value = 0; src3.connect(bp3); bp3.connect(audio.crowd); audio.crowd.connect(audio.master); src3.start();
    const src2 = ctx.createBufferSource(); src2.buffer = nb; src2.loop = true; src2.playbackRate.value = 1.7;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.6; const g2 = ctx.createGain(); g2.gain.value = 0.012; src2.connect(bp); bp.connect(g2); g2.connect(audio.master); src2.start();
  } catch (e) { audio.ctx = null; }
}
function tone(f, t0, dur, type = 'sine', vol = 0.12, f2 = null) {
  const c = audio.ctx; if (!c || !audio.on) return; const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + t0;
  o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(audio.master); o.start(t); o.stop(t + dur + 0.05);
}
const sfx = {
  chime() { tone(1046, 0, 0.18, 'sine', 0.13); tone(1318, 0.09, 0.28, 'sine', 0.12); },
  tick() { tone(520, 0, 0.09, 'triangle', 0.09, 380); },
  pop() { tone(420, 0, 0.1, 'sine', 0.1, 760); },
  success() { [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.09, 0.3, 'triangle', 0.12)); },
  step() {
    const c = audio.ctx; if (!c || !audio.on) return; const s = c.createBufferSource(); s.buffer = audio.noise; s.playbackRate.value = 2.2;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700 + Math.random() * 300; f.Q.value = 0.9; const g = c.createGain(), t = c.currentTime;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    s.connect(f); f.connect(g); g.connect(audio.master); s.start(t, Math.random() * 3, 0.12);
  },
  bird(vol) { const base = 2100 + Math.random() * 1400; for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) tone(base, i * 0.11, 0.09, 'sine', vol, base * (1.25 + Math.random() * 0.3)); }
};
function updateAudio(now, dt) {
  const c = audio.ctx; if (!c || !audio.on) return;
  const low = clamp(1 - (camera.position.y - 3) / 130, 0, 1);
  audio.amb.gain.setTargetAtTime(0.045 + 0.13 * low, c.currentTime, 0.4);
  if (audio.crowd) { const dm = Math.hypot(camera.position.x - MK.cx, camera.position.z - MK.cz), prox = clamp(1 - (dm - 24) / 80, 0, 1); audio.crowd.gain.setTargetAtTime(0.16 * prox * (0.75 + 0.25 * Math.sin(now * 0.0017)), c.currentTime, 0.3); }
  if (now > audio.nextBird) { audio.nextBird = now + 1800 + Math.random() * 4800; sfx.bird(0.02 + 0.05 * low); }
  if (walk.on && walk.moving) { audio.stepT += dt; if (audio.stepT > 0.36) { audio.stepT = 0; sfx.step(); } } else audio.stepT = 0.3;
}
addEventListener('pointerdown', startAudio); addEventListener('keydown', startAudio);
function paintSound() { $('sound').textContent = audio.on ? '🔊' : '🔇'; $('sound').setAttribute('aria-pressed', String(audio.on)); }
$('sound').addEventListener('click', e => { e.stopPropagation(); audio.on = !audio.on; try { localStorage.setItem('dr_sound', audio.on ? '1' : '0'); } catch (err) {} if (audio.on) startAudio(); else if (audio.ctx) audio.ctx.suspend(); paintSound(); });
paintSound();

/* ---------- zone toast ---------- */
let zoneNow = 'city', toastT = 0;
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 3400); }
function checkZone() { if (!walk.on) { zoneNow = 'city'; return; } const z = walk.pos.z > 98 ? 'market' : 'city'; if (z !== zoneNow) { zoneNow = z; toast(z === 'market' ? '🏪 ברוכים הבאים לרובע השוק' : '🏙️ חזרתם לעיר'); sfx.chime(); } }
/* ---------- loop ---------- */
let last = performance.now(), screenAt = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (tween) {
    const k = clamp((now - tween.t0) / tween.ms, 0, 1), e = ease(k);
    controls.target.lerpVectors(tween.fromT, tween.toT, e); camera.position.lerpVectors(tween.fromP, tween.toP, e);
    if (k >= 1) { const cb = tween.onDone; tween = null; if (cb) cb(); else controls.enabled = true; }
  }
  { const r = Math.hypot(controls.target.x, controls.target.z); if (r > 300) { controls.target.x *= 300 / r; controls.target.z *= 300 / r; } controls.target.y = clamp(controls.target.y, 0, 80); }
  if (walk.on) updateWalk(dt, now); else controls.update();
  if (!walk.on && camera.position.y < 1.4) camera.position.y = 1.4;
  drawMini(now);
  if (screenDirty && now - screenAt > 150) { drawScreen(); screenDirty = false; screenAt = now; }
  towerAnim.ball.rotation.y = now * 0.0005;
  { const a = towerAnim.pts.geometry.attributes.position, N = towerAnim.N, M = towerAnim.M;
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
      const t = (now * 0.00055 + j / M) % 1, ang = (i / N) * Math.PI * 2, r = 17.5 + (t - 0.5) * 9;
      a.setXYZ(i * M + j, Math.cos(ang) * r, 1 + Math.sin(t * Math.PI) * 6.5, Math.sin(ang) * r);
    }
    a.needsUpdate = true; }
  for (const b of buildingRoots) {
    const u = b.userData; u.hover += (u.hoverT - u.hover) * 0.2; const s = 1 + u.hover * 0.03; b.scale.set(s, 1 + u.hover * 0.015, s);
    u.fc.userData.disp.rotation.y = now * 0.0007 + b.position.x;
    if (u.badge.visible) u.badge.position.y = u.F.h + 6 + Math.sin(now * 0.003 + b.position.x) * 0.4;
  }
  if (marker.visible) { const p = 1 + Math.sin(now * 0.004) * 0.04; marker.userData.ring.scale.set(p, p, p); }
  updatePeople(dt); updateMultiplayer(now, dt); updateAudio(now, dt); checkZone();
  for (const fn of animators) fn(now, dt);
  if (gradePass) gradePass.uniforms.uBlur.value = clamp((camera.position.distanceTo(controls.target) - 40) / 120, 0, 1) * 2.6;
  if (composer) composer.render(); else renderer.render(scene, camera);
}
requestAnimationFrame(loop);
requestAnimationFrame(() => requestAnimationFrame(() => { $('bar').style.width = '100%'; setTimeout(() => $('loading').classList.add('gone'), 250); }));
window.cityDebug = { walk, market, net, peers, me, THREE, scene, camera, controls, openShop, buildings, flyToView, cart, setQty, people, renderer };
