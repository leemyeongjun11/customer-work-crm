import type { Stage } from './crm.ts';

export const TASK_TYPES = [
  { id: 'intake-review', label: '상담 요청 확인', stages: ['접수'] },
  { id: 'requirements', label: '고객 요구사항 확인', stages: ['접수', '상담 진행'] },
  { id: 'meeting', label: '미팅 일정 조율', stages: ['상담 진행'] },
  { id: 'materials', label: '자료 전달', stages: ['상담 진행', '제안·협의'] },
  { id: 'follow-up', label: '후속 연락', stages: ['접수', '상담 진행', '제안·협의'] },
  { id: 'quote', label: '견적서 작성·전달', stages: ['제안·협의'] },
  { id: 'quote-response', label: '견적 회신 확인', stages: ['제안·협의'] },
  { id: 'terms', label: '계약 조건 협의', stages: ['제안·협의'] },
  { id: 'contract', label: '계약서 전달·확인', stages: ['계약 완료'] },
  { id: 'service-schedule', label: '서비스 일정 확정', stages: ['계약 완료'] },
  { id: 'visit', label: '현장 방문', stages: ['서비스 진행'] },
  { id: 'progress', label: '작업 진행 상황 확인', stages: ['서비스 진행'] },
  { id: 'results', label: '서비스 결과 안내', stages: ['서비스 진행'] },
  { id: 'customer-check', label: '서비스 완료 확인 연락', stages: ['서비스 진행'] },
  { id: 'other', label: '기타 고객 관련 업무', stages: [] },
] as const;

export function taskTypeGroups(stage: Stage) {
  return {
    recommended: TASK_TYPES.filter(t => (t.stages as readonly string[]).includes(stage)),
    others: TASK_TYPES.filter(t => t.id !== 'other' && !(t.stages as readonly string[]).includes(stage)),
  };
}

export function describeTask(taskType: string, description = '') {
  const type = TASK_TYPES.find(t => t.id === taskType);
  if (!type) throw new Error('업무 종류를 선택해 주세요.');
  const details = description.trim();
  if (type.id === 'other' && !details) throw new Error('기타 업무는 고객과 관련된 구체적인 내용을 적어 주세요.');
  return { taskType: type.id, description: details, title: details ? `${type.label} · ${details}` : type.label };
}
