import { createId } from './id.ts';
import { describeTask } from './task-types.ts';
export type Role = 'admin' | 'staff' | 'agent';
export type Stage = '접수' | '상담 진행' | '제안·협의' | '계약 완료' | '서비스 진행' | '서비스 완료' | '종료';
export const STAGES: Stage[] = ['접수', '상담 진행', '제안·협의', '계약 완료', '서비스 진행', '서비스 완료', '종료'];
export const TODAY = '2026-09-14';
export const NOW = '2026-09-14T15:00:00+09:00';
export const PEOPLE = [{ id: 'kim', name: '김담당' }, { id: 'lee', name: '이담당' }];
export interface SalesCase {
  id: string; name: string; person: string; phone: string; email: string; size: string;
  stage: Stage; assigneeId: string; summary: string; original: string; receivedAt: string;
  files: string[]; notes: { id: string; body: string; author: string; at: string }[];
}
export interface Task {
  id: string; caseId: string; title: string; dueAt: string | null; originalDueAt: string | null;
  kind: 'first' | 'work' | 'email'; status: 'incomplete' | 'complete'; excluded: boolean;
  completedAt?: string; completedBy?: string;
  taskType?: string; description?: string;
}
export interface Proposal {
  id: string; caseId: string; taskId?: string; kind: 'email' | 'close' | 'reassign';
  title: string; reason: string; status: 'pending' | 'approved' | 'rejected'; date: string;
  to?: string; subject?: string; body?: string; nextAssigneeId?: string;
}
export interface Activity { id: string; caseId: string; text: string; author: string; at: string; kind: 'ai' | 'human' | 'system'; proposalId?: string }
export interface CRMState { cases: SalesCase[]; tasks: Task[]; proposals: Proposal[]; activities: Activity[] }
export type Command =
  | { type: 'complete'; taskId: string; outcome?: 'connected' | 'sms' | 'attempt'; actualAt: string; memo: string }
  | { type: 'reopen'; taskId: string; reason: string }
  | { type: 'due'; taskId: string; date: string; reason: string }
  | { type: 'exclude'; taskId: string; reason: string }
  | { type: 'add-task'; caseId: string; title: string; date: string; taskType?: string; description?: string }
  | { type: 'note'; caseId: string; body: string }
  | { type: 'customer'; caseId: string; name: string; person: string; phone: string; email: string; reason: string }
  | { type: 'stage'; caseId: string; stage: Stage; reason: string; ack: boolean }
  | { type: 'reject'; proposalId: string; reason: string }
  | { type: 'defer'; proposalId: string; date: string; reason: string }
  | { type: 'email-draft'; taskId: string; to: string; subject: string; body: string }
  | { type: 'approve'; proposalId: string; ack: boolean; to: string; subject: string; body: string; nextDate: string };

