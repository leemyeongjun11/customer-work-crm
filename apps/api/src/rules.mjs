export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function requireValue(value, message, status = 422) { if (!value) throw new ApiError(status, message); }
export function fields(body, allowed) {
  requireValue(body && typeof body === 'object' && !Array.isArray(body), '올바른 요청 본문이 필요합니다.');
  requireValue(Object.keys(body).every(k => allowed.includes(k)), '허용되지 않은 입력 항목이 있습니다.');
}
export function text(value, label, max = 200, optional = false) {
  if (optional && value === undefined) return '';
  requireValue(typeof value === 'string', `${label}을 확인해 주세요.`);
  const clean = value.trim();
  requireValue((optional || clean.length > 0) && clean.length <= max, `${label}을 확인해 주세요. (최대 ${max}자)`);
  return clean;
}
export function kstDate(date = new Date()) { return new Date(new Date(date).getTime() + 9 * 3600000).toISOString().slice(0,10); }
export function dayDeadline(day) {
  requireValue(typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0,10) === day, '유효한 날짜를 선택해 주세요.');
  return new Date(`${day}T17:00:00+09:00`).toISOString();
}
export function firstDeadline(receivedAt, holidays = []) {
  const date = new Date(`${kstDate(receivedAt)}T00:00:00Z`);
  for (let i = 0; i < 370; i++) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.toISOString().slice(0,10);
    if (![0,6].includes(date.getUTCDay()) && !holidays.includes(day)) return dayDeadline(day);
  }
  throw new ApiError(503, '영업일 달력을 확인할 수 없습니다. 관리자에게 문의해 주세요.');
}
export function timestamp(value, now, earliest) {
  requireValue(typeof value === 'string' && /(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)), '시간대가 포함된 수행 시각이 필요합니다.');
  requireValue(Date.parse(value) <= Date.parse(now) && Date.parse(value) >= Date.parse(earliest), '접수 이후부터 현재까지의 실제 수행 시각을 입력해 주세요.');
  return new Date(value).toISOString();
}
export const iso = value => value ? new Date(value).toISOString() : null;
