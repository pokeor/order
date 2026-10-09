import { CONFIG } from './config.js';

/* Realtime transport for the city.
   online  -> Supabase Realtime broadcast channel (everyone in the city)
   local   -> BroadcastChannel (other tabs of the same browser) - used when config.js is empty,
              so multiplayer can be tried without any backend. */
export async function createNet() {
  const handlers = {};
  const okMsg = m => m && typeof m === 'object' && !Array.isArray(m) && typeof m.id === 'string' && /^[\w-]{6,40}$/.test(m.id) && typeof m.t === 'string' && m.t.length < 12 && JSON.stringify(m).length < 1500;
  const emit = (k, v) => (handlers[k] || []).forEach(f => { try { f(v); } catch (e) { console.warn('handler failed', k); } });
  let id = null;
  try { id = sessionStorage.getItem('dr_pid'); } catch (e) {}
  if (!/^[\w-]{6,40}$/.test(id || '')) { id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)).slice(0, 12); try { sessionStorage.setItem('dr_pid', id); } catch (e) {} }
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
      const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
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
