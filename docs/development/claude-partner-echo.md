# 実機1台での試験: 指揮役が「相手役」になってオウム返しする

ユーザーの端末が1台しかないとき、指揮役（Claude）が**ブラウザペインの公開版**から別の役割で参加し、相手役をする。2026-11-06（セッション2）に iPhone 1台で実施し、動作を確認した。

## できること・できないこと

| 項目 | 可否 |
|---|---|
| 声の行き来（ユーザー→指揮役→ユーザー） | できる。ユーザーが話し終わると約1.5秒後に、届いた声をそのまま送り返す |
| 話し始めの欠け | できる。返ってきた声を聞けば分かる。指揮役の側でも、合図から声が届くまでの時間を数値で取れる |
| 受信の音量・スピーカーか受話口か | できる（ユーザーが返ってきた声で判断） |
| 直接か中継か | **参考にならない**。Mac が iPhone のテザリングだと、同じ回線の内側どうしでほぼ必ず「直接」になる |
| 声のループ | できない。指揮役の側は Mac のスピーカーから鳴らさない（自分の声が遅れて聞こえて紛らわしいため） |

## 手順

1. `preview_start` で `https://iitsubu-cloud.github.io/matsucom/` を開く
2. **参加前に**スクリプト1を `javascript_tool` で実行する（マイクと位置の差し替え、相手役の役割ボタンを押す。下は1班）
3. 合言葉を `computer` の `type` で入れ、「通信開始」を `computer` の `left_click` で押す（本物のクリックにすること。AudioContext がユーザー操作の中で作られる）
4. つながったら（左下に相手が出たら）スクリプト2を実行する（オウム返し）
5. ユーザーへの依頼: 「押した瞬間に『いち、に、さん、し、ご』と数え、離す。返ってきた声がどの数字から聞こえるか」
6. 集計は `window.__test.levels`（100ms ごとの受信音量 `rms` と、太鼓台が話しているか）から取る。0.01 を超えたら声とみなした

位置は、相手（太鼓台）の印が届いた時点で、その北東約150m（緯度・経度とも +0.0012）に置く。相手の座標は出力しないこと。

## スクリプト1（参加前）

```js
(() => {
  const S = window.__test = { levels: [], pos: null, clips: [], rec: null };
  navigator.mediaDevices.getUserMedia = async () => {
    const ctx = S.ctx = new AudioContext();
    const osc = ctx.createOscillator(); osc.frequency.value = 660;
    const g = ctx.createGain(); g.gain.value = 0.5;
    const dst = ctx.createMediaStreamDestination();
    osc.connect(g); g.connect(dst); osc.start();
    return dst.stream;
  };
  let geoOk = null;
  const feed = () => { if (geoOk && S.pos) geoOk({ coords: { latitude: S.pos.lat, longitude: S.pos.lng, accuracy: 10 }, timestamp: Date.now() }); };
  navigator.geolocation.watchPosition = (ok) => { geoOk = ok; feed(); return setInterval(feed, 3000); };
  navigator.geolocation.clearWatch = (id) => clearInterval(id);
  L.Map.addInitHook(function () { window.__map = this; });
  setInterval(() => {
    if (!S.pos && window.__map) {
      window.__map.eachLayer((l) => {
        if (!S.pos && l instanceof L.Marker && l.options.zIndexOffset === 500) {
          const ll = l.getLatLng();
          S.pos = { lat: ll.lat + 0.0012, lng: ll.lng + 0.0012 };
          feed();
        }
      });
    }
    document.querySelectorAll('audio').forEach((a) => {
      if (!a.srcObject || !S.ctx) return;
      if (a !== S.playback) a.muted = true;
      if (a.__an && a.__an.stream === a.srcObject) return;
      const src = S.ctx.createMediaStreamSource(a.srcObject);
      const an = S.ctx.createAnalyser(); an.fftSize = 2048; src.connect(an);
      a.__an = { an, stream: a.srcObject, buf: new Float32Array(2048) };
    });
  }, 500);
  setInterval(() => {
    const banner = document.getElementById('talker-banner');
    const talking = !!(banner && !banner.hidden && banner.textContent.includes('太鼓台'));
    let rms = 0, stream = null;
    document.querySelectorAll('audio').forEach((a) => {
      if (!a.__an) return;
      a.__an.an.getFloatTimeDomainData(a.__an.buf);
      let s = 0; for (const v of a.__an.buf) s += v * v;
      const r = Math.sqrt(s / a.__an.buf.length);
      if (r >= rms) { rms = r; stream = a.__an.stream; }
    });
    if (talking && !S.rec && stream) {
      const chunks = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = () => S.clips.push({ blob: new Blob(chunks, { type: mr.mimeType }), at: Date.now() });
      mr.start();
      S.rec = mr;
    } else if (!talking && S.rec) {
      S.rec.stop(); S.rec = null;
    }
    S.levels.push({ t: Date.now(), talking, rms });
    if (S.levels.length > 6000) S.levels.shift();
  }, 100);
  document.querySelector('[data-role=g1]').click();
  return 'ready ' + typeof L;
})()
```

