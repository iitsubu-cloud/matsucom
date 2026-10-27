// 画面遷移と全体の配線。
//   起動画面（役割・合言葉）→「通信開始」→ メイン画面（地図・押して話す）

import { GROUP_COUNT, MAX_GROUPS, ROLE_COLORS } from './config.js?v=2';
import * as transport from './transport.js?v=2';
import * as voice from './voice.js?v=2';
import * as geo from './location.js?v=2';
import * as mapView from './map.js?v=2';

const $ = (id) => document.getElementById(id);

const screenStart = $('screen-start');
const screenMain = $('screen-main');
const roleButtonsEl = $('role-buttons');
const passInput = $('passphrase');
const startBtn = $('start-btn');
const startErrorEl = $('start-error');
const mapEl = $('map');
const bannerEl = $('talker-banner');
const pttBtn = $('ptt-btn');
const modeBadgeEl = $('mode-badge');
const noticeEl = $('notice');
const peerStatusEl = $('peer-status');

// ---------------------------------------------------------------
// 役割
// ---------------------------------------------------------------

const groupCount = Math.max(0, Math.min(GROUP_COUNT, MAX_GROUPS));
const ROLE_IDS = ['taiko'];
for (let i = 1; i <= groupCount; i++) ROLE_IDS.push('g' + i);

function roleLabel(role) {
  if (role === 'taiko') return '太鼓台';
  const m = /^g([1-9]\d*)$/.exec(String(role));
  return m ? m[1] + '班' : '?';
}

function roleOrder(role) {
  if (role === 'taiko') return 0;
  const m = /^g([1-9]\d*)$/.exec(String(role));
  return m ? Number(m[1]) : 999;
}

function isValidRole(role) {
  return role === 'taiko' || /^g[1-9]\d*$/.test(String(role));
}

// ---------------------------------------------------------------
// 起動画面
// ---------------------------------------------------------------

let selectedRole = null;
let starting = false;

function buildRoleButtons() {
  for (const role of ROLE_IDS) {
    const color = ROLE_COLORS[role] || '#757575';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'role-btn' + (role === 'taiko' ? ' role-btn-wide' : '');
    btn.dataset.role = role;
    btn.setAttribute('aria-pressed', 'false');
    btn.style.setProperty('--c', color);
    btn.style.setProperty('--t', mapView.textColorFor(color));
    btn.textContent = roleLabel(role);
    btn.addEventListener('click', () => selectRole(role));
    roleButtonsEl.appendChild(btn);
  }
}

function selectRole(role) {
  selectedRole = role;
  for (const btn of roleButtonsEl.children) {
    btn.setAttribute('aria-pressed', String(btn.dataset.role === role));
  }
  updateStartButton();
}

function canStart() {
  return !!selectedRole && passInput.value.trim() !== '';
}

function updateStartButton() {
  startBtn.disabled = starting || !canStart();
}

function showStartError(text) {
  startErrorEl.textContent = text;
  startErrorEl.hidden = !text;
}

// ---------------------------------------------------------------
// 画面の常時点灯
// ---------------------------------------------------------------

let wakeLock = null;
let running = false;

async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  if (wakeLock && !wakeLock.released) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) {
    wakeLock = null; // 取れなくても続行
  }
}

function releaseWakeLock() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && running) acquireWakeLock();
});

// ---------------------------------------------------------------
// メイン画面の表示
// ---------------------------------------------------------------

const notices = new Map(); // key -> text

function setNotice(key, text) {
  if (text) notices.set(key, text);
  else notices.delete(key);
  const lines = Array.from(notices.values(), (t) => {
    const d = document.createElement('div');
    d.textContent = t;
    return d;
  });
  noticeEl.replaceChildren(...lines);
}

function showTalker(talker) {
  // 他の人が話している間は、押して話すボタンを灰色にする（自分が話している間は talker が来ないので赤のまま）
  pttBtn.classList.toggle('busy', !!talker);
  if (!talker) {
    bannerEl.hidden = true;
    bannerEl.textContent = '';
    return;
  }
  bannerEl.textContent = roleLabel(talker.role) + 'が話しています';
  bannerEl.hidden = false;
}

function setPttActive(on) {
  pttBtn.classList.toggle('talking', on);
}

function formatPeer(p) {
  const name = roleLabel(p.role);
  if (p.state === 'connected' || p.state === 'completed') {
    if (p.path === 'direct' || p.path === 'relay') {
      const path = p.path === 'relay' ? '中継' : '直接';
      const rtt = p.rtt !== null && p.rtt !== undefined ? ' ' + p.rtt + 'ms' : '';
      return name + ': ' + path + rtt;
    }
    return name + ': 接続中';
  }
  if (p.state === 'failed' || p.state === 'disconnected' || p.state === 'closed') {
    return name + ': 切断';
  }
  return name + ': 接続中';
}

