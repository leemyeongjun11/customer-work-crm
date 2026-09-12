import { useRef, useState, type ReactNode, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { STAGES, type Stage } from '../../../../packages/domain/crm';
import { createId } from '../../../../packages/domain/id';
import { request, RequestError } from './api';

export type CaseData={id:string;name:string;person:string;phone:string;email:string;size:string;customerType:string;requestMemo:string;stage:Stage;assigneeId:string;assigneeName:string;receivedAt:string;version:number;original:{memo:string}};
export type Proposal={id:string;type:'close'|'service_complete'|'reassign';reason:string;status:string;version:number};
type Preview={proposal:Proposal;salesCase:CaseData;openTasks:{id:string;title:string;dueAt:string|null}[];proposedAssignee:{id:string;name:string;active:boolean}|null;canDecide:boolean};
type Mode='customer'|'stage'|'close'|'service_complete'|'reassign';
const titles={customer:'고객 정보 수정',stage:'영업 단계 변경',close:'영업건 종료',service_complete:'서비스 완료',reassign:'담당자 변경'};
function Field({label,children}:{label:string;children:ReactNode}){return <label className="grid min-w-0 gap-2 text-sm font-medium">{label}{children}</label>;}
export const isCaseClosed=(stage:string)=>stage==='종료'||stage==='서비스 완료';
export function ChangeSummary({payload:p}:{payload:Record<string,unknown>}){
  const before=p.before as Record<string,unknown>|undefined,after=p.after as Record<string,unknown>|undefined;
  return <>{p.beforeStage!==p.afterStage&&typeof p.afterStage==='string'&&<p className="text-sm">단계: {String(p.beforeStage)} → {p.afterStage}</p>}{p.beforeAssigneeId!==p.afterAssigneeId&&typeof p.afterAssigneeName==='string'&&<p className="text-sm">담당자: {String(p.beforeAssigneeName)} → {p.afterAssigneeName}</p>}{before&&after&&<details><summary className="cursor-pointer text-sm">수정 전후 보기</summary><dl className="mt-3 grid gap-3 text-sm">{[['name','이름·업체명'],['customerType','신청 유형'],['person','고객 담당자'],['phone','연락처'],['email','이메일'],['size','회사 규모'],['requestMemo','고객 요청 내용']].filter(([k])=>before[k]!==after[k]).map(([k,label])=><div key={k}><dt className="font-medium">{label}</dt><dd className="whitespace-pre-wrap break-words text-muted-foreground">{String(before[k]||'없음')} → {String(after[k]||'없음')}</dd></div>)}</dl></details>}</>;
}

export function CaseActions({salesCase:c,proposals,role,onSaved}:{salesCase:CaseData;proposals:Proposal[];role:string;onSaved:()=>Promise<void>}){
  const [mode,setMode]=useState<Mode|null>(null),[snapshot,setSnapshot]=useState(c),[form,setForm]=useState<Record<string,string>>({});
  const [users,setUsers]=useState<{id:string;name:string;role:string}[]>([]),[preview,setPreview]=useState<Preview|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false),[confirmed,setConfirmed]=useState(false),[rejectReason,setRejectReason]=useState('');
  const [latest,setLatest]=useState<CaseData|null>(null);
  const key=useRef(createId());
  const change=(name:string,value:string)=>{setForm(v=>({...v,[name]:value}));key.current=createId();};
  async function open(next:Mode){
    setBusy(true);setError('');setConflict(false);setLatest(null);
    try{
      const fresh=(await request(`/cases/${c.id}`)).salesCase as CaseData;
      if(isCaseClosed(fresh.stage))throw new Error('종료된 영업건입니다. 최신 화면을 확인해 주세요.');
      if(next==='reassign')setUsers((await request('/assignees')).items.filter((u:{id:string})=>u.id!==fresh.assigneeId));
      setSnapshot(fresh);setForm({customerType:fresh.customerType,name:fresh.name,person:fresh.person,phone:fresh.phone,email:fresh.email,size:fresh.size,requestMemo:fresh.requestMemo,stage:fresh.stage,reason:'',proposedAssigneeId:''});
      key.current=createId();setMode(next);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function review(id:string){
    setBusy(true);setError('');
    try{setPreview(await request(`/change-proposals/${id}/preview`));setConfirmed(false);setRejectReason('');setConflict(false);key.current=createId();}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function save(event:FormEvent){
    event.preventDefault();if(busy||!mode)return;setBusy(true);setError('');
    try{
      const base={expectedVersion:snapshot.version,reason:form.reason};
      if(mode==='customer')await request(`/cases/${c.id}`,'PATCH',{...base,...Object.fromEntries(['customerType','name','person','phone','email','size','requestMemo'].map(k=>[k,form[k]]))},key.current);
      else if(mode==='stage')await request(`/cases/${c.id}/stage`,'POST',{...base,stage:form.stage},key.current);
      else {
        const r=await request(`/cases/${c.id}/change-proposals`,'POST',{...base,type:mode,...(mode==='reassign'?{proposedAssigneeId:form.proposedAssigneeId}:{})},key.current);
        setPreview(await request(`/change-proposals/${r.id}/preview`));setConfirmed(false);setRejectReason('');key.current=createId();
      }
      setMode(null);setConflict(false);await onSaved();
    }catch(e){setError((e as Error).message);setConflict(e instanceof RequestError&&e.status===409);}finally{setBusy(false);}
  }
  async function decide(action:'approve'|'reject'){
    if(!preview||busy)return;
    if(action==='reject'&&!rejectReason.trim()){setError('제외 이유를 입력해 주세요.');return;}
    setBusy(true);setError('');
    try{
      await request(`/change-proposals/${preview.proposal.id}/${action}`,'POST',{expectedCaseVersion:preview.salesCase.version,expectedProposalVersion:preview.proposal.version,...(action==='approve'?{confirmed}:{reason:rejectReason})},key.current);
      setPreview(null);setConflict(false);await onSaved();
    }catch(e){setError((e as Error).message);setConflict(e instanceof RequestError&&e.status===409);}finally{setBusy(false);}
  }
  return <div className="mb-6 grid min-w-0 gap-3">
    {!isCaseClosed(c.stage)&&<div className="flex flex-wrap gap-2">{(['customer','stage',...(role==='admin'?['reassign']:[]),'service_complete','close'] as Mode[]).map(action=><Button key={action} variant="outline" size="sm" disabled={busy} onClick={()=>void open(action)}>{titles[action]}</Button>)}</div>}
    {isCaseClosed(c.stage)&&<p className="rounded-md border bg-muted/40 p-4 text-sm">{c.stage} 처리된 영업건입니다. 남은 업무를 완료로 바꾸지 않고 보존했으며, 오늘 할 일에서 제외됩니다.</p>}
    {proposals.map(p=><Card key={p.id} className="min-w-0 gap-3 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><strong className="text-sm">{titles[p.type]} · 확인 대기</strong><Button variant="outline" size="sm" disabled={busy} onClick={()=>void review(p.id)}>변경 내용 확인</Button></div><p className="break-words text-sm text-muted-foreground">{p.reason}</p><p className="text-xs text-muted-foreground">아직 실제 단계와 담당자는 변경되지 않았습니다.</p></Card>)}
    {!mode&&!preview&&error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    <Dialog open={!!mode} onOpenChange={v=>{if(!v&&!busy){setMode(null);setError('');}}}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogTitle>{mode?titles[mode]:''}</DialogTitle><DialogDescription>{mode==='customer'?'고객 정보의 수정본을 저장합니다. 접수 당시 원문은 보존됩니다.':mode==='stage'?'현재 진행 단계를 변경하고 이유를 기록합니다.':'이유를 입력한 후 남은 업무와 변경 영향을 확인합니다.'}</DialogDescription><form onSubmit={save}><fieldset disabled={busy} className="grid min-w-0 gap-4">
      {mode==='customer'&&<><Field label="신청 유형"><NativeSelect value={form.customerType} onChange={e=>change('customerType',e.target.value)}><option value="company">회사·업체</option><option value="person">개인</option></NativeSelect></Field><Field label="이름·업체명"><Input required maxLength={200} value={form.name} onChange={e=>change('name',e.target.value)}/></Field>{form.customerType==='company'&&<Field label="고객 담당자명"><Input required maxLength={200} value={form.person} onChange={e=>change('person',e.target.value)}/></Field>}<Field label="연락처"><Input type="tel" required maxLength={30} value={form.phone} onChange={e=>change('phone',e.target.value)}/></Field><Field label="이메일"><Input type="email" required maxLength={254} value={form.email} onChange={e=>change('email',e.target.value)}/></Field><Field label="회사 규모 (선택)"><Input maxLength={100} value={form.size} onChange={e=>change('size',e.target.value)}/></Field><Field label="고객 요청 내용 · 수정본"><Textarea required maxLength={4000} value={form.requestMemo} onChange={e=>change('requestMemo',e.target.value)}/></Field></>}
      {mode==='stage'&&<Field label="변경할 단계"><NativeSelect value={form.stage} onChange={e=>change('stage',e.target.value)}>{STAGES.slice(0,5).map(s=><option key={s} disabled={s===snapshot.stage}>{s}</option>)}</NativeSelect></Field>}
      {mode==='reassign'&&<><p className="text-sm">현재 담당자: {snapshot.assigneeName}</p><Field label="새 담당자"><NativeSelect required value={form.proposedAssigneeId} onChange={e=>change('proposedAssigneeId',e.target.value)}><option value="">선택하세요</option>{users.map(u=><option key={u.id} value={u.id}>{u.name} · {u.role==='admin'?'관리자':'직원'}</option>)}</NativeSelect></Field></>}
      <Field label="변경 이유"><Textarea required maxLength={1000} value={form.reason||''} onChange={e=>change('reason',e.target.value)}/></Field>
      {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{conflict&&<Button type="button" variant="outline" onClick={async()=>{setBusy(true);try{const fresh=(await request(`/cases/${c.id}`)).salesCase;setLatest(fresh);setSnapshot(fresh);setConflict(false);setError('');key.current=createId();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>최신 내용 확인 · 입력 유지</Button>}
      {latest&&<div className="rounded-md border bg-muted/40 p-4 text-sm"><p className="font-medium">최신 저장 내용과 위 입력을 비교해 주세요.</p><p>단계: {latest.stage} · 담당자: {latest.assigneeName}</p>{mode==='customer'&&<div className="mt-2 break-words">{latest.name} / {latest.person}<br/>{latest.phone} / {latest.email}<p>{latest.requestMemo}</p></div>}</div>}
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={()=>{setMode(null);setError('');}}>닫기</Button><Button disabled={busy||isCaseClosed(snapshot.stage)}>{busy?'저장 중…':mode==='customer'||mode==='stage'?'저장':'변경 영향 확인'}</Button></div>
    </fieldset></form></DialogContent></Dialog>
    <Dialog open={!!preview&&!mode} onOpenChange={v=>{if(!v&&!busy){setPreview(null);setError('');}}}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogTitle>{preview?titles[preview.proposal.type]:''} · 최종 확인</DialogTitle><DialogDescription>아래 내용을 확인하고 확정해야 실제 변경됩니다. 창을 닫으면 확인 대기로 남습니다.</DialogDescription>{preview&&<div className="grid min-w-0 gap-4">
      <p className="text-sm"><strong>{preview.salesCase.name}</strong><br/>이유: {preview.proposal.reason}</p>
      <div className="rounded-md border bg-muted/40 p-4 text-sm">{preview.proposal.type==='reassign'?<>{preview.salesCase.assigneeName} → {preview.proposedAssignee?.name||'확인 불가'}<p className="mt-2">미완료 업무도 새 담당자에게 연결됩니다. 완료 기록의 실제 수행자는 유지됩니다.</p></>:<>{preview.salesCase.stage} → {preview.proposal.type==='close'?'종료':'서비스 완료'}<p className="mt-2">미완료 기록을 그대로 보존하고 오늘 할 일에서 제외합니다. 이메일 알림은 아직 연결 전입니다.</p></>}</div>
      <div><h3 className="mb-2 text-sm font-semibold">남은 업무 {preview.openTasks.length}개</h3><ul className="grid max-h-40 list-disc gap-2 overflow-auto pl-5 text-sm">{preview.openTasks.map(t=><li className="break-words" key={t.id}>{t.title}</li>)}</ul>{!preview.openTasks.length&&<p className="text-sm text-muted-foreground">남은 미완료 업무가 없습니다.</p>}</div>
      {preview.canDecide&&!isCaseClosed(preview.salesCase.stage)&&<label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>{setConfirmed(e.target.checked);}} className="mt-1"/>남은 업무와 변경 영향을 확인했습니다.</label>}
      {preview.canDecide&&<Field label="요청을 제외할 경우 이유"><Textarea value={rejectReason} disabled={busy} maxLength={1000} onChange={e=>{setRejectReason(e.target.value);key.current=createId();}}/></Field>}
      {!preview.canDecide&&<p className="text-sm text-muted-foreground">{preview.proposal.status!=='pending'?'이미 처리된 요청입니다.':'담당자 변경 확정은 관리자만 할 수 있습니다.'}</p>}
      {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{conflict&&<Button variant="outline" disabled={busy} onClick={()=>void review(preview.proposal.id)}>최신 영향 다시 확인</Button>}
      <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={busy} onClick={()=>{setPreview(null);setError('');}}>나중에 확인</Button>{preview.canDecide&&<><Button variant="outline" disabled={busy} onClick={()=>void decide('reject')}>요청 제외</Button><Button disabled={busy||!confirmed||isCaseClosed(preview.salesCase.stage)} onClick={()=>void decide('approve')}>확인하고 확정</Button></>}</div>
    </div>}</DialogContent></Dialog>
  </div>;
}