## スクリプト2（接続後・オウム返し）

送信側の `replaceTrack` を差し替え、話すときに付くトラックを指揮役が鳴らす音（`S.out`）にする。受信した声は ScriptProcessor で直近40秒を貯め、相手が話し終わったら「話し始めの1秒前〜話し終わりの0.5秒後」（最長15秒）を送り返す。押してから0.6秒待って流し始めるので、返す側の話し始めで欠けることはない。

```js
(() => {
  const S = window.__test;
  const ctx = S.ctx;
  S.out = ctx.createMediaStreamDestination();
  S.outTrack = S.out.stream.getAudioTracks()[0];
  const osc = ctx.createOscillator(); osc.frequency.value = 660;
  S.toneGain = ctx.createGain(); S.toneGain.gain.value = 0;
  osc.connect(S.toneGain); S.toneGain.connect(S.out); osc.start();
  const orig = RTCRtpSender.prototype.replaceTrack;
  RTCRtpSender.prototype.replaceTrack = function (t) { return orig.call(this, t ? S.outTrack : t); };

  S.ring = []; S.tapStream = null; S.talks = []; S.echoes = []; S.echo = true; S.busyEcho = false;
  const ensureTap = () => {
    const a = [...document.querySelectorAll('audio')].find((x) => x.srcObject && x.srcObject.getAudioTracks().length);
    if (!a || S.tapStream === a.srcObject) return;
    S.tapStream = a.srcObject;
    const src = ctx.createMediaStreamSource(a.srcObject);
    const sp = ctx.createScriptProcessor(4096, 1, 1);
    const z = ctx.createGain(); z.gain.value = 0;
    src.connect(sp); sp.connect(z); z.connect(ctx.destination);
    sp.onaudioprocess = (e) => {
      const now = performance.now();
      S.ring.push({ t: now, d: new Float32Array(e.inputBuffer.getChannelData(0)) });
      while (S.ring.length && now - S.ring[0].t > 40000) S.ring.shift();
    };
    S.sp = sp;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const press = (down) => {
    const btn = document.getElementById('ptt-btn');
    const r = btn.getBoundingClientRect();
    btn.dispatchEvent(new PointerEvent(down ? 'pointerdown' : 'pointerup', { bubbles: true, pointerId: 1, isPrimary: true, button: 0, clientX: r.x + 10, clientY: r.y + 10 }));
  };
  S.press = press;
  const echo = async (c) => {
    const from = c.start - 1000, to = Math.min(c.end + 500, c.start + 15000);
    const chunks = S.ring.filter((x) => x.t >= from && x.t <= to + 100);
    if (!chunks.length) { S.echoes.push({ skipped: 'no audio captured' }); return; }
    const len = chunks.reduce((n, x) => n + x.d.length, 0);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    let off = 0; for (const x of chunks) { buf.copyToChannel(x.d, 0, off); off += x.d.length; }
    const btn = document.getElementById('ptt-btn');
    if (btn.classList.contains('busy')) { S.echoes.push({ skipped: 'busy' }); return; }
    S.busyEcho = true;
    press(true);
    await sleep(600);
    const node = ctx.createBufferSource(); node.buffer = buf; node.connect(S.out);
    await new Promise((r) => { node.onended = r; node.start(); });
    await sleep(300);
    press(false);
    S.busyEcho = false;
    S.echoes.push({ at: Date.now(), sec: +(len / ctx.sampleRate).toFixed(1) });
  };
  let cur = null;
  setInterval(() => {
    ensureTap();
    const b = document.getElementById('talker-banner');
    const talking = !!(b && !b.hidden && b.textContent.includes('太鼓台'));
    const now = performance.now();
    if (talking && !cur) cur = { start: now };
    else if (!talking && cur) {
      cur.end = now; S.talks.push(cur); const c = cur; cur = null;
      if (S.echo && c.end - c.start > 300 && !S.busyEcho) setTimeout(() => echo(c).catch((e) => { S.busyEcho = false; S.echoErr = String(e); }), 800);
    }
  }, 50);
  return 'echo ready, tapping=' + !!S.tapStream;
})()
```

## 注意

- スクリプト1の `MediaRecorder` の部分はスクリプト2で不要になった名残（害はない）
- 相手が太鼓台以外なら、`includes('太鼓台')` と `zIndexOffset === 500`（太鼓台の印）を相手に合わせて変える
- 終わったらタブを閉じて部屋から抜ける
