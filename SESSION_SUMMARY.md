# SESSION_SUMMARY — newproject7（MatsuCom）

<!-- ⚠️ このファイルの冒頭が進捗と次タスクの唯一の正。セッション終了時に必ず更新すること。 -->

## 現在の状態（最終更新: 2026-11-06 セッション2）

- **アプリ**: MatsuCom（仮名）。地域の秋祭りで、太鼓台のリーダーと3〜4班の班長がトランシーバー式で話し、互いの位置を地図で見る Web アプリ。**本番 2027年10月**
- **フェーズ**: **Supabase 接続済み**（v0.1.2）。Mac の2タブで本物の Supabase 経由の在室・位置・押して話すを確認済み。GitHub に push 済み。**実機テスト待ち**
- **公開**: リポジトリ https://github.com/iitsubu-cloud/matsucom （公開、main）／ GitHub Pages https://iitsubu-cloud.github.io/matsucom/ （`?v=3`）
- **Supabase**: プロジェクト `matsucom`（組織 iitsubu-cloud、Free、東京）。ダッシュボード https://supabase.com/dashboard/project/aspxtujvhsvjanxacqmf 。キーは **publishable キー**（旧 anon キーは 2027 年初めに廃止予定）。Realtime の「Allow public access to channels」は既定で ON。データベースのパスワードはユーザーが保管（指揮役は知らない）。ブラウザペインにユーザーのサインインが残っている
- **タグ**: `v0.1-local`、`v0.1.1-local`、`v0.1.2-supabase`（いずれも作業タグ。実機未確認）。安定タグなし
- 記録: [docs/logs/2026-11/06-supabase-connect.md](docs/logs/2026-11/06-supabase-connect.md)

### 次回の1手（この順で）

1. （済）Supabase 登録・`config.js` 設定・`?v=3`・push（2026-11-06）
2. （済）デプロイ確認は `curl -s https://iitsubu-cloud.github.io/matsucom/ | grep 'app.js?v='`
3. ⚠️ 作成直後に1回だけ参加が `TIMED_OUT`（10秒）→ 再試行で成功、以後14回は全成功（0.5〜1.2秒）。実機で「接続できませんでした」が出るなら、画面を変えずに自動再試行を足す
4. **実機テスト**（ユーザー）: 2台以上（iPhone と Android が混ざるとなお良い）、**Wi-Fi を切って携帯回線で**。確認依頼は「URL・操作・期待される結果」の3点セットで出す。確かめること:
   - (1) iPhone で相手の声が小さくならないか、受話口から出ないか → `?audio=A`／`B`（既定）／`C` を聞き比べ
   - (2) ホーム画面アプリだと起動ごとにマイクの許可を聞かれるか。Safari で開く場合と比較
   - (3) 画面の隅の「直接／中継」と ms。つながらない組み合わせがあるか
   - (4) 近くで使うと声がループしないか
   - (5) 話し始めの語頭が欠けないか（欠けるなら `?idle=silent` と比較）
5. つながらない組み合わせがあれば TURN を追加（ExpressTURN はユーザーが登録→ `ICE_SERVERS` に追記。Cloudflare TURN は資格情報の発行にサーバー処理が必要）

### その後の予定（承認済みの機能を1つずつ。画面は作る前に文章で承認を得る）

個別発信 → 大音量の呼び出し音 → 文字 → 写真・ファイル → 圏外中の後送り（Postgres と Storage）→ Supabase を作り直せる SQL をリポジトリに置く
- 段階: 〜冬 Web 試作／春〜夏 実地テスト（電波の弱い所・電池の持ち）／夏 ネイティブ化の要否を判断／2027年10月 本番

## 確定した方針（2026-10-27）

