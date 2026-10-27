// 位置の取得と送信の間引き。
// 送信は「前回送信から10m以上動いた、かつ5秒以上経過」または「30秒経過」のとき。
//   start({ onSelf, onSend, onError }) … 「通信開始」のタップの中で呼ぶ（許可のダイアログが出る）
//     onSelf(pos)  … 位置が取れるたびに呼ぶ（自分の印用）
//     onSend(pos)  … 送信すべきときに呼ぶ。pos = { lat, lng, acc, ts }
//     onError(err) … 取得に失敗したとき（許可の拒否など）。声は使える
//   sendNow() … 最新の位置をすぐ送る（新しく入った人向け）
//   stop()

const MIN_DISTANCE_M = 10;
const MIN_INTERVAL_MS = 5000;
const MAX_INTERVAL_MS = 30000;
const CHECK_INTERVAL_MS = 1000;

let watchId = null;
let timer = null;
let latest = null; // 最新の位置
let lastSent = null; // 最後に送った位置（t = 送信時刻）
let sendCb = null;

function distanceM(a, b) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function doSend() {
  if (!latest || !sendCb) return;
  lastSent = { lat: latest.lat, lng: latest.lng, t: Date.now() };
  sendCb(latest);
}

function maybeSend() {
  if (!latest) return;
  if (!lastSent) {
    doSend(); // 最初の1回
    return;
  }
  const elapsed = Date.now() - lastSent.t;
  if (elapsed >= MAX_INTERVAL_MS) {
    doSend();
  } else if (elapsed >= MIN_INTERVAL_MS && distanceM(lastSent, latest) >= MIN_DISTANCE_M) {
    doSend();
  }
}

export function start({ onSelf, onSend, onError }) {
  stop();
  sendCb = onSend;

  if (!('geolocation' in navigator)) {
    if (onError) onError(new Error('geolocation unavailable'));
    return;
  }

  watchId = navigator.geolocation.watchPosition(
    (p) => {
      latest = {
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        acc: p.coords.accuracy,
        ts: Date.now(),
      };
      if (onSelf) onSelf(latest);
      maybeSend();
    },
    (err) => {
      if (onError) onError(err);
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 60000 }
  );

  // 動かないときの30秒再送と、5秒待ちの間に動いた分の送信
  timer = setInterval(maybeSend, CHECK_INTERVAL_MS);
}

export function sendNow() {
  doSend();
}

export function stop() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  if (timer !== null) clearInterval(timer);
  watchId = null;
  timer = null;
  latest = null;
  lastSent = null;
  sendCb = null;
}