function renderPeerStatus(list) {
  const sorted = list.slice().sort((a, b) => roleOrder(a.role) - roleOrder(b.role));
  peerStatusEl.replaceChildren(
    ...sorted.map((p) => {
      const d = document.createElement('div');
      d.textContent = formatPeer(p);
      return d;
    })
  );
}

// ---------------------------------------------------------------
// 全体の配線
// ---------------------------------------------------------------

let me = null;
let mapReady = false;
let selfPos = null;
let knownPeerIds = new Set();
let wired = false;
const pendingLocs = new Map(); // 地図の準備前に届いた位置 role -> { lat, lng }（他の人の印は役割ごとに1つ）

function placeSelf() {
  if (mapReady && selfPos) mapView.setMarker(me.role, selfPos.lat, selfPos.lng, true);
}

function wireTransport() {
  if (wired) return;
  wired = true;

  // 他の人の位置
  transport.on('loc', (p, from) => {
    if (!p || !isValidRole(p.role)) return;
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
    if (!mapReady) {
      pendingLocs.set(p.role, { lat: p.lat, lng: p.lng });
      return;
    }
    mapView.setMarker(p.role, p.lat, p.lng, false);
  });

  // 在室の変化: 新しく入った人には自分の位置をすぐ送る。いなくなった人の印は消さず、薄くして最後の位置を残す
  transport.onPeers((list) => {
    const ids = new Set(list.map((p) => p.id));
    let someoneNew = false;
    for (const id of ids) if (!knownPeerIds.has(id)) someoneNew = true;
    knownPeerIds = ids;
    mapView.setPresentRoles(list.map((p) => p.role));
    if (someoneNew) geo.sendNow();
  });
}

function teardown() {
  running = false;
  voice.stop();
  geo.stop();
  releaseWakeLock();
  transport.leave();
  knownPeerIds = new Set();
  mapView.setPresentRoles([]);
  pendingLocs.clear();
}

async function onStart() {
  if (starting || !canStart()) return;
  starting = true;
  updateStartButton();
  showStartError('');

  const passphrase = passInput.value.trim();
  me = { id: crypto.randomUUID(), role: selectedRole };
  running = true;
  selfPos = null;

  // ---- ここまで同期。以下の3つは「通信開始」のタップの中で始める ----
  // (1) マイクの取得と再生の解錠  (2) 画面の常時点灯  (3) 位置の取得（許可のダイアログ）
  const micReady = voice.prepareMic();
  acquireWakeLock();
  geo.start({
    onSelf: (pos) => {
      selfPos = pos;
      setNotice('geo', '');
      placeSelf();
    },
    onSend: (pos) =>
      transport.send('loc', { role: me.role, lat: pos.lat, lng: pos.lng, acc: pos.acc, ts: pos.ts }),
    onError: () => {
      if (!selfPos) setNotice('geo', '位置が使えません');
    },
  });
  // ------------------------------------------------------------------

  try {
    const mic = await micReady;
    const room = await transport.roomName(passphrase);

    wireTransport();
    voice.start({ me, onTalker: showTalker, onLocalTalk: setPttActive, onStats: renderPeerStatus });
    await transport.join(room, me);

    // メイン画面へ
    screenStart.hidden = true;
    screenMain.hidden = false;
    modeBadgeEl.hidden = !transport.isLocal;
    mapView.initMap(mapEl);
    mapReady = true;
    for (const [role, l] of pendingLocs) mapView.setMarker(role, l.lat, l.lng, false);
    pendingLocs.clear();

    if (mic.ok) {
      voice.bindPttButton(pttBtn);
    } else {
      pttBtn.disabled = true;
      setNotice('mic', 'マイクが使えません');
    }

    placeSelf();
    geo.sendNow(); // 参加前に取れていた位置があれば送る
  } catch (err) {
    console.error('[app] start failed', err);
    teardown();
    starting = false;
    showStartError('接続できませんでした');
    updateStartButton();
  }
}

// 画面を閉じるとき、在室から外れる
window.addEventListener('pagehide', () => {
  transport.leave();
});

// 戻るボタンなどでキャッシュ（bfcache）から復元されたときは、通信が切れたままなので読み込み直す
window.addEventListener('pageshow', (e) => {
  if (e.persisted) location.reload();
});

buildRoleButtons();
passInput.addEventListener('input', updateStartButton);
startBtn.addEventListener('click', onStart);
updateStartButton();
