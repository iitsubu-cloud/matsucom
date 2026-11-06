// Leaflet の地図と印。Leaflet は index.html で CDN から読み込んだグローバル L を使う。
//   initMap(el)
//   setMarker(role, lat, lng, isSelf) … 他の人の印は役割ごとに1つ（再読み込みで id が変わっても二重にならない）。自分の印は別に持つ
//   setPresentRoles(roles)            … 在室している役割の一覧（自分を除く）。いない役割の印は薄くして最後の位置を残す
//   textColorFor(hex)                 … 背景色の上に載せる文字色（白か黒）

import { ROLE_COLORS } from './config.js?v=3';

// 国土地理院の標準地図タイル（出典の表示が必要）
const TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>';

const DEFAULT_CENTER = [36.2, 138.25]; // 位置が分かるまでは日本全体
const DEFAULT_ZOOM = 5;
const FIT_MAX_ZOOM = 16;

// 電波が切れた人の「最後の位置」の扱い
const STALE_MS = 60000; // 最後に位置を受け取ってからこれを超えたら薄くする（位置は最低30秒ごとに送られる）
const ABSENT_GRACE_MS = 5000; // 在室一覧にいなくても、位置を受け取った直後はこの間だけ薄くしない（在室の反映が位置より遅れることがあるため）
const REFRESH_MS = 15000; // 「N分前」などの表示を更新する間隔
const SELF_KEY = '__self__';

let map = null;
let autoFit = true; // 利用者が地図を触るまでは、全員が入るように自動で合わせる
const markers = new Map(); // 役割（自分は SELF_KEY）-> { marker, role, isSelf, lastSeen, mk, label }
let presentRoles = new Set(); // 在室している役割
let soonTimer = null;

export function textColorFor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  // 知覚輝度
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111' : '#fff';
}

export function initMap(el) {
  if (map) return map;
  map = L.map(el, {
    zoomControl: false,
    attributionControl: false,
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    zoomSnap: 0.5,
  });
  L.tileLayer(TILE_URL, { minZoom: 5, maxZoom: 18, maxNativeZoom: 18 }).addTo(map);
  L.control.attribution({ prefix: false }).addAttribution(TILE_ATTRIBUTION).addTo(map);

  // 利用者が触ったら自動の位置合わせをやめる
  const stopAutoFit = () => {
    autoFit = false;
  };
  el.addEventListener('pointerdown', stopAutoFit);
  el.addEventListener('wheel', stopAutoFit, { passive: true });

  setInterval(refreshFade, REFRESH_MS);

  // 画面の大きさが変わったとき（iOS のバー出入り、回転）に地図を合わせ直す
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => map.invalidateSize()).observe(el);
  }
  map.invalidateSize();
  return map;
}

// 印の DOM を作る。戻り値の mk（印本体）と label（「N分前」）は、薄くする処理で更新する。
function buildIcon(role, isSelf) {
  const color = ROLE_COLORS[role] || '#757575';
  const wrap = document.createElement('div');
  wrap.className = 'mk-wrap';
  const el = document.createElement('div');
  const label = document.createElement('div');
  label.className = 'mk-label';
  label.hidden = true;
  wrap.append(el, label);
  const icon = (size) =>
    L.divIcon({ html: wrap, className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });

  if (role === 'taiko') {
    // 太鼓台＝黄色の大きな印（星形）
    el.className = 'mk mk-taiko' + (isSelf ? ' mk-self' : '');
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 48 48');
    const star = document.createElementNS(ns, 'polygon');
    star.setAttribute(
      'points',
      '24,2 30.5,17 46,18.5 34.2,29 37.8,44.5 24,36.5 10.2,44.5 13.8,29 2,18.5 17.5,17'
    );
    star.setAttribute('fill', color);
    star.setAttribute('stroke', '#222');
    star.setAttribute('stroke-width', '3');
    star.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(star);
    el.appendChild(svg);
    return { icon: icon(48), mk: el, label };
  }

  // 班＝色付きの丸に数字
  el.className = 'mk mk-group' + (isSelf ? ' mk-self' : '');
  el.style.background = color;
  el.style.color = textColorFor(color);
  el.textContent = /^g(\d+)$/.test(role) ? role.slice(1) : '';
  return { icon: icon(34), mk: el, label };
}

function fitAll() {
  if (!map || !autoFit || markers.size === 0) return;
  const points = Array.from(markers.values(), (m) => m.marker.getLatLng());
  if (points.length === 1) {
    map.setView(points[0], FIT_MAX_ZOOM, { animate: false });
  } else {
    map.fitBounds(L.latLngBounds(points), {
      padding: [60, 60],
      maxZoom: FIT_MAX_ZOOM,
      animate: false,
    });
  }
}

export function setMarker(role, lat, lng, isSelf) {
  if (!map || typeof lat !== 'number' || typeof lng !== 'number') return;
  const key = isSelf ? SELF_KEY : role;
  let m = markers.get(key);
  if (!m) {
    const built = buildIcon(role, isSelf);
    const marker = L.marker([lat, lng], {
      icon: built.icon,
      interactive: false,
      keyboard: false,
      zIndexOffset: isSelf ? 1000 : role === 'taiko' ? 500 : 0,
    }).addTo(map);
    m = { marker, role, isSelf, lastSeen: Date.now(), mk: built.mk, label: built.label };
    markers.set(key, m);
  } else {
    m.marker.setLatLng([lat, lng]);
    m.lastSeen = Date.now(); // 新しい位置が届いたら、通常の表示に戻る
  }
  refreshFade();
  fitAll();
}

export function setPresentRoles(roles) {
  presentRoles = new Set(roles);
  refreshFade();
}

// 薄くする条件: 在室一覧にいない、または最後に位置を受け取ってから60秒を超えた。薄いとき「N分前」を添える。
function refreshFade() {
  const now = Date.now();
  let waitingForPresence = false;
  for (const m of markers.values()) {
    if (m.isSelf) continue;
    const elapsed = now - m.lastSeen;
    const present = presentRoles.has(m.role);
    const absent = !present && elapsed > ABSENT_GRACE_MS;
    if (!present && !absent) waitingForPresence = true;
    const faded = absent || elapsed > STALE_MS;
    m.mk.classList.toggle('mk-faded', faded);
    if (faded) {
      const minutes = Math.max(1, Math.floor(elapsed / 60000));
      m.label.textContent = minutes + '分前';
      m.label.hidden = false;
    } else {
      m.label.hidden = true;
    }
  }
  // 位置を受け取った直後で在室に載っていない印は、猶予が過ぎたら判定し直す
  if (waitingForPresence && !soonTimer) {
    soonTimer = setTimeout(() => {
      soonTimer = null;
      refreshFade();
    }, ABSENT_GRACE_MS + 100);
  }
}
