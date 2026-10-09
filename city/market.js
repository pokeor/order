import { CONFIG } from './config.js';

/* Market: user shops on the park ring. Needs the Supabase client from net.js (net.sb).
   Visitors: browse approved shops, order through the seller's WhatsApp (no payment on site).
   Sellers: register, request a shop, manage listings, go live with a YouTube/Twitch link.
   Admin (profiles.is_admin): approve / reject / suspend shops, read reports. */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SWATCH = ['#2f6f4f', '#d94f4f', '#3b7dd8', '#e8a33a', '#8a5ad6', '#d9559e', '#1f9aa8', '#6b5a4a'];
const STATUS = { pending: 'ממתינה לאישור', approved: 'פעילה', rejected: 'נדחתה', suspended: 'מושהית' };
const IMG_BASE = CONFIG.supabaseUrl + '/storage/v1/object/public/listings/';
const okImg = u => typeof u === 'string' && u.startsWith(IMG_BASE);

function liveEmbed(u) {
  try {
    const x = new URL(u), h = x.hostname.replace(/^(www|m)\./, '');
    let id = null;
    if (h === 'youtu.be') id = x.pathname.slice(1);
    else if (h === 'youtube.com') id = x.searchParams.get('v') || (x.pathname.match(/^\/(?:live|embed|shorts)\/([\w-]{6,20})/) || [])[1];
    if (id && /^[\w-]{6,20}$/.test(id)) return { src: `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&playsinline=1`, link: u };
    if (h === 'twitch.tv') { const c = x.pathname.split('/')[1]; if (/^\w{3,25}$/.test(c)) return { src: `https://player.twitch.tv/?channel=${c}&parent=${location.hostname}&muted=true&autoplay=true`, link: u }; }
  } catch (e) { /* not a url */ }
  return null;
}
const normPhone = v => { let d = String(v || '').replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); if (d.startsWith('0')) d = '972' + d.slice(1); return d; };
const hashN = s => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
async function resizeImage(file) {
  const bmp = await createImageBitmap(file), k = Math.min(1, 800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
}
const authErr = e => {
  const m = String(e && e.message || e || '');
  if (/invalid login/i.test(m)) return 'מייל או סיסמה שגויים';
  if (/already registered|already been registered/i.test(m)) return 'המייל כבר רשום — נסו להיכנס';
  if (/password/i.test(m)) return 'סיסמה: לפחות 6 תווים';
  if (/valid email|invalid.*email/i.test(m)) return 'כתובת מייל לא תקינה';
  if (/rate|too many|seconds/i.test(m)) return 'יותר מדי ניסיונות, נסו שוב עוד דקה';
  return 'משהו השתבש, נסו שוב';
};

export function createMarket(ctx) {
  const { THREE, mergeGeometries, scene, net, $, fmt, polar, deg, FONT_D, FONT_B, HI, stallSlot, LOTS, flyTo, walk, closeOthers, sfx, animators } = ctx;
  const sb = net.sb || null, money = n => fmt(n) + ' ₪';
  const group = new THREE.Group(); scene.add(group);
  const stalls = new Map(); let shops = [], user = null, isAdmin = false, cart = {}, mode = null;
  const el = document.createElement('section'); el.className = 'sheet'; el.id = 'market'; el.hidden = true; document.body.appendChild(el);
  const q = s => el.querySelector(s);
  const api = { group, enabled: !!sb };

  /* ---------- 3D stalls ---------- */
  function signTex(s) {
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 256; const g = cv.getContext('2d'), c = new THREE.Color(s.color);
    const lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b, ink = lum > 0.5 ? '#14201b' : '#ffffff';
    g.fillStyle = s.color; g.fillRect(0, 0, 1024, 256); g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, 0, 1024, 14); g.fillRect(0, 242, 1024, 14);
    g.direction = 'rtl'; g.textAlign = 'center'; g.fillStyle = ink;
    let fs = 120; g.font = `400 ${fs}px ${FONT_D}`; while (g.measureText(s.name).width > 940 && fs > 40) { fs -= 6; g.font = `400 ${fs}px ${FONT_D}`; }
    g.fillText(s.name, 512, s.tagline ? 138 : 160);
    if (s.tagline) { g.font = `500 46px ${FONT_B}`; g.globalAlpha = 0.85; g.fillText(s.tagline.slice(0, 40), 512, 214); g.globalAlpha = 1; }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  }
  function liveTex() {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 96; const g = cv.getContext('2d');
    g.fillStyle = '#e02929'; g.beginPath(); g.roundRect ? g.roundRect(0, 0, 256, 96, 48) : g.rect(0, 0, 256, 96); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(56, 48, 15, 0, 7); g.fill(); g.font = `400 54px ${FONT_D}`; g.textAlign = 'left'; g.fillText('LIVE', 90, 66);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  const stallMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  function buildStall(s) {
    const parts = [], rnd = mulberry(hashN(s.id));
    const add = (w, h, d, x, y, z, col, rx = 0) => {
      const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); g.translate(x, y, z);
      const n = g.attributes.position.count, a = new Float32Array(n * 3), cc = new THREE.Color(col);
      for (let i = 0; i < n; i++) { a[i * 3] = cc.r; a[i * 3 + 1] = cc.g; a[i * 3 + 2] = cc.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3)); parts.push(g);
    };
    add(5.8, 0.25, 4.0, 0, 0.125, 0, 0x8a5f3a);
    add(4.6, 1.0, 1.2, 0, 0.75, 0.8, 0xe9e2cf); add(4.8, 0.12, 1.4, 0, 1.28, 0.8, 0x8a5f3a);
    add(5.2, 2.7, 0.2, 0, 1.6, -1.7, 0xd8cdb5);
    for (const sx of [-1, 1]) { add(0.16, 2.7, 0.16, sx * 2.7, 1.55, 1.7, 0x6d5a45); add(0.16, 5.0, 0.16, sx * 2.7, 2.5, -1.7, 0x6d5a45); }
    for (let i = 0; i < 7; i++) add(0.8, 0.1, 4.0, -2.4 + i * 0.8, 3.05, 0.0, i % 2 ? 0xf3efe4 : s.color, 0.22);
    for (let i = 0; i < 6; i++) { const w = 0.45 + rnd() * 0.35, h = 0.35 + rnd() * 0.45; add(w, h, 0.5 + rnd() * 0.25, -1.9 + i * 0.76 + (rnd() - 0.5) * 0.15, 1.34 + h / 2, 0.85, [0xf2c14e, 0xe35d7a, 0x58c27d, 0xb36cd6, 0x4fa3e8, 0xffffff][Math.floor(rnd() * 6)]); }
    add(0.9, 0.8, 0.8, -1.9, 0.65, -0.9, 0xb98b55); add(0.9, 0.8, 0.8, 1.9, 0.65, -0.9, 0xb98b55);
    const g = new THREE.Group(), body = new THREE.Mesh(mergeGeometries(parts, false), stallMat); body.castShadow = HI; body.receiveShadow = true; g.add(body);
    parts.forEach(p => p.dispose());
    const map = signTex(s), sm = new THREE.MeshBasicMaterial({ map, toneMapped: false });
    const f = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 1.35), sm); f.position.set(0, 4.35, -1.58); g.add(f);
    const b = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 1.35), sm); b.position.set(0, 4.35, -1.82); b.rotation.y = Math.PI; g.add(b);
    if (s.live_url) {
      const lv = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.82), new THREE.MeshBasicMaterial({ map: liveTex(), toneMapped: false, transparent: true, side: THREE.DoubleSide }));
      lv.position.set(0, 5.75, -1.7); g.add(lv); g.userData.live = lv;
    }
    const sl = stallSlot(s.lot); g.position.set(sl.x, 0, sl.z); g.rotation.y = sl.ry;
    g.userData.shopId = s.id; g.userData.key = [s.name, s.tagline, s.color, s.lot, !!s.live_url].join('|'); g.userData.out = new THREE.Vector3(Math.sin(sl.ry), 0, Math.cos(sl.ry));
    return g;
  }
  function disposeStall(g) { group.remove(g); g.traverse(o => { if (o.isMesh) { o.geometry.dispose(); if (o.material !== stallMat) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } } }); }
  /* empty lots: pad + signpost, click opens the shop request form */
  const pads = (() => {
    const parts = [], add = (w, h, d, x, y, z, col) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); const n = g.attributes.position.count, a = new Float32Array(n * 3), c = new THREE.Color(col); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); parts.push(g); };
    add(5.8, 0.12, 4.0, 0, 0.06, 0, 0xc9bfa3); add(0.14, 1.9, 0.14, -1.2, 0.95, 1.2, 0x6d5a45); add(0.14, 1.9, 0.14, 1.2, 0.95, 1.2, 0x6d5a45);
    const m = new THREE.InstancedMesh(mergeGeometries(parts, false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), LOTS); parts.forEach(g => g.dispose()); m.receiveShadow = true; return m;
  })();
  const emptyTex = (() => { const cv = document.createElement('canvas'); cv.width = 512; cv.height = 192; const g = cv.getContext('2d'); g.fillStyle = '#fff6d6'; g.fillRect(0, 0, 512, 192); g.strokeStyle = '#d9a93a'; g.lineWidth = 12; g.strokeRect(6, 6, 500, 180);
    g.direction = 'rtl'; g.textAlign = 'center'; g.fillStyle = '#1b2a22'; g.font = `400 64px ${FONT_D}`; g.fillText('מגרש פנוי', 256, 92); g.fillStyle = '#b8791a'; g.font = `600 42px ${FONT_B}`; g.fillText('פתחו כאן חנות', 256, 150);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; })();
  const signs = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.7, 1.0), new THREE.MeshBasicMaterial({ map: emptyTex, side: THREE.DoubleSide, toneMapped: false }), LOTS);
  group.add(pads); group.add(signs);
  const padM = [], signM = [], zeroM = new THREE.Matrix4().makeScale(0, 0, 0), dm = new THREE.Object3D();
  for (let k = 0; k < LOTS; k++) {
    const sl = stallSlot(k); dm.position.set(sl.x, 0, sl.z); dm.rotation.set(0, sl.ry, 0); dm.scale.set(1, 1, 1); dm.updateMatrix(); padM.push(dm.matrix.clone());
    dm.translateY(1.95); dm.translateZ(1.2); dm.updateMatrix(); signM.push(dm.matrix.clone());
  }
  let taken = new Set();
  function syncPads() { for (let k = 0; k < LOTS; k++) { pads.setMatrixAt(k, taken.has(k) ? zeroM : padM[k]); signs.setMatrixAt(k, taken.has(k) ? zeroM : signM[k]); } pads.instanceMatrix.needsUpdate = signs.instanceMatrix.needsUpdate = true; }
  syncPads();
  api.pads = pads; api.signs = signs;
  api.lotAt = hit => { if (hit.object !== pads && hit.object !== signs) return null; const k = hit.instanceId; return k !== undefined && !taken.has(k) ? k : -1; };
  api.occupied = () => [...taken];
  api.lotColors = () => new Map(shops.filter(s => s.lot != null && s.lot >= 0 && s.lot < LOTS).map(s => [s.lot, s.color]));
  function syncStalls() {
    taken = new Set(shops.filter(s => s.lot != null && s.lot >= 0 && s.lot < LOTS).map(s => s.lot)); syncPads();
    const seen = new Set();
    for (const s of shops) {
      if (s.lot == null || s.lot < 0 || s.lot >= LOTS) continue; seen.add(s.id);
      const cur = stalls.get(s.id), key = [s.name, s.tagline, s.color, s.lot, !!s.live_url].join('|');
      if (cur && cur.userData.key === key) continue; if (cur) disposeStall(cur);
      const g = buildStall(s); stalls.set(s.id, g); group.add(g);
    }
    for (const [id, g] of stalls) if (!seen.has(id)) { disposeStall(g); stalls.delete(id); }
  }
  animators.push(now => { for (const g of stalls.values()) if (g.userData.live) g.userData.live.scale.setScalar(1 + 0.07 * Math.sin(now * 0.006)); });
  function flyToStall(id) {
    const g = stalls.get(id); if (!g) return; const t = g.position.clone(); t.y = 2.4;
    const k = Math.min(1.6, Math.max(1, innerWidth / innerHeight < 1 ? 1.5 : 1));
    flyTo(t, t.clone().addScaledVector(g.userData.out, 17 * k).add(new THREE.Vector3(0, 8 * k, 0)), 900);
  }
  api.tooltip = id => { const s = shops.find(x => x.id === id); return s ? `<b>${esc(s.name)}</b>${s.live_url ? ' 🔴 לייב' : ''}<br>${esc(s.tagline || 'חנות בשוק')}` : null; };

  /* ---------- data ---------- */
  async function refresh() {
    if (!sb) return;
    const { data, error } = await sb.from('shops').select('id,name,tagline,whatsapp,color,live_url,lot,status').eq('status', 'approved').order('lot');
    if (!error && data) { shops = data; syncStalls(); }
  }
  async function loadUser() {
    const { data } = await sb.auth.getSession(); user = data.session ? data.session.user : null; isAdmin = false;
    if (user) { const r = await sb.from('profiles').select('is_admin').eq('id', user.id).maybeSingle(); isAdmin = !!(r.data && r.data.is_admin); }
  }

  /* ---------- sheet helpers ---------- */
  const head = (title, sub = '') => `<div class="sheet-head"><div style="flex:1"><h2 class="sheet-title">${esc(title)}</h2>${sub ? `<div class="sheet-sub">${esc(sub)}</div>` : ''}</div><button class="close" id="mk-x" aria-label="סגור">✕</button></div>`;
  const msg = (cls, t) => { const m = q('#mk-msg'); if (!m) return; m.className = 'msg show ' + cls; m.textContent = t; };
  function open(html) { closeOthers(); el.innerHTML = html; el.hidden = false; const x = q('#mk-x'); if (x) x.onclick = close; }
  function close() { el.hidden = true; mode = null; el.innerHTML = ''; }
  api.close = close; api.isOpen = () => !el.hidden;

  /* ---------- visitor: shop sheet ---------- */
  async function openShop(id, fly = true) {
    const s = shops.find(x => x.id === id); if (!s) return;
    sfx.pop(); if (fly && !walk.on) flyToStall(id);
    cart = {}; mode = 'shop';
    let saved = {}; try { saved = JSON.parse(localStorage.getItem('dr_customer') || '{}') || {}; } catch (e) { /* ignore */ }
    const live = s.live_url ? liveEmbed(s.live_url) : null;
    open(`${head(s.name, s.tagline || '')}
      ${live ? `<div class="embed"><iframe src="${esc(live.src)}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"></iframe></div><a class="note" href="${esc(live.link)}" target="_blank" rel="noopener noreferrer">🔴 לייב עכשיו — פתיחה בחלון נפרד</a>` : ''}
      <div class="lines" id="mk-list"><div class="note">טוען מוצרים…</div></div>
      <div class="total"><span>סה״כ</span><span class="amt" id="mk-total">0 ₪</span></div>
      <div class="grid2"><div class="field"><label for="mk-name">שם מלא</label><input id="mk-name" type="text" autocomplete="name" value="${esc(saved.name || '')}"></div>
      <div class="field"><label for="mk-phone">טלפון</label><input id="mk-phone" type="tel" autocomplete="tel" inputmode="tel" value="${esc(saved.phone || '')}"></div></div>
      <div class="btns"><button class="btn btn-wa" id="mk-wa" type="button">שליחת הזמנה בוואטסאפ</button></div>
      <div class="note">אין תשלום באתר. ההזמנה נשלחת למוכר והעסקה היא ביניכם. <button class="lnk" id="mk-rep" type="button">דיווח על החנות</button></div>
      <div id="mk-repbox" hidden class="field"><label for="mk-reason">מה הבעיה?</label><input id="mk-reason" maxlength="300"><button class="btn btn-ghost" id="mk-repsend" type="button">שליחת דיווח</button></div>
      <div class="msg" id="mk-msg"></div>`);
    q('#mk-rep').onclick = () => { q('#mk-repbox').hidden = !q('#mk-repbox').hidden; };
    q('#mk-repsend').onclick = async () => {
      const r = q('#mk-reason').value.trim(); if (r.length < 3) return msg('err', 'כתבו כמה מילים');
      let last = 0; try { last = +localStorage.getItem('dr_rep') || 0; } catch (e) { /* ignore */ }
      if (Date.now() - last < 30000) return msg('err', 'אפשר לשלוח דיווח אחד כל חצי דקה');
      const { error } = await sb.from('reports').insert({ shop_id: s.id, reason: r });
      if (error) return msg('err', 'לא הצלחנו לשלוח, נסו שוב'); try { localStorage.setItem('dr_rep', String(Date.now())); } catch (e) { /* ignore */ }
      q('#mk-repbox').hidden = true; msg('ok', 'תודה, הדיווח התקבל');
    };
    const { data: ls } = await sb.from('listings').select('id,title,price,image_url').eq('shop_id', id).eq('active', true).order('created_at');
    if (mode !== 'shop' || !q('#mk-list')) return;
    const items = ls || [], list = q('#mk-list');
    if (!items.length) list.innerHTML = '<div class="note">עדיין אין מוצרים בחנות.</div>';
    else list.innerHTML = items.map(it => `<div class="lrow"><img class="thumb" src="${okImg(it.image_url) ? esc(it.image_url) : ''}" alt="" ${okImg(it.image_url) ? '' : 'style="visibility:hidden"'}><div class="lt"><b>${esc(it.title)}</b><span>${money(it.price)}</span></div>
      <div class="stepper"><button type="button" data-id="${it.id}" data-d="-1" aria-label="הפחתה">–</button><input id="q-${it.id}" type="number" inputmode="numeric" min="0" value="0"><button type="button" data-id="${it.id}" data-d="1" aria-label="הוספה">+</button></div></div>`).join('');
    const recalc = () => { let t = 0; for (const it of items) t += (cart[it.id] || 0) * it.price; q('#mk-total').textContent = money(t); };
    list.querySelectorAll('.stepper button').forEach(b => b.onclick = () => { const i = q('#q-' + b.dataset.id), v = Math.max(0, Math.min(99, (+i.value || 0) + (+b.dataset.d))); i.value = v; cart[b.dataset.id] = v; recalc(); });
    list.querySelectorAll('.stepper input').forEach(i => i.oninput = () => { cart[i.id.slice(2)] = Math.max(0, Math.min(99, +i.value || 0)); recalc(); });
    q('#mk-wa').onclick = () => {
      const chosen = items.filter(it => cart[it.id] > 0); if (!chosen.length) return msg('err', 'בחרו לפחות מוצר אחד');
      const name = q('#mk-name').value.trim(), phone = q('#mk-phone').value.trim(); if (!name) return msg('err', 'כתבו שם');
      try { localStorage.setItem('dr_customer', JSON.stringify({ ...saved, name, phone })); } catch (e) { /* ignore */ }
      let total = 0; const L = [`הזמנה מהחנות "${s.name}" 🛒 (דרך עיר הפוקימון)`, 'שם: ' + name, 'טלפון: ' + (phone || '-'), ''];
      chosen.forEach(it => { const t = cart[it.id] * it.price; total += t; L.push(`• ${it.title} × ${cart[it.id]} = ${money(t)}`); });
      L.push('', 'סה"כ: ' + money(total), '', '(בקשת הזמנה — ללא תשלום באתר)');
      sfx.success && sfx.success(); window.open(`https://wa.me/${s.whatsapp}?text=${encodeURIComponent(L.join('\n'))}`, '_blank', 'noopener');
    };
  }
  api.openShop = openShop;
  api.preview = list => { shops = list; syncStalls(); }; // local look-dev only; the server never trusts client state

  /* ---------- account: login / owner / admin ---------- */
  async function showAccount(note) {
    if (!sb) { open(head('חנויות') + '<div class="note">החנויות זמינות רק כשהעיר מחוברת לשרת.</div>'); return; }
    mode = 'acct'; await loadUser();
    if (!user) return renderAuth(note);
    open(head('החנות שלי', user.email) + '<div class="note">טוען…</div>');
    const [mine, all] = await Promise.all([
      sb.from('shops').select('*').eq('owner', user.id).maybeSingle(),
      isAdmin ? sb.from('shops').select('*').order('created_at', { ascending: false }) : Promise.resolve({ data: [] })
    ]);
    if (mode !== 'acct') return;
    const shop = mine.data;
    let html = head('החנות שלי', user.email);
    html += shop ? ownerShopHtml(shop) : newShopHtml();
    if (isAdmin) html += adminHtml(all.data || []);
    html += '<div class="btns"><button class="btn btn-ghost" id="mk-out" type="button">יציאה מהחשבון</button></div><div class="msg" id="mk-msg"></div>';
    open(html);
    q('#mk-out').onclick = async () => { await sb.auth.signOut(); user = null; isAdmin = false; showAccount('התנתקת'); };
    if (shop) await wireOwner(shop); else wireNewShop();
    if (isAdmin) wireAdmin(all.data || []);
    if (note) msg('ok', note);
  }
  api.showAccount = () => showAccount();
  api.toggleAccount = () => { if (api.isOpen() && mode === 'acct') close(); else showAccount(); };

  function renderAuth(note) {
    open(`${head('כניסה לחנויות', 'רוצים לפתוח חנות בעיר? נרשמים ומבקשים אישור')}
      <div class="field"><label for="a-mail">מייל</label><input id="a-mail" type="email" autocomplete="email" inputmode="email"></div>
      <div class="field"><label for="a-pass">סיסמה (לפחות 6 תווים)</label><input id="a-pass" type="password" autocomplete="current-password"></div>
      <div class="btns"><button class="btn btn-main" id="a-in" type="button">כניסה</button><button class="btn btn-ghost" id="a-up" type="button">הרשמה</button></div>
      <div class="msg" id="mk-msg"></div><div class="note">הרשמה מאפשרת להגיש בקשה לחנות. טיול בעיר וקניות לא דורשים חשבון.</div>`);
    const go = async up => {
      const email = q('#a-mail').value.trim(), password = q('#a-pass').value; if (!email || !password) return msg('err', 'מלאו מייל וסיסמה');
      q('#a-in').disabled = q('#a-up').disabled = true;
      const r = up ? await sb.auth.signUp({ email, password }) : await sb.auth.signInWithPassword({ email, password });
      if (r.error) { q('#a-in').disabled = q('#a-up').disabled = false; return msg('err', authErr(r.error)); }
      if (up && !r.data.session) { q('#a-in').disabled = q('#a-up').disabled = false; return msg('ok', 'נשלח מייל אישור — אשרו ואז היכנסו'); }
      showAccount('ברוכים הבאים!');
    };
    q('#a-in').onclick = () => go(false); q('#a-up').onclick = () => go(true);
    if (note) msg('ok', note);
  }

  const swatches = cur => `<div class="sw" id="sh-sw">${SWATCH.map(c => `<button type="button" class="swb${c === cur ? ' on' : ''}" data-c="${c}" style="background:${c}" aria-label="צבע"></button>`).join('')}</div>`;
  function newShopHtml() {
    return `<div class="note">אין לך עדיין חנות. מלאו פרטים — הבקשה תעבור לאישור ואחריו החנות תופיע בעיר.</div>
      <div class="field"><label for="sh-name">שם החנות</label><input id="sh-name" maxlength="28"></div>
      <div class="field"><label for="sh-tag">משפט קצר (לא חובה)</label><input id="sh-tag" maxlength="60"></div>
      <div class="field"><label for="sh-wa">וואטסאפ להזמנות (יוצג ללקוחות)</label><input id="sh-wa" type="tel" inputmode="tel" placeholder="050-1234567"></div>
      <div class="row"><span class="lbl">צבע החנות</span>${swatches(SWATCH[0])}</div>
      <div class="btns"><button class="btn btn-main" id="sh-create" type="button">שליחת בקשה לפתיחת חנות</button></div>`;
  }
  const pickColor = () => { const b = q('#sh-sw .on'); return b ? b.dataset.c : SWATCH[0]; };
  function wireSwatches() { q('#sh-sw').querySelectorAll('.swb').forEach(b => b.onclick = () => { q('#sh-sw').querySelectorAll('.swb').forEach(x => x.classList.toggle('on', x === b)); }); }
  function wireNewShop() {
    wireSwatches();
    q('#sh-create').onclick = async () => {
      const name = q('#sh-name').value.trim(), tagline = q('#sh-tag').value.trim(), whatsapp = normPhone(q('#sh-wa').value);
      if (name.length < 2) return msg('err', 'שם החנות קצר מדי'); if (!/^\d{9,15}$/.test(whatsapp)) return msg('err', 'מספר וואטסאפ לא תקין');
      const { error } = await sb.from('shops').insert({ owner: user.id, name, tagline: tagline || null, whatsapp, color: pickColor() });
      if (error) return msg('err', 'לא הצלחנו ליצור את החנות'); showAccount('הבקשה נשלחה! נחזור אליך אחרי אישור.');
    };
  }
  function ownerShopHtml(s) {
    return `<div class="stat st-${esc(s.status)}"><b>${esc(s.name)}</b> · ${esc(STATUS[s.status] || s.status)}${s.status === 'approved' && s.lot != null ? ` · דוכן ${s.lot + 1}` : ''}</div>
      ${s.status === 'pending' ? '<div class="note">הבקשה ממתינה לאישור. אפשר כבר להוסיף מוצרים.</div>' : ''}
      ${s.status === 'rejected' || s.status === 'suspended' ? '<div class="note">החנות לא מוצגת בעיר כרגע. אפשר לפנות לבעל העיר.</div>' : ''}
      <details class="dt"><summary>פרטי החנות</summary>
        <div class="field"><label for="sh-name">שם החנות</label><input id="sh-name" maxlength="28" value="${esc(s.name)}"></div>
        <div class="field"><label for="sh-tag">משפט קצר</label><input id="sh-tag" maxlength="60" value="${esc(s.tagline || '')}"></div>
        <div class="field"><label for="sh-wa">וואטסאפ להזמנות</label><input id="sh-wa" type="tel" inputmode="tel" value="${esc(s.whatsapp)}"></div>
        <div class="row"><span class="lbl">צבע</span>${swatches(s.color)}</div>
        <div class="btns"><button class="btn btn-ghost" id="sh-save" type="button">שמירה</button></div></details>
      ${s.status === 'approved' ? `<details class="dt" ${s.live_url ? 'open' : ''}><summary>🔴 לייב ${s.live_url ? '(פעיל)' : ''}</summary>
        <div class="field"><label for="lv-url">קישור YouTube או Twitch</label><input id="lv-url" type="url" inputmode="url" placeholder="https://www.youtube.com/watch?v=…" value="${esc(s.live_url || '')}"></div>
        <div class="btns"><button class="btn btn-main" id="lv-on" type="button">התחלת לייב</button><button class="btn btn-ghost" id="lv-off" type="button">סיום לייב</button></div></details>` : ''}
      <details class="dt" open><summary>המוצרים שלי</summary><div class="lines" id="ls-list"><div class="note">טוען…</div></div>
        <div class="field"><label for="ls-title">שם מוצר</label><input id="ls-title" maxlength="60"></div>
        <div class="grid2"><div class="field"><label for="ls-price">מחיר ₪</label><input id="ls-price" type="number" inputmode="numeric" min="0"></div>
        <div class="field"><label for="ls-img">תמונה</label><input id="ls-img" type="file" accept="image/*"></div></div>
        <div class="btns"><button class="btn btn-main" id="ls-add" type="button">הוספת מוצר</button></div></details>`;
  }
  async function wireOwner(s) {
    wireSwatches();
    q('#sh-save').onclick = async () => {
      const name = q('#sh-name').value.trim(), whatsapp = normPhone(q('#sh-wa').value);
      if (name.length < 2) return msg('err', 'שם החנות קצר מדי'); if (!/^\d{9,15}$/.test(whatsapp)) return msg('err', 'מספר וואטסאפ לא תקין');
      const { error } = await sb.from('shops').update({ name, tagline: q('#sh-tag').value.trim() || null, whatsapp, color: pickColor() }).eq('id', s.id);
      if (error) return msg('err', 'השמירה נכשלה'); await refresh(); msg('ok', 'נשמר');
    };
    const setLive = async url => {
      if (url && !liveEmbed(url)) return msg('err', 'אפשר קישור YouTube או Twitch בלבד');
      const { error } = await sb.from('shops').update({ live_url: url }).eq('id', s.id);
      if (error) return msg('err', 'העדכון נכשל'); await refresh(); showAccount(url ? 'הלייב פעיל — תג LIVE מופיע על הדוכן' : 'הלייב הסתיים');
    };
    if (q('#lv-on')) { q('#lv-on').onclick = () => { const u = q('#lv-url').value.trim(); if (!u) return msg('err', 'הדביקו קישור'); setLive(u); }; q('#lv-off').onclick = () => setLive(null); }
    const renderList = async () => {
      const { data } = await sb.from('listings').select('*').eq('shop_id', s.id).order('created_at'), box = q('#ls-list'); if (!box) return;
      box.innerHTML = (data || []).length ? data.map(it => `<div class="lrow"><img class="thumb" src="${okImg(it.image_url) ? esc(it.image_url) : ''}" alt="" ${okImg(it.image_url) ? '' : 'style="visibility:hidden"'}><div class="lt"><b>${esc(it.title)}</b><span>${money(it.price)}${it.active ? '' : ' · מוסתר'}</span></div>
        <button class="btn btn-ghost sm" data-tg="${it.id}" data-a="${it.active}" type="button">${it.active ? 'הסתר' : 'הצג'}</button><button class="btn btn-ghost sm" data-del="${it.id}" type="button">מחק</button></div>`).join('') : '<div class="note">אין מוצרים עדיין.</div>';
      box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { await sb.from('listings').delete().eq('id', b.dataset.del); renderList(); });
      box.querySelectorAll('[data-tg]').forEach(b => b.onclick = async () => { await sb.from('listings').update({ active: b.dataset.a !== 'true' }).eq('id', b.dataset.tg); renderList(); });
    };
    renderList();
    q('#ls-add').onclick = async () => {
      const title = q('#ls-title').value.trim(), price = Math.round(+q('#ls-price').value);
      if (title.length < 2) return msg('err', 'כתבו שם מוצר'); if (!(price >= 0) || price > 1000000) return msg('err', 'מחיר לא תקין');
      const btn = q('#ls-add'); btn.disabled = true; let image_url = null; const f = q('#ls-img').files[0];
      try {
        if (f) { const blob = await resizeImage(f), path = `${user.id}/${crypto.randomUUID()}.jpg`, up = await sb.storage.from('listings').upload(path, blob, { contentType: 'image/jpeg' }); if (up.error) throw up.error; image_url = sb.storage.from('listings').getPublicUrl(path).data.publicUrl; }
        const { error } = await sb.from('listings').insert({ shop_id: s.id, title, price, image_url }); if (error) throw error;
        q('#ls-title').value = ''; q('#ls-price').value = ''; q('#ls-img').value = ''; msg('ok', 'המוצר נוסף'); renderList();
      } catch (e) { msg('err', 'ההוספה נכשלה'); }
      btn.disabled = false;
    };
  }

  function adminHtml(all) {
    const rows = all.map(s => `<div class="lrow"><div class="lt"><b>${esc(s.name)}</b><span>${esc(STATUS[s.status] || s.status)} · ${esc(s.whatsapp)}${s.lot != null ? ' · דוכן ' + (s.lot + 1) : ''}</span></div>
      ${s.status !== 'approved' ? `<button class="btn btn-main sm" data-ap="${s.id}" type="button">אשר</button>` : `<button class="btn btn-ghost sm" data-su="${s.id}" type="button">השעה</button>`}
      ${s.status === 'pending' ? `<button class="btn btn-ghost sm" data-rj="${s.id}" type="button">דחה</button>` : ''}</div>`).join('');
    return `<details class="dt" open><summary>👑 ניהול חנויות (${all.length})</summary><div class="lines">${rows || '<div class="note">אין חנויות.</div>'}</div></details>
      <details class="dt"><summary>🚩 דיווחים</summary><div class="lines" id="ad-rep"><div class="note">טוען…</div></div></details>`;
  }
  function wireAdmin(all) {
    const upd = async (id, patch) => { const { error } = await sb.from('shops').update(patch).eq('id', id); if (error) return msg('err', 'הפעולה נכשלה'); await refresh(); showAccount('עודכן'); };
    el.querySelectorAll('[data-ap]').forEach(b => b.onclick = () => {
      const used = new Set(all.filter(s => s.status === 'approved' && s.lot != null).map(s => s.lot)); let lot = 0; while (used.has(lot) && lot < LOTS) lot++;
      if (lot >= LOTS) return msg('err', 'אין דוכנים פנויים'); upd(b.dataset.ap, { status: 'approved', lot });
    });
    el.querySelectorAll('[data-su]').forEach(b => b.onclick = () => upd(b.dataset.su, { status: 'suspended', lot: null, live_url: null }));
    el.querySelectorAll('[data-rj]').forEach(b => b.onclick = () => upd(b.dataset.rj, { status: 'rejected' }));
    sb.from('reports').select('reason,created_at,shops(name)').order('created_at', { ascending: false }).limit(20).then(({ data }) => {
      const box = q('#ad-rep'); if (!box) return;
      box.innerHTML = (data || []).length ? data.map(r => `<div class="line"><span><b>${esc(r.shops && r.shops.name || '?')}</b> — ${esc(r.reason)}</span><span>${esc(new Date(r.created_at).toLocaleDateString('he-IL'))}</span></div>`).join('') : '<div class="note">אין דיווחים.</div>';
    });
  }

  if (sb) { refresh(); setInterval(() => { if (!document.hidden) refresh(); }, 45000); sb.auth.onAuthStateChange(() => { if (mode === 'acct' && api.isOpen()) showAccount(); }); }
  return api;
}
