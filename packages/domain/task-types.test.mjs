import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand } from './crm.ts';
import { seedState } from './seed.ts';
import { taskTypeGroups } from './task-types.ts';

const add = (taskType, description = '', date = '') => ({type:'add-task',caseId:'c9',title:'',taskType,description,date});

test('guided registration requires a valid type and meaningful details for other work', () => {
  for (const command of [add(''), add('unknown'), add('other'), add('other', '   ')]) {
    assert.throws(() => applyCommand(seedState(), command, 'staff'));
  }
  const task = applyCommand(seedState(), add('other', ' 현장 출입 신청 서류 확인 '), 'staff').tasks.at(-1);
  assert.equal(task.taskType, 'other');
  assert.equal(task.description, '현장 출입 신청 서류 확인');
  assert.equal(task.title, '기타 고객 관련 업무 · 현장 출입 신청 서류 확인');
});

test('standard types work without details or dates, and stages recommend rather than restrict', () => {
  const options = taskTypeGroups('상담 진행');
  assert.ok(options.recommended.some(t=>t.id==='meeting'));
  assert.ok(options.others.some(t=>t.id==='visit'));
  const initial = seedState();
  const after = applyCommand(initial, add('visit'), 'staff');
  assert.equal(after.tasks.at(-1).title, '현장 방문');
  assert.equal(after.tasks.at(-1).dueAt, null);
  assert.equal(after.cases.find(c=>c.id==='c9').stage, '상담 진행');
  assert.equal(initial.tasks.length + 1, after.tasks.length);
  assert.throws(() => applyCommand(initial, add('meeting', '고객 요청 시간 확인', '2026-09-15'), 'agent'));
});
