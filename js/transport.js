// 通信の口。Supabase Realtime と、テスト用の BroadcastChannel を同じ形で扱う。
//   join(room, me) / send(type, payload) / on(type, cb) / onPeers(cb) / leave()
// me = { id, role }。on の cb は (payload, fromId)。onPeers の cb は在室一覧 [{ id, role }]（自分を除く）。

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=2';

const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const query = new URLSearchParams(window.location.search);

// ?local=1、または Supabase の設定が空のとき、ローカル試験モード
export const isLocal = query.get('local') === '1' || !SUPABASE_URL || !SUPABASE_ANON_KEY;

// ローカル試験モードの在室通知
const HELLO_INTERVAL_MS = 2000;
const PEER_TIMEOUT_MS = 6000;
const T_HELLO = '__hello';
const T_BYE = '__bye';

const handlers = new Map(); // type -> Set<cb>
const peerCallbacks = new Set();

let me = null;
let peers = []; // [{ id, role }]
let impl = null; // { send(envelope), leave() }

// 部屋名＝matsuri- ＋ 合言葉の SHA-256 の16進先頭16文字（合言葉そのものは送らない）
export async function roomName(passphrase) {
  const bytes = new TextEncoder().encode(passphrase);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return 'matsuri-' + hex.slice(0, 16);
}

export function on(type, cb) {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type).add(cb);
}

export function onPeers(cb) {
  peerCallbacks.add(cb);
}

export function send(type, payload) {
  if (!impl || !me) return;
  impl.send({ t: type, from: me.id, p: payload });
}

export async function join(room, self) {
  if (impl) leave();
  me = self;
  peers = [];
  impl = isLocal ? joinLocal(room) : await joinSupabase(room);
}

export function leave() {
  const current = impl;
  impl = null;
  if (current) current.leave();
  peers = [];
  me = null;
}

function dispatch(type, payload, from) {
  const set = handlers.get(type);
  if (!set) return;
  for (const cb of set) {
    try {
      cb(payload, from);
    } catch (e) {
      console.error('[transport] handler error', type, e);
    }
  }
}

// 在室一覧が変わったときだけ onPeers を呼ぶ
function setPeers(list) {
  const sorted = list.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sig = (l) => l.map((p) => p.id + ':' + p.role).join(',');
  if (sig(sorted) === sig(peers)) return;
  peers = sorted;
  for (const cb of peerCallbacks) {
    try {
      cb(peers.slice());
    } catch (e) {
      console.error('[transport] onPeers error', e);
    }
  }
}

// ---------------------------------------------------------------
// ローカル試験モード（BroadcastChannel）
// ---------------------------------------------------------------
function joinLocal(room) {
  const channel = new BroadcastChannel(room);
  const seen = new Map(); // id -> { role, last }

  const publish = () =>
    setPeers(Array.from(seen, ([id, v]) => ({ id, role: v.role })));

  const hello = () => channel.postMessage({ t: T_HELLO, from: me.id, p: { role: me.role } });

  channel.onmessage = (ev) => {
    const m = ev.data;
    if (!m || typeof m.t !== 'string' || m.from === me.id) return;
    if (m.t === T_HELLO) {
      const known = seen.has(m.from);
      seen.set(m.from, { role: m.p && m.p.role, last: Date.now() });
      if (!known) {
        hello(); // 新顔には自分の存在をすぐ知らせる
        publish();
      }
    } else if (m.t === T_BYE) {
      if (seen.delete(m.from)) publish();
    } else {
      dispatch(m.t, m.p, m.from);
    }
  };

  const helloTimer = setInterval(() => {
    hello();
    const now = Date.now();
    let removed = false;
    for (const [id, v] of seen) {
      if (now - v.last > PEER_TIMEOUT_MS) {
        seen.delete(id);
        removed = true;
      }
    }
    if (removed) publish();
  }, HELLO_INTERVAL_MS);

  hello();

  return {
    send(envelope) {
      channel.postMessage(envelope);
    },
    leave() {
      clearInterval(helloTimer);
      try {
        channel.postMessage({ t: T_BYE, from: me.id, p: null });
      } catch (e) {
        /* 既に閉じている */
      }
      channel.close();
    },
  };
}

// ---------------------------------------------------------------
// Supabase Realtime
// ---------------------------------------------------------------
async function joinSupabase(room) {
  const { createClient } = await import(SUPABASE_ESM);
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    // 声の接続の合図（ICE）が短時間に集中するため、既定より上げておく
    realtime: { params: { eventsPerSecond: 30 } },
  });
  const channel = client.channel(room, {
    config: { broadcast: { self: false }, presence: { key: me.id } },
  });

  channel.on('broadcast', { event: 'msg' }, ({ payload }) => {
    if (!payload || typeof payload.t !== 'string' || payload.from === me.id) return;
    dispatch(payload.t, payload.p, payload.from);
  });

  channel.on('presence', { event: 'sync' }, () => {
    const state = channel.presenceState();
    const list = [];
    for (const [key, metas] of Object.entries(state)) {
      if (key === me.id || !metas.length) continue;
      const meta = metas[metas.length - 1];
      list.push({ id: meta.id || key, role: meta.role });
    }
    setPeers(list);
  });

  await new Promise((resolve, reject) => {
    channel.subscribe(async (status, err) => {
      if (status === 'SUBSCRIBED') {
        // 再接続のたびに在室を登録し直す
        await channel.track({ id: me.id, role: me.role });
        resolve();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        reject(err || new Error(status)); // 参加済みの後なら無害
      }
    });
  }).catch((e) => {
    client.removeChannel(channel);
    throw e;
  });

  return {
    send(envelope) {
      channel.send({ type: 'broadcast', event: 'msg', payload: envelope });
    },
    leave() {
      channel.untrack();
      client.removeChannel(channel);
    },
  };
}
