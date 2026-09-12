import {useCallback,useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
import {createId} from '../../../../packages/domain/id';
import {request} from './api';
type Job={id:string;kind:string;status:string;attempts:number;reason:string;created_at:string;next_run:string};
type Mail={id:string;recipient:string;subject:string;body:string;created_at:string};
type State={jobs:Job[];messages:Mail[];runtime:{name:string;last_tick:string;error:string}[]};
const labels:Record<string,string>={queued:'처리 대기',retry:'재시도 대기',reviewed:'검수함 저장 완료',skipped:'대상 없음·생략',failed:'처리 실패',blocked:'인증 확인 필요',unknown:'결과 확인 필요'};
const kinds:Record<string,string>={receipt:'고객 접수 확인',assignment:'직원 접수 알림',daily:'15시 통합 알림',first_reminder:'16시 30분 첫 연락 알림',review:'현재 업무 미리보기'};
const date=(value:string)=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
export function Notifications(){
  const [state,setState]=useState<State|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const key=useRef(createId());
  const load=useCallback(async()=>{try{setState(await request('/notifications'));setError('');}catch(e){setError((e as Error).message);}},[]);
  useEffect(()=>{void load();const timer=setInterval(()=>void load(),5000);return()=>clearInterval(timer);},[load]);
  async function preview(){if(busy)return;setBusy(true);setError('');try{await request('/notifications/review','POST',{},key.current);key.current=createId();setNotice('검수 요청을 등록했습니다. 수 초 뒤 결과가 표시됩니다. 대상이 없으면 생략으로 기록됩니다.');await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <div className="grid min-w-0 gap-5"><div><h1 className="text-2xl font-semibold">알림·실행 내역</h1><p className="mt-2 text-sm text-muted-foreground">신규 상담 알림과 기한 알림의 내용·처리 결과를 확인합니다.</p></div>
    <Card className="min-w-0 gap-3 p-5"><strong>검수용 수신함 · 실제 이메일 미발송</strong><p className="text-sm text-muted-foreground">메일 계정 연결 전입니다. 이 화면에 저장된 내용만 확인할 수 있으며, 고객이나 직원의 실제 수신함으로 보내지 않습니다.</p><div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={()=>void preview()}>{busy?'등록 중…':'내 현재 업무 알림 미리보기'}</Button><Button variant="outline" onClick={()=>void load()}>새로 불러오기</Button></div><p className="text-xs text-muted-foreground">미리보기는 내 기한 초과·오늘 마감·기한 미정·다음 행동 누락을 확인합니다. 예약 알림은 영업일 15시와 16시 30분에 정해진 대상만 처리합니다.</p></Card>
    {notice&&<p role="status" className="text-sm">{notice}</p>}{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {state&&<><div className="grid min-w-0 gap-5 lg:grid-cols-2"><section className="grid min-w-0 content-start gap-3"><h2 className="font-semibold">알림 내용 · {state.messages.length}</h2>{!state.messages.length&&<p className="text-sm text-muted-foreground">아직 저장된 알림이 없습니다.</p>}{state.messages.map(m=><Card key={m.id} className="min-w-0 gap-3 p-4"><strong className="break-words text-sm">{m.subject}</strong><p className="break-all text-xs text-muted-foreground">받는 주소(검수): {m.recipient} · {date(m.created_at)}</p><details><summary className="cursor-pointer text-sm">알림 본문 보기</summary><div className="mt-3 grid min-w-0 gap-2 text-sm">{m.body.split('\n').map((line,i)=>{const match=/^\s*http:\/\/127\.0\.0\.1:4180(\/live\/cases\/[0-9a-f-]+)$/.exec(line);return match?<Link key={i} className="underline" to={match[1]}>영업건 열기</Link>:<p key={i} className="whitespace-pre-wrap break-words">{line||' '}</p>;})}</div></details></Card>)}</section><section className="grid min-w-0 content-start gap-3"><h2 className="font-semibold">처리 기록 · {state.jobs.length}</h2>{!state.jobs.length&&<p className="text-sm text-muted-foreground">아직 등록된 알림 작업이 없습니다.</p>}{state.jobs.map(j=><Card key={j.id} className="min-w-0 gap-2 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{kinds[j.kind]||j.kind}</strong><Badge variant={['failed','blocked','unknown'].includes(j.status)?'destructive':'secondary'}>{labels[j.status]||j.status}</Badge></div><p className="text-sm text-muted-foreground">{j.reason||'실행 순서를 기다리고 있습니다.'}</p><p className="text-xs text-muted-foreground">{date(j.created_at)} · 시도 {j.attempts}회{j.status==='retry'?` · 다음 시도 ${date(j.next_run)}`:''}</p></Card>)}</section></div><details className="rounded-md border p-4"><summary className="cursor-pointer text-sm">자동 처리 상태</summary><p className="mt-3 text-xs text-muted-foreground">예약·처리 서버가 실행 중일 때 동작합니다. 휴일 달력은 운영 전 설정해야 합니다.</p>{state.runtime.map(r=><p className="mt-2 text-xs" key={r.name}>{r.name==='scheduler'?'알림 예약':r.name==='worker'?'알림 처리':'자동 처리'} · 마지막 확인 {date(r.last_tick)} {r.error}</p>)}</details><p className="text-xs text-muted-foreground">최근 알림·처리 기록 각각 최대 100개를 표시합니다. 고객 접수 확인 내용은 관리자에게만 표시됩니다.</p></>}
  </div>;
}
