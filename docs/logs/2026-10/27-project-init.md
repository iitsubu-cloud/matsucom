# 2026-10-27: newproject7 初期化

## 実装内容

- ComChat（newproject4）・手書き楽譜（newproject6）と並行して進める新プロジェクトとして作成。内容は未定
- ORCHESTRATION_GUIDE.md: newproject6 の指南書を複製し、ComChat で決まっていたのに未反映だった規則を追加
  - UI の変更（見た目・文言）は文章で事前承認を得る
  - 委任プロンプトに「再委譲の禁止」「計測は実データで」を書く。委任後は `git diff --stat` で実変更を確認
  - 実機確認の方法は「iPhone + GitHub Pages」固定にせず、アプリの種類が決まった時点で決める
- CLAUDE.md: セッション開始時に指南書と SESSION_SUMMARY.md を読ませるブートストラップ
- SESSION_SUMMARY.md: 進捗の正となるファイル。並行プロジェクトとの混同防止の注記つき
- 標準ディレクトリ構造（docs/logs, journals, specifications, development, .zeami-knowledge）
- 専用 git リポジトリ（ローカルのみ）

## 次のステップ

- アプリの内容が決まったら要件を SESSION_SUMMARY.md に記載し、縦切り最小版から着手
