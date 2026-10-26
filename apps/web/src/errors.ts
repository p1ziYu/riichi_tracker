import { ApiError } from './api.ts';

// Server error codes (and better-auth codes) mapped to Chinese copy.
// Raw server messages are never shown: they are English API text and must
// not reach the UI.
const COPY: Record<string, string> = {
  match_not_found: '找不到该牌局，可能已被删除',
  match_finished: '牌局已结束，无法加入',
  match_cancelled: '牌局已取消，无法加入',
  match_already_started: '牌局已开始，无法加入；已入座请从战绩进入',
  match_full: '牌桌已满员',
  invalid_token: '加入链接无效或已过期',
  token_consumed_or_expired: '加入链接已过期，请向房主索取新的分享链接',
  invalid_join_code: '房间码不正确，请重新输入',
  missing_credential: '需要房间码或加入链接才能加入',
  guest_already_bound: '访客身份已绑定其他牌局，无法加入',
  seats_incomplete: '得点须覆盖全部座位',
  invalid_scores: '得点格式不正确',
  unknown_wind: '座位风位不正确',
  duplicate_wind: '同一座位重复填写',
  score_not_integer: '得点须为整数',
  score_out_of_range: '得点须在 -9999 至 9999 之间',
  total_mismatch: '合计点数不正确，请核对后再保存',
  forbidden: '没有权限进行此操作',
  invalid_state: '牌局状态不允许此操作，请刷新后重试',
  invalid_mode: '请选择三麻或四麻',
  invalid_request: '请求无效，请检查输入',
  join_code_not_found: '找不到该房间码的牌局',
  rate_limited: '尝试过于频繁，请稍后再试',
  unauthorized: '请先登录',
  principal_inactive: '账户已被停用',
  template_selection_retired: '模板开桌已停用，请直接选择三麻或四麻',
  legacy_create_retired: '请直接选择三麻或四麻开桌',
  rounds_retired: '逐局记分已停用，只记终局得点',
  settlement_retired: '逐局结算已停用，只记终局得点',
  internal_error: '服务端异常，请稍后再试',
  bad_request: '请求无效，请检查输入',
  invalid_json: '请求无效，请重试',
  payload_too_large: '提交内容过大',
  unsupported_media_type: '提交格式不支持',
  invalid_origin: '来源不受信任',
  INVALID_EMAIL_OR_PASSWORD: '邮箱或密码不正确',
  INVALID_EMAIL: '邮箱格式不正确',
  USER_ALREADY_EXISTS: '该邮箱已注册，请直接登录',
  EMAIL_ALREADY_EXISTS: '该邮箱已注册，请直接登录',
  WEAK_PASSWORD: '密码强度不足，请换一个更强的密码',
};

function statusFallback(status: number): string {
  if (status === 401) return '请先登录';
  if (status === 403) return '没有权限进行此操作';
  if (status === 404) return '找不到内容';
  if (status === 409) return '状态冲突，请刷新后重试';
  if (status === 429) return '请求过于频繁，请稍后再试';
  if (status >= 500) return '服务端异常，请稍后再试';
  return '请求失败，请重试';
}

export function errorTextZh(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code && COPY[error.code]) return COPY[error.code];
    return statusFallback(error.status);
  }
  if (error instanceof Error && /network|fetch|Failed to fetch|NetworkError/i.test(error.message)) {
    return '网络连接失败，请检查网络后重试';
  }
  return '请求失败，请重试';
}