export const isClosed = (c: SalesCase) => c.stage === '서비스 완료' || c.stage === '종료';
export const canRead = (c: SalesCase, role: Role) => role !== 'staff' || c.assigneeId === 'kim';
export const isOpenTask = (t: Task) => t.status === 'incomplete' && !t.excluded;
export const personName = (id: string) => PEOPLE.find(p => p.id === id)?.name ?? '담당 미정';
export function visibleCases(state: CRMState, role: Role) { return state.cases.filter(c => canRead(c, role)); }
export function activeTasks(state: CRMState, role: Role) {
  return state.tasks.filter(t => isOpenTask(t) && state.cases.some(c => c.id === t.caseId && !isClosed(c) && canRead(c, role)));
}
export function pendingProposals(state: CRMState, role: Role) {
  return state.proposals.filter(p => p.status === 'pending' && state.cases.some(c => c.id === p.caseId && !isClosed(c) && canRead(c, role)) &&
    (!p.taskId || state.tasks.some(t => t.id === p.taskId && isOpenTask(t))));
}
export function workboard(state: CRMState, role: Role) {
  const tasks = activeTasks(state, role);
  const overdue = tasks.filter(t => !!t.dueAt && t.dueAt.slice(0, 10) < TODAY).sort((a, b) => Number(b.kind === 'first') - Number(a.kind === 'first') || a.dueAt!.localeCompare(b.dueAt!));
  const today = tasks.filter(t => !!t.dueAt && (t.dueAt.slice(0, 10) === TODAY || (t.kind === 'first' && state.cases.find(c => c.id === t.caseId)?.receivedAt.slice(0, 10) === TODAY)) && !overdue.includes(t));
  const unknown = tasks.filter(t => !t.dueAt);
  const upcoming = tasks.filter(t => t.dueAt && t.dueAt.slice(0, 10) > TODAY && !today.includes(t));
  const missing = visibleCases(state, role).filter(c => !isClosed(c) && !tasks.some(t => t.caseId === c.id));
  const proposals = pendingProposals(state, role).filter(p => !p.taskId && p.date <= TODAY);
  return { overdue, today, unknown, upcoming, missing, proposals };
}
function need(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function due(date: string) { need(/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date, '유효한 날짜를 선택해 주세요.'); return `${date}T17:00:00+09:00`; }

/** Review-only state model. Real authorization belongs to the future API server. */
export function applyCommand(input: CRMState, command: Command, role: Role): CRMState {
  const state = structuredClone(input);
  const task = 'taskId' in command ? state.tasks.find(t => t.id === command.taskId) : undefined;
  const proposal = 'proposalId' in command ? state.proposals.find(p => p.id === command.proposalId) : undefined;
  const caseId = 'caseId' in command ? command.caseId : task?.caseId ?? proposal?.caseId;
  const c = state.cases.find(x => x.id === caseId);
  need(c && canRead(c, role), '이 영업건에 접근할 권한이 없습니다.');
  need(!isClosed(c), '이미 종료된 영업건입니다.');
  const author = role === 'agent' ? 'AI 에이전트' : '김담당';
  const log = (text: string, proposalId?: string) => state.activities.unshift({ id: createId(), caseId: c.id, text, author, at: NOW, kind: role === 'agent' ? 'ai' : 'human', ...(proposalId ? { proposalId } : {}) });
  if (proposal) need(proposal.status === 'pending', '이미 처리된 제안입니다.');
  if (['approve', 'reject', 'reopen', 'exclude'].includes(command.type)) need(role !== 'agent', '직원 확인이 필요한 작업입니다.');
  if (proposal?.kind === 'reassign' && ['approve', 'reject'].includes(command.type)) need(role === 'admin', '담당자 변경 권한이 있는 관리자만 확정할 수 있습니다.');
  switch (command.type) {
    case 'complete': {
      need(task && isOpenTask(task), '이미 처리된 업무입니다.');
      need(task.kind !== 'email', '이메일은 초안 검토 후 발송 결과로 완료됩니다.');
      need(role !== 'agent', '실제 수행 근거가 필요한 작업입니다. 검수 화면에서는 직원이 기록해 주세요.');
      need(Number.isFinite(Date.parse(command.actualAt)) && Date.parse(command.actualAt) <= Date.parse(NOW), '시연 기준 시각보다 늦지 않은 실제 연락 시각을 입력해 주세요.');
      if (task.kind === 'first') need(command.outcome, '연락 결과를 선택해 주세요.');
      if (command.outcome !== 'attempt') {
        task.status = 'complete'; task.completedAt = command.actualAt; task.completedBy = author;
        state.proposals.filter(p => p.taskId === task.id && p.status === 'pending').forEach(p => p.status = 'rejected');
        if (task.kind === 'first' && command.outcome === 'connected' && c.stage === '접수') c.stage = '상담 진행';
      }
      log(command.outcome === 'attempt' ? '전화 시도 기록 · 문자 미발송으로 첫 연락 미완료' : `${task.title} 완료${command.outcome === 'sms' ? ' · 부재 후 안내 문자 발송' : ''}`);
      if (command.memo.trim()) c.notes.unshift({ id: createId(), body: command.memo, author, at: NOW });
      break;
    }
    case 'reopen':
      need(task?.status === 'complete', '완료된 업무만 되돌릴 수 있습니다.'); need(command.reason.trim(), '완료 취소 이유를 적어 주세요.');
      task.status = 'incomplete'; delete task.completedAt; log(`${task.title} 완료 취소 · ${command.reason}${task.kind === 'email' ? ' · 이미 보낸 메일은 취소되지 않음, 재발송은 새 검토 필요' : ''}`); break;
    case 'due':
      need(task && isOpenTask(task), '처리할 업무가 없습니다.'); need(command.reason.trim(), '기한을 정하거나 변경하는 이유를 적어 주세요.');
      need(role !== 'agent', '날짜가 불명확한 업무의 기한은 담당자가 확인합니다.');
      task.dueAt = due(command.date); task.originalDueAt ??= task.dueAt;
      state.proposals.filter(p => p.taskId === task.id).forEach(p => p.date = command.date);
      log(`${task.title} 기한 ${command.date}로 설정 · ${command.reason}`); break;
    case 'exclude':
      need(task && isOpenTask(task), '처리할 업무가 없습니다.'); need(command.reason.trim(), '제외 이유를 적어 주세요.');
      task.excluded = true; state.proposals.filter(p => p.taskId === task.id).forEach(p => p.status = 'rejected');
      log(`${task.title} 관리 제외 · ${command.reason}`); break;
    case 'add-task': {
      const content = command.taskType !== undefined
        ? describeTask(command.taskType, command.description)
        : { title: command.title.trim() };
      need(content.title, '할 일을 입력해 주세요.');
      need(role !== 'agent' || !command.date, 'AI가 날짜 근거 없이 기한을 정할 수 없습니다.');
      state.tasks.push({ id: createId(), caseId: c.id, ...content, dueAt: command.date ? due(command.date) : null, originalDueAt: command.date ? due(command.date) : null, status: 'incomplete', kind: 'work', excluded: false });
      log(`다음 행동 등록 · ${content.title}${command.date ? '' : ' · 기한 확인 필요'}`); break;
    }
    case 'note':
      need(command.body.trim(), '메모를 입력해 주세요.'); c.notes.unshift({ id: createId(), body: command.body, author, at: NOW });
      log('상담 메모 저장'); break;
    case 'customer':
      need(command.name.trim() && command.phone.trim() && command.person.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(command.email), '이름, 담당자, 연락처, 올바른 이메일을 입력해 주세요.');
      need(command.reason.trim(), '수정 이유를 적어 주세요.');
      Object.assign(c, { name: command.name, person: command.person, phone: command.phone, email: command.email }); log(`고객 정보 수정 · ${command.reason} · 접수 원문 보존`); break;
    case 'stage':
      need(STAGES.includes(command.stage), '단계를 선택해 주세요.');
      if (command.stage === '종료' || command.stage === '서비스 완료') {
        need(role !== 'agent', '영업건 종료는 직원 확인이 필요합니다.'); need(command.ack, '남은 업무와 중단될 알림을 확인해 주세요.');
        if (command.stage === '종료') need(command.reason.trim(), '종료 이유를 적어 주세요.');
      }
      need(role !== 'agent', '검수 화면의 단계 변경은 직원 확인으로 진행합니다.');
      c.stage = command.stage; log(`단계 변경 · ${command.stage}${command.reason ? ' · ' + command.reason : ''}`); break;
    case 'reject':
      need(proposal, '제안을 찾지 못했습니다.'); need(command.reason.trim(), '제외 이유를 적어 주세요.');
      proposal.status = 'rejected'; log(`제안 제외 · ${proposal.title} · ${command.reason}`); break;
    case 'defer':
      need(proposal, '제안을 찾지 못했습니다.'); need(command.reason.trim(), '다음 확인 날짜 변경 이유를 적어 주세요.');
      need(role !== 'agent', '날짜 근거가 없는 제안의 확인 날짜는 직원이 정합니다.');
      due(command.date); proposal.date = command.date;
      if (proposal.taskId) { const linked = state.tasks.find(t => t.id === proposal.taskId); if (linked) linked.dueAt = due(command.date); }
      log(`제안 다음 확인 ${command.date} · ${command.reason}`); break;
    case 'email-draft':
      need(task && isOpenTask(task) && task.kind === 'email', '초안을 작성할 발송 업무가 없습니다.');
      need(!state.proposals.some(p => p.taskId === task.id && p.status === 'pending'), '이미 검토 대기 중인 초안이 있습니다.');
      need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(command.to) && command.subject.trim() && command.body.trim(), '받는 사람, 제목, 내용을 확인해 주세요.');
      state.proposals.push({ id: createId(), caseId: c.id, taskId: task.id, kind: 'email', title: task.title, reason: '기존 초안 또는 완료 기록을 확인하고 새 초안을 작성했습니다.', status: 'pending', date: task.dueAt?.slice(0, 10) ?? TODAY, to: command.to, subject: command.subject, body: command.body });
      log('새 이메일 초안 저장 · 발송 전 직원 검토 필요', state.proposals.at(-1)!.id); break;
    case 'approve': {
      need(proposal, '제안을 찾지 못했습니다.');
      if (proposal.kind === 'email') {
        need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(command.to) && command.subject.trim() && command.body.trim(), '받는 사람, 제목, 내용을 확인해 주세요.');
        if (command.nextDate) need(command.nextDate > TODAY, '회신 확인 날짜는 내일부터 선택해 주세요.');
        Object.assign(proposal, { to: command.to, subject: command.subject, body: command.body });
        const linked = state.tasks.find(t => t.id === proposal.taskId);
        if (linked) { linked.status = 'complete'; linked.completedAt = NOW; linked.completedBy = author; }
        if (command.nextDate) state.tasks.push({ id: createId(), caseId: c.id, title: '고객 회신 여부 확인', dueAt: due(command.nextDate), originalDueAt: due(command.nextDate), kind: 'work', status: 'incomplete', excluded: false });
        log('[시연] 후속 이메일 발송 성공 · 실제 메일 전송 없음');
      } else {
        need(command.ack, '변경 내용과 영향을 확인해 주세요.');
        if (proposal.kind === 'close') { c.stage = '종료'; log(`직원 확인 후 종료 · ${proposal.reason}`); }
        else { need(PEOPLE.some(p => p.id === proposal.nextAssigneeId), '변경할 담당자를 확인해 주세요.'); c.assigneeId = proposal.nextAssigneeId!; log(`담당자 변경 · ${personName(c.assigneeId)} · ${proposal.reason}`); }
      }
      proposal.status = 'approved'; break;
    }
  }
  return state;
}
