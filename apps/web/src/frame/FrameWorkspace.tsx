import { createId } from '../../../../packages/domain/id.ts';
import { createContext, useContext, useEffect, useState, type ReactNode, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Menu, ArrowRight, CheckCircle2, Smartphone, Monitor, FileText } from 'lucide-react';
import { canRead, NOW, TODAY, workboard, visibleCases, type CRMState, type Role, type SalesCase } from '../../../../packages/domain/crm';
import { frameScreens } from './screens';

type Review = { pc: string; mobile: string; note: string };
type Member = { id: string; name: string; email: string; role: string; status: string };
type FileItem = { name: string; size: number };
const DemoContext = createContext<{
  members: Member[]; setMembers: (v: Member[]) => void;
  files: Record<string, FileItem[]>; setFiles: (v: Record<string, FileItem[]>) => void;
  policy: { owner: string; holiday: string }; setPolicy: (v: {owner: string; holiday: string}) => void;
}>(null!);
export function FrameProvider({ children }: { children: ReactNode }) {
  const [members, setMembers] = useState<Member[]>([
    { id: 'kim', name: '김담당', email: 'kim@example.com', role: '관리자', status: '사용 중' },
    { id: 'lee', name: '이담당', email: 'lee@example.com', role: '일반 직원', status: '사용 중' },
  ]);
  const [files, setFiles] = useState<Record<string, FileItem[]>>({});
  const [policy, setPolicy] = useState({ owner: '김담당', holiday: '2026-09-24' });
  return <DemoContext.Provider value={{ members, setMembers, files, setFiles, policy, setPolicy }}>{children}</DemoContext.Provider>;
}
type Props = { state: CRMState; role: Role; updateState: (s: CRMState) => void; setRole: (r: Role) => void };
const nav = [
  ['오늘 할 일', '/today'], ['영업건', '/cases'], ['AI 활동', '/activity'], ['알림', '/notifications'],
  ['첫 연락 성과', '/performance'], ['자동화 실행', '/automation/jobs'], ['운영 기준', '/settings'],
  ['사용자 관리', '/admin/users'], ['외부 연동', '/admin/integrations'], ['전체 프레임 검수', '/review'],
];
export function FullMenu({ role, setRole, onTools }: { role: Role; setRole: (r: Role) => void; onTools: () => void }) {
  const [open, setOpen] = useState(false);
  return <><Button variant="ghost" size="icon" aria-label="전체 메뉴" onClick={() => setOpen(true)}><Menu /></Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogTitle>전체 메뉴</DialogTitle><DialogDescription>프레임 02 · PC와 모바일에서 모든 화면을 확인합니다.</DialogDescription>
      <nav className="grid grid-cols-2 gap-2" aria-label="전체 화면 메뉴">{nav.map(([label, to]) => <Link className="rounded-md border px-3 py-3 text-sm hover:bg-muted" key={to} to={to} onClick={() => setOpen(false)}>{label}</Link>)}</nav>
      <label className="grid gap-2 text-sm">검수용 역할<NativeSelect value={role} onChange={e => setRole(e.target.value as Role)}><option value="admin">관리자</option><option value="staff">일반 직원 · 김담당</option><option value="agent">AI 에이전트</option></NativeSelect></label>
      <Button variant="outline" onClick={() => { setOpen(false); onTools(); }}>가상 데이터·실패 시나리오 도구</Button>
      <Link to="/login" onClick={() => setOpen(false)} className="text-sm underline">로그인 화면 검수</Link>
    </DialogContent></Dialog></>;
}
function Page({ title, description, children }: {title: string; description: string; children: ReactNode}) {
  return <div className="page frame-page"><div className="mb-6 flex flex-wrap items-start justify-between gap-3"><div><p className="mb-2 text-xs text-muted-foreground">프레임 02 · 동작 시연</p><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p></div><Link className="text-sm underline underline-offset-4" to="/review">전체 검수 목록</Link></div>{children}</div>;
}
function Notice({children}: {children: ReactNode}) { return <div className="rounded-md border bg-muted/40 p-4 text-sm leading-relaxed" role="status">{children}</div>; }
function Field({label, children}: {label: string; children: ReactNode}) { return <label className="grid gap-2 text-sm font-medium">{label}{children}</label>; }
function Submit({children = '저장 · 시연'}: {children?: ReactNode}) { return <Button type="submit">{children}</Button>; }
function ReviewHub() {
  const [results, setResults] = useState<Record<string, Review>>(() => {
    try { const data = JSON.parse(localStorage.getItem('crm-frame-02-review') || '{}'); return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; } catch { return {}; }
  });
  const [storageError, setStorageError] = useState(false);
  const [group, setGroup] = useState('전체');
  const [onlyPending, setOnlyPending] = useState(false);
  const [gate, setGate] = useState(false);
  const [exportUrl, setExportUrl] = useState('');
  useEffect(() => { try { localStorage.setItem('crm-frame-02-review', JSON.stringify(results)); } catch { setStorageError(true); } }, [results]);
  useEffect(() => () => { if (exportUrl) URL.revokeObjectURL(exportUrl); }, [exportUrl]);
  const passed = (id: string) => results[id]?.pc === 'pass' && results[id]?.mobile === 'pass';
  const count = frameScreens.filter(s => passed(s.id)).length;
  const pcCount = frameScreens.filter(s => results[s.id]?.pc === 'pass').length;
  const mobileCount = frameScreens.filter(s => results[s.id]?.mobile === 'pass').length;
  const update = (id: string, field: keyof Review, value: string) => {
    setGate(false); setResults(r => ({ ...r, [id]: { ...(r[id] || { pc: 'pending', mobile: 'pending', note: '' }), [field]: value } }));
  };
  return <Page title="전체 프레임 검수" description="모든 화면의 배치·이동·정상/예외 흐름을 확인합니다. PC와 모바일 검수 및 수정 반영 후 UI 의사결정으로 넘어갑니다.">
    <Card className="mb-6 gap-4 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><Badge variant="secondary">현재 단계 5.1</Badge><h2 className="mt-3 text-xl font-semibold">화면 검수 진행 현황</h2><p className="mt-1 text-sm text-muted-foreground">PC와 모바일에서 확인한 화면 수를 각각 보여드립니다.</p></div><Button disabled={count !== frameScreens.length} onClick={() => setGate(true)}>전체 검수 완료 확인</Button></div>
      <div className="grid gap-3 sm:grid-cols-3" aria-label="기기별 검수 현황">
        {[{ label: 'PC 완료', value: pcCount, icon: Monitor }, { label: '모바일 완료', value: mobileCount, icon: Smartphone }, { label: '모두 완료', value: count, icon: CheckCircle2 }].map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-md border p-4">
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="size-4" />{label}</p>
            <p className="my-2 text-xl font-semibold" aria-live="polite">{value} / {frameScreens.length}</p>
            <div role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={frameScreens.length} className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{width: `${value / frameScreens.length * 100}%`}} /></div>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">‘모두 완료’는 같은 화면의 PC와 모바일을 모두 확인한 수입니다. 한쪽만 확인해도 해당 기기의 완료 수는 올라갑니다. 선택과 의견은 자동 저장됩니다.</p>
      {gate ? <Notice>사용자가 전체 프레임 검수를 완료로 확인했습니다. 이제 다음 대화에서 UI 의사결정을 시작할 수 있습니다. 테마 선택은 그다음 단계입니다.</Notice> : <p className="text-sm">UI 의사결정 대기 · 모든 화면의 PC/모바일 항목이 ‘확인 완료’여야 완료 버튼이 활성화됩니다.</p>}
      <p className="text-xs text-muted-foreground">기록은 이 브라우저에만 보관됩니다. 휴대폰 검수 후 아래 의견을 내보내 전달하거나 PC 목록에 합쳐 기록해 주세요. 실제 계정·고객 자료는 입력하지 마세요.</p>
      {storageError && <Notice>브라우저 저장을 사용할 수 없습니다. 페이지를 닫기 전에 검수 기록을 내보내세요.</Notice>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setExportUrl(URL.createObjectURL(new Blob([JSON.stringify({ version: 'frame-02', exportedAt: new Date().toISOString(), results }, null, 2)], {type:'application/json'})))}>검수 기록 내보내기 준비</Button>{exportUrl && <a href={exportUrl} download="crm-frame-02-review.json" className="self-center text-sm underline">검수 기록 다운로드</a>}<Link to="/inquiry" className="self-center text-sm underline">접수부터 시작하기</Link></div>
    </Card>
    <div className="mb-5 grid gap-3 sm:grid-cols-2"><Field label="화면 구역"><NativeSelect value={group} onChange={e => setGroup(e.target.value)}>{['전체', ...new Set(frameScreens.map(s => s.group))].map(g => <option key={g}>{g}</option>)}</NativeSelect></Field><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyPending} onChange={e => setOnlyPending(e.target.checked)} />미완료 화면만 보기</label></div>
    <div className="grid gap-4 xl:grid-cols-2">{frameScreens.filter(s => (group === '전체' || s.group === group) && (!onlyPending || !passed(s.id))).map(s => <Card className="gap-4 p-5" key={s.id}>
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs text-muted-foreground">{s.group} · {s.id}</p><h2 className="mt-1 font-semibold">{s.title}</h2></div>{passed(s.id) && <CheckCircle2 className="size-5 shrink-0" aria-label="검수 완료" />}</div><p className="text-sm text-muted-foreground">{s.check}</p>
      <Link to={s.url} className="flex min-h-10 items-center gap-2 text-sm font-medium underline underline-offset-4">화면 열기<ArrowRight className="size-4" /></Link>
      <div className="grid grid-cols-2 gap-3">{(['pc', 'mobile'] as const).map(d => <Field key={d} label={`${s.title} · ${d === 'pc' ? 'PC' : '모바일'}`}><NativeSelect aria-label={`${s.title} ${d === 'pc' ? 'PC' : '모바일'} 검수`} value={results[s.id]?.[d] || 'pending'} onChange={e => update(s.id, d, e.target.value)}><option value="pending">미확인</option><option value="fix">수정 필요</option><option value="pass">확인 완료</option></NativeSelect></Field>)}</div>
      <Textarea aria-label={`${s.title} 수정 의견`} placeholder="불편한 점 / 원하는 변화" value={results[s.id]?.note || ''} onChange={e => update(s.id, 'note', e.target.value)} />
    </Card>)}</div>
  </Page>;
}

