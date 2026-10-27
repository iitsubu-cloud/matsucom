# 技術構成の調査と提案（2026-10-27）

Sonnet 2体の並行調査（中継サーバー／リアルタイム音声）を指揮役が精査した結果。無料枠は変わりやすいので **2027年9月に再確認する**。

## 前提（ユーザーの回答）

- 本番 2027年10月。太鼓台リーダー1＋班長3〜4＝端末5台程度。iPhone・iPad・Android が混在
- 声は**無線機と同じリアルタイム**（遅れは嫌われる）。一斉・個別の発信、大音量の呼び出し、音声・文字・写真・ファイル
- 一部に電波の入りにくい所がある。中継サーバー（無料枠）は使ってよい

## 提案する構成（未承認）

| 役割 | 方式 | 理由 |
|---|---|---|
| 画面 | 静的 Web アプリ（素の HTML/CSS/JS）、GitHub Pages | 端末が混在しても1つで済む。ComChat と同じ |
| 位置・通話の仲介・文字・写真 | **Supabase Free（東京）** | カード不要の範囲で1つにまとまる。位置＝Realtime Broadcast、文字＝Postgres、写真・ファイル＝Storage、匿名サインイン |
| 声 | **WebRTC の端末どうしの直接接続（メッシュ）＋ TURN** | 遅延が最小。宛先の切り替えが接続ごとで簡単。iOS では WebRTC の受信音声が Web Audio より問題が整理されている |
| TURN | ExpressTURN（無料・カード不要）＋ Cloudflare Realtime TURN を併記して比較 | 前者は確実に無料、後者は近い拠点が期待できる（カード要否は未確認） |
| 地図 | Leaflet ＋ 国土地理院タイル or OpenStreetMap | 無料。利用規約は試作時に確認 |

### 確認済みの事実（指揮役が公式ページで再確認したもの）

- Supabase: 低活動1週間で休止。休止から1年は再開できる（docs）。※2024-06 の changelog は90日と記載し食い違い → 再開できない前提で運用する [S4][S5]
- Supabase: Broadcast は「送信1＋受信端末ごとに1」と数える。位置5秒ごと×5台×10時間 ≈ 18万メッセージ/日 対 枠200万/月（試算）[S9]
- Firebase: 2026-02-03 から無料の Spark プランでは Cloud Storage を使えない。Blaze（支払い方法の登録が必要）が必須 [F2]
- ExpressTURN: 無料で月1000GB、ポートは 3478（TCP/UDP）のみ。無料で使えるサーバーの所在地は記載なし
- Cloudflare Realtime: SFU と TURN 合わせて月1000GB 無料、超過 $0.05/GB。カード要否は記載なし
- LiveKit Build: 月5,000参加者分、カード不要 → 5台×8時間×2日で枠の96%。全日接続に合わないので不採用
- WebKit Bug 327237（2026-10-12 起票・NEW）: iOS のホーム画面 Web アプリは起動のたびにカメラ・マイクの許可を聞き直す

### Supabase の休止への対策

- テーブル作成の SQL とアクセス規則（RLS）をリポジトリに置き、いつでも作り直せるようにする
- 開発・試験の期間は継続的に使う。本番の1〜2か月前に作り直すか再開し、祭りの後は project ごと削除する（＝データ削除）
- 作り直すと URL と公開キーが変わる → 設定は1か所にまとめる

## 早期に実機で確かめるべき危険（優先順）

1. **iPhone でマイクを使うと、受信音が受話口から小さく出る**（WebKit Bug 218012。報告は iOS 18.6 まで）。太鼓の横では致命的。回避策の報告＝マイク取得の前に `navigator.audioSession.type = 'play-and-record'`、取得後に `'playback'`。iOS 26 での効果は未検証
2. **ホーム画面アプリは起動ごとにマイク許可を聞き直す**（Bug 327237）→ 起動時の「通信開始」1タップで許可と音声の解錠を済ませる。Safari で開く運用で避けられるかも試す
3. **日本の携帯回線どうしで直接つながる割合が不明**（実測データなし）→ 試作に接続経路（直接／中継）と遅延の表示を入れて実測。中継が大半で無料 TURN が頼りにならなければ、WebSocket 中継方式へ切り替えを検討
4. **近くにいる端末どうしの声のループ**（相手のスピーカーの声を自分のマイクが拾う。エコーキャンセルでは消せない）→ 無線機と同じ「誰かが話している間は他の人は送信できない」仕組みを検討
5. 他のアプリへ切り替えた後の復帰: `track.muted` を監視し、無音になったら復帰ボタン。前面に戻ったら再接続

## 不採用とした案

- Firebase Spark: 写真に Storage を使えない（base64 で Realtime Database に入れる回避策はあるが不格好）。Realtime Database は日本リージョンなし（シンガポール）
- Cloudflare Workers＋Durable Objects: 技術的な適性は高いが、サーバー側のコードを自作・デプロイする必要があり、カード要否と休止規則が未確認。Supabase で困ったら次点
- ホスティング型 SFU（LiveKit／Cloudflare SFU）: 利用時間の上限、または実装の重さ
- 録音して送る方式: ユーザーがリアルタイムを選択（2026-10-27）

## 出典

- [S4] https://supabase.com/docs/guides/platform/free-project-pausing
- [S5] https://supabase.com/changelog/27497-paused-free-plan-projects-are-restorable-for-90-days
- [S9] https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages
- [F2] https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024
- https://www.expressturn.com/
- https://developers.cloudflare.com/realtime/sfu/pricing/
- https://livekit.com/pricing
- https://bugs.webkit.org/show_bug.cgi?id=327237
- https://bugs.webkit.org/show_bug.cgi?id=218012
- その他の出典（Supabase の各上限、iOS の音声の挙動など）は調査報告の原文にあり、要点のみここに転記した
