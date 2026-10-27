# 2026-10-27: 試作 v0.1（地図に全員の位置＋全員宛ての押して話す）

## 実装内容

- Sonnet が仕様書（docs/specifications/prototype-v0.1.md）から実装。index.html／css／js 6ファイル、約1,800行
- 通信は Supabase Realtime と BroadcastChannel（`?local=1`）を同じ口で扱う。声は WebRTC メッシュ、送信の排他は talk-start／talk-end（(ts, id) が小さい方が勝ち、2秒ごと再送、5秒途絶で解除）

## レビューで直したこと

1. 話していない間も無音の RTP を送り続けていた（enabled=false だけ）。8人相手で1台1日1GB超の見積もり → `replaceTrack(null)` で停止
2. 相手だけが接続を閉じたとき、offer 側が failed まで数十秒復旧しない → answer 側から `need-offer` で催促
3. ES Modules の import にキャッシュ番号が無く、GitHub Pages で新旧が混ざる恐れ → 全 import に `?v=1`
4. bfcache 復元時に通信だけ切れた画面が残る → pageshow で再読込

## 学んだこと

- answer 側で `addTransceiver` した送信側は、届いた offer の m= 行と対応づけられない（Chrome で実測、answer が recvonly になる）。offer から作られた transceiver の direction を sendrecv に変えて使う。**指揮役の指示ミスを実装担当が実測で発見した**＝委任が独立した検証になった例
- `track.enabled = false` は送信を止めない（無音フレームを送り続ける）。PTT では `replaceTrack(null)`

## 次のステップ

- Supabase 登録 → GitHub Pages 公開 → iPhone・Android 実機で4つの危険を確認
