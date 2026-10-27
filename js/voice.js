// 声。マイク、WebRTC メッシュ、押して話す、送信の排他、接続状態の取得。
//
//   prepareMic()            … 「通信開始」のタップの中で、同期的に呼ぶ（マイク取得と再生の解錠）。Promise<{ ok, error? }>
//   start({ me, onTalker, onLocalTalk, onStats }) … transport.join の前に呼ぶ（受信の登録）
//   bindPttButton(el)       … 押して話すボタンに pointer 操作を結びつける
//   stop()
//
// URL パラメータ
//   audio=A|B|C … iOS の音声セッションの切り替え方（B が既定）
//   dsp=0       … echoCancellation / noiseSuppression / autoGainControl をすべて切る
//   idle=null|silent … 話していない間の送信（null が既定）
//     null   … 送信側の track を外し、RTP パケットを送らない（replaceTrack(null)）
//     silent … track を付けたまま enabled の切り替えだけ（無音のパケットを送り続ける。比較用）

import { ICE_SERVERS } from './config.js?v=1';
import * as transport from './transport.js?v=1';

const query = new URLSearchParams(window.location.search);
const AUDIO_MODE = (query.get('audio') || 'B').toUpperCase();
const DSP_OFF = query.get('dsp') === '0';
const IDLE_NULL = query.get('idle') !== 'silent'; // 既定は idle=null

const TALK_RESEND_MS = 2000; // 話している間の talk-start 再送
const TALK_TIMEOUT_MS = 5000; // 相手の再送が途絶えたら話し中を解除
const STATS_INTERVAL_MS = 3000;
const SWEEP_INTERVAL_MS = 1000;
const ICE_BATCH_MS = 250; // ICE 候補はまとめて送る（Realtime のメッセージ数を抑える）
const RESTART_GUARD_MS = 5000;
const PENDING_SIGNAL_TTL_MS = 15000;
const PENDING_SIGNAL_MAX = 50;

let me = null;
let started = false;
let registered = false;
let callbacks = {};

let micPromise = null;
let micStream = null;
let micTrack = null;

const peers = new Map(); // id -> peer
const pendingSignals = new Map(); // id -> { t, msgs[] }（在室一覧に載る前に届いた合図）
const remoteTalkers = new Map(); // id -> { role, ts, seen }

let myTalking = false;
let myTs = 0;
let resendTimer = null;
let shownTalkerKey = null; // 画面に出している話し手（id:role）

let statsTimer = null;
let sweepTimer = null;
let sinkEl = null;

// ---------------------------------------------------------------
// マイクと再生の解錠
// ---------------------------------------------------------------

