import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, ClipboardList, FileText, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { TASK_TYPES } from '../../../../packages/domain/task-types';

type DraftTask = { id: string; taskType: string; description: string; date: string; evidence: string; selected: boolean };
type SavedTask = DraftTask & { complete: boolean };
type Scenario = {
  id: string; label: string; hint: string; customer: string; source: string; transcript: string;
  summary: string; tasks: DraftTask[]; existing: SavedTask[]; check: string;
};
const scenarios: Scenario[] = [
  {
    id: 'quote', label: '견적과 연락 요청', hint: '한 번의 상담에서 할 일 2개 정리', customer: '김하늘 · 예시 고객',
    source: '전화 상담 전사 예시 · 2026년 9월 14일',
    transcript: '고객: 사무실 에어컨 3대 점검 견적 부탁드려요.\n담당자: 견적은 언제까지 보내드리면 될까요?\n고객: 9월 16일까지 이메일로 보내주시고, 9월 18일 오후에 다시 전화 주세요.',
    summary: '사무실 에어컨 3대 점검 견적 요청. 9월 16일까지 이메일 견적 전달, 9월 18일 오후 후속 연락을 요청함.',
    tasks: [
      { id: 'quote-send', taskType: 'quote', description: '에어컨 3대 점검 견적을 이메일로 전달', date: '2026-09-16', evidence: '9월 16일까지 이메일로 보내주시고', selected: true },
      { id: 'quote-call', taskType: 'follow-up', description: '오후에 전화해 견적 검토 결과 확인', date: '2026-09-18', evidence: '9월 18일 오후에 다시 전화 주세요', selected: true },
    ], existing: [], check: '상담에서 나온 견적 전달과 후속 연락을 각각 업무로 준비했습니다.',
  },
  {
    id: 'unclear', label: '날짜가 없는 요청', hint: '없는 날짜를 만들어 내지 않기', customer: '이서준 · 예시 고객',
    source: '고객 메시지 예시 · 2026년 9월 14일',
    transcript: '매장 정기 점검 서비스 안내 자료를 보내주세요. 지금 바빠서 날짜는 아직 못 정하겠어요.',
    summary: '매장 정기 점검 서비스 안내 자료 요청. 전달 날짜는 정해지지 않음.',
    tasks: [{ id: 'materials', taskType: 'materials', description: '매장 정기 점검 서비스 안내 자료 전달', date: '', evidence: '안내 자료를 보내주세요. … 날짜는 아직 못 정하겠어요', selected: true }],
    existing: [], check: '날짜 근거가 없어 비워 두었습니다. 직접 정하거나, 기한 확인 필요로 등록할 수 있습니다.',
  },
  {
    id: 'duplicate', label: '이미 등록된 업무', hint: '기존 업무와 비교하고 빠진 요청 찾기', customer: '박지민 · 예시 고객',
    source: '고객 메시지 예시 · 2026년 9월 14일',
    transcript: '지난 견적에서 점검 대수를 3대로 바꿔서 9월 16일까지 다시 보내주세요. 말씀드린 대로 9월 18일 오후에 연락 부탁드립니다.',
    summary: '점검 대수를 3대로 변경한 수정 견적을 9월 16일까지 요청함. 9월 18일 오후 연락 약속을 재확인함.',
    tasks: [{ id: 'revision', taskType: 'quote', description: '점검 대수를 3대로 변경한 수정 견적 전달', date: '2026-09-16', evidence: '점검 대수를 3대로 바꿔서 9월 16일까지 다시 보내주세요', selected: true }],
    existing: [{ id: 'existing-call', taskType: 'follow-up', description: '오후에 전화해 견적 검토 결과 확인', date: '2026-09-18', evidence: '', selected: true, complete: false }],
    check: '9월 18일 후속 연락은 이미 등록되어 있습니다. 빠져 있는 수정 견적 전달만 새로 제안합니다.',
  },
];
const typeLabel = (id: string) => TASK_TYPES.find(t => t.id === id)?.label ?? id;

