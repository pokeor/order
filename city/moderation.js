/* Client-side moderation for the public chat: word/number filter, duplicate-spam guard, personal mute list,
   shared ban list (read from Supabase) and player reports.
   Honest limits: the channel is peer-to-peer broadcast, so this is good-faith enforcement - a determined user can clear
   storage and come back. Bans and mutes key on a persistent per-browser id, not on an account. */

// Basic list - extend freely. Whole-word match for short stems, substring match for long ones.
const BAD_SHORT = ['זין', 'חרא', 'שרמוטה', 'fuck', 'shit', 'cunt', 'dick', 'bitch'];
const BAD_LONG = ['זונה', 'מניאק', 'מזדיין', 'כוסאמק', 'כוסעמק', 'בןזונה', 'בןכלב', 'מפגר', 'נאצי', 'asshole', 'nigger', 'faggot', 'motherfucker', 'bastard'];

const norm = w => w.toLowerCase().replace(/[֑-ׇ]/g, '').replace(/[^\p{L}\p{N}]/gu, '').replace(/(.)\1{2,}/gu, '$1');
export function hasBad(text) {
  for (const w of String(text || '').split(/\s+/)) { const n = norm(w); if (!n) continue; if (BAD_SHORT.includes(n) || BAD_LONG.some(b => n.includes(b))) return true; }
  const joined = norm(String(text || '').replace(/\s+/g, '')); return BAD_LONG.some(b => joined.includes(b));
}
export function filterText(raw) {
  let t = String(raw || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  t = t.replace(/https?:\/\/\S+|www\.\S+/gi, '[קישור]').replace(/\S+@\S+\.\S+/g, '[מייל]').replace(/(?:\+?972|\b0)[\s-]?\d[\d\s-]{7,}\d/g, '[מספר]');
  t = t.replace(/(.)\1{4,}/gu, '$1$1$1');
  t = t.split(' ').map(w => (hasBad(w) ? '***' : w)).join(' ');
  if (hasBad(t)) t = '***';
  t = t.slice(0, 100);
  return /[\p{L}\p{N}]/u.test(t.replace(/\[(קישור|מייל|מספר)\]/g, '')) ? t : '';
}
export const cleanDisplayName = (raw, fallback) => { const t = String(raw || '').replace(/[<>&"'`]/g, '').trim().slice(0, 14); return t && !hasBad(t) ? t : fallback; };

export const uidOf = id => String(id || '').split('_')[0];

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return []; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
};
const muted = new Set(store.get('dr_muted')), banned = new Set();
export const isMuted = uid => muted.has(uid);
export const isBanned = uid => banned.has(uid);
export const isBlocked = uid => muted.has(uid) || banned.has(uid);
export function setMuted(uid, on) { if (on) muted.add(uid); else muted.delete(uid); store.set('dr_muted', [...muted].slice(-200)); }

export function watchBans(sb) {
  if (!sb) return;
  const pull = async () => { try { const { data } = await sb.from('banned_uids').select('uid'); if (data) { banned.clear(); data.forEach(r => banned.add(r.uid)); } } catch (e) { /* offline */ } };
  pull(); setInterval(() => { if (!document.hidden) pull(); }, 60000);
}

/* a short rolling transcript per sender, attached to reports as evidence */
const recent = new Map();
export function remember(uid, text) { const a = recent.get(uid) || []; a.push(text); if (a.length > 5) a.shift(); recent.set(uid, a); if (recent.size > 80) recent.delete(recent.keys().next().value); }
export const transcript = uid => (recent.get(uid) || []).join(' | ').slice(0, 600);

export async function reportPlayer(sb, { uid, name, reason }) {
  if (!sb) return { error: 'offline' };
  let last = 0; try { last = +localStorage.getItem('dr_prep') || 0; } catch (e) { /* ignore */ }
  if (Date.now() - last < 30000) return { error: 'rate' };
  const { error } = await sb.from('player_reports').insert({ reported_uid: uid, reported_name: String(name || '').slice(0, 14), reason: String(reason).slice(0, 200), evidence: transcript(uid) || null });
  if (!error) { try { localStorage.setItem('dr_prep', String(Date.now())); } catch (e) { /* ignore */ } }
  return { error: error ? 'failed' : null };
}