function Inquiry({state, updateState}: Props) {
  const [kind, setKind] = useState('company');
  const [failure, setFailure] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState('');
  const {policy} = useContext(DemoContext);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (failure) { setError('접수 연결에 실패했습니다. 입력은 유지됩니다. 실패 시연을 해제하고 다시 제출하세요.'); return; }
    const f = new FormData(e.currentTarget); const name = String(f.get('name')).trim(); const memo = String(f.get('memo')).trim();
    if (!name || !memo || (kind === 'company' && !String(f.get('person')).trim())) { setError('이름, 담당자, 요청 내용을 확인해 주세요.'); return; }
    const id = `c-${createId()}`;
    const c: SalesCase = { id, name, person: kind === 'person' ? name : String(f.get('person')).trim(), phone: String(f.get('phone')), email: String(f.get('email')), size: String(f.get('size') || '미정'), stage: '접수', assigneeId: policy.owner === '김담당' ? 'kim' : 'lee', original: memo, summary: memo, receivedAt: NOW, files: [], notes: [] };
    updateState({...state, cases: [c, ...state.cases], tasks: [{id: `t-${id}`, caseId: id, title: '신규 상담 첫 연락', kind: 'first', status: 'incomplete', excluded: false, dueAt: '2026-09-15T17:00:00+09:00', originalDueAt: '2026-09-15T17:00:00+09:00'}, ...state.tasks], activities: [{id: `a-${id}`, caseId: id, author: '시스템', kind: 'system', at: NOW, text: '[시연] 상담 접수 · 담당자와 첫 연락 기한 연결'}, ...state.activities]});
    setCreated(id); setError('');
  }
  return <Page title={created ? '상담 요청이 접수되었습니다' : '신규 상담 요청'} description="고객이 작성하는 공개 접수 화면의 목업입니다. 실제 전송 없이 현재 검수 공간에 가상 문의를 만듭니다.">
    {created ? <Card className="max-w-xl gap-4 p-6"><CheckCircle2 /><h2 className="text-lg font-semibold">담당자가 연락드리겠습니다.</h2><p className="text-sm">입력하신 연락처로 다음 영업일 안에 연락드립니다. 연락이 어려운 시간은 상담 내용에 남겨주세요.</p><Notice>접수 확인 이메일 화면 시연 · 실제 이메일은 발송되지 않았습니다.</Notice><Link className="underline" to={`/cases/${created}`}>검수용 CRM 반영 결과 확인</Link><Button variant="outline" onClick={() => setCreated('')}>새 상담 작성</Button></Card> : <Card className="max-w-2xl p-6"><form className="grid gap-5" onSubmit={submit}>
      <Field label="신청 유형"><NativeSelect value={kind} onChange={e => setKind(e.target.value)}><option value="company">회사·업체</option><option value="person">개인</option></NativeSelect></Field>
      <div className="grid gap-5 sm:grid-cols-2"><Field label={`${kind === 'company' ? '회사·업체명' : '이름'} *`}><Input name="name" required autoComplete="organization" /></Field>{kind === 'company' && <Field label="담당자명 *"><Input name="person" required autoComplete="name" /></Field>}<Field label="연락처 *"><Input name="phone" type="tel" required pattern="[0-9+() -]{8,20}" title="연락 가능한 전화번호를 입력하세요" autoComplete="tel" /></Field><Field label="이메일 *"><Input name="email" type="email" required autoComplete="email" /></Field></div>
      {kind === 'company' && <Field label="회사 규모 (선택)"><NativeSelect name="size">{['미정','1명','2~9명','10~49명','50~299명','300명 이상'].map(v => <option key={v}>{v}</option>)}</NativeSelect></Field>}
      <Field label="상담 내용 *"><Textarea name="memo" required rows={4} placeholder="요청하시는 서비스, 상담 배경, 연락 가능한 시간을 적어주세요." /></Field>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Submit>상담 요청 · 시연</Submit><label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={failure} onChange={e => setFailure(e.target.checked)} />검수용 접수 실패</label>
    </form></Card>}
  </Page>;
}
function Account({setRole}: Props) {
  const path = useLocation().pathname; const navigate = useNavigate();
  const [done, setDone] = useState(false); const [error, setError] = useState(false); const [role, changeRole] = useState<Role>('admin');
  const reset = path.endsWith('reset'); const invite = path.endsWith('invite');
  return <Page title={reset ? '비밀번호 재설정' : invite ? '초대 수락' : '로그인'} description="인증 화면 검수입니다. 실제 계정 생성·로그인·이메일 발송은 연결되지 않았습니다."><Card className="mx-auto max-w-md gap-5 p-6">
    {done ? <><CheckCircle2 /><h2 className="font-semibold">{reset ? '안내 요청을 접수했습니다' : '초대 수락 화면을 확인했습니다'}</h2><p className="text-sm">{reset ? '등록된 계정이라면 재설정 안내를 받게 됩니다. 현재는 발송 시연입니다.' : '서비스 기업 · 일반 직원으로 업무 화면에 진입할 수 있습니다.'}</p><Link to="/login" className="underline">로그인으로 이동</Link></> : <form className="grid gap-5" onSubmit={e => {e.preventDefault(); if(error) return; if(reset || invite) setDone(true); else {setRole(role); navigate('/today');}}}>
      {invite && <Notice>서비스 기업에서 일반 직원으로 초대했습니다. 사용자·권한·운영 설정은 변경할 수 없습니다.</Notice>}
      <Field label="이메일"><Input type="email" required defaultValue="kim@example.com" autoComplete="username" /></Field>
      {!reset && <Field label={invite ? '새 비밀번호 (시연 값만 입력)' : '비밀번호 (시연 값만 입력)'}><Input type="password" required minLength={8} defaultValue="demo-only-123" autoComplete={invite ? 'new-password' : 'current-password'} /></Field>}
      {!reset && !invite && <Field label="검수용 역할"><NativeSelect value={role} onChange={e => changeRole(e.target.value as Role)}><option value="admin">관리자</option><option value="staff">일반 직원</option><option value="agent">AI 에이전트</option></NativeSelect></Field>}
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={error} onChange={e => setError(e.target.checked)} />{invite ? '초대 만료' : '요청 실패'} 시연</label>
      {error && <p role="alert" className="text-sm text-destructive">{invite ? '초대가 만료되었습니다. 관리자에게 새 초대를 요청해 주세요.' : '요청을 처리하지 못했습니다. 입력값을 확인하고 다시 시도해 주세요.'}</p>}
      <Submit>{reset ? '재설정 안내 요청 · 시연' : invite ? '초대 수락 · 시연' : '로그인 · 시연'}</Submit>
      <div className="flex flex-wrap gap-4 text-sm"><Link to="/account/reset" className="underline">비밀번호 재설정</Link><Link to="/account/invite" className="underline">초대 수락 화면</Link></div>
    </form>}
  </Card></Page>;
}

