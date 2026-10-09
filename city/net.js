import { CONFIG } from './config.js';

/* Realtime transport for the city.
   online  -> Supabase Realtime broadcast channel (everyone in the city)
   local   -> BroadcastChannel (other tabs of the same browser) - used when config.js is empty,
              so multiplayer can be tried without any backend. */
// self-hosted supabase-js 2.45.4 (UMD build) - no third-party code is executed from a CDN
const loadSupabase = () => new Promise((res, rej) => {
  if (window.supabase) return res(window.supabase);
  const s = document.createElement('script'); s.src = new URL('./vendor/supabase/supabase.js', import.meta.url).href;
  s.onload = () => (window.supabase ? res(window.supabase) : rej(new Error('supabase global missing'))); s.onerror = () => rej(new Error('supabase failed to load')); document.head.appendChild(s);
});
export async function createNet() {
  const handlers = {};
  const okMsg = m => m && typeof m === 'object' && !Array.isArray(m) && typeof m.id === 'string' && /^[\w-]{6,40}$/.test(m.id) && typeof m.t === 'string' && m.t.length < 12 && JSON.stringify(m).length < 1500;
  const emit = (k, v) => (handlers[k] || []).forEach(f => { try { f(v); } catch (e) { console.warn('handler failed', k); } });
  const rnd = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
  let uid = null, sess = null;                 // uid: stable per browser (bans/mutes key on it), sess: per tab so two tabs don't collide
  try { uid = localStorage.getItem('dr_uid'); } catch (e) {}
  if (!/^[a-z0-9]{12}$/.test(uid || '')) { uid = rnd(12); try { localStorage.setItem('dr_uid', uid); } catch (e) {} }
  try { sess = sessionStorage.getItem('dr_sess'); } catch (e) {}
  if (!/^[a-z0-9]{4}$/.test(sess || '')) { sess = rnd(4); try { sessionStorage.setItem('dr_sess', sess); } catch (e) {} }
  const id = uid + '_' + sess;
  const emitMsg = m => { if (okMsg(m)) emit('msg', m); };
  const api = { id, mode: 'local', on(k, f) { (handlers[k] = handlers[k] || []).push(f); }, send: () => {} };

  const useLocal = () => {
    api.mode = 'local';
    const bc = new BroadcastChannel('dr-city');
    bc.onmessage = e => emitMsg(e.data);
    api.send = m => bc.postMessage({ ...m, id });
    setTimeout(() => emit('ready', api.mode), 0);
  };

  if (CONFIG.supabaseUrl && CONFIG.supabaseKey) {
    try {
      const { createClient } = await loadSupabase();
      const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, { realtime: { params: { eventsPerSecond: 14 } } });
      const ch = sb.channel('city-main', { config: { broadcast: { self: false } } });
      ch.on('broadcast', { event: 'msg' }, ({ payload }) => emitMsg(payload));
      api.sb = sb; api.mode = 'connecting';
      ch.subscribe(status => {
        if (status === 'SUBSCRIBED') { api.mode = 'online'; api.send = m => ch.send({ type: 'broadcast', event: 'msg', payload: { ...m, id } }); emit('ready', api.mode); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { api.mode = 'offline'; emit('ready', api.mode); }
      });
    } catch (e) { console.warn('Supabase unavailable, using local mode', e); useLocal(); }
  } else useLocal();
  return api;
}
