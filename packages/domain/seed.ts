import type { CRMState, SalesCase, Task } from './crm.ts';
import { NOW } from './crm.ts';
const makeCase = (id: string, name: string, person: string, stage: SalesCase['stage'], summary: string, original: string, receivedAt: string, assigneeId = 'kim'): SalesCase => ({
  id, name, person, stage, summary, original, receivedAt, assigneeId,
  phone: `010-0000-01${id.replace('c', '').padStart(2, '0')}`, email: `contact${id}@example.com`, size: '10~49명',
  files: ['c2', 'c3', 'c5', 'c6'].includes(id) ? ['상담 참고자료.pdf'] : [],
  notes: [{ id: `note-${id}`, body: summary, author: '김담당', at: receivedAt }],
});
const makeTask = (id: string, caseId: string, title: string, date: string | null, kind: Task['kind'] = 'work'): Task => ({
  id, caseId, title, kind, dueAt: date ? `${date}T17:00:00+09:00` : null, originalDueAt: date ? `${date}T17:00:00+09:00` : null, status: 'incomplete', excluded: false,
});
export function seedState(): CRMState {
  return {
    cases: [
      makeCase('c1', '가온설비', '박지은', '접수', '사무실 시설 점검 범위와 비용 문의', '사무실 시설 점검 상담을 받고 싶습니다. 가능한 일정과 비용이 궁금합니다.', '2026-09-10T16:20:00+09:00'),
      makeCase('c2', '온유상사', '최민수', '제안·협의', '현장 확인 완료 · 점검 견적 발송 약속', '창고 시설 점검 견적을 요청합니다. 현장 확인이 먼저 필요합니다.', '2026-09-08T10:10:00+09:00'),
      makeCase('c3', '메이플스튜디오', '서하늘', '제안·협의', '견적 검토 중 · 오늘 회신 여부 확인', '스튜디오 정기 점검을 의뢰하고 싶습니다.', '2026-09-09T11:00:00+09:00'),
      makeCase('c4', '이지민', '이지민', '접수', '방문 점검 상담 · 오후 연락 희망', '방문 점검이 가능한지 알고 싶어요. 오후에 연락 부탁드립니다.', '2026-09-14T09:10:00+09:00'),
      makeCase('c5', '봄길공방', '이봄', '서비스 진행', '방문 서비스 진행 · 완료 후 확인 연락 예정', '공방 시설 유지보수 상담을 요청합니다.', '2026-09-03T10:00:00+09:00', 'lee'),
      makeCase('c6', '다온오피스', '김다온', '상담 진행', '고객의 진행 보류 요청 · 종료 여부 확인 필요', '사무실 방문 점검을 상담받고 싶습니다.', '2026-09-07T13:00:00+09:00'),
      makeCase('c7', '한결상점', '정한결', '서비스 완료', '서비스 제공과 결과 안내 완료', '상점 시설 점검 문의입니다.', '2026-09-01T10:00:00+09:00'),
      makeCase('c8', '늘봄기획', '윤늘봄', '종료', '고객 요청 철회로 종료', '사무실 점검 상담을 요청합니다.', '2026-09-04T14:00:00+09:00'),
      makeCase('c9', '해솔사무소', '한해솔', '상담 진행', '첫 통화 완료 · 소개자료 전달 요청', '어떤 서비스를 제공하는지 소개자료를 받아보고 싶습니다.', '2026-09-11T10:00:00+09:00'),
    ],
    tasks: [
      makeTask('t1', 'c1', '신규 상담 첫 연락', '2026-09-11', 'first'),
      makeTask('t2', 'c2', '점검 견적서 작성·발송', '2026-09-10'),
      makeTask('t3', 'c3', '견적 검토 확인 이메일 보내기', '2026-09-14', 'email'),
      makeTask('t4', 'c4', '신규 상담 첫 연락', '2026-09-15', 'first'),
      makeTask('t5', 'c5', '서비스 완료 후 확인 연락', '2026-09-18'),
      makeTask('t6', 'c6', '방문 가능 일정 안내', '2026-09-15'),
      makeTask('t7', 'c9', '회사소개서 전달', null),
      { ...makeTask('t8', 'c3', '견적서 전달', '2026-09-10'), status: 'complete', completedAt: '2026-09-10T14:10:00+09:00', completedBy: '김담당' },
    ],
    proposals: [
      { id: 'p1', caseId: 'c3', taskId: 't3', kind: 'email', title: '견적 검토 상황을 확인하는 이메일', reason: '9월 14일에 검토 상황을 확인하기로 했고, 이후 회신 기록이 없습니다.', status: 'pending', date: '2026-09-14', to: 'contactc3@example.com', subject: '전달드린 견적 검토 상황을 확인드립니다', body: '안녕하세요, 서하늘님.\n\n전달드린 견적을 검토하셨는지 확인차 연락드립니다.\n궁금한 점이나 조정이 필요한 사항이 있으면 편하게 알려주세요.\n\n감사합니다.' },
      { id: 'p2', caseId: 'c6', kind: 'close', title: '고객 요청에 따른 영업건 종료 검토', reason: '고객이 “이번에는 진행하지 않겠습니다”라고 전달했습니다.', status: 'pending', date: '2026-09-14' },
      { id: 'p3', caseId: 'c2', kind: 'reassign', title: '견적 후속 업무 담당자 변경 제안', reason: '현재 담당자의 부재로 후속 처리 담당자 확인이 필요합니다.', status: 'pending', date: '2026-09-14', nextAssigneeId: 'lee' },
    ],
    activities: [
      { id: 'a1', caseId: 'c9', text: '회사소개서 전달 업무 등록 · 고객이 날짜를 말하지 않아 기한 확인 필요', author: 'AI 에이전트', kind: 'ai', at: '2026-09-14T14:42:00+09:00' },
      { id: 'a2', caseId: 'c6', proposalId: 'p2', text: '종료 제안 등록 · 직원 확인 전 상태와 알림 유지', author: 'AI 에이전트', kind: 'ai', at: '2026-09-14T14:30:00+09:00' },
      { id: 'a3', caseId: 'c4', text: '신규 문의 접수 · 김담당 배정 · 첫 연락 기한 9.15 17:00', author: '시스템', kind: 'system', at: '2026-09-14T09:10:00+09:00' },
    ],
  };
}
export function newInquiry(state: CRMState): CRMState {
  if (state.cases.some(c => c.id === 'c-live')) return state;
  return { ...state,
    cases: [makeCase('c-live', '새봄오피스', '정새봄', '접수', '오늘 접수된 신규 상담 · 방문 점검 요청', '사무실 정기 점검 상담을 요청합니다.', NOW), ...state.cases],
    tasks: [makeTask('t-live', 'c-live', '신규 상담 첫 연락', '2026-09-15', 'first'), ...state.tasks],
    activities: [{ id: 'a-live', caseId: 'c-live', text: '[시연] 신규 문의 반영 · 담당자와 첫 연락 기한 자동 연결', author: '시스템', kind: 'system', at: NOW }, ...state.activities],
  };
}