function silentWavUrl() {
  const n = 800; // 8kHz で 0.1 秒
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

// タップの中で無音を再生して、以後の音声再生を許可させる
function unlockPlayback() {
  try {
    const a = new Audio(silentWavUrl());
    a.setAttribute('playsinline', '');
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
  } catch (e) {
    /* 解錠できなくても続行（PTT 操作のたびに再試行する） */
  }
}

// 「通信開始」のタップの中で、await より前に呼ぶこと。
export function prepareMic() {
  if (micPromise) return micPromise;

  const session = navigator.audioSession; // 無い環境では何もしない
  const touchSession = !!session && (AUDIO_MODE === 'B' || AUDIO_MODE === 'C');
  if (touchSession) {
    try {
      session.type = 'play-and-record';
    } catch (e) {
      /* 非対応の値 */
    }
  }

  const audio = DSP_OFF
    ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    : true;
  let request;
  try {
    request = navigator.mediaDevices.getUserMedia({ audio, video: false });
  } catch (e) {
    request = Promise.reject(e);
  }

  unlockPlayback();

  micPromise = request
    .then((stream) => {
      micStream = stream;
      micTrack = stream.getAudioTracks()[0] || null;
      if (micTrack) micTrack.enabled = false; // 起動時は切
      return { ok: !!micTrack };
    })
    .catch((error) => ({ ok: false, error }))
    .then((result) => {
      // audio=B: 取得の後に playback へ
      if (session && AUDIO_MODE === 'B') {
        try {
          session.type = 'playback';
        } catch (e) {
          /* 非対応の値 */
        }
      }
      return result;
    });
  return micPromise;
}

// ---------------------------------------------------------------
// 開始と終了
// ---------------------------------------------------------------

export function start(opts) {
  me = opts.me;
  callbacks = opts;
  started = true;

  if (!registered) {
    registered = true;
    transport.on('signal', onSignal);
    transport.on('talk-start', onTalkStart);
    transport.on('talk-end', onTalkEnd);
    transport.onPeers(onPeers);
    document.addEventListener('visibilitychange', onVisibility);
  }
  statsTimer = setInterval(pollAll, STATS_INTERVAL_MS);
  sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
}

export function stop() {
  if (myTalking) stopTalking();
  started = false;
  clearInterval(statsTimer);
  clearInterval(sweepTimer);
  statsTimer = null;
  sweepTimer = null;
  for (const id of Array.from(peers.keys())) closePeer(id);
  pendingSignals.clear();
  remoteTalkers.clear();
  shownTalkerKey = null;
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  micStream = null;
  micTrack = null;
  micPromise = null;
}

function onVisibility() {
  if (document.visibilityState === 'hidden') {
    if (myTalking) stopTalking(); // 画面を離れたら送信を止める
  } else {
    resumeAudio();
  }
}

// ---------------------------------------------------------------
// 押して話す・送信の排他
// ---------------------------------------------------------------

// (ts, id) が小さい方が勝ち
function beats(a, b) {
  if (a.ts !== b.ts) return a.ts < b.ts;
  return a.id < b.id;
}

function sendTalkStart() {
  transport.send('talk-start', { id: me.id, role: me.role, ts: myTs });
}

function pressStart() {
  if (!started || !micTrack || myTalking) return;
  if (remoteTalkers.size > 0) return; // 他の人が話している間は送信しない
  myTalking = true;
  myTs = Date.now();
  setSending(true);
  sendTalkStart();
  resendTimer = setInterval(sendTalkStart, TALK_RESEND_MS);
  if (callbacks.onLocalTalk) callbacks.onLocalTalk(true);
  updateTalker();
}

function pressEnd() {
  if (myTalking) stopTalking();
}

// 送信の入切。enabled は二重の安全策として常に切り替える。
// idle=null のときは、話している間だけ全 peer の sender に track を付ける（話していない間は RTP を送らない）。
function setSending(on) {
  if (micTrack) micTrack.enabled = on;
  if (!IDLE_NULL) return;
  for (const peer of peers.values()) applySender(peer, on ? micTrack : null);
}

function applySender(peer, track) {
  if (!peer.sender) return;
  peer.sender.replaceTrack(track).catch((e) => console.warn('[voice] replaceTrack failed', peer.id, e));
}

function stopTalking() {
  myTalking = false;
  setSending(false);
  clearInterval(resendTimer);
  resendTimer = null;
  transport.send('talk-end', { id: me.id, role: me.role, ts: myTs });
  if (callbacks.onLocalTalk) callbacks.onLocalTalk(false);
  updateTalker();
}

function onTalkStart(p, from) {
  if (!started || !p || typeof p.ts !== 'number') return;
  remoteTalkers.set(from, { role: p.role, ts: p.ts, seen: Date.now() });
  // 同時に押した場合: 相手が勝ちなら自分は送信を止める（指を離して押し直すまで再開しない）
  if (myTalking && beats({ ts: p.ts, id: from }, { ts: myTs, id: me.id })) stopTalking();
  updateTalker();
}

function onTalkEnd(p, from) {
  if (remoteTalkers.delete(from)) updateTalker();
}

// 画面に出す「話している人」。自分が話している間は出さない（自分のボタンの赤で分かる）
function updateTalker() {
  let top = null;
  if (!myTalking) {
    for (const [id, t] of remoteTalkers) {
      if (!top || beats({ ts: t.ts, id }, top)) top = { id, role: t.role, ts: t.ts };
    }
  }
  const nextKey = top ? top.id + ':' + top.role : null;
  if (nextKey === shownTalkerKey) return;
  shownTalkerKey = nextKey;
  if (callbacks.onTalker) callbacks.onTalker(top ? { id: top.id, role: top.role } : null);
}

function sweep() {
  const now = Date.now();
  let changed = false;
  for (const [id, t] of remoteTalkers) {
    if (now - t.seen > TALK_TIMEOUT_MS) {
      remoteTalkers.delete(id);
      changed = true;
    }
  }
  for (const [id, q] of pendingSignals) {
    if (now - q.t > PENDING_SIGNAL_TTL_MS) pendingSignals.delete(id);
  }
  if (changed) updateTalker();
}

// 押して話すボタンに pointer 操作を結びつける
export function bindPttButton(btn) {
  btn.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try {
      btn.setPointerCapture(e.pointerId); // 指がボタンの外へ動いても pointerup を受け取る
    } catch (err) {
      /* 取れなくても続行 */
    }
    resumeAudio(); // 解錠できていなかった再生を、この操作の中で再試行
    pressStart();
  });
  const release = (e) => {
    e.preventDefault();
    pressEnd();
  };
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('lostpointercapture', pressEnd);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  btn.addEventListener('selectstart', (e) => e.preventDefault());
  btn.addEventListener('dragstart', (e) => e.preventDefault());
}