export function FrameFiles({c, role}: {c: SalesCase; role: Role}) {
  const {files, setFiles} = useContext(DemoContext); const [selected, setSelected] = useState(''); const [error, setError] = useState('');
  const list = [...c.files.map(name => ({name, size: 0})), ...(files[c.id] || [])];
  return <div className="grid gap-4"><h2 className="font-semibold">상담 자료</h2><Notice>파일명·크기와 화면 동작만 확인합니다. 파일 내용은 읽거나 서버에 올리지 않으며 새로고침하면 추가 목록이 초기화됩니다.</Notice>
    {role !== 'agent' && !['종료','서비스 완료'].includes(c.stage) && <Field label="자료 선택 · 최대 10MB"><Input type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx" onChange={e => {
      const f = e.target.files?.[0]; if(!f) return; e.target.value = '';
      if (f.size > 10 * 1024 * 1024 || !/\.(pdf|png|jpe?g|docx|xlsx)$/i.test(f.name)) {setError('PDF·이미지·Word·Excel 파일을 10MB 이하로 선택해 주세요.'); return;}
      setFiles({...files, [c.id]: [...(files[c.id] || []), {name:f.name,size:f.size}]}); setError('');
    }} /></Field>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {list.length ? list.map((f,i) => <div className="flex min-w-0 items-center gap-3 rounded-md border p-3" key={`${f.name}-${i}`}><FileText className="size-5 shrink-0" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{f.name}</p><p className="text-xs text-muted-foreground">{f.size ? `${Math.ceil(f.size/1024)} KB · 선택한 파일명` : '가상 자료 · 실제 파일 없음'}</p></div><Button size="sm" variant="outline" onClick={() => setSelected(f.name)}>미리보기</Button></div>) : <Notice>첨부된 자료가 없습니다. 상담에 필요한 자료를 추가하세요.</Notice>}
    <Dialog open={!!selected} onOpenChange={v => !v && setSelected('')}><DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogTitle className="break-all">{selected}</DialogTitle><DialogDescription>자료 미리보기 프레임 · 실제 문서 내용은 표시하지 않습니다.</DialogDescription><div className="flex aspect-[3/4] flex-col items-center justify-center gap-4 rounded-md border bg-muted"><FileText className="size-12" /><p className="text-sm">문서 표시 영역</p><p className="px-6 text-center text-xs text-muted-foreground">실제 파일 뷰어·다운로드·메일 첨부는 API 연결 단계에서 구현합니다.</p></div></DialogContent></Dialog>
  </div>;
}
function Notifications(p: Props) {
  const [time, setTime] = useState('15:00'); const b = workboard(p.state, p.role);
  const tasks = time === '15:00' ? [...b.overdue, ...b.today] : b.today.filter(t => t.kind === 'first' && t.dueAt?.slice(0,10) === TODAY);
  return <Page title="업무 알림" description="담당자가 받을 알림 이메일의 본문과 이동 경로를 검수합니다. 실제 발송 기록이 아닙니다."><div className="mb-5 flex gap-2">{['15:00','16:30'].map(t => <Button key={t} variant={t===time?'default':'outline'} onClick={() => setTime(t)}>{t} 알림</Button>)}</div><Card className="gap-4 p-6"><Badge variant="outline">2026. 9. 14. · {time} KST · 미리보기</Badge><h2 className="text-xl font-semibold">{time === '15:00' ? '지연 업무와 오늘 해야 할 일' : '오늘 마감인 첫 연락을 확인해 주세요'}</h2><p className="text-sm text-muted-foreground">{tasks.length}건 · 직접 연락하거나 담당자 변경을 요청하세요.</p>{tasks.map(t => <Link key={t.id} className="grid gap-1 rounded-md border p-4 hover:bg-muted" to={`/cases/${t.caseId}`}><strong className="text-sm">{p.state.cases.find(c => c.id === t.caseId)?.name} · {t.title}</strong><span className="text-xs text-muted-foreground">기한 {t.dueAt?.slice(0,10)} 17:00 · 영업건 보기 →</span></Link>)}{!tasks.length && <Notice>이번 알림의 대상 업무가 없습니다. 불필요한 이메일은 보내지 않습니다.</Notice>}</Card></Page>;
}
function Performance(p: Props) {
  const ids = new Set(visibleCases(p.state,p.role).map(c => c.id));
  const first = p.state.tasks.filter(t => ids.has(t.caseId) && t.kind === 'first');
  const eligible = first.filter(t => !t.excluded && t.originalDueAt && t.originalDueAt <= NOW);
  const success = eligible.filter(t => t.status === 'complete' && t.completedAt && t.completedAt <= t.originalDueAt!);
  return <Page title="첫 연락 성과" description="정해진 기한 안에 첫 연락을 완료했는지 확인합니다. 목표 100%와 관측값을 분리합니다."><div className="grid gap-4 sm:grid-cols-3">{[['목표','100%'],['기한 내 완료율',eligible.length ? `${Math.round(success.length / eligible.length *100)}%` : '집계 없음'],['집계 대상',`${eligible.length}건`]].map(([label,value]) => <Card key={label} className="gap-2 p-5"><p className="text-sm text-muted-foreground">{label}</p><strong className="text-3xl">{value}</strong></Card>)}</div><div className="mt-5 grid gap-4"><Notice>가상 데이터 · 2026. 9. 14. 15:00까지 원래 첫 연락 기한이 지난 업무 중 기한 내 완료 {success.length}건 / 집계 대상 {eligible.length}건. 기한 전 {first.filter(t => t.originalDueAt && t.originalDueAt > NOW).length}건은 아직 분모에 넣지 않습니다. 기한 변경으로 원래 목표 달성 여부가 바뀌지 않습니다.</Notice><Notice>목업에는 일부 첫 연락 이력만 있습니다. 실제 전체 고객 성과가 아닙니다. 오접수 제외 정책과 운영 집계 기간은 실데이터 연결 전에 검증합니다.</Notice>{eligible.map(t => <Link className="rounded-md border p-4 text-sm underline" key={t.id} to={`/cases/${t.caseId}`}>{p.state.cases.find(c=>c.id===t.caseId)?.name} · {success.includes(t) ? '기한 내 완료' : '기한 내 미완료'}</Link>)}</div></Page>;
}

