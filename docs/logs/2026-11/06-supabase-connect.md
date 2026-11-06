# 2026-11-06: Supabase を接続（ローカル試験モードから端末どうしの通信へ）

## 実装内容

- Supabase プロジェクト `matsucom` を作成（組織 iitsubu-cloud・Free・Northeast Asia (Tokyo)）
  - サインイン（GitHub）とデータベースのパスワードはユーザー本人。組織とプロジェクトの入力は指揮役がブラウザペインで代行
  - Security はユーザーに「Automatically expose new tables を外す」「Enable automatic RLS を入れる」を推奨（公開キーで表を読み書きされないため。v0.1 は表を使わない）
- `js/config.js` に Project URL と **publishable キー**（`sb_publishable_`）を設定。キャッシュ番号 `?v=3`
- タグ `v0.1.2-supabase`、GitHub に push

## 確認したこと

- Realtime 設定: サービス有効、**Allow public access to channels が既定で ON**（サインインなしの Broadcast／Presence が使える）。Free の上限＝同時接続 200、毎秒 100 イベント、Presence 毎秒 20、1件 256KB
- ローカル（matsuri-static、2タブ、マイクは発振音・位置は固定座標に差し替え）で本物の Supabase 経由: 在室・位置の印・WebRTC 直接接続（直接 1ms）・押して話す（相手側に「1班が話しています」、ボタン灰色、受信トラック live）・離すと解除、エラーなし
- supabase-js は `@2` 指定で 2.119.0 が読み込まれた

## 課題と解決

- 2つめのタブの最初の参加が `TIMED_OUT`（10秒）で「接続できませんでした」。再試行で成功。続けて参加の所要時間を14回測定 → 全成功、0.5〜1.2秒が13回、4.3秒が1回。作成直後の立ち上がりによる一度きりと判断
  - 電波の弱い現場では同じ時間切れがあり得る。実機で出るなら、画面を変えずに自動再試行を足す（内部ロジックのみ）
- 旧 anon キーはダッシュボードに「2027 年初めに廃止」と表示 → 最初から publishable キーを使用

## 次のステップ

- 実機テスト（2台以上、携帯回線で）: SESSION_SUMMARY.md の5項目
