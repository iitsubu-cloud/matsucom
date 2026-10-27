// Leaflet の地図と印。Leaflet は index.html で CDN から読み込んだグローバル L を使う。
//   initMap(el) / setMarker(id, role, lat, lng, isSelf) / removeMarker(id)
//   textColorFor(hex) … 背景色の上に載せる文字色（白か黒）

import { ROLE_COLORS } from './config.js?v=1';

// 国土地理院の標準地図タイル（出典の表示が必要）
const TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>';

const DEFAULT_CENTER = [36.2, 138.25]; // 位置が分かるまでは日本全体
const DEFAULT_ZOOM = 5;
const FIT_MAX_ZOOM = 16;

let map = null;
let autoFit = true; // 利用者が地図を触るまでは、全員が入るように自動で合わせる
const markers = new Map(); // id -> L.marker

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

  // 画面の大きさが変わったとき（iOS のバー出入り、回転）に地図を合わせ直す
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => map.invalidateSize()).observe(el);
  }
  map.invalidateSize();
  return map;
}

function buildIcon(role, isSelf) {
  const color = ROLE_COLORS[role] || '#757575';
  const el = document.createElement('div');

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
    return L.divIcon({ html: el, className: '', iconSize: [48, 48], iconAnchor: [24, 24] });
  }

  // 班＝色付きの丸に数字
  el.className = 'mk mk-group' + (isSelf ? ' mk-self' : '');
  el.style.background = color;
  el.style.color = textColorFor(color);
  el.textContent = /^g(\d+)$/.test(role) ? role.slice(1) : '';
  return L.divIcon({ html: el, className: '', iconSize: [34, 34], iconAnchor: [17, 17] });
}

function fitAll() {
  if (!map || !autoFit || markers.size === 0) return;
  const points = Array.from(markers.values(), (m) => m.getLatLng());
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

export function setMarker(id, role, lat, lng, isSelf) {
  if (!map || typeof lat !== 'number' || typeof lng !== 'number') return;
  let marker = markers.get(id);
  if (marker && marker.__role !== role) {
    marker.remove();
    markers.delete(id);
    marker = null;
  }
  if (!marker) {
    marker = L.marker([lat, lng], {
      icon: buildIcon(role, isSelf),
      interactive: false,
      keyboard: false,
      zIndexOffset: isSelf ? 1000 : role === 'taiko' ? 500 : 0,
    }).addTo(map);
    marker.__role = role;
    markers.set(id, marker);
  } else {
    marker.setLatLng([lat, lng]);
  }
  fitAll();
}

export function removeMarker(id) {
  const marker = markers.get(id);
  if (!marker) return;
  marker.remove();
  markers.delete(id);
}