const jobStates = ['대기','실행 중','성공','실패','인증 만료','요청 제한','결과 불명'] as const;
function Jobs() {
  const [status, setStatus] = useState<string>('대기'); const [detail, setDetail] = useState('이메일 발송'); const [checked, setChecked] = useState(false); const [confirmed, setConfirmed] = useState(false);
  return <Page title="자동화 실행 내역" description="접수 수집·이메일·AI 실행의 상태와 복구 화면입니다. 실제 외부 API를 실행하지 않습니다."><div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]"><Card className="gap-3 p-5"><h2 className="font-semibold">실행 목록</h2>{['이메일 발송','신규 문의 수집','15시 업무 알림','AI 다음 행동 제안'].map((label,i) => <Button key={label} variant={detail===label?'secondary':'outline'} className="h-auto min-h-12 justify-between whitespace-normal text-left" onClick={()=> {setDetail(label);setStatus('대기');setChecked(false);setConfirmed(false);}}>{label}<span className="text-xs">JOB-00{i+1}</span></Button>)}</Card><Card className="gap-4 p-5"><h2 className="font-semibold">{detail} · 실행 상세</h2><Field label="검수할 실행 상태"><NativeSelect value={status} onChange={e=>{setStatus(e.target.value);setChecked(false);setConfirmed(false);}}>{jobStates.map(s=><option key={s}>{s}</option>)}</NativeSelect></Field><Badge variant="secondary">{status}</Badge><dl className="grid gap-2 text-sm"><div>요청 시각 · 9.14 15:00</div><div>중복 방지 키 · demo-job-001</div><div>시도 횟수 · {status==='실패'?'3 / 3':'1 / 3'}</div><div>실행 주체 · 시스템 / 서비스 기업</div></dl>
      <Notice>{status==='대기'?'요청을 접수했습니다. 대기 중에는 업무를 완료로 표시하지 않습니다.':status==='실행 중'?'응답을 기다리고 있습니다. 같은 작업을 다시 실행하지 않습니다.':status==='성공'?'성공 응답을 확인한 상태의 화면 예시입니다. 실제 발송은 없으며 CRM 업무는 변경하지 않습니다.':status==='실패'?'자동 재시도 3회를 모두 사용했습니다. 원인을 해결한 후 관리자가 다시 실행할 수 있습니다.':status==='인증 만료'?'인증이 만료되어 실행을 중단했습니다. 관리자에게 연결 갱신을 요청하세요.':status==='요청 제한'?'제공자 재시도 시각: 15:01. 그전에는 실행을 반복하지 않습니다.': '전송 요청 후 응답이 끊겨 성공 여부를 알 수 없습니다. 재발송 전에 제공자 결과를 조회해야 합니다.'}</Notice>
      <div className="flex flex-wrap gap-2">{['대기','실행 중'].includes(status) && <Button onClick={()=>setStatus(status==='대기'?'실행 중':'성공')}>다음 상태 · 시연</Button>}{status==='인증 만료' && <Link className="underline" to="/admin/integrations">연동 관리로 이동</Link>}{status==='요청 제한' && <Button variant="outline" onClick={()=>setStatus('대기')}>재시도 시각 도달 · 시연</Button>}{status==='결과 불명' && <><Button variant="outline" onClick={()=>setStatus('성공')}>결과 조회: 성공 · 시연</Button><Button variant="outline" onClick={()=>setChecked(true)}>결과 조회: 미접수 확인 · 시연</Button></>}{(status==='실패' || status==='결과 불명') && <Button disabled={status==='결과 불명'&&!checked} onClick={()=>setConfirmed(true)}>재실행 검토</Button>}</div>
      {checked && <Notice>제공자가 요청을 접수하지 않았음을 확인했습니다. 재실행 여부를 검토하세요.</Notice>}
      {confirmed && <Notice><p className="mb-3">원인이 해결되었으며 동일 작업이 실행 중이지 않은지 확인하세요.</p><Button onClick={()=>{setStatus('대기');setConfirmed(false);setChecked(false);}}>확인 후 대기열에 등록 · 시연</Button></Notice>}
    </Card></div></Page>;
}
function Audit(p: Props) {
  const [reason, setReason] = useState(''); const [conflict, setConflict] = useState(false); const [ask, setAsk] = useState(false); const [done, setDone] = useState(false);
  const task = p.state.tasks.find(t=>t.id==='t7'); const c = p.state.cases.find(c=>c.id==='c9');
  const changed = !task || task.status !== 'incomplete' || task.excluded || task.dueAt !== null || task.title !== '회사소개서 전달';
  const forbidden = !c || !canRead(c,p.role) || p.role === 'agent';
  return <Page title="AI 변경 상세" description="가상 AI 기록의 근거와 전후 상태를 확인합니다. 후속 수정이 있으면 되돌리기를 차단합니다."><Card className="gap-5 p-6"><Badge variant="outline">해솔사무소 · 9.14 14:42</Badge><h2 className="text-lg font-semibold">회사소개서 전달 업무 등록</h2><Notice>근거 예시: “어떤 서비스를 제공하는지 소개자료를 받아보고 싶습니다.” 날짜 근거가 없으므로 기한은 미정으로 기록합니다.</Notice><div className="grid gap-3 sm:grid-cols-2"><Notice>변경 전<br/>다음 행동 없음</Notice><Notice>변경 후<br/>회사소개서 전달 · 기한 확인 필요</Notice></div><Link to="/cases/c9" className="text-sm underline">영업건과 최신 업무 확인</Link><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={conflict} onChange={e=>setConflict(e.target.checked)} />다른 직원이 수정한 상황 시연</label>
    {done ? <Notice>시연 업무를 제외 처리하고 되돌리기 이유를 이력에 남겼습니다.</Notice> : <><Button disabled={forbidden || changed || conflict} onClick={()=>setAsk(true)}>이 변경 되돌리기 검토</Button>{(changed||conflict) && <Notice>후속 변경이 있어 자동으로 되돌릴 수 없습니다. 최신 업무를 확인해 직접 조정해 주세요.</Notice>}{forbidden && <Notice>변경을 확인할 수 있는 직원만 되돌릴 수 있습니다.</Notice>}</>}
    <Dialog open={ask} onOpenChange={setAsk}><DialogContent><DialogTitle>업무 등록 되돌리기</DialogTitle><DialogDescription>등록된 업무를 관리 대상에서 제외하고 이력을 보존합니다. 이미 발송된 이메일 등 외부 실행은 취소하지 않습니다.</DialogDescription><form className="grid gap-4" onSubmit={e=>{e.preventDefault();if(!reason.trim()||changed||conflict||forbidden)return;p.updateState({...p.state,tasks:p.state.tasks.map(t=>t.id==='t7'?{...t,excluded:true}:t),activities:[{id:createId(),caseId:'c9',author:'김담당',kind:'human',at:NOW,text:`AI 업무 등록 되돌리기 · ${reason}`},...p.state.activities]});setDone(true);setAsk(false);}}><Field label="되돌리는 이유 *"><Textarea required value={reason} onChange={e=>setReason(e.target.value)} /></Field><Submit>확인 후 되돌리기 · 시연</Submit></form></DialogContent></Dialog>
  </Card></Page>;
}