// ---------------------------------------------------------------
// WebRTC メッシュ
// ---------------------------------------------------------------

function sink() {
  if (!sinkEl) {
    sinkEl = document.createElement('div');
    sinkEl.className = 'audio-sink';
    document.body.appendChild(sinkEl);
  }
  return sinkEl;
}

function resumeAudio() {
  for (const peer of peers.values()) {
    if (peer.audio && peer.audio.paused) {
      const p = peer.audio.play();
      if (p && p.catch) p.catch(() => {});
    }
  }
}

function randomSid() {
  return Math.random().toString(36).slice(2, 10);
}

function onPeers(list) {
  if (!started) return;
  const ids = new Set(list.map((p) => p.id));

  // 在室から消えた相手の接続は閉じる
  for (const id of Array.from(peers.keys())) {
    if (!ids.has(id)) closePeer(id);
  }
  let talkerGone = false;
  for (const id of Array.from(remoteTalkers.keys())) {
    if (!ids.has(id)) {
      remoteTalkers.delete(id);
      talkerGone = true;
    }
  }

  for (const p of list) {
    const existing = peers.get(p.id);
    if (existing) {
      existing.role = p.role;
    } else {
      const peer = createPeer(p.id, p.role);
      drainPending(peer);
      // answer 側で、まだ offer を受け取っていなければ催促する（相手に古い接続が残っている場合の取りこぼし対策）
      if (!peer.closed && !peer.offerer && peer.sid === null) sendSignal(peer, 'need-offer', null);
    }
  }
  if (talkerGone) updateTalker();
  emitStats();
}

function createPeer(id, role) {
  const offerer = me.id < id; // id の辞書順で小さい側が offer を出す
  const peer = {
    id,
    role,
    offerer,
    sid: offerer ? randomSid() : null, // 接続ごとの識別子（相手が作り直したことを見分ける）
    pc: null,
    audio: null,
    sender: null, // idle=null で track を付け外しする RTCRtpSender
    pendingIce: [],
    hasRemote: false,
    chain: Promise.resolve(),
    iceBuf: [],
    iceTimer: null,
    restartAt: 0,
    path: null,
    rtt: null,
    closed: false,
  };

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peer.pc = pc;
  if (offerer) {
    if (IDLE_NULL) {
      // track は付けずに作り、話している間だけ replaceTrack で付ける。マイクが無くても聞くことはできる
      const tr = pc.addTransceiver('audio', {
        direction: micTrack ? 'sendrecv' : 'recvonly',
        streams: micStream ? [micStream] : [],
      });
      peer.sender = tr.sender;
    } else if (micTrack) {
      peer.sender = pc.addTrack(micTrack, micStream);
    } else {
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }
  } else if (!IDLE_NULL && micTrack) {
    // addTrack で作った送信側は、届いた offer の m= 行と対応づけられる
    peer.sender = pc.addTrack(micTrack, micStream);
  }
  // answer 側の idle=null: addTransceiver で作った送信側は offer と対応づけられないため、
  // offer を受けた後に bindAnswerSender で、offer から作られた側を送受信に切り替える。

  pc.addEventListener('icecandidate', (e) => queueIce(peer, e.candidate));
  pc.addEventListener('track', (e) => attachRemote(peer, e));
  pc.addEventListener('connectionstatechange', () => onPcState(peer));
  pc.addEventListener('iceconnectionstatechange', () => onPcState(peer));

  peers.set(id, peer);
  if (offerer) {
    enqueue(peer, () => makeOffer(peer, false));
    if (myTalking) applySender(peer, micTrack); // 話している最中に入ってきた相手にも送る
  }
  return peer;
}

