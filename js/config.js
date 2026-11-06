// 設定を1か所にまとめる（Supabase を作り直すと URL と公開キーが変わるため）。
// SUPABASE_URL / SUPABASE_ANON_KEY が空のときは、自動でローカル試験モード（BroadcastChannel）になる。

// Supabase（公開キーのみ。v0.1 ではサインインしない）
// プロジェクト matsucom（組織 iitsubu-cloud、東京）。キーは publishable キー（旧 anon キーは 2027 年初めに廃止予定）
export const SUPABASE_URL = 'https://aspxtujvhsvjanxacqmf.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_yuJOUAA-WcBg4cswoXXTiQ__1R9Pmdd';

// WebRTC の ICE サーバー。TURN はユーザーの登録後にここへ追加する。
// 例: { urls: 'turn:example.com:3478', username: '...', credential: '...' }
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// 班の数。実際に使われる数は min(GROUP_COUNT, MAX_GROUPS)。
export const GROUP_COUNT = 4;
export const MAX_GROUPS = 8;

// 役割ごとの色。キーは 'taiko'（太鼓台）と 'g1'〜'g8'（1班〜8班）。
// 5〜8班の色は承認待ちの仮。
export const ROLE_COLORS = {
  taiko: '#fdd835', // 黄
  g1: '#e53935',    // 赤
  g2: '#1e88e5',    // 青
  g3: '#43a047',    // 緑
  g4: '#ef6c00',    // オレンジ
  g5: '#8e24aa',    // 紫（仮）
  g6: '#00acc1',    // 水色（仮）
  g7: '#6d4c41',    // 茶（仮）
  g8: '#ec407a',    // ピンク（仮）
};