function Users(p: Props) {
  const {members,setMembers} = useContext(DemoContext); const [message,setMessage] = useState(''); const [editing,setEditing] = useState<Member|null>(null); const [reason,setReason]=useState('');
  return <Page title="사용자·권한 관리" description="관리자만 구성원을 초대하고 역할을 변경할 수 있습니다. 변경은 현재 화면 세션에서만 유지됩니다."><div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]"><Card className="gap-4 p-5"><h2 className="font-semibold">회사 구성원</h2>{members.map(m=><div className="grid gap-2 rounded-md border p-4" key={m.id}><div className="flex flex-wrap items-center justify-between gap-2"><strong>{m.name}</strong><Badge variant="secondary">{m.status}</Badge></div><p className="break-all text-sm text-muted-foreground">{m.email} · {m.role}</p><Button variant="outline" disabled={m.id==='kim'} onClick={()=>{setEditing({...m});setReason('');}}>권한·사용 상태 변경</Button>{m.id==='kim'&&<p className="text-xs text-muted-foreground">현재 검수 관리자 계정은 변경할 수 없습니다.</p>}</div>)}</Card><Card className="gap-4 p-5"><h2 className="font-semibold">구성원 초대</h2><form className="grid gap-4" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);const email=String(f.get('email')).trim().toLowerCase();if(members.some(m=>m.email.toLowerCase()===email)){setMessage('이미 등록되었거나 초대한 이메일입니다.');return;}setMembers([...members,{id:createId(),name:String(f.get('name')).trim(),email,role:String(f.get('role')),status:'초대 대기'}]);setMessage('초대 대기 목록에 추가했습니다. 실제 이메일은 발송하지 않았습니다.');e.currentTarget.reset();}}><Field label="이름 *"><Input required name="name" /></Field><Field label="이메일 *"><Input required type="email" name="email" /></Field><Field label="역할"><NativeSelect name="role"><option>일반 직원</option><option>관리자</option></NativeSelect></Field><Submit>초대 등록 · 시연</Submit></form>{message&&<Notice>{message}</Notice>}<Link to="/account/invite" className="text-sm underline">초대를 받는 화면 확인</Link></Card></div>
    <Dialog open={!!editing} onOpenChange={v=>!v&&setEditing(null)}><DialogContent><DialogTitle>구성원 권한·사용 상태</DialogTitle><DialogDescription>비활성화 전 미완료 업무를 다른 담당자에게 인계해야 합니다.</DialogDescription>{editing&&<form className="grid gap-4" onSubmit={e=>{e.preventDefault();if(!reason.trim())return;setMembers(members.map(m=>m.id===editing.id?editing:m));setMessage(`${editing.name} 변경 · ${reason}`);setEditing(null);}}><Field label="역할"><NativeSelect value={editing.role} onChange={e=>setEditing({...editing,role:e.target.value})}><option>일반 직원</option><option>관리자</option></NativeSelect></Field><Field label="사용 상태"><NativeSelect value={editing.status} onChange={e=>setEditing({...editing,status:e.target.value})}><option>사용 중</option><option>초대 대기</option><option>비활성</option></NativeSelect></Field>{editing.status==='비활성' && p.state.cases.some(c=>c.assigneeId===editing.id&&!['종료','서비스 완료'].includes(c.stage)) ? <Notice>진행 중인 영업건이 있습니다. 담당자를 인계한 뒤 비활성화해 주세요.<Link className="ml-2 underline" to="/cases">영업건 확인</Link></Notice> : <><Field label="변경 이유 *"><Textarea required value={reason} onChange={e=>setReason(e.target.value)} /></Field><Submit /></>}</form>}</DialogContent></Dialog>
  </Page>;
}
function Policy() {
  const {policy,setPolicy} = useContext(DemoContext); const [message,setMessage]=useState(''); const [draft,setDraft]=useState<{owner:string;holiday:string;reason:string}|null>(null);
  return <Page title="운영 기준 변경" description="새 문의의 기본 담당자와 휴일 입력 화면을 검수합니다. 기존 업무의 원래 기한은 바뀌지 않습니다."><Card className="max-w-2xl gap-5 p-6"><Notice>현재 시연 기준: 다음 영업일 17:00 첫 연락, 15:00/16:30 이메일 알림, Asia/Seoul. 실제 영업일 계산·예약 실행은 연결 전입니다.</Notice><form className="grid gap-5" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);setDraft({owner:String(f.get('owner')),holiday:String(f.get('holiday')),reason:String(f.get('reason'))});}}><Field label="신규 문의 기본 담당자"><NativeSelect key={policy.owner} name="owner" defaultValue={policy.owner}><option>김담당</option><option>이담당</option></NativeSelect></Field><Field label="휴일 추가 · 화면 시연"><Input key={policy.holiday} name="holiday" type="date" defaultValue={policy.holiday} required /></Field><Field label="변경 이유 *"><Textarea name="reason" required /></Field><Submit>변경 내용 확인</Submit></form>{message&&<Notice>{message}</Notice>}</Card><Dialog open={!!draft} onOpenChange={v=>!v&&setDraft(null)}><DialogContent><DialogTitle>운영 기준 변경 확인</DialogTitle><DialogDescription>담당자 변경은 새 접수 시연부터 적용됩니다. 휴일 값은 화면에만 저장하며 기한 계산에는 아직 연결하지 않습니다.</DialogDescription>{draft&&<><Notice>기본 담당자: {policy.owner} → {draft.owner}<br/>휴일: {policy.holiday} → {draft.holiday}<br/>이유: {draft.reason}</Notice><Button onClick={()=>{setPolicy({owner:draft.owner,holiday:draft.holiday});setMessage('운영 기준 시연 값을 저장했습니다.');setDraft(null);}}>확인 후 저장 · 시연</Button></>}</DialogContent></Dialog></Page>;
}
function Integrations() {
  const [mode,setMode]=useState('정상'); const [message,setMessage]=useState('');
  return <Page title="외부 연동·AI 연결" description="연동 상태와 관리자의 복구 동선을 검수합니다. 연결 문자열·토큰 등 실제 비밀값은 입력받지 않습니다."><Field label="검수할 연결 상태"><NativeSelect value={mode} onChange={e=>{setMode(e.target.value);setMessage('');}}>{['정상','인증 만료','API 변경','데이터 오류','요청 제한','비용 한도 도달'].map(s=><option key={s}>{s}</option>)}</NativeSelect></Field><div className="mt-5 grid gap-4 lg:grid-cols-2">{[['Emergent 신규 문의','웹훅 수신 + 60초 보정 수집 · 원문 보존'],['이메일 제공자','접수 안내·업무 알림·직원 승인 후 고객 후속 발송'],['외부 AI API','영업건·다음 행동 처리 · 사용자/권한/설정 접근 금지'],['CRM 실시간 연결','신규 문의 표시 · SSE / 15초 조회 대체']].map(([name,text])=><Card className="gap-4 p-5" key={name}><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{name}</h2><Badge variant="outline">{mode} · 시연</Badge></div><p className="text-sm text-muted-foreground">{text}</p><Notice>{mode==='정상'?'연결 정상 표시 예시 · 실제 연결 없음':mode==='API 변경'?'지원하지 않는 응답 형식입니다. 새 API 형식을 확인하기 전에는 해당 데이터 처리를 중단합니다.':mode==='데이터 오류'?'필수 연락처 누락 항목을 격리했습니다. 정상 문의는 계속 처리합니다.':mode==='비용 한도 도달'?'AI 실행을 중단했습니다. 직원은 기존 업무를 계속 처리할 수 있습니다.':`${mode} 상태입니다. 자동 실행을 제한하고 관리자에게 알립니다.`}</Notice><Button variant="outline" onClick={()=>setMessage(`${name}의 연결 점검 화면을 확인했습니다. 실제 인증 갱신·API 요청은 실행하지 않았습니다.`)}>연결 점검 · 시연</Button><Link className="text-sm underline" to="/automation/jobs">실행 상세와 재처리 확인</Link></Card>)}</div>{message&&<div className="mt-5"><Notice>{message}</Notice></div>}</Page>;
}