function closePeer(id) {
  const peer = peers.get(id);
  if (!peer) return;
  peer.closed = true;
  peer.sender = null;
  clearTimeout(peer.iceTimer);
  peers.delete(id);
  try {
    peer.pc.close();
  } catch (e) {
    /* 既に閉じている */
  }
  if (peer.audio) {
    peer.audio.srcObject = null;
    peer.audio.remove();
    peer.audio = null;
  }
}

function enqueue(peer, fn) {
  peer.chain = peer.chain
    .then(() => (peer.closed ? null : fn()))
    .catch((e) => console.warn('[voice] negotiation error', peer.id, e));
}

function sendSignal(peer, kind, data) {
  transport.send('signal', { to: peer.id, sid: peer.sid, kind, data });
}

async function makeOffer(peer, iceRestart) {
  const pc = peer.pc;
  const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
  await pc.setLocalDescription(offer);
  sendSignal(peer, 'offer', { type: pc.localDescription.type, sdp: pc.localDescription.sdp });
}

function queueIce(peer, candidate) {
  if (peer.closed) return;
  if (!candidate) {
    flushIce(peer); // 収集の終わり
    return;
  }
  peer.iceBuf.push(typeof candidate.toJSON === 'function' ? candidate.toJSON() : candidate);
  if (!peer.iceTimer) peer.iceTimer = setTimeout(() => flushIce(peer), ICE_BATCH_MS);
}

function flushIce(peer) {
  clearTimeout(peer.iceTimer);
  peer.iceTimer = null;
  if (peer.closed || peer.iceBuf.length === 0) return;
  const batch = peer.iceBuf;
  peer.iceBuf = [];
  sendSignal(peer, 'ice', batch);
}

function onSignal(msg, from) {
  if (!started || !msg || msg.to !== me.id) return; // 宛先以外は無視
  const peer = peers.get(from);
  if (!peer) {
    // 在室一覧に載る前に届いた合図は、載るまで預かる
    let q = pendingSignals.get(from);
    if (!q) {
      q = { t: Date.now(), msgs: [] };
      pendingSignals.set(from, q);
    }
    if (q.msgs.length < PENDING_SIGNAL_MAX) q.msgs.push(msg);
    return;
  }
  routeSignal(peer, msg);
}

function drainPending(peer) {
  const q = pendingSignals.get(peer.id);
  if (!q) return;
  pendingSignals.delete(peer.id);
  for (const msg of q.msgs) routeSignal(peers.get(peer.id) || peer, msg);
}

function routeSignal(peer, msg) {
  if (peer.closed) return;
  if (msg.kind === 'offer') {
    if (peer.offerer) return; // offer を出すのは id が小さい側だけ
    if (peer.sid !== msg.sid) {
      if (peer.sid !== null) {
        // 相手が接続を作り直した。こちらも作り直す
        const role = peer.role;
        closePeer(peer.id);
        peer = createPeer(peer.id, role);
      }
      peer.sid = msg.sid;
    }
  } else if (msg.kind === 'answer') {
    if (!peer.offerer) return;
    if (peer.sid !== msg.sid) return;
  } else if (msg.kind === 'ice') {
    if (peer.sid === null || peer.sid !== msg.sid) return;
  } else if (msg.kind === 'need-offer') {
    // answer 側が offer を待っている。sid の照合はしない（answer 側にはまだ sid が無い）
    if (!peer.offerer) return;
    if (peer.hasRemote) {
      // 既に answer を受け取った接続の相手が、新しい接続で待っている → こちらも作り直して新しい offer を出す
      const role = peer.role;
      closePeer(peer.id);
      createPeer(peer.id, role);
    }
    // hasRemote が false なら、送信中の offer が届くはずなので何もしない
    return;
  } else {
    return;
  }
  enqueue(peer, () => handleSignal(peer, msg));
}

