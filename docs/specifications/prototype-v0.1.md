# 試作 v0.1 仕様 — 地図に全員の位置＋全員宛ての「押して話す」

2026-10-27 ユーザー承認（構成 A・送信の排他 B・画面案 C）。構成の根拠は [architecture-research-2026-10.md](architecture-research-2026-10.md)。

## 目的

実機（iPhone・iPad・Android、携帯回線）で次の4点を確かめるための最小版。

1. iPhone でマイク使用中に受信音が受話口から小さく出ないか（音声セッションの切り替え方を URL で選んで比較）
2. 起動ごとのマイク許可の聞き直しが運用上耐えられるか
3. 携帯回線どうしで直接つながる割合と遅延
4. 近くの端末どうしの声のループ（送信の排他で抑えられるか）

## 範囲

- 含む: 役割の選択、合言葉、通信開始、地図に全員の位置、全員宛ての押して話す、送信の排他、話している人の表示、試作用の接続状態表示、画面の常時点灯
- 含まない: 個別発信、呼び出し音、文字、写真・ファイル、圏外中の後送り、TURN の資格情報の発行サーバー

## 画面（承認済みの案。文言を勝手に変えない）

### 起動画面
- 見出し（アプリ名は未定なので仮に「祭り連絡」）
- 自分の役割を大きなボタンで選ぶ: 「太鼓台」「1班」「2班」…「N班」（N は config.js の `GROUP_COUNT`、既定 4、最大 `MAX_GROUPS` = 8）
- 合言葉の入力欄
- 「通信開始」ボタン（役割と合言葉が揃うまで押せない）。押すとマイクと位置の許可がまとめて出る

### メイン画面
- 画面の大部分が地図
- 太鼓台＝黄色の大きな印、班＝色付きの丸に数字。色: 1班 赤、2班 青、3班 緑、4班 オレンジ（5〜8班の色は承認待ち。仮に 5 紫、6 水色、7 茶、8 ピンク）
- 自分の印も地図に出す
- 下に大きな「押して話す」ボタン。押している間は赤。離すと止まる
- 誰かが話している間は画面の上に「◯◯が話しています」（◯◯＝役割名）。その間、自分のボタンは押しても送信しない
- 試作の間だけ: 画面の隅に小さく、相手ごとに「1班: 直接 45ms」「2班: 中継 120ms」のような接続状態

## 技術仕様

### ファイル構成（ビルド工程なし、ES Modules、相対パス）
```
index.html
css/style.css
js/config.js     … SUPABASE_URL, SUPABASE_ANON_KEY, ICE_SERVERS, GROUP_COUNT, MAX_GROUPS, ROLE_COLORS
js/app.js        … 画面遷移と全体の配線
js/transport.js  … Supabase Realtime と、テスト用の BroadcastChannel を同じ口で扱う
js/voice.js      … マイク、WebRTC メッシュ、押して話す、送信の排他、接続状態の取得
js/location.js   … 位置の取得と送信の間引き
js/map.js        … Leaflet の地図と印
```
- index.html の css/js 参照には `?v=1` を付ける（変更のたびに +1。ComChat の運用）
- 外部ライブラリは CDN のみ: Leaflet 1.9.4（cdnjs）、supabase-js v2（`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm`）

### 接続（transport.js）
- 部屋名＝`matsuri-` ＋ 合言葉の SHA-256 の16進先頭16文字（合言葉そのものは送らない）
- Supabase: Realtime Broadcast（`self: false`）で全メッセージを送る。Presence で在室（id, role）を管理。v0.1 ではサインインしない（公開キーのみ）
- テスト用: URL に `?local=1` を付けると Supabase を使わず BroadcastChannel で同じブラウザのタブどうしを接続（在室は数秒ごとの在室通知と途絶で判定）。Supabase の設定が空のときも自動でこちらに切り替え、画面の隅に「ローカル試験モード」と出す
- 共通の口: `join(room, me)`, `send(type, payload)`, `on(type, cb)`, `onPeers(cb)`（在室一覧の変化）, `leave()`
- 自分の id は起動ごとに `crypto.randomUUID()`

### 声（voice.js）
- 「通信開始」のタップの中でマイクを1回だけ取得し、以後は取り直さない。`track.enabled` で送信の入切をする（起動時は切）
- 音声セッションの切り替えを URL の `audio=` で選べるようにする（iOS の受話口問題の比較用）
  - `audio=B`（既定）: 取得の前に `navigator.audioSession.type = 'play-and-record'`、取得の後に `'playback'`
  - `audio=A`: 何もしない
  - `audio=C`: `'play-and-record'` のまま
  - `navigator.audioSession` が無い環境では何もしない
- URL の `dsp=0` で getUserMedia の echoCancellation / noiseSuppression / autoGainControl をすべて false
- WebRTC メッシュ: 在室者の組ごとに RTCPeerConnection を1本。id の辞書順で小さい側が offer を出す（衝突回避）。シグナリングは transport の `signal` メッセージ（宛先 id 付き、宛先以外は無視）
- ICE: `config.js` の `ICE_SERVERS`（既定は Google の STUN のみ。TURN はユーザーの登録後に追加）
- 接続が failed になったら offer 側が ICE restart。在室から消えた相手の接続は閉じる
- 相手の音声は相手ごとの `<audio autoplay playsinline>` に流す。「通信開始」のタップで再生を解錠する
- 送信の排他: ボタンを押したとき、他の人が話していれば何もしない。話していなければ `talk-start {id, role, ts}` を送り、話している間は2秒ごとに再送、離したら `talk-end`。同時に押した場合は (ts, id) が小さい方が勝ち、負けた方は送信を止める。相手の再送が5秒途絶えたら話し中を解除
- 押す操作: pointerdown/pointerup/pointercancel（指が外れたら止める）。iOS の長押しメニューと文字選択を CSS で抑止
- 接続状態: 3秒ごとに getStats で使用中の候補ペアを調べ、どちらかが relay なら「中継」、それ以外は「直接」。往復時間は `currentRoundTripTime`

### 位置（location.js）
- `watchPosition`（高精度）。送信は「前回送信から10m以上動いた、かつ5秒以上経過」または「30秒経過」のとき
- 新しく入った人がいたら自分の最新位置をすぐ送る
- 位置の許可が拒否されても声は使える

### 画面の常時点灯
- 「通信開始」で `navigator.wakeLock.request('screen')`。画面が再表示されたら（visibilitychange）取り直す

### 画面の作り
- 縦画面のスマホ前提。`100dvh`、セーフエリア対応、横スクロールなし。iPad でも崩れない
- ボタンは大きく（指で押しやすい）

## 確認方法

- 構文: `node --check js/*.js`
- Mac のブラウザで `?local=1` を付けて2タブ開き、別の役割で入って、地図の印・押して話す・話し中の表示・送信の排他・接続状態の表示を確認
- 実機: GitHub Pages に公開してから（リポジトリは未作成）
