import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {NativeSelect} from '@/components/ui/native-select';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {TASK_TYPES} from '../../../../packages/domain/task-types';
import {STAGES} from '../../../../packages/domain/crm';
import {createId} from '../../../../packages/domain/id';
import {request} from './api';
import type {CaseData} from './CaseActions';

type SalesCase=CaseData&{followUp?:{cause:string;taskType:string;title?:string};reason?:string};
type Task={id:string;title:string;status:string;excluded:boolean;kind:string;dueAt:string|null;taskType:string};
type Detail={salesCase:SalesCase;tasks:Task[];linkedContacts:SalesCase[];notes:{id:string;body:string;sourcePerson?:string}[]};
const openTasks=(d:Detail)=>d.tasks.filter(t=>t.status==='incomplete'&&!t.excluded);
const when=(date:string|null)=>date?new Date(date).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'}):'기한 확인 필요';
const closing=(stage:string)=>['서비스 완료','종료'].includes(stage);

export function NextStepGuide({id,onClose,onSaved}:{id:string;onClose:()=>void;onSaved:(id:string)=>Promise<void>}){
  const [detail,setDetail]=useState<Detail|null>(null),[candidates,setCandidates]=useState<SalesCase[]>([]),[target,setTarget]=useState<Detail|null>(null);
  const [step,setStep]=useState('next'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [situation,setSituation]=useState(''),[stage,setStage]=useState(''),[taskType,setTaskType]=useState('follow-up'),[description,setDescription]=useState(''),[date,setDate]=useState(''),[createTask,setCreateTask]=useState(true);
  const [confirmed,setConfirmed]=useState(false),[reason,setReason]=useState(''),[keep,setKeep]=useState<string[]>([]);
  const key=useRef(createId());
  async function refresh(){
    const d=await request(`/cases/${id}`);if(d.redirectId){await onSaved(d.redirectId);return;}
    setDetail(d);setStage(d.salesCase.stage);setTarget(null);setConfirmed(false);setSituation('');
    const related=await request(`/cases/${id}/related`);setCandidates(related.items);
    setStep(d.salesCase.followUp?.cause==='consultation'&&related.items.length?'related':'next');key.current=createId();
  }
  useEffect(()=>{void refresh().catch(e=>setError(e.message));},[id]);
  function choose(value:string){
    if(!detail)return;setSituation(value);setConfirmed(false);setCreateTask(true);setDate('');key.current=createId();
    const c=detail.salesCase;const afterQuote=c.followUp?.taskType==='quote';
    const rules:Record<string,[string,string,string]>={
      waiting:[afterQuote?'제안·협의':c.stage,afterQuote?'quote-response':'follow-up',afterQuote?'전달한 견적에 대한 고객 답변 확인':'고객 답변 확인 후 다음 진행 결정'],
      revise:['제안·협의','quote','고객 수정 요청을 반영하여 견적 작성·전달'],
      negotiating:['제안·협의','terms','고객과 계약 조건 협의'],
      agreed:['계약 완료','service-schedule','확정된 계약에 따라 서비스 일정 확인'],
      working:['서비스 진행','progress','약속한 작업의 진행 상황 확인'],
      canceled:['종료','follow-up',''],
      finished:['서비스 완료','follow-up',''],
      custom:[c.stage,'follow-up',''],
    };
    const suggestion=rules[value];if(suggestion){
      const stages:readonly string[]=STAGES;
      // Revised quotes can happen after a contract: keep the later stage unless the user explicitly changes it.
      const suggestedStage=closing(suggestion[0])||stages.indexOf(suggestion[0])>=stages.indexOf(c.stage)?suggestion[0]:c.stage;
      setStage(suggestedStage);setTaskType(suggestion[1]);setDescription(suggestion[2]);if(closing(suggestedStage))setCreateTask(false);
    }
  }
  async function save(){
    if(!detail||busy)return;setBusy(true);setError('');
    try{
      if(target){const result=await request(`/cases/${id}/link`,'POST',{targetId:target.salesCase.id,expectedVersion:detail.salesCase.version,targetVersion:target.salesCase.version,keepTaskIds:keep,reason,confirmed},key.current);await onSaved(result.id);}
      else{await request(`/cases/${id}/follow-up`,'POST',{expectedVersion:detail.salesCase.version,stage,situation:({waiting:'고객 답변 대기',revise:'수정 요청',negotiating:'조건 협의 중',agreed:'계약 확정',working:'서비스 진행',canceled:'요청 취소',finished:'서비스 완료',custom:'직접 다음 진행 결정'} as Record<string,string>)[situation],createTask:!closing(stage)&&createTask,taskType,description,date,confirmed},key.current);await onSaved(id);}
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogTitle>{target?'같은 요청으로 묶기':step==='related'?'기존 영업건과 같은 요청인가요?':'완료 후 다음 진행 정하기'}</DialogTitle><DialogDescription>AI 연결 전 · 규칙 기반 안내입니다. 확인하고 승인한 변경은 현재 업무 화면과 서버에 저장됩니다.</DialogDescription>
    {error&&<div role="alert" className="grid gap-2 rounded border p-3 text-sm"><p>{error}</p><Button variant="outline" disabled={busy} onClick={()=>void refresh().then(()=>setError('')).catch(e=>setError(e.message))}>최신 내용 다시 확인</Button></div>}
    {!detail?<p>상담 기록을 불러오는 중…</p>:target?<>
      <div className="grid gap-3 sm:grid-cols-2">{[detail,target].map((d,i)=><Card key={d.salesCase.id} className="gap-2 p-4 text-sm"><strong>{i?'함께 관리할 기존 건':'추가로 접수된 건'} · {d.salesCase.name}</strong><p>{d.salesCase.person} · {d.salesCase.phone}</p><p>{d.salesCase.requestMemo}</p><p className="text-muted-foreground">최근 상담: {d.notes[0]?.body||'메모 없음'}</p><p>우리 담당자: {d.salesCase.assigneeName}</p></Card>)}</div>
      <p className="text-sm">연락처와 상담 이력은 모두 남습니다. 이후 기존 건의 담당자가 함께 관리하며, 어느 고객 담당자 이름으로 검색해도 이 영업건을 찾습니다.</p>
      <div className="rounded border p-3 text-sm"><strong>기존 건에서 유지되는 업무</strong>{openTasks(target).map(t=><p key={t.id}>{t.title} · {when(t.dueAt)}</p>)}{!openTasks(target).length&&<p>미완료 업무 없음</p>}</div>
      <div className="grid gap-2 rounded border p-3 text-sm"><strong>추가 건에서 함께 가져올 업무</strong><p>겹치는 업무는 체크를 해제하세요. 기록은 ‘관리 제외’로 남습니다.</p>{openTasks(detail).filter(t=>t.kind==='work').map(t=><label key={t.id} className="flex items-start gap-2"><input type="checkbox" checked={keep.includes(t.id)} onChange={e=>{setKeep(v=>e.target.checked?[...v,t.id]:v.filter(x=>x!==t.id));key.current=createId();setConfirmed(false);}}/>{t.title} · {when(t.dueAt)}</label>)}{!openTasks(detail).some(t=>t.kind==='work')&&<p>추가할 미완료 업무 없음</p>}<p>추가 건의 미완료 첫 연락과 대기 중인 변경 요청은 종료하고 기존 건에서 이어갑니다.</p></div>
      <label className="grid gap-2 text-sm">같은 요청인 이유<Textarea value={reason} maxLength={1000} placeholder="예: 같은 부서에서 같은 2층 에어컨 3대 점검 건으로 연락함" onChange={e=>{setReason(e.target.value);key.current=createId();}}/></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>{setConfirmed(e.target.checked);key.current=createId();}}/>업체뿐 아니라 부서·장소·실제 요청도 같은 건이며, 위 업무 처리와 담당자를 확인했습니다.</label>
      <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={busy} onClick={()=>{setTarget(null);setConfirmed(false);}}>다시 비교</Button><Button disabled={busy||!confirmed||!reason.trim()} onClick={()=>void save()}>같은 건으로 묶고 이어서 정리</Button></div>
    </>:step==='related'?<>
      <Card className="gap-2 p-4 text-sm"><strong>이번 상담 · {detail.salesCase.person}</strong><p>{detail.salesCase.requestMemo}</p><p>{detail.notes[0]?.body}</p></Card><p className="text-sm">업체명이 같은 후보입니다. 2층 에어컨과 4층 실외기처럼 다른 요청이면 따로 유지하세요.</p>
      {candidates.map(c=><Card key={c.id} className="gap-2 p-4 text-sm"><strong>{c.name} · {c.person}</strong><p>{c.requestMemo}</p><p>{c.reason}</p><Button variant="outline" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const d=await request(`/cases/${c.id}`);if(d.redirectId)throw new Error('후보가 변경되었습니다. 최신 내용을 다시 확인하세요.');setTarget(d);setKeep(openTasks(detail).filter(t=>t.kind==='work').map(t=>t.id));setConfirmed(false);key.current=createId();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>이 건과 비교</Button></Card>)}
      {!candidates.length&&<p className="text-sm">접근 가능한 같은 업체의 진행 중인 영업건이 없습니다.</p>}
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>나중에 확인</Button><Button onClick={()=>setStep('next')}>별도 요청으로 유지 · 다음 진행</Button></div>
    </>:<>
      <p className="rounded border p-3 text-sm">{detail.salesCase.followUp?.title?`완료한 업무: ${detail.salesCase.followUp.title}`:'상담 기록을 저장했습니다.'} 고객의 실제 상황에 맞춰 다음 진행을 선택하세요.</p>
      <Button variant="outline" onClick={()=>setStep('related')}>같은 업체의 다른 요청 확인 ({candidates.length})</Button>
      <label className="grid gap-2 text-sm">현재 고객 상황<NativeSelect value={situation} onChange={e=>choose(e.target.value)}><option value="">상황을 선택하세요</option><option value="waiting">고객 답변을 기다리고 있어요</option><option value="revise">내용을 수정해 달라고 했어요</option><option value="negotiating">진행 의사가 있어 조건을 협의해요</option><option value="agreed">계약이 확정됐어요</option><option value="working">서비스·작업을 시작했어요</option><option value="finished">서비스 제공과 완료 확인을 마쳤어요</option><option value="canceled">고객이 요청을 취소했어요</option><option value="custom">다음 진행을 직접 정할게요</option></NativeSelect></label>
      {situation&&<><label className="grid gap-2 text-sm">영업 단계 · 현재 {detail.salesCase.stage}<NativeSelect value={stage} onChange={e=>{setStage(e.target.value);setConfirmed(false);key.current=createId();}}>{STAGES.map(s=><option key={s}>{s}</option>)}</NativeSelect></label>
        <div className="rounded border p-3 text-sm"><strong>{closing(stage)?'종료 후 업무 목록에서 제외되는 미완료 업무':'이미 등록된 미완료 업무'}</strong>{openTasks(detail).map(t=><p key={t.id}>{t.title} · {when(t.dueAt)}</p>)}{!openTasks(detail).length&&<p>없음</p>}</div>
        {!closing(stage)&&<><label className="flex gap-2 text-sm"><input type="checkbox" checked={createTask} onChange={e=>{setCreateTask(e.target.checked);setConfirmed(false);key.current=createId();}}/>새로운 다음 업무 추가 (이미 있으면 체크 해제)</label>{createTask&&<><label className="grid gap-2 text-sm">다음 업무<NativeSelect value={taskType} onChange={e=>{setTaskType(e.target.value);setConfirmed(false);key.current=createId();}}>{TASK_TYPES.map(t=><option value={t.id} key={t.id}>{t.label}</option>)}</NativeSelect></label><label className="grid gap-2 text-sm">구체적인 내용<Textarea value={description} maxLength={1000} onChange={e=>{setDescription(e.target.value);setConfirmed(false);key.current=createId();}}/></label><label className="grid gap-2 text-sm">처리할 날짜 · 모르면 비워 두세요<Input type="date" value={date} onChange={e=>{setDate(e.target.value);setConfirmed(false);key.current=createId();}}/></label><p className="text-xs text-muted-foreground">날짜가 없으면 ‘기한 확인 필요’에 표시됩니다. 날짜를 임의로 정하지 않습니다.</p></>}</>}
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>{setConfirmed(e.target.checked);key.current=createId();}}/>{closing(stage)?'고객의 종료 상태와 남은 업무가 목록에서 제외되는 것을 확인했습니다.':'현재 상황, 변경할 단계와 다음 업무를 확인했습니다.'}</label>
      </>}
      <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={busy} onClick={onClose}>나중에 결정</Button><Button disabled={busy||!situation||!confirmed} onClick={()=>void save()}>{busy?'저장 중…':'승인하고 업무에 반영'}</Button></div>
    </>}
  </DialogContent></Dialog>;
}