async function handleSignal(peer, msg) {
  const pc = peer.pc;
  if (msg.kind === 'offer') {
    await pc.setRemoteDescription(msg.data);
    peer.hasRemote = true;
    bindAnswerSender(peer);
    await flushPendingIce(peer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendSignal(peer, 'answer', { type: pc.localDescription.type, sdp: pc.localDescription.sdp });
  } else if (msg.kind === 'answer') {
    await pc.setRemoteDescription(msg.data);
    peer.hasRemote = true;
    await flushPendingIce(peer);
  } else if (msg.kind === 'ice') {
    const list = Array.isArray(msg.data) ? msg.data : [msg.data];
    for (const c of list) {
      if (peer.hasRemote) await pc.addIceCandidate(c).catch(() => {});
      else peer.pendingIce.push(c);
    }
  }
}

// answer 側（idle=null）: offer から作られた音声の送受信を、送信ありに切り替え、sender を持っておく。
// track は話している間だけ付ける。
function bindAnswerSender(peer) {
  if (!IDLE_NULL || peer.sender || !micTrack) return;
  const tr = peer.pc
    .getTransceivers()
    .find((t) => t.mid !== null && t.receiver && t.receiver.track && t.receiver.track.kind === 'audio');
  if (!tr) return;
  tr.direction = 'sendrecv';
  peer.sender = tr.sender;
  if (myTalking) applySender(peer, micTrack);
}

async function flushPendingIce(peer) {
  const list = peer.pendingIce;
  peer.pendingIce = [];
  for (const c of list) await peer.pc.addIceCandidate(c).catch(() => {});
}

function pcState(peer) {
  return peer.pc.connectionState || peer.pc.iceConnectionState;
}

function onPcState(peer) {
  if (peer.closed) return;
  // 接続が failed になったら offer 側が ICE restart
  if (pcState(peer) === 'failed' && peer.offerer && Date.now() - peer.restartAt > RESTART_GUARD_MS) {
    peer.restartAt = Date.now();
    enqueue(peer, () => makeOffer(peer, true));
  }
  emitStats();
}

function attachRemote(peer, ev) {
  if (ev.track.kind !== 'audio' || peer.closed) return;
  const stream = (ev.streams && ev.streams[0]) || new MediaStream([ev.track]);
  if (!peer.audio) {
    const a = document.createElement('audio');
    a.autoplay = true;
    a.playsInline = true;
    a.setAttribute('playsinline', '');
    sink().appendChild(a);
    peer.audio = a;
  }
  peer.audio.srcObject = stream;
  const p = peer.audio.play();
  if (p && p.catch) p.catch(() => {}); // 解錠が足りなければ、次の操作で resumeAudio が再試行
}

// ---------------------------------------------------------------
// 接続状態（試作用）
// ---------------------------------------------------------------

async function pollOne(peer) {
  if (peer.closed) return;
  try {
    const report = await peer.pc.getStats();
    const byId = new Map();
    report.forEach((r) => byId.set(r.id, r));

    let pair = null;
    report.forEach((r) => {
      if (r.type === 'transport' && r.selectedCandidatePairId) {
        pair = byId.get(r.selectedCandidatePairId) || pair;
      }
    });
    if (!pair) {
      report.forEach((r) => {
        if (r.type === 'candidate-pair' && (r.selected || (r.nominated && r.state === 'succeeded'))) {
          pair = r;
        }
      });
    }
    if (pair) {
      const local = byId.get(pair.localCandidateId);
      const remote = byId.get(pair.remoteCandidateId);
      const relay =
        (local && local.candidateType === 'relay') || (remote && remote.candidateType === 'relay');
      peer.path = relay ? 'relay' : 'direct';
      peer.rtt =
        typeof pair.currentRoundTripTime === 'number'
          ? Math.round(pair.currentRoundTripTime * 1000)
          : null;
    }
  } catch (e) {
    /* 取得に失敗したら前回の値のまま */
  }
}

async function pollAll() {
  await Promise.all(Array.from(peers.values(), pollOne));
  emitStats();
}

function emitStats() {
  if (!callbacks.onStats) return;
  const list = Array.from(peers.values(), (p) => ({
    id: p.id,
    role: p.role,
    state: pcState(p),
    path: p.path,
    rtt: p.rtt,
  }));
  callbacks.onStats(list);
}