const states: Record<string,[string,string,string]> = {
  session:['로그인이 만료되었습니다','작성 중이던 내용은 현재 탭에 보관됩니다. 다시 로그인한 뒤 이어서 처리하세요.','다시 로그인'],
  loading:['업무를 불러오고 있습니다','입력과 중복 요청을 막고 이전 화면의 정보 배치를 유지합니다.','불러오기 완료 · 시연'],
  empty:['아직 접수된 상담이 없습니다','첫 상담이 접수되면 담당자와 첫 연락 기한이 이곳에 표시됩니다.','접수 화면 보기'],
  save:['저장하지 못했습니다','입력한 내용은 유지됩니다. 연결을 확인하고 다시 시도하세요.','다시 저장 · 시연'],
  forbidden:['이 화면에 접근할 권한이 없습니다','사용자·권한·운영 설정은 관리자만 변경할 수 있습니다. 필요한 경우 회사 관리자에게 문의하세요.','오늘 할 일로 이동'],
  missing:['화면을 찾을 수 없습니다','주소가 바뀌었거나 더 이상 존재하지 않는 화면입니다.','영업건 목록으로 이동'],
  conflict:['다른 사용자가 먼저 변경했습니다','같은 요청을 중복 실행하지 않습니다. 최신 값과 작성 내용을 비교한 뒤 다시 결정해 주세요.','최신 영업건 확인'],
  validation:['입력 내용을 확인해 주세요','값이 올바르지 않은 항목 옆에 이유를 표시합니다. 나머지 입력은 유지합니다.','입력 내용 확인'],
  rate:['요청이 잠시 제한되었습니다','제공자 지정 재시도 시각까지 기다립니다. 같은 요청을 반복 실행하지 않습니다.','실행 상태 보기'],
  offline:['새 문의 연결이 지연되고 있습니다','마지막 확인 14:58 · 저장된 업무는 계속 확인할 수 있습니다. 복구 후 누락된 문의를 다시 확인합니다.','다시 연결 · 시연'],
};
function StatePage({kind}: {kind:string}) {
  const [recovered,setRecovered]=useState(false); const [memo,setMemo]=useState('고객에게 오후에 다시 연락하기'); const [email,setEmail]=useState('wrong-email');
  const navigate=useNavigate(); const [title,text,action]=states[kind]||states.missing;
  return <Page title={title} description="정상 업무 화면과 별도로 예외 상태의 안내·입력 보존·복구 동작을 확인하는 시연입니다."><Card className="max-w-2xl gap-5 p-6"><Badge variant="secondary">{kind} 상태 프레임</Badge><p className="text-sm leading-relaxed">{text}</p>{kind==='loading'&& !recovered && <div aria-busy="true" aria-label="불러오는 중" className="grid gap-3"><div className="h-10 rounded bg-muted animate-pulse"/><div className="h-24 rounded bg-muted animate-pulse"/></div>}{['save','conflict','session'].includes(kind)&&<Field label="작성 중인 내용"><Textarea value={memo} onChange={e=>setMemo(e.target.value)}/></Field>}{kind==='validation'&&<Field label="고객 이메일"><Input aria-invalid={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)} value={email} onChange={e=>setEmail(e.target.value)} /><span className="text-xs text-destructive">{!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&'예: name@example.com 형식으로 입력해 주세요.'}</span></Field>}{kind==='conflict'&&<Notice>최신 기한: 9월 16일 · 내 작성 기한: 9월 15일. 자동 덮어쓰기를 하지 않습니다.</Notice>}
    {recovered?<Notice>{kind==='validation'?'입력값 확인을 마쳤습니다.':kind==='session'?'재로그인 완료 상태 시연입니다. 작성 중인 내용이 유지되어 있습니다.':'정상 상태로 복구했습니다. 위 입력값은 유지됩니다.'}<Link to="/today" className="ml-2 underline">오늘 할 일</Link></Notice>:<Button onClick={()=>{
      if(kind==='empty')navigate('/inquiry');else if(kind==='forbidden')navigate('/today');else if(['missing','conflict'].includes(kind))navigate('/cases/c3');else if(kind==='rate')navigate('/automation/jobs');else if(kind==='validation'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return;else setRecovered(true);
    }}>{kind==='session'?'다시 로그인 완료 · 시연':action}</Button>}
    {kind==='session'&&<Link to="/login" className="text-sm underline">로그인 폼 화면도 확인하기</Link>}
  </Card></Page>;
}
function RecordEdit(p: Props) {
  const location = useLocation();
  const caseId = location.pathname.split('/')[2];
  const kind = new URLSearchParams(location.search).get('kind') === 'task' ? 'task' : 'note';
  const c = p.state.cases.find(c=>c.id===caseId);
  const items = kind === 'task' ? p.state.tasks.filter(t=>t.caseId===caseId && t.status==='incomplete' && !t.excluded).map(t=>({id:t.id,body:t.title})) : (c?.notes || []).filter(n=>p.role!=='agent'||n.author==='AI 에이전트').map(n=>({id:n.id,body:n.body}));
  const [selected, setSelected] = useState(items[0]?.id || '');
  const [body, setBody] = useState(items[0]?.body || '');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  if(!c || !canRead(c,p.role) || ['서비스 완료','종료'].includes(c.stage)) return <StatePage kind="forbidden"/>;
  return <Page title={kind==='task'?'업무 제목 수정':'상담 메모 수정'} description="수정 이유와 기존 내용을 이력으로 보존합니다. 고객의 초기 요청 원문은 바뀌지 않습니다."><Card className="max-w-2xl gap-4 p-6">{items.length ? <form className="grid gap-4" onSubmit={e=>{e.preventDefault();if(!body.trim()||!reason.trim())return;const old=items.find(i=>i.id===selected);if(!old)return;
    p.updateState({...p.state,cases:kind==='note'?p.state.cases.map(x=>x.id===caseId?{...x,notes:x.notes.map(n=>n.id===selected?{...n,body:body.trim()}:n)}:x):p.state.cases,tasks:kind==='task'?p.state.tasks.map(t=>t.id===selected?{...t,title:body.trim()}:t):p.state.tasks,activities:[{id:createId(),caseId,kind:p.role==='agent'?'ai':'human',author:p.role==='agent'?'AI 에이전트':'김담당',at:NOW,text:`${kind==='task'?'업무':'메모'} 수정 · 이전: ${old.body} → 이후: ${body.trim()} · 이유: ${reason}`},...p.state.activities]});setMessage('수정하고 변경 이력을 남겼습니다.');
  }}><Field label="수정할 기록"><NativeSelect value={selected} onChange={e=>{setSelected(e.target.value);setBody(items.find(i=>i.id===e.target.value)?.body||'');setMessage('');}}>{items.map(i=><option key={i.id} value={i.id}>{i.body}</option>)}</NativeSelect></Field><Field label={kind==='task'?'업무 제목 *':'상담 메모 *'}><Textarea required value={body} onChange={e=>setBody(e.target.value)}/></Field><Field label="수정 이유 *"><Textarea required value={reason} onChange={e=>setReason(e.target.value)}/></Field><Submit/></form> : <Notice>현재 권한으로 수정할 수 있는 기록이 없습니다. AI는 자신이 만든 정리 기록만 수정할 수 있습니다.</Notice>}{message&&<Notice>{message}</Notice>}<Link to={`/cases/${caseId}?tab=${kind==='task'?'tasks':'notes'}`} className="text-sm underline">영업건으로 돌아가기</Link></Card></Page>;
}
export function FrameWorkspace(p: Props) {
  const path = useLocation().pathname;
  if(path === '/review') return <ReviewHub/>;
  if(/^\/cases\/[^/]+\/edit-record$/.test(path)) return <RecordEdit key={path + new URLSearchParams(window.location.search).get('kind')} {...p}/>;
  if(path.startsWith('/review/states/')) return <StatePage key={path} kind={path.split('/').pop()!}/>;
  if(path === '/inquiry') return <Inquiry {...p}/>;
  if(path === '/login' || path.startsWith('/account/')) return <Account key={path} {...p}/>;
  if(path === '/notifications') return <Notifications {...p}/>;
  if(path === '/performance') return <Performance {...p}/>;
  if(path === '/automation/audit') return <Audit {...p}/>;
  if(path === '/automation/jobs') return p.role==='admin' ? <Jobs/> : <StatePage kind="forbidden"/>;
  if(path.startsWith('/admin/')) {
    if(p.role!=='admin')return <StatePage kind="forbidden"/>;
    if(path==='/admin/users')return <Users {...p}/>;
    if(path==='/admin/policy')return <Policy/>;
    if(path==='/admin/integrations')return <Integrations/>;
  }
  return <StatePage kind="missing"/>;
}