export function AiWorkflowDemo() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const scenario = scenarios.find(s => s.id === scenarioId)!;
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [summary, setSummary] = useState('');
  const [tasks, setTasks] = useState<DraftTask[]>([]);
  const [saved, setSaved] = useState<SavedTask[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { document.title = '상담 후 업무 정리 · AI 시연'; }, []);
  useEffect(() => { heading.current?.focus(); }, [step]);

  function reset() {
    setStep(0); setTasks([]); setSaved([]); setSummary(''); setConfirmed(false); setError('');
  }
  function prepare() {
    setSummary(scenario.summary);
    setTasks(scenario.tasks.map(t => ({ ...t })));
    setConfirmed(false); setError(''); setStep(1);
  }
  function changeTask(id: string, patch: Partial<DraftTask>) {
    setTasks(old => old.map(t => t.id === id ? { ...t, ...patch } : t));
    setConfirmed(false); setError('');
  }
  function approve(event: FormEvent) {
    event.preventDefault();
    if (step !== 1) return;
    const chosen = tasks.filter(t => t.selected);
    if (!confirmed || !summary.trim() || chosen.some(t => !t.description.trim())) {
      setError('상담 요약과 선택한 업무 내용을 확인한 뒤 확인란을 선택해 주세요.'); return;
    }
    setSaved([...scenario.existing.map(t => ({ ...t })), ...chosen.map(t => ({ ...t, description: t.description.trim(), complete: false }))]);
    setSummary(summary.trim()); setStep(2); setError('');
  }
  const selectedCount = tasks.filter(t => t.selected).length;

  return <div className="min-h-screen bg-background text-foreground">
    <header className="border-b"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
      <Link to="/live" className="font-semibold">고객 업무 관리</Link>
      <Badge variant="secondary">AI 시연 모드 · 실제 AI 연결 전</Badge>
      <Link to="/live" className="text-sm underline">기존 업무 화면으로</Link>
    </div></header>
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 max-w-3xl">
        <p className="mb-2 text-sm font-medium text-muted-foreground">상담이 끝난 뒤, 업무로 옮겨 적는 과정을 체험해 보세요</p>
        <h1 ref={step === 0 ? heading : undefined} tabIndex={-1} className="text-2xl font-semibold outline-none sm:text-3xl">상담 후 업무 정리</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">AI가 연결됐을 때의 사용 흐름을 미리 체험합니다. 예시 상담에 맞춰 준비한 결과를 보여주며, 실제 AI 분석이나 음성 변환은 수행하지 않습니다.</p>
      </div>
      <aside className="mb-6 rounded-lg border border-dashed bg-muted/40 p-4 text-sm leading-relaxed">
        <strong>이 화면의 고객과 결과는 모두 시연용입니다.</strong> 승인한 내용도 이 화면에서만 유지됩니다. 실제 고객 DB에 저장되거나 이메일·전화가 발송되지 않으며, 새로고침하면 초기화됩니다.
      </aside>
      <ol aria-label="시연 진행 단계" className="mb-8 grid grid-cols-3 gap-2">
        {['예시 상담 선택', '정리 결과 확인', '업무 등록 결과'].map((label, i) => <li key={label} aria-current={step === i ? 'step' : undefined} className={`rounded-lg border px-3 py-3 text-sm ${step === i ? 'border-primary bg-primary/5 font-semibold' : 'text-muted-foreground'}`}>
          <span className="mb-1 block text-xs">STEP {i + 1}</span>{label}
        </li>)}
      </ol>

      {step === 0 ? <>
        <div className="mb-6 grid gap-3 sm:grid-cols-3" role="group" aria-label="상담 예시 선택">
          {scenarios.map(s => <button key={s.id} type="button" aria-pressed={scenarioId === s.id} onClick={() => setScenarioId(s.id)} className={`rounded-xl border p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring ${scenarioId === s.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'}`}>
            <strong className="block text-sm">{s.label}</strong><span className="mt-2 block text-xs leading-relaxed text-muted-foreground">{s.hint}</span>
          </button>)}
        </div>
        <div className="grid items-start gap-5 lg:grid-cols-[1.3fr_1fr]">
          <Card className="gap-4 p-5 sm:p-6">
            <div><h2 className="font-semibold">{scenario.customer}</h2><p className="mt-1 text-xs text-muted-foreground">{scenario.source}</p></div>
            <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-4 text-sm leading-7">{scenario.transcript}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">시연에서는 준비된 기록을 사용합니다. 실제 제품에서는 고객 메시지 또는 녹음에서 변환한 텍스트가 들어올 자리입니다.</p>
            <Button onClick={prepare} className="self-start">정리 결과 보기 <ArrowRight aria-hidden="true" /></Button>
          </Card>
          <Card className="gap-4 p-5 sm:p-6">
            <h2 className="font-semibold">원래 사람이 하던 일</h2>
            <ul className="grid gap-3 text-sm leading-relaxed">
              <li>1. 상담 내용을 다시 읽고 메모 작성</li><li>2. 할 일과 약속 날짜를 하나씩 확인</li><li>3. 기존 업무와 비교해 빠진 일을 등록</li>
            </ul>
            <p className="border-t pt-4 text-sm leading-relaxed">이 세 가지를 AI가 준비하고, 사람은 확인·수정하는 흐름을 체험합니다.</p>
            {!!scenario.existing.length && <div className="rounded-lg bg-muted/40 p-3 text-sm"><strong>이미 등록된 업무</strong>{scenario.existing.map(t => <p className="mt-2" key={t.id}>{typeLabel(t.taskType)} · {t.date}<br /><span className="text-muted-foreground">{t.description}</span></p>)}</div>}
          </Card>
        </div>
      </> : step === 1 ? <>
        <h2 ref={heading} tabIndex={-1} className="mb-2 text-xl font-semibold outline-none">정리 결과를 확인해 주세요</h2>
        <p className="mb-5 text-sm text-muted-foreground">미리 준비한 시연 결과입니다. 요약·업무·날짜를 수정하거나 등록하지 않을 업무를 해제할 수 있습니다.</p>
        <form onSubmit={approve} className="grid items-start gap-5 lg:grid-cols-[1fr_1.5fr]">
          <Card className="gap-4 p-5">
            <h3 className="flex items-center gap-2 font-semibold"><FileText size={18} aria-hidden="true" /> 원본 상담</h3>
            <p className="text-xs text-muted-foreground">{scenario.customer} · {scenario.source}</p>
            <p className="whitespace-pre-wrap text-sm leading-7">{scenario.transcript}</p>
            <p className="rounded-lg bg-muted/50 p-3 text-sm leading-relaxed">{scenario.check}</p>
          </Card>
          <div className="grid min-w-0 gap-4">
            <Card className="gap-3 p-5"><label htmlFor="demo-summary" className="font-semibold">상담 요약</label><Textarea id="demo-summary" required maxLength={1500} value={summary} onChange={e => { setSummary(e.target.value); setConfirmed(false); }} className="min-h-28" /></Card>
            {tasks.map((t, i) => <Card key={t.id} className="gap-4 p-5">
              <label className="flex items-center gap-3 font-semibold"><input type="checkbox" className="size-4" checked={t.selected} onChange={e => changeTask(t.id, { selected: e.target.checked })} /> 업무 {i + 1} 등록</label>
              <fieldset disabled={!t.selected} className="grid min-w-0 gap-4 disabled:opacity-50">
                <label className="grid gap-2 text-sm">업무 종류<NativeSelect value={t.taskType} onChange={e => changeTask(t.id, { taskType: e.target.value })}>{TASK_TYPES.filter(type => type.id !== 'other').map(type => <option key={type.id} value={type.id}>{type.label}</option>)}</NativeSelect></label>
                <label className="grid gap-2 text-sm">업무 내용<Textarea required maxLength={1000} value={t.description} onChange={e => changeTask(t.id, { description: e.target.value })} /></label>
                <label className="grid gap-2 text-sm">처리할 날짜 (선택)<Input type="date" value={t.date} onChange={e => changeTask(t.id, { date: e.target.value })} /></label>
                {!t.date && <p className="text-xs text-muted-foreground">날짜를 비워 두면 ‘기한 확인 필요’로 등록됩니다.</p>}
              </fieldset>
              <p className="rounded-md bg-muted/50 p-3 text-xs leading-relaxed"><strong>제안 근거</strong><br />“{t.evidence}”</p>
            </Card>)}
            <div className="rounded-lg border p-5">
              <label className="flex items-start gap-3 text-sm leading-relaxed"><input type="checkbox" className="mt-1 size-4 shrink-0" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />상담 요약과 선택한 업무·날짜를 확인했습니다.</label>
              <p className="mt-3 text-xs text-muted-foreground">등록 예정: 상담 기록 1건 · 새 업무 {selectedCount}건{scenario.existing.length ? ` · 기존 업무 ${scenario.existing.length}건 유지` : ''}</p>
              {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
              <div className="mt-4 flex flex-wrap gap-2"><Button type="submit" className="h-auto min-h-9 whitespace-normal" disabled={!confirmed || !summary.trim()}><Check aria-hidden="true" /> 승인하고 시연용 업무함에 등록</Button><Button type="button" variant="outline" onClick={reset}>처음으로</Button></div>
            </div>
          </div>
        </form>
      </> : <>
        <div className="mb-6 rounded-xl border bg-primary/5 p-5">
          <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold outline-none">시연용 업무함에 등록했습니다</h2>
          <p role="status" className="mt-2 text-sm">상담 기록 1건과 선택한 새 업무 {selectedCount}건을 반영했습니다. 실제 고객 DB에는 저장되지 않습니다.</p>
        </div>
        <div className="grid items-start gap-5 lg:grid-cols-[1fr_1.5fr]">
          <Card className="gap-4 p-5"><h3 className="font-semibold">{scenario.customer}</h3><Badge variant="secondary" className="self-start">시연용 상담 기록</Badge><p className="whitespace-pre-wrap text-sm leading-7">{summary}</p><p className="border-t pt-3 text-xs text-muted-foreground">다음은 사람이 견적을 작성하거나 고객에게 연락하는 단계입니다.</p></Card>
          <div className="grid min-w-0 gap-3">
            <h3 className="flex items-center gap-2 font-semibold"><ClipboardList size={18} aria-hidden="true" /> 시연용 업무함 · {saved.length}건</h3>
            {!saved.length && <p className="rounded-lg border p-4 text-sm">상담 기록만 등록했습니다. 선택한 업무가 없습니다.</p>}
            {saved.map(t => <Card key={t.id} className="gap-3 p-5">
              <div className="flex flex-wrap gap-2"><Badge variant="secondary">{t.complete ? '처리 완료' : t.date ? '예정 업무' : '기한 확인 필요'}</Badge>{scenario.existing.some(old => old.id === t.id) && <Badge variant="outline">기존 업무 유지</Badge>}</div>
              <h4 className="font-semibold">{typeLabel(t.taskType)}</h4><p className="whitespace-pre-wrap break-words text-sm">{t.description}</p><p className="text-xs text-muted-foreground">{t.date || '처리 날짜를 확인해 주세요.'}</p>
              <Button className="self-end" variant="outline" onClick={() => setSaved(old => old.map(item => item.id === t.id ? { ...item, complete: !item.complete } : item))}>{t.complete ? '완료 취소' : '처리 완료로 표시'}</Button>
            </Card>)}
            <Button className="mt-3 justify-self-start" variant="outline" onClick={reset}><RotateCcw aria-hidden="true" /> 다른 예시로 다시 체험</Button>
          </div>
        </div>
      </>}
    </main>
  </div>;
}