- **構成**（ユーザー承認）: 静的 Web アプリ（素の HTML/CSS/JS、ビルドなし、GitHub Pages）／位置・通話の仲介・文字・写真＝**Supabase Free（東京）**／声＝**WebRTC の端末どうしの直接接続（メッシュ）＋必要なら TURN**／地図＝Leaflet ＋ 国土地理院タイル。根拠と出典は [docs/specifications/architecture-research-2026-10.md](docs/specifications/architecture-research-2026-10.md)
- **声**: 無線機と同じ**リアルタイム**（ユーザー判断。参加者の多くはお酒が入って気が短いので遅れは嫌われる）。**送信の排他**＝誰かが話している間は他の人は話せない
- **Web の前提**: 画面を点けたまま使う（OS の決まりで、画面を消すと位置・声が止まる）。画面の常時点灯＋モバイルバッテリー
- **端末**: 班長は自分のスマホか iPad、iPhone と Android が混在。太鼓台は iPad か iPhone。**1つの班でスマホ2台は使わない**（→ 他の人の印は役割ごとに1つ）
- **班の数**: 目安 8班まで（太鼓台と合わせて9台）。`js/config.js` の `GROUP_COUNT`（今は4）でその年の数に合わせる。班が3つなら4班以降は出ない
- **画面**（ユーザー承認済み）: 起動画面＝役割ボタン（太鼓台・1班…）＋合言葉＋「通信開始」／メイン画面＝地図（太鼓台は黄色の星、班は色付きの丸に数字、自分は二重の輪、触るまで全員が入るよう自動で合わせる、ズームボタン無し）＋大きな「押して話す」（話している間は赤、他の人が話している間は灰色）＋上に「◯班が話しています」＋電波が切れた人の印は薄く残して「N分前」
  - 色: 太鼓台 黄、1 赤、2 青、3 緑、4 オレンジ、5 紫、6 水色、7 茶、8 ピンク
- **実機確認の方法**: ユーザーが iPhone・Android 実機で GitHub Pages 版を開く。変更のたびに `?v=N` を `sed` で一括で上げてからプッシュ
- **公開リポジトリに入れないもの**: データベースのパスワード、TURN の有料アカウントの秘密情報。Supabase の公開用キーと無料 TURN の資格情報はコードに入る（仕組み上避けられない、ユーザーに説明済み）

## 早期に実機で確かめる危険（調査で判明）

1. iPhone でマイク使用中に受信音が受話口から小さく出る（WebKit Bug 218012）。対策候補＝`audio=B`
2. ホーム画面アプリは起動ごとにマイク許可を聞き直す（Bug 327237、2026-10-12 起票・未修正）
3. 日本の携帯回線どうしで直接つながる割合は実測データなし
4. 近くの端末どうしの声のループ（送信の排他で抑える想定）

## 試作の技術メモ

- 仕様: [docs/specifications/prototype-v0.1.md](docs/specifications/prototype-v0.1.md)（v0.1.1 の追加を末尾に記載）
- URL の試験用パラメータ: `local=1`（サーバー無し、同じブラウザのタブどうし）、`audio=A|B|C`（iOS の音声セッション、既定 B）、`dsp=0`（エコー除去等を切る）、`idle=silent`（話していない間も無音を送る旧方式）
- ローカル確認: launch.json の `matsuri-static`（ポート 8707）で `?local=1` を2タブ。マイクと位置は javascript で差し替え（getUserMedia→オシレーター、watchPosition→固定座標）
- レビューで分かったこと: `track.enabled=false` は送信を止めない（無音を送り続け、8人相手で1台1日1GB超）→ `replaceTrack(null)`。answer 側で `addTransceiver` した送信側は offer と対応づけられない → offer から作られた transceiver を sendrecv に
- 試作で増えた文言（承認済み）: 「自分の役割」「合言葉」「接続できませんでした」「マイクが使えません」「位置が使えません」「接続中」「切断」「ローカル試験モード」「地理院タイル」「N分前」

## 経緯（2026-10-27 セッション1）

- 初期化 → テーマの相談 → 要件の聞き取り → Sonnet 2体で中継サーバーと音声方式を並行調査（指揮役が7か所を公式で再確認）→ 構成の承認 → Sonnet が v0.1 を実装 → 指揮役のレビューで4点差し戻し → v0.1 完成 → ユーザー承認の画面変更3点で v0.1.1 → GitHub に公開（ユーザー承認、名前 `matsucom`）
- 記録: [docs/logs/2026-10/](docs/logs/2026-10/)

## 並行中のプロジェクト（混同しないこと）

- `projects/newproject4` = ComChat（P2Pビデオ会議、GitHub Pages で公開中）
- `projects/newproject6` = 手書き楽譜 → MusicXML
- それぞれ自分の SESSION_SUMMARY.md を持つ。このファイルには newproject7 のことだけを書く
