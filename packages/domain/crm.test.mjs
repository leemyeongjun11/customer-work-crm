import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, workboard, activeTasks, visibleCases, pendingProposals, NOW } from './crm.ts';
import { seedState, newInquiry } from './seed.ts';

const complete = (taskId, outcome = 'connected') => ({ type: 'complete', taskId, outcome, actualAt: NOW, memo: '' });
const approve = proposalId => ({ type: 'approve', proposalId, ack: true, to: 'client@example.com', subject: '견적 확인', body: '검토 상황 확인 부탁드립니다.', nextDate: '' });

test('first-contact delay outranks older ordinary work; fresh inquiries appear before tomorrow deadline', () => {
  const board = workboard(seedState(), 'admin');
  assert.deepEqual(board.overdue.map(t => t.id), ['t1', 't2']);
  assert.ok(board.today.some(t => t.id === 't4'));
  assert.ok(!board.upcoming.some(t => t.id === 't4'));
  assert.deepEqual(board.unknown.map(t => t.id), ['t7']);
  assert.ok(![...board.overdue, ...board.today, ...board.upcoming].some(t => t.id === 't8'));
});
test('phone attempt alone stays open; connected call or missed call plus SMS completes without a memo', () => {
  const initial = seedState();
  const attempted = applyCommand(initial, complete('t1', 'attempt'), 'staff');
  assert.equal(attempted.tasks.find(t => t.id === 't1').status, 'incomplete');
  for (const result of ['connected', 'sms']) {
    const after = applyCommand(initial, complete('t1', result), 'staff');
    assert.ok(!activeTasks(after, 'staff').some(t => t.id === 't1'));
    assert.equal(after.tasks.find(t => t.id === 't1').completedAt, NOW);
    assert.equal(after.cases.find(c => c.id === 'c1').notes.length, 1);
  }
  assert.equal(initial.tasks.find(t => t.id === 't1').status, 'incomplete');
});
test('unknown deadlines remain unknown until human confirmation and first deadline is retained on changes', () => {
  let state = applyCommand(seedState(), { type: 'add-task', caseId: 'c1', title: '고객 요청 자료 확인', date: '' }, 'agent');
  assert.equal(state.tasks.at(-1).dueAt, null);
  assert.throws(() => applyCommand(state, { type: 'due', taskId: 't7', date: '2026-09-15', reason: '추정' }, 'agent'));
  state = applyCommand(state, { type: 'due', taskId: 't1', date: '2026-09-16', reason: '고객 일정 요청' }, 'staff');
  assert.equal(state.tasks.find(t => t.id === 't1').originalDueAt, '2026-09-11T17:00:00+09:00');
  assert.throws(() => applyCommand(state, { type: 'due', taskId: 't7', date: '2026-02-30', reason: '오류' }, 'staff'));
});
test('staff cannot read or edit other owners; autonomous AI cannot approve closure or reassignment', () => {
  const state = seedState();
  assert.ok(!visibleCases(state, 'staff').some(c => c.id === 'c5'));
  assert.throws(() => applyCommand(state, { type: 'note', caseId: 'c5', body: '접근 불가' }, 'staff'));
  assert.throws(() => applyCommand(state, approve('p2'), 'agent'));
  assert.throws(() => applyCommand(state, approve('p3'), 'staff'));
  assert.throws(() => applyCommand(state, { type: 'stage', caseId: 'c1', stage: '종료', reason: '고객 취소', ack: true }, 'agent'));
});
test('pending closure retains tasks; confirmed closure suppresses active tasks without counting them complete', () => {
  const state = seedState();
  assert.ok(activeTasks(state, 'admin').some(t => t.id === 't6'));
  assert.throws(() => applyCommand(state, { ...approve('p2'), ack: false }, 'staff'));
  const after = applyCommand(state, approve('p2'), 'staff');
  assert.ok(!activeTasks(after, 'admin').some(t => t.id === 't6'));
  assert.equal(after.tasks.find(t => t.id === 't6').status, 'incomplete');
  assert.equal(after.cases.find(c => c.id === 'c6').stage, '종료');
});
test('reassignment changes active ownership while preserving completed performer history', () => {
  const initial = seedState();
  initial.tasks.push({ ...initial.tasks.find(t => t.id === 't8'), id: 'past-owner', caseId: 'c2' });
  const after = applyCommand(initial, approve('p3'), 'admin');
  assert.ok(!activeTasks(after, 'staff').some(t => t.id === 't2'));
  assert.equal(after.tasks.find(t => t.id === 'past-owner').completedBy, '김담당');
});
test('CRM customer edits retain intake source and replayed mock inquiry remains single', () => {
  const initial = seedState();
  const after = applyCommand(initial, { type: 'customer', caseId: 'c1', name: '가온시설', person: '박지은', phone: '010-0000-0000', email: 'edited@example.com', reason: '고객 정정' }, 'staff');
  assert.equal(after.cases[0].original, initial.cases[0].original);
  assert.equal(after.cases[0].name, '가온시설');
  const added = newInquiry(newInquiry(after));
  assert.equal(added.cases.filter(c => c.id === 'c-live').length, 1);
  assert.equal(added.tasks.filter(t => t.id === 't-live').length, 1);
});
test('email approval completes only the send task and creates a separate reply-check task', () => {
  const state = seedState();
  assert.throws(() => applyCommand(state, complete('t3'), 'staff'));
  const after = applyCommand(state, { ...approve('p1'), nextDate: '2026-09-16' }, 'staff');
  assert.equal(after.tasks.find(t => t.id === 't3').status, 'complete');
  assert.equal(after.tasks.at(-1).title, '고객 회신 여부 확인');
  assert.equal(after.tasks.at(-1).status, 'incomplete');
  assert.ok(after.activities[0].text.includes('실제 메일 전송 없음'));
  assert.throws(() => applyCommand(after, approve('p1'), 'staff'));
});
test('rejecting an email proposal does not complete work; a replacement draft requires fresh approval', () => {
  const rejected = applyCommand(seedState(), { type: 'reject', proposalId: 'p1', reason: '문구 변경 필요' }, 'staff');
  assert.equal(rejected.tasks.find(t => t.id === 't3').status, 'incomplete');
  const after = applyCommand(rejected, { type: 'email-draft', taskId: 't3', to: 'new@example.com', subject: '수정 초안', body: '확인 부탁드립니다.' }, 'staff');
  assert.equal(pendingProposals(after, 'staff').filter(p => p.taskId === 't3').length, 1);
  assert.equal(after.tasks.find(t => t.id === 't3').status, 'incomplete');
});
test('excluded tasks are kept but are not counted as completed, and missing next action is surfaced', () => {
  const after = applyCommand(seedState(), { type: 'exclude', taskId: 't7', reason: '고객 요청 철회' }, 'staff');
  assert.equal(after.tasks.find(t => t.id === 't7').status, 'incomplete');
  assert.ok(workboard(after, 'staff').missing.some(c => c.id === 'c9'));
});
