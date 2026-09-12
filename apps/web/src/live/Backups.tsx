import {useEffect,useRef,useState} from 'react';
import {Card} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {request} from './api';
import {createId} from '../../../../packages/domain/id';

type Backup={id:string;status:'creating'|'ready'|'failed';reason:string;filename:string|null;counts:Record<string,number>|null;createdAt:string;verifiedAt:string|null;message:string};
const label={creating:'생성 중·결과 확인 필요',ready:'복원 검증 완료',failed:'실패'};
const date=(s:string)=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(new Date(s));
export function Backups(){
  const [items,setItems]=useState<Backup[]>([]),[reason,setReason]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);const key=useRef(createId());
  async function load(){try{const r=await request('/admin/backups');setItems(r.items);}catch(e){setError((e as Error).message);}}
  useEffect(()=>{void load();const timer=setInterval(()=>void load(),10000);return()=>clearInterval(timer);},[]);
  async function create(){if(busy)return;setBusy(true);setError('');setNotice('');try{const r:Backup=await request('/admin/backups','POST',{reason},key.current);setNotice(r.status==='ready'?'암호화 백업을 저장하고 별도 DB에서 복원을 검증했습니다.':'백업 상태를 아래 목록에서 확인해 주세요.');if(r.status!=='creating'){key.current=createId();setReason('');}await load();}catch(e){setError((e as Error).message);await load();}finally{setBusy(false);}}
  return <section className="grid min-w-0 gap-3 border-t pt-6"><h2 className="font-semibold">데이터 백업</h2><p className="text-sm text-muted-foreground">우리 회사의 고객·업무·사용자·변경 기록을 이 컴퓨터에 암호화해서 보관합니다. 백업마다 별도 데이터베이스에서 복원을 확인합니다.</p><form className="flex flex-wrap items-end gap-3" onSubmit={e=>{e.preventDefault();void create();}}><label className="grid min-w-0 flex-1 gap-2 text-sm">백업 이유<Input required maxLength={500} value={reason} onChange={e=>{setReason(e.target.value);key.current=createId();}} placeholder="예: 운영 기준 변경 전 보관"/></label><Button disabled={busy}>{busy?'백업·복원 검증 중…':'백업 만들기'}</Button></form>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{notice&&<p role="status" className="text-sm">{notice}</p>}<p className="text-xs text-muted-foreground">현재는 로컬 백업입니다. 컴퓨터 고장에도 대비하려면 운영자가 백업 파일과 복원 키를 별도 저장소에 보관해야 합니다. 기존 데이터에 덮어쓰는 복원 버튼은 제공하지 않습니다.</p>{!items.length&&<p className="text-sm text-muted-foreground">아직 생성한 백업이 없습니다.</p>}{items.map(b=><Card key={b.id} className="min-w-0 gap-2 p-4"><div className="flex flex-wrap justify-between gap-2"><strong className="break-words text-sm">{b.reason}</strong><span className="text-sm">{label[b.status]}</span></div><p className="text-xs text-muted-foreground">{date(b.createdAt)}{b.verifiedAt?` · 검증 ${date(b.verifiedAt)}`:''}</p><p className="text-sm">{b.message||'완료되지 않은 실행은 서버 상태를 확인해 주세요.'}</p>{b.counts&&<p className="text-sm">영업건 {b.counts.crm_cases}개 · 업무 {b.counts.crm_tasks}개 · 사용자 {b.counts.crm_users}명</p>}{b.filename&&<p className="break-all text-xs text-muted-foreground">보관 파일: {b.filename}</p>}</Card>)}<p className="text-xs text-muted-foreground">최근 20개 생성 기록을 표시합니다. 백업 파일은 자동 삭제하지 않습니다.</p></section>;
}
