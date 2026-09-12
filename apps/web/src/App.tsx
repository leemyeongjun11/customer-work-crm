import { Button as ShadcnButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  useEffect,
  useState,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileText,
  Inbox,
  LayoutGrid,
  ListTodo,
  Mail,
  MoreHorizontal,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import {
  applyCommand,
  canRead,
  isClosed,
  isOpenTask,
  NOW,
  pendingProposals,
  PEOPLE,
  personName,
  STAGES,
  TODAY,
  visibleCases,
  workboard,
  type Command,
  type CRMState,
  type Proposal,
  type Role,
  type SalesCase,
  type Stage,
  type Task,
} from "../../../packages/domain/crm.ts";
import { newInquiry, seedState } from "../../../packages/domain/seed.ts";
import { TASK_TYPES, taskTypeGroups } from "../../../packages/domain/task-types.ts";
import { FrameWorkspace, FullMenu, FrameFiles } from "./frame/FrameWorkspace";

type FormKind =
  | "record"
  | "due"
  | "exclude"
  | "add-task"
  | "note"
  | "customer"
  | "stage"
  | "approve"
  | "reject"
  | "defer"
  | "reopen"
  | "email-draft";
type Editor = {
  kind: FormKind;
  id: string;
  values: Record<string, string>;
  label: string;
  key: string;
};
type Scenario =
  "normal" | "empty" | "clear" | "save-error" | "email-error" | "offline";
type Context = {
  state: CRMState;
  role: Role;
  scenario: Scenario;
  updateState: (state: CRMState) => void;
  open: (kind: FormKind, id: string) => void;
};
const dateLabel = (value: string | null) =>
  value
    ? `${Number(value.slice(5, 7))}.${Number(value.slice(8, 10))} 17:00`
    : "기한 확인 필요";
const timeLabel = (value: string) =>
  `${Number(value.slice(5, 7))}.${Number(value.slice(8, 10))} ${value.slice(11, 16)}`;
const initials = (name: string) => name.slice(0, 1);
const cls = (...v: (string | false | undefined)[]) =>
  v.filter(Boolean).join(" ");

export function App() {
  const [state, setState] = useState<CRMState>(seedState);
  const [role, setRole] = useState<Role>("admin");
  const [scenario, setScenario] = useState<Scenario>("normal");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Editor>>({});
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [reviewTools, setReviewTools] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  useEffect(() => {
    setDrafts({});
    setDraftsOpen(false);
    setEditor(null);
  }, [role]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const board = workboard(state, role);
  const needsCount =
    board.unknown.length + board.missing.length + board.proposals.length;
  const pendingCount = pendingProposals(state, role).length;
  function open(kind: FormKind, id: string) {
    setError("");
    const key = `${kind}:${id}`;
    if (drafts[key]) {
      setEditor(drafts[key]);
      setDraftsOpen(false);
      return;
    }
    const t = state.tasks.find((t) => t.id === id),
      p = state.proposals.find((p) => p.id === id);
    const c = state.cases.find((c) => c.id === (t?.caseId ?? p?.caseId ?? id));
    if (!c || !canRead(c, role)) {
      setToast("이 영업건에 접근할 권한이 없습니다.");
      return;
    }
    const labels: Record<FormKind, string> = {
      record: t?.kind === "first" ? "첫 연락 결과 기록" : "업무 완료 기록",
      due: t?.dueAt ? "기한 변경" : "기한 설정",
      exclude: "업무 관리 제외",
      "add-task": "다음 행동 등록",
      note: "상담 메모 작성",
      customer: "고객 정보 수정",
      stage: "진행 단계 변경",
      approve:
        p?.kind === "email"
          ? "이메일 검토 후 발송"
          : p?.kind === "close"
            ? "영업건 종료 확인"
            : "담당자 변경 확인",
      reject: "제안 제외",
      defer: "다음 확인 날짜",
      reopen: "완료 취소",
      "email-draft": "이메일 초안 작성",
    };
    const values = {
      title: "",
      taskType: "",
      description: "",
      date: kind === "defer" ? (p?.date ?? "") : (t?.dueAt?.slice(0, 10) ?? ""),
      reason: "",
      memo: "",
      outcome: "",
      actualAt: "2026-09-14T15:00",
      body: kind === "approve" ? (p?.body ?? "") : "",
      to: p?.to ?? c.email,
      subject: p?.subject ?? "",
      nextDate: "",
      ack: "",
      stage: c.stage,
      name: c.name,
      person: c.person,
      phone: c.phone,
      email: c.email,
    };
    setEditor({ kind, id, key, values, label: `${c.name} · ${labels[kind]}` });
  }
  function field(key: string, value: string) {
    if (!editor) return;
    const next = { ...editor, values: { ...editor.values, [key]: value } };
    setEditor(next);
    setDrafts((prev) => ({ ...prev, [next.key]: next }));
    setError("");
  }
  function closeEditor() {
    if (editor && drafts[editor.key])
      setToast("작성 중인 내용을 임시 보관했습니다.");
    setEditor(null);
    setError("");
  }
  function submit(retry = false) {
    if (!editor) return;
    const { kind, id, values: v } = editor;
    const p = state.proposals.find((p) => p.id === id);
    if (
      !retry &&
      (scenario === "save-error" ||
        (kind === "approve" &&
          p?.kind === "email" &&
          scenario === "email-error"))
    ) {
      setError(
        kind === "approve" && p?.kind === "email"
          ? "발송에 실패했습니다. 업무는 미완료이며 작성 내용은 그대로 보관됩니다."
          : "저장하지 못했습니다. 입력 내용은 그대로 보관됩니다.",
      );
      return;
    }
    let cmd: Command;
    switch (kind) {
      case "record":
        cmd = {
          type: "complete",
          taskId: id,
          outcome: (v.outcome || undefined) as
            "connected" | "sms" | "attempt" | undefined,
          actualAt: v.actualAt + ":00+09:00",
          memo: v.memo,
        };
        break;
      case "due":
        cmd = { type: "due", taskId: id, date: v.date, reason: v.reason };
        break;
      case "exclude":
        cmd = { type: "exclude", taskId: id, reason: v.reason };
        break;
      case "reopen":
        cmd = { type: "reopen", taskId: id, reason: v.reason };
        break;
      case "add-task":
        cmd = { type: "add-task", caseId: id, title: '', date: v.date, taskType: v.taskType ?? '', description: v.description ?? '' };
        break;
      case "note":
        cmd = { type: "note", caseId: id, body: v.body };
        break;
      case "customer":
        cmd = {
          type: "customer",
          caseId: id,
          name: v.name,
          person: v.person,
          phone: v.phone,
          email: v.email,
          reason: v.reason,
        };
        break;
      case "stage":
        cmd = {
          type: "stage",
          caseId: id,
          stage: v.stage as Stage,
          reason: v.reason,
          ack: v.ack === "yes",
        };
        break;
      case "approve":
        cmd = {
          type: "approve",
          proposalId: id,
          ack: v.ack === "yes",
          to: v.to,
          subject: v.subject,
          body: v.body,
          nextDate: v.nextDate,
        };
        break;
      case "reject":
        cmd = { type: "reject", proposalId: id, reason: v.reason };
        break;
      case "defer":
        cmd = { type: "defer", proposalId: id, date: v.date, reason: v.reason };
        break;
      case "email-draft":
        cmd = {
          type: "email-draft",
          taskId: id,
          to: v.to,
          subject: v.subject,
          body: v.body,
        };
        break;
    }
    try {
      setState(applyCommand(state, cmd, role));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[editor.key];
        return next;
      });
      setEditor(null);
      setError("");
      setToast(
        kind === "approve" && p?.kind === "email"
          ? "발송 성공 흐름을 시연했습니다. 실제 이메일은 보내지 않았습니다."
          : kind === "record" && v.outcome === "attempt"
            ? "전화 시도를 기록했습니다. 첫 연락은 아직 미완료입니다."
            : "변경 내용을 반영했습니다.",
      );
    } catch (err) {
      setError((err as Error).message);
    }
  }
  function reset(next: Scenario = "normal") {
    const fresh = seedState();
    if (next === "empty") {
      fresh.cases = [];
      fresh.tasks = [];
      fresh.proposals = [];
      fresh.activities = [];
    }
    if (next === "clear") {
      fresh.tasks.forEach((t) => {
        t.status = "complete";
        t.completedAt = NOW;
        t.completedBy = "김담당";
      });
      fresh.proposals.forEach((p) => (p.status = "approved"));
      fresh.cases
        .filter((c) => !isClosed(c))
        .forEach((c) => (c.stage = "서비스 완료"));
    }
    setState(fresh);
    setScenario(next);
    setDrafts({});
    setEditor(null);
    setError("");
    navigate("/today");
  }
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const kind = params.get('frameForm');
    const id = params.get('id');
    if (kind && id && ['record','due','exclude','add-task','note','customer','stage','approve','reject','defer','reopen','email-draft'].includes(kind)) open(kind as FormKind, id);
  }, [location.search]);
  const ctx: Context = { state, role, scenario, open, updateState: setState };
  const crumb = location.pathname.startsWith("/cases")
    ? "영업건"
    : location.pathname === "/activity"
      ? "AI 활동"
      : location.pathname === "/settings"
        ? "운영 기준"
        : location.pathname.startsWith('/review') ? '전체 프레임 검수'
        : location.pathname.startsWith('/admin') ? '관리자'
        : location.pathname.startsWith('/automation') ? '자동화'
        : location.pathname === '/notifications' ? '업무 알림'
        : location.pathname === '/performance' ? '첫 연락 성과'
        : location.pathname === '/inquiry' ? '상담 접수'
        : location.pathname === '/today' ? '오늘 할 일' : '프레임 검수';
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        본문으로 이동
      </a>
      <aside className="sidebar">
        <Link to="/today" className="brand" aria-label="고객 업무 관리">
          <span className="brand-mark">
            <CheckCheck size={22} />
          </span>
          <span>고객 업무 관리</span>
        </Link>
        <div className="workspace">
          <div className="workspace-avatar">S</div>
          <div>
            <strong>서비스 기업</strong>
            <span>프레임 검수 공간</span>
          </div>
          <ChevronDown size={15} />
        </div>
        <p className="nav-label">업무 공간</p>
        <nav aria-label="주 메뉴">
          <NavLink to="/today">
            <ListTodo size={19} />
            <span>오늘 할 일</span>
            {board.overdue.length > 0 && (
              <b className="nav-count">{board.overdue.length}</b>
            )}
          </NavLink>
          <NavLink to="/cases">
            <LayoutGrid size={19} />
            <span>영업건</span>
          </NavLink>
          <NavLink to="/activity" aria-label="AI 활동">
            <Sparkles size={19} />
            <span>AI 활동</span>
          </NavLink>
        </nav>
        <div className="sidebar-foot">
          <NavLink to="/review"><LayoutGrid size={18} /><span>전체 프레임 검수</span></NavLink>
          <NavLink to="/settings">
            <Settings2 size={18} />
            <span>운영 기준</span>
          </NavLink>
          <Button
            className="review-launch"
            onClick={() => setReviewTools(!reviewTools)}
          >
            <SlidersHorizontal size={17} />
            검수 도구<span className="mini-badge">01</span>
          </Button>
          <div className="profile">
            <span className="avatar">김</span>
            <div>
              <strong>{role === "agent" ? "AI 에이전트" : "김담당"}</strong>
              <small>
                {role === "admin"
                  ? "관리자"
                  : role === "staff"
                    ? "일반 직원"
                    : "권한 시연"}
              </small>
            </div>
            <span className="profile-dot" />
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumb">
            <span>업무 공간</span>
            <ChevronRight size={14} />
            <strong>{crumb}</strong>
          </div>
          <div className="top-actions">
            <FullMenu role={role} setRole={setRole} onTools={() => setReviewTools(true)} />
            <span className="demo-pill">가상 데이터 · 프레임 검수</span>
            {Object.keys(drafts).length > 0 && (
              <Button
                className="text-button"
                onClick={() => setDraftsOpen(!draftsOpen)}
              >
                작성 중 {Object.keys(drafts).length}
              </Button>
            )}
            <Button
              className="icon-button"
              aria-label={`확인 필요한 제안 ${pendingCount}건 보기`}
              onClick={() => navigate("/today?view=review")}
            >
              <Bell size={19} />
              {pendingCount > 0 && <i />}
            </Button>
          </div>
        </header>
        {draftsOpen && (
          <div className="draft-tray">
            <strong>작성 중인 초안</strong>
            <span className="muted">새로고침하면 초기화됩니다.</span>
            {Object.values(drafts).map((d) => (
              <div key={d.key}>
                <Button
                  className="text-button"
                  onClick={() => {
                    setEditor(d);
                    setDraftsOpen(false);
                  }}
                >
                  {d.label}
                </Button>
                <Button
                  className="icon-button"
                  aria-label={`${d.label} 초안 삭제`}
                  onClick={() =>
                    setDrafts((prev) => {
                      const next = { ...prev };
                      delete next[d.key];
                      return next;
                    })
                  }
                >
                  <X size={15} />
                </Button>
              </div>
            ))}
          </div>
        )}
        {scenario === "offline" && (
          <div className="connection-notice">
            <CircleAlert size={16} />
            신규 문의 연결이 지연되고 있습니다. 마지막 확인 14:58 · 현재 저장된
            업무는 확인할 수 있습니다.
            <Button onClick={() => setScenario("normal")}>
              다시 연결 · 시연
            </Button>
          </div>
        )}
        <main id="main">
          <Routes>
            <Route
              path="/today"
              element={<Today {...ctx} needsCount={needsCount} />}
            />
            <Route
              path="/cases"
              element={<Cases {...ctx} search={search} setSearch={setSearch} />}
            />
            <Route path="/cases/:caseId" element={<CaseDetail {...ctx} />} />
            <Route path="/activity" element={<ActivityView {...ctx} />} />
            <Route path="/settings" element={<Settings role={role} />} />
            <Route path="/" element={<Navigate to="/today" replace />} />
            <Route path="*" element={<FrameWorkspace state={state} role={role} updateState={setState} setRole={setRole} />} />
          </Routes>
        </main>
        <footer className="app-footer">
          <span>프레임 목업 02 · 2026. 9. 14. 15:00 기준</span>
          <span>실제 고객 데이터·메일·AI 연결 없음</span>
        </footer>
      </div>
      {reviewTools && (
        <aside className="review-panel" aria-label="검수 도구">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">UI REVIEW</span>
              <h2>화면 상태 확인</h2>
            </div>
            <Button
              className="icon-button"
              aria-label="검수 도구 닫기"
              onClick={() => setReviewTools(false)}
            >
              <X size={19} />
            </Button>
          </div>
          <p>
            같은 화면에서 여러 업무 상황을 확인하세요. 전환하면 시연 데이터가
            초기화됩니다.
          </p>
          <label>
            화면 상황
            <NativeSelect
              value={scenario}
              onChange={(e) => reset(e.target.value as Scenario)}
            >
              <option value="normal">일반 업무</option>
              <option value="empty">접수된 상담 없음</option>
              <option value="clear">오늘 처리할 업무 없음</option>
              <option value="save-error">저장 실패</option>
              <option value="email-error">이메일 발송 실패</option>
              <option value="offline">신규 문의 연결 지연</option>
            </NativeSelect>
          </label>
          <label>
            권한 시연
            <NativeSelect
              value={role}
              onChange={(e) => {
                setRole(e.target.value as Role);
                setEditor(null);
              }}
            >
              <option value="admin">김담당 · 관리자</option>
              <option value="staff">김담당 · 일반 직원</option>
              <option value="agent">AI 에이전트 · 권한 범위 확인</option>
            </NativeSelect>
          </label>
          <p className="small muted">
            화면 검수용 전환입니다. 실제 로그인이나 서버 권한 검사를 대신하지
            않습니다.
          </p>
          <Button
            className="button primary full"
            onClick={() => {
              setState((s) => newInquiry(s));
              setScenario("normal");
              navigate("/today");
              setToast("새 문의를 반영하는 흐름을 시연했습니다.");
            }}
          >
            신규 문의 도착 시연
            <Plus size={16} />
          </Button>
          <Button className="button full" onClick={() => reset()}>
            <RefreshCw size={16} />
            초기 상태로 되돌리기
          </Button>
          <div className="review-steps">
            <strong>현재 단계</strong>
            <p>
              <b>01 프레임 목업</b>
              <span>검수 중</span>
            </p>
            <p>
              02 UI 의사결정<span>다음 단계</span>
            </p>
            <p>
              03 테마 선택<span>대기</span>
            </p>
          </div>
        </aside>
      )}
      {editor && (
        <EditorDialog
          editor={editor}
          state={state}
          role={role}
          error={error}
          field={field}
          close={closeEditor}
          submit={submit}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <Button
            className="icon-button"
            aria-label="알림 닫기"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </Button>
        </div>
      )}
    </div>
  );
}

function PageHead({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children && <div className="page-head-actions">{children}</div>}
    </div>
  );
}
function Empty({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Inbox size={27} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
function Section({
  title,
  count,
  subtitle,
  children,
  urgent = false,
}: {
  title: string;
  count: number;
  subtitle?: string;
  children: ReactNode;
  urgent?: boolean;
}) {
  return (
    <section className={cls("work-section", urgent && "urgent-section")}>
      <div className="section-head">
        <h2>
          {urgent && <CircleAlert size={17} />}
          {title}
          <span className="count">{count}</span>
        </h2>
        {subtitle && <span>{subtitle}</span>}
      </div>
      <div className="section-body">{children}</div>
    </section>
  );
}
function Today(ctx: Context & { needsCount: number }) {
  const navigate = useNavigate(),
    location = useLocation();
  const view = new URLSearchParams(location.search).get("view") ?? "today";
  const b = workboard(ctx.state, ctx.role);
  const todayCount = b.overdue.length + b.today.length;
  return (
    <div className="page today-page">
      <PageHead
        eyebrow="MONDAY, SEPTEMBER 14"
        title="오늘 할 일"
        description="지금 필요한 연락과 후속 업무를 확인하세요."
      >
        <span className="date-chip">
          <CalendarDays size={16} />
          2026년 9월 14일
        </span>
      </PageHead>
      <div className="stats">
        <Card className="gap-0 p-0">
          <Button className="stat danger" onClick={() => navigate("/today")}>
            <span>
              기한 초과
              <CircleAlert size={17} />
            </span>
            <div>
              <strong>{b.overdue.length}</strong>
              <small>건</small>
            </div>
            <p>첫 연락이 늦어진 업무부터 확인</p>
          </Button>
        </Card>
        <Card className="gap-0 p-0">
          <Button className="stat" onClick={() => navigate("/today")}>
            <span>
              <span className="hidden sm:inline">오늘 확인할 업무</span>
              <span className="sm:hidden">오늘 확인</span>
              <CalendarDays size={17} />
            </span>
            <div>
              <strong>{b.today.length}</strong>
              <small>건</small>
            </div>
            <p>오늘 마감 업무와 신규 상담</p>
          </Button>
        </Card>
        <Card className="gap-0 p-0">
          <Button
            className="stat"
            onClick={() => navigate("/today?view=review")}
          >
            <span>
              확인 필요
              <Sparkles size={17} />
            </span>
            <div>
              <strong>{ctx.needsCount}</strong>
              <small>건</small>
            </div>
            <p>기한 설정 · 종료 · 담당자 변경</p>
          </Button>
        </Card>
      </div>
      <div className="list-toolbar">
        <div className="tabs" aria-label="업무 보기">
          <Button
            className={view === "today" ? "active" : ""}
            onClick={() => navigate("/today")}
          >
            오늘 업무<span>{todayCount}</span>
          </Button>
          <Button
            className={view === "upcoming" ? "active" : ""}
            onClick={() => navigate("/today?view=upcoming")}
          >
            예정 업무<span>{b.upcoming.length}</span>
          </Button>
          <Button
            className={view === "review" ? "active" : ""}
            onClick={() => navigate("/today?view=review")}
          >
            확인 필요<span>{ctx.needsCount}</span>
          </Button>
        </div>
        <span className="sort-label">
          <ArrowDown size={14} />첫 연락 지연 우선
        </span>
      </div>
      {view === "today" && (
        <>
          {b.overdue.length > 0 && (
            <Section
              title="기한이 지난 업무"
              count={b.overdue.length}
              urgent
              subtitle="아직 처리되지 않은 업무입니다."
            >
              {b.overdue.map((t) => (
                <TaskCard key={t.id} task={t} {...ctx} />
              ))}
            </Section>
          )}
          {b.today.length > 0 && (
            <Section title="오늘 확인할 업무" count={b.today.length}>
              {b.today.map((t) => (
                <TaskCard key={t.id} task={t} {...ctx} />
              ))}
            </Section>
          )}
          {ctx.needsCount > 0 && <ReviewSection {...ctx} />}
          {todayCount + ctx.needsCount === 0 && (
            <Empty
              title={
                ctx.state.cases.length
                  ? "오늘 확인할 업무가 없습니다"
                  : "아직 접수된 상담이 없습니다"
              }
              text={
                ctx.state.cases.length
                  ? "예정된 업무는 예정 업무에서, 완료 기록은 영업건 상세에서 확인하세요."
                  : "새로운 문의가 들어오면 담당자와 첫 연락 기한이 연결되어 여기에 표시됩니다."
              }
            >
              <Link className="button" to="/cases">
                영업건 보기
                <ArrowRight size={15} />
              </Link>
            </Empty>
          )}
        </>
      )}
      {view === "upcoming" &&
        (b.upcoming.length ? (
          <Section
            title="예정된 업무"
            count={b.upcoming.length}
            subtitle="다가오는 기한 순서로 확인하세요."
          >
            {[...b.upcoming]
              .sort((a, z) => a.dueAt!.localeCompare(z.dueAt!))
              .map((t) => (
                <TaskCard key={t.id} task={t} {...ctx} />
              ))}
          </Section>
        ) : (
          <Empty
            title="예정된 업무가 없습니다"
            text="다음 행동을 등록하면 이곳에서 확인할 수 있습니다."
          />
        ))}
      {view === "review" &&
        (ctx.needsCount ? (
          <ReviewSection {...ctx} />
        ) : (
          <Empty
            title="확인할 항목이 없습니다"
            text="기한이 없는 업무나 직원 확인이 필요한 제안이 생기면 알려드립니다."
          />
        ))}
      <div className="daily-note">
        <Clock3 size={16} />
        <span>
          15:00 담당자별 업무 알림 · 16:30 오늘 마감인 첫 연락 추가 알림
        </span>
      </div>
    </div>
  );
}
function ReviewSection(ctx: Context) {
  const b = workboard(ctx.state, ctx.role);
  return (
    <Section
      title="확인이 필요한 항목"
      count={b.unknown.length + b.missing.length + b.proposals.length}
      subtitle="직원의 판단이 필요한 업무입니다."
    >
      {b.unknown.map((t) => (
        <TaskCard key={t.id} task={t} {...ctx} />
      ))}
      {b.missing.map((c) => (
        <div className="task-card" key={c.id}>
          <span className="task-symbol">
            <Plus size={19} />
          </span>
          <div className="task-content">
            <div className="task-caption">
              <Link to={`/cases/${c.id}`}>{c.name}</Link>
              <Badge variant="secondary">다음 행동 없음</Badge>
            </div>
            <h3>다음 행동 또는 확인 날짜를 남겨주세요</h3>
            <RequestPreview salesCase={c} />
            <div className="task-meta">
              {personName(c.assigneeId)} · {c.stage}
            </div>
          </div>
          <Button className="button" onClick={() => ctx.open("add-task", c.id)}>
            다음 행동 등록
            <Plus size={15} />
          </Button>
        </div>
      ))}
      {b.proposals.map((p) => (
        <ProposalCard key={p.id} proposal={p} {...ctx} />
      ))}
    </Section>
  );
}
function RequestPreview({ salesCase }: { salesCase: SalesCase }) {
  const preview = salesCase.original.replace(/\s+/g, " ").trim();
  return (
    <div className="request-preview">
      <span className="shrink-0 font-medium">초기 요청</span>
      <span className="min-w-0 truncate" title={preview || undefined}>
        {preview || "초기 요청 내용 없음"}
      </span>
    </div>
  );
}

function TaskCard({ task: t, ...ctx }: Context & { task: Task }) {
  const c = ctx.state.cases.find((c) => c.id === t.caseId)!;
  const late = !!t.dueAt && t.dueAt.slice(0, 10) < TODAY;
  const fresh = t.kind === "first" && c.receivedAt.slice(0, 10) === TODAY;
  const proposal = pendingProposals(ctx.state, ctx.role).find(
    (p) => p.taskId === t.id,
  );
  const action =
    t.kind === "email"
      ? () =>
          proposal
            ? ctx.open("approve", proposal.id)
            : ctx.open("email-draft", t.id)
      : !t.dueAt
        ? () => ctx.open("due", t.id)
        : () => ctx.open("record", t.id);
  const label =
    t.kind === "email"
      ? proposal
        ? "이메일 검토"
        : "새 초안 작성"
      : !t.dueAt
        ? "기한 설정"
        : late
          ? t.kind === "first" ? "지금 연락하기" : "지금 처리하기"
        : t.kind === "first"
          ? "연락 결과 기록"
          : "완료 기록";
  return (
    <Card className={cls("task-card flex-row gap-4 p-4", late && "late")}>
      <span className="task-symbol">
        {t.kind === "first" ? (
          <Phone size={19} />
        ) : t.kind === "email" ? (
          <Mail size={19} />
        ) : (
          <FileText size={19} />
        )}
      </span>
      <div className="task-content">
        <div className="task-caption">
          <Link to={`/cases/${c.id}`}>{c.name}</Link>
          {late && (
            <Badge variant="destructive">
              {t.kind === "first" ? "첫 연락 지연" : "기한 초과"}
            </Badge>
          )}
          {fresh && <Badge variant="secondary">신규 문의</Badge>}
          {!t.dueAt && <Badge variant="secondary">기한 확인 필요</Badge>}
        </div>
        <h3>{t.title}</h3>
        <RequestPreview salesCase={c} />
        <div className="task-meta">
          <span>
            <CalendarDays size={13} />
            {dateLabel(t.dueAt)}
          </span>
          <i />
          {personName(c.assigneeId)}
          <i />
          {c.stage}
        </div>
        {proposal && (
          <div className="inline-ai">
            <Sparkles size={14} />
            <span>{proposal.reason}</span>
          </div>
        )}
      </div>
      <div className="task-actions">
        <Button
          className={cls("button", t.kind === "first" && late && "primary")}
          onClick={action}
        >
          {label}
          {t.kind === "first" ? <ArrowRight size={15} /> : null}
        </Button>
        <details className="more-menu">
          <summary aria-label={`${c.name} 업무 더보기`}>
            <MoreHorizontal size={20} />
          </summary>
          <div>
            <Button onClick={() => ctx.open("due", t.id)}>기한 변경</Button>
            {proposal && (
              <Button onClick={() => ctx.open("defer", proposal.id)}>
                다음 확인 날짜
              </Button>
            )}
            <Button onClick={() => ctx.open("exclude", t.id)}>관리 제외</Button>
            <Link to={`/cases/${c.id}`}>영업건 상세</Link>
          </div>
        </details>
      </div>
    </Card>
  );
}
function ProposalCard({
  proposal: p,
  ...ctx
}: Context & { proposal: Proposal }) {
  const c = ctx.state.cases.find((c) => c.id === p.caseId)!;
  const allowed =
    ctx.role !== "agent" && (p.kind !== "reassign" || ctx.role === "admin");
  return (
    <Card className="proposal-card flex-row gap-4 p-4">
      <span className="task-symbol">
        <Sparkles size={19} />
      </span>
      <div className="task-content">
        <div className="task-caption">
          <Link to={`/cases/${c.id}`}>{c.name}</Link>
          <Badge variant="secondary">
            {p.kind === "close"
              ? "종료 승인 대기"
              : p.kind === "reassign"
                ? "담당자 변경 승인 대기"
                : "발송 승인 대기"}
          </Badge>
        </div>
        <h3>{p.title}</h3>
        <RequestPreview salesCase={c} />
        <p className="muted">{p.reason}</p>
        <span className="small muted">
          {p.kind === "close"
            ? "확인 전에는 상태와 알림이 유지됩니다."
            : p.kind === "reassign"
              ? `변경 제안: ${personName(c.assigneeId)} → ${personName(p.nextAssigneeId!)}`
              : "발송 전 수신자와 내용을 확인하세요."}
        </span>
      </div>
      <div className="task-actions vertical">
        <Button className="button" onClick={() => ctx.open("approve", p.id)}>
          {allowed ? "제안 검토" : "내용 확인"}
          <ChevronRight size={15} />
        </Button>
        {allowed && (
          <Button
            className="text-button muted"
            onClick={() => ctx.open("reject", p.id)}
          >
            제안 제외
          </Button>
        )}
      </div>
    </Card>
  );
}
function Cases(
  ctx: Context & { search: string; setSearch: (v: string) => void },
) {
  const casesLocation = useLocation();
  const casesNavigate = useNavigate();
  const archived = new URLSearchParams(casesLocation.search).get('view') === 'archived';
  const setArchived = (value: boolean) => casesNavigate(value ? '/cases?view=archived' : '/cases');
  const list = visibleCases(ctx.state, ctx.role).filter(
    (c) =>
      isClosed(c) === archived &&
      `${c.name} ${c.person} ${c.summary}`.includes(ctx.search),
  );
  const stages = archived ? STAGES.slice(5) : STAGES.slice(0, 5);
  return (
    <div className="page cases-page">
      <PageHead
        title="영업건"
        description="상담 접수부터 서비스 제공까지 한 흐름으로 관리하세요."
      >
        <span className="date-chip">
          <Users size={16} />
          {ctx.role === "staff" ? "내 담당 영업건" : "회사 전체 영업건"}
        </span>
      </PageHead>
      <div className="list-toolbar">
        <div className="tabs">
          <Button
            className={!archived ? "active" : ""}
            onClick={() => setArchived(false)}
          >
            진행 중
          </Button>
          <Button
            className={archived ? "active" : ""}
            onClick={() => setArchived(true)}
          >
            서비스 완료·종료
          </Button>
        </div>
        <label className="search-box">
          <Search size={17} aria-hidden="true" />
          <Input
            className="pl-10"
            aria-label="영업건 검색"
            value={ctx.search}
            onChange={(e) => ctx.setSearch(e.target.value)}
            placeholder="고객명, 담당자, 상담 내용 검색"
          />
        </label>
      </div>
      {!list.length ? (
        <Empty
          title={ctx.search ? "검색 결과가 없습니다" : "해당 영업건이 없습니다"}
          text={
            ctx.search
              ? "고객명이나 상담 내용으로 다시 찾아보세요."
              : "접수된 문의와 진행 상태가 이곳에 표시됩니다."
          }
        />
      ) : (
        <div className={cls("kanban", archived && "archived-board")}>
          {stages.map((stage) => (
            <section className="kanban-column" key={stage}>
              <div className="column-heading">
                <h2>{stage}</h2>
                <span>{list.filter((c) => c.stage === stage).length}</span>
              </div>
              {list
                .filter((c) => c.stage === stage)
                .map((c) => {
                  const tasks = ctx.state.tasks.filter(
                    (t) => t.caseId === c.id && isOpenTask(t),
                  );
                  const next = [...tasks].sort((a, b) =>
                    (a.dueAt ?? "z").localeCompare(b.dueAt ?? "z"),
                  )[0];
                  return (
                    <Link
                      className="case-tile"
                      to={`/cases/${c.id}`}
                      key={c.id}
                    >
                      <div className="tile-top">
                        <span className="case-avatar">{initials(c.name)}</span>
                        <ChevronRight size={15} />
                      </div>
                      <h3>{c.name}</h3>
                      <RequestPreview salesCase={c} />
                      <p>{c.summary}</p>
                      {next && !archived && (
                        <div
                          className={cls(
                            "tile-next",
                            !!next.dueAt &&
                              next.dueAt.slice(0, 10) < TODAY &&
                              "text-danger",
                          )}
                        >
                          <Clock3 size={14} />
                          <span>{dateLabel(next.dueAt)}</span>
                        </div>
                      )}
                      <div className="tile-footer">
                        <span>{personName(c.assigneeId)}</span>
                        <span>{c.person}</span>
                      </div>
                    </Link>
                  );
                })}
              {!list.some((c) => c.stage === stage) && (
                <div className="column-empty">등록된 영업건 없음</div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
function CaseDetail(ctx: Context) {
  const { caseId } = useParams();
  const detailLocation = useLocation();
  const detailNavigate = useNavigate();
  const tab = new URLSearchParams(detailLocation.search).get('tab') || 'tasks';
  const setTab = (value: string) => detailNavigate(`/cases/${caseId}?tab=${value}`);
  const c = ctx.state.cases.find((c) => c.id === caseId);
  if (!c || !canRead(c, ctx.role))
    return (
      <div className="page">
        <Empty
          title="영업건을 확인할 수 없습니다"
          text="기록이 없거나 현재 권한으로 접근할 수 없습니다."
        >
          <Link to="/cases" className="button">
            영업건으로 돌아가기
          </Link>
        </Empty>
      </div>
    );
  const tasks = ctx.state.tasks.filter((t) => t.caseId === c.id);
  const openTasks = tasks.filter(isOpenTask);
  const proposals = pendingProposals(ctx.state, ctx.role).filter(
    (p) => p.caseId === c.id && !p.taskId,
  );
  const history = ctx.state.activities.filter((a) => a.caseId === c.id);
  return (
    <div className="page detail-page">
      <Link className="back-link" to="/cases">
        <ArrowLeft size={15} />
        영업건 목록
      </Link>
      <PageHead title={c.name} description={c.summary}>
        <Badge variant="secondary">{c.stage}</Badge>
        {!isClosed(c) && (
          <Button className="button" onClick={() => ctx.open("stage", c.id)}>
            단계 변경
            <ChevronDown size={15} />
          </Button>
        )}
      </PageHead>
      <div className="stage-track" aria-label={`현재 단계 ${c.stage}`}>
        {STAGES.slice(0, 6).map((stage, i) => (
          <span
            key={stage}
            className={cls(
              stage === c.stage && "current",
              STAGES.indexOf(c.stage) > i && c.stage !== "종료" && "past",
            )}
          >
            <b>{i + 1}</b>
            {stage}
            {i < 5 && <ChevronRight size={13} />}
          </span>
        ))}
      </div>
      <div className="detail-grid">
        <div className="detail-main">
          {isClosed(c) && (
            <div className="closed-notice">
              <ShieldCheck size={19} />
              <div>
                <strong>
                  {c.stage === "종료"
                    ? "종료된 영업건입니다"
                    : "서비스가 완료되었습니다"}
                </strong>
                <p>후속 알림은 중단되며 기존 업무와 이력은 보관됩니다.</p>
              </div>
            </div>
          )}
          <div className="detail-tabs tabs">
            {[
              ["tasks", "업무와 다음 행동"],
              ["notes", "상담 메모"],
              ["history", "변경 이력"],
              ["files", "자료"],
            ].map(([key, label]) => (
              <Button
                key={key}
                className={tab === key ? "active" : ""}
                onClick={() => setTab(key)}
              >
                {label}
              </Button>
            ))}
          </div>
          {tab === "tasks" && (
            <>
              <div className="detail-section-title">
                <h2>
                  다음 행동 <span>{openTasks.length}</span>
                </h2>
                {!isClosed(c) && (
                  <div className="detail-section-actions">
                  <Link className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm hover:bg-muted" to={`/cases/${c.id}/edit-record?kind=task`}>업무 제목 수정</Link>
                  <Button
                    className="text-button"
                    onClick={() => ctx.open("add-task", c.id)}
                  >
                    <Plus size={16} />
                    업무 등록
                  </Button>
                  </div>
                )}
              </div>
              {openTasks.length ? (
                openTasks.map((t) =>
                  isClosed(c) ? (
                    <div className="archived-task" key={t.id}>
                      <FileText size={17} />
                      <div>
                        <strong>{t.title}</strong>
                        <p>{dateLabel(t.dueAt)} · 미완료 기록 보관</p>
                      </div>
                    </div>
                  ) : (
                    <TaskCard key={t.id} task={t} {...ctx} />
                  ),
                )
              ) : (
                <Empty
                  title="등록된 다음 행동이 없습니다"
                  text={
                    isClosed(c)
                      ? "진행 기록은 변경 이력에서 확인하세요."
                      : "고객과 약속한 업무 또는 다음 확인 날짜를 남겨주세요."
                  }
                >
                  {!isClosed(c) && (
                    <Button
                      className="button"
                      onClick={() => ctx.open("add-task", c.id)}
                    >
                      다음 행동 등록
                    </Button>
                  )}
                </Empty>
              )}
              {proposals.map((p) => (
                <ProposalCard key={p.id} proposal={p} {...ctx} />
              ))}
              <details className="completed-section">
                <summary>
                  <CheckCheck size={17} />
                  완료·관리 제외 기록
                  <span>{tasks.filter((t) => !isOpenTask(t)).length}</span>
                  <ChevronDown size={15} />
                </summary>
                {tasks
                  .filter((t) => !isOpenTask(t))
                  .map((t) => (
                    <div className="completed-row" key={t.id}>
                      <Check size={16} />
                      <div>
                        <strong>{t.title}</strong>
                        <span>
                          {t.excluded
                            ? "관리 제외 · 완료 실적 제외"
                            : `${t.completedAt ? timeLabel(t.completedAt) : "완료"} · ${t.completedBy ?? "김담당"}`}
                        </span>
                      </div>
                      {!isClosed(c) && !t.excluded && (
                        <Button
                          className="text-button"
                          onClick={() => ctx.open("reopen", t.id)}
                        >
                          완료 취소
                        </Button>
                      )}
                    </div>
                  ))}
              </details>
            </>
          )}
          {tab === "notes" && (
            <>
              <div className="detail-section-title">
                <h2>상담 메모</h2>
                {!isClosed(c) && (
                  <div className="detail-section-actions">
                  <Link className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm hover:bg-muted" to={`/cases/${c.id}/edit-record?kind=note`}>기존 메모 수정</Link>
                  <Button
                    className="button"
                    onClick={() => ctx.open("note", c.id)}
                  >
                    <Plus size={15} />
                    메모 작성
                  </Button>
                  </div>
                )}
              </div>
              {c.notes.map((n) => (
                <Card key={n.id} className="note-card gap-3 p-5">
                  <div>
                    <span className="avatar small-avatar">
                      {n.author.slice(0, 1)}
                    </span>
                    <strong>{n.author}</strong>
                    <span className="muted">{timeLabel(n.at)}</span>
                  </div>
                  <p>{n.body}</p>
                </Card>
              ))}
              <p className="hint">
                이번 검수본은 메모 저장 흐름만 시연합니다. 실제 AI 분석은 아직
                연결하지 않았습니다.
              </p>
            </>
          )}
          {tab === "history" && (
            <div className="timeline">
              {history.length ? (
                history.map((a) => (
                  <div key={a.id}>
                    <span className="timeline-dot" />
                    <strong>{a.text}</strong>
                    <p>
                      {a.author} · {timeLabel(a.at)}
                    </p>
                  </div>
                ))
              ) : (
                <Empty
                  title="추가 변경 이력이 없습니다"
                  text="업무를 처리하거나 고객 정보를 수정하면 이곳에 기록됩니다."
                />
              )}
            </div>
          )}
          {tab === "files" && <FrameFiles c={c} role={ctx.role} />}
        </div>
        <aside className="customer-panel">
          <div className="section-head">
            <h2>고객 정보</h2>
            {!isClosed(c) && (
              <Button
                className="text-button"
                onClick={() => ctx.open("customer", c.id)}
              >
                수정
              </Button>
            )}
          </div>
          <dl>
            <dt>이름·업체명</dt>
            <dd>{c.name}</dd>
            <dt>고객 담당자</dt>
            <dd>{c.person}</dd>
            <dt>전화번호</dt>
            <dd>{c.phone}</dd>
            <dt>이메일</dt>
            <dd>{c.email}</dd>
            <dt>회사 규모</dt>
            <dd>{c.size}</dd>
          </dl>
          <div className="owner-line">
            <span className="avatar">
              {personName(c.assigneeId).slice(0, 1)}
            </span>
            <div>
              <small>우리 회사 담당자</small>
              <strong>{personName(c.assigneeId)}</strong>
            </div>
          </div>
          <div className="source-info">
            <span className="eyebrow">최초 접수</span>
            <p>{timeLabel(c.receivedAt)}</p>
            <span>웹사이트 상담 신청</span>
          </div>
          <details className="original">
            <summary>
              접수 원문 보기
              <ChevronDown size={14} />
            </summary>
            <p>{c.original}</p>
            <small>CRM 수정본과 별도로 보관됩니다.</small>
          </details>
        </aside>
      </div>
    </div>
  );
}
function ActivityView(ctx: Context) {
  const awaitingApproval = new Set(pendingProposals(ctx.state, ctx.role).map(p => p.id));
  const list = ctx.state.activities.filter((a) =>
    ctx.state.cases.some((c) => c.id === a.caseId && canRead(c, ctx.role)),
  );
  return (
    <div className="page">
      <PageHead
        title="AI 활동"
        description="직접 반영한 업무와 직원 확인이 필요한 변경을 확인하세요."
      />
      <div className="permission-strip">
        <Sparkles size={19} />
        <span>영업 기록·다음 행동은 직접 반영</span>
        <span>종료·담당자 변경·후속 발송은 직원 확인</span>
      </div>
      <Section title="최근 처리 내역" count={list.length}>
        {list.map((a) => {
          const proposal = a.proposalId ? ctx.state.proposals.find(p => p.id === a.proposalId && p.caseId === a.caseId) : undefined;
          const approvalLabel = proposal
            ? awaitingApproval.has(proposal.id) ? '직원 승인 대기'
              : proposal.status === 'approved' ? '승인 완료'
              : proposal.status === 'rejected' ? '제안 제외' : '검토 종료'
            : null;
          return (
          <div className="activity-row" key={a.id}>
            <span className="task-symbol" aria-hidden="true">
              {a.kind === "ai" ? (
                <Sparkles size={18} />
              ) : a.kind === "system" ? (
                <RefreshCw size={18} />
              ) : (
                <Check size={18} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap gap-2">
                <Badge variant="secondary">{a.kind === 'ai' ? proposal ? 'AI 제안' : 'AI 처리' : a.kind === 'system' ? '시스템 자동 처리' : '직원 처리'}</Badge>
                {approvalLabel && <Badge variant="outline">{approvalLabel}</Badge>}
              </div>
              <Link to={`/cases/${a.caseId}`}>
                {ctx.state.cases.find((c) => c.id === a.caseId)?.name}
              </Link>
              <h3>{a.text}</h3>
              <p>
                {a.author} · {timeLabel(a.at)}
              </p>
            </div>
          </div>
        );})}
        {!list.length && (
          <Empty
            title="아직 처리 내역이 없습니다"
            text="AI와 직원의 업무 변경 기록이 이곳에 표시됩니다."
          />
        )}
      </Section>
      <Link to="/automation/audit" className="button">AI 변경 근거·되돌리기 화면 검수</Link>
      <p className="hint">
        검수용 처리 이력입니다. 실제 AI 에이전트가 실행된 결과는 아닙니다.
      </p>
    </div>
  );
}
function Settings({ role }: { role: Role }) {
  return (
    <div className="page settings-page">
      <PageHead
        title="운영 기준"
        description="현재 정한 업무 기준과 권한을 확인하세요."
      />
      {role !== "admin" ? (
        <Empty
          title="관리자만 접근할 수 있습니다"
          text="AI 에이전트와 일반 직원은 사용자·권한·시스템 설정을 변경할 수 없습니다."
        />
      ) : (
        <>
          <div className="read-only-note">
            <ShieldCheck size={18} />
            현재는 정해진 기준을 확인하는 화면입니다. 설정 변경 기능은 연결
            전입니다.
          </div>
          <div className="mb-5 flex flex-wrap gap-4 text-sm"><Link className="underline" to="/admin/policy">운영 기준 변경 화면</Link><Link className="underline" to="/admin/users">사용자 관리</Link><Link className="underline" to="/admin/integrations">외부 연동 관리</Link></div>
          <div className="settings-grid">
            {[
              [
                "첫 연락 기준",
                [
                  "접수일 다음 영업일 17:00까지",
                  "통화 연결 또는 부재 후 안내 문자 발송",
                  "전화만 시도한 경우는 미완료",
                ],
              ],
              [
                "업무 알림",
                [
                  "영업일 15:00 · 지연 및 오늘 마감 업무",
                  "영업일 16:30 · 오늘 마감 첫 연락",
                  "종료된 영업건의 후속 알림 중단",
                ],
              ],
              [
                "AI 권한",
                [
                  "해당 회사 전체 영업건 관리",
                  "영업 기록과 다음 행동 직접 반영",
                  "종료·담당자 변경·고객 후속 발송은 직원 확인",
                ],
              ],
              [
                "기록과 기한",
                [
                  "날짜가 없으면 기한 확인 필요",
                  "CRM 수정본과 접수 원문 분리",
                  "기한 변경·완료 취소·승인 이력 보관",
                ],
              ],
            ].map(([title, lines]) => (
              <section key={title as string} className="settings-card">
                <h2>{title}</h2>
                {(lines as string[]).map((line) => (
                  <p key={line}>
                    <Check size={15} />
                    {line}
                  </p>
                ))}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function EditorDialog({
  editor: e,
  state,
  role,
  error,
  field,
  close,
  submit,
}: {
  editor: Editor;
  state: CRMState;
  role: Role;
  error: string;
  field: (k: string, v: string) => void;
  close: () => void;
  submit: (retry?: boolean) => void;
}) {
  const t = state.tasks.find((t) => t.id === e.id),
    p = state.proposals.find((p) => p.id === e.id);
  const c = state.cases.find((c) => c.id === (t?.caseId ?? p?.caseId ?? e.id))!;
  const v = e.values;
  const taskOptions = taskTypeGroups(c.stage);
  const selectedTaskType = TASK_TYPES.find(t => t.id === v.taskType);
  const remaining = state.tasks.filter(
    (t) => t.caseId === c.id && isOpenTask(t),
  );
  const blocked =
    e.kind === "approve" &&
    (role === "agent" || (p?.kind === "reassign" && role !== "admin"));
  const closing =
    (e.kind === "approve" && p?.kind === "close") ||
    (e.kind === "stage" && ["종료", "서비스 완료"].includes(v.stage));
  const input = (
    key: string,
    label: string,
    type = "text",
    optional = false,
  ) => (
    <label key={key}>
      {label}
      {optional && <span className="optional">선택</span>}
      <Input
        type={type}
        value={v[key] ?? ""}
        onChange={(event) => field(key, event.target.value)}
        required={!optional}
        {...(key === "nextDate" ? { min: "2026-09-15" } : {})}
      />
    </label>
  );
  const textarea = (key: string, label: string, optional = false) => (
    <label key={key}>
      {label}
      {optional && <span className="optional">선택</span>}
      <Textarea
        rows={key === "body" ? 7 : 3}
        value={v[key] ?? ""}
        onChange={(event) => field(key, event.target.value)}
        required={!optional}
      />
    </label>
  );
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit(false);
  };
  return (
    <Dialog
      open
      onOpenChange={(opened) => {
        if (!opened) close();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="editor-dialog max-h-[calc(100dvh-2rem)] overflow-y-auto p-0 sm:max-w-xl"
      >
        <DialogDescription className="sr-only">
          {c.name}의 업무 내용을 확인하고 저장하세요. 가상 데이터 검수
          화면입니다.
        </DialogDescription>
        <form onSubmit={onSubmit}>
          <div className="dialog-head">
            <div>
              <span className="eyebrow">{c.name}</span>
              <DialogTitle id="editor-title">
                {e.label.split(" · ").slice(1).join(" · ")}
              </DialogTitle>
            </div>
            <Button
              type="button"
              className="icon-button"
              aria-label="작성 창 닫기"
              onClick={close}
            >
              <X size={21} />
            </Button>
          </div>
          <div className="dialog-body">
            {e.kind === "record" && (
              <>
                {t?.dueAt && t.dueAt.slice(0, 10) < TODAY && (
                  <div className="context-box">
                    <strong>{t.title} · 아직 처리되지 않은 업무</strong>
                    {t.kind === "first" && <span>{c.person} · {c.phone}</span>}
                    <p>
                      {t.kind === "first"
                        ? "고객에게 직접 연락한 뒤 아래에 결과를 남겨 주세요. 이 창을 여는 것만으로 전화가 걸리거나 업무가 완료되지는 않습니다."
                        : "업무를 직접 처리한 뒤 아래에 수행 시각과 결과를 남겨 주세요. 아직 처리하지 않았다면 창을 닫고 업무를 먼저 진행하세요."}
                    </p>
                  </div>
                )}
                {t?.kind === "first" && (
                  <label>
                    연락 결과
                    <NativeSelect
                      value={v.outcome}
                      onChange={(event) => field("outcome", event.target.value)}
                      required
                    >
                      <option value="">결과를 선택하세요</option>
                      <option value="connected">통화 연결</option>
                      <option value="sms">부재 후 안내 문자 발송</option>
                      <option value="attempt">전화만 시도 · 문자 미발송</option>
                    </NativeSelect>
                  </label>
                )}
                {input("actualAt", "실제 수행 시각", "datetime-local")}
                {textarea("memo", "상담 메모", true)}
                <p className="hint">
                  메모 없이도 결과를 저장할 수 있습니다. 시연 기준 시각은 9월
                  14일 15:00입니다.
                </p>
              </>
            )}
            {e.kind === "due" && (
              <>
                <div className="context-box">
                  <strong>{t?.title}</strong>
                  <span>현재 기한 · {dateLabel(t?.dueAt ?? null)}</span>
                  <span>최초 기한 · {dateLabel(t?.originalDueAt ?? null)}</span>
                </div>
                {input("date", "처리할 날짜", "date")}
                {textarea("reason", "기한 설정·변경 이유")}
                <p className="hint">
                  기한을 바꿔도 원래 기한과 변경 이력은 보관됩니다.
                </p>
              </>
            )}
            {["exclude", "reject", "reopen"].includes(e.kind) && (
              <>
                <div className="context-box">
                  <strong>{t?.title ?? p?.title}</strong>
                  <span>
                    {e.kind === "reopen"
                      ? "완료 기록을 취소하고 미완료로 되돌립니다."
                      : "제외 이유를 남기며, 실제 완료 실적에는 포함하지 않습니다."}
                  </span>
                </div>
                {textarea(
                  "reason",
                  e.kind === "reopen" ? "완료 취소 이유" : "제외 이유",
                )}
              </>
            )}
            {e.kind === "add-task" && (
              <>
                <label>
                  어떤 업무인가요?
                  <NativeSelect required value={v.taskType ?? ''} onChange={event => field('taskType', event.target.value)}>
                    <option value="">업무 종류를 선택하세요</option>
                    {taskOptions.recommended.length > 0 && <optgroup label={`현재 단계 · ${c.stage}`}>
                      {taskOptions.recommended.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}
                    </optgroup>}
                    <optgroup label="다른 단계의 업무">
                      {taskOptions.others.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}
                    </optgroup>
                    <option value="other">기타 고객 관련 업무</option>
                  </NativeSelect>
                </label>
                <p className="hint">현재 ‘{c.stage}’ 단계에 맞는 업무를 먼저 보여드립니다. 필요하면 다른 단계의 업무도 선택할 수 있습니다.</p>
                <label>
                  구체적으로 무엇을 해야 하나요?
                  {v.taskType !== 'other' && <span className="optional">선택</span>}
                  <Textarea rows={3} value={v.description ?? ''} required={v.taskType === 'other'} onChange={event => field('description', event.target.value)} placeholder="예: 다음 주 방문 가능한 날짜를 고객에게 확인" />
                </label>
                {v.taskType === 'other' && <p className="hint">이 고객의 상담·계약·서비스 제공과 관련된 업무 내용을 반드시 적어 주세요.</p>}
                {input("date", "처리할 날짜", "date", true)}
                {selectedTaskType && <div className="context-box">
                  <span>등록할 업무 미리보기</span>
                  <strong className="break-words">{selectedTaskType.label}{v.description?.trim() ? ` · ${v.description.trim()}` : ''}</strong>
                </div>}
                <div className="context-box">
                  <span>담당자 · {personName(c.assigneeId)}</span>
                  <span>
                    날짜를 모르면 비워두세요. ‘기한 확인 필요’로 등록됩니다.
                  </span>
                </div>
              </>
            )}
            {e.kind === "note" && (
              <>
                {textarea("body", "상담 메모")}
                <p className="hint">
                  이 검수본에서는 메모 저장만 시연합니다. AI 분석은 연결 후
                  실행됩니다.
                </p>
              </>
            )}
            {e.kind === "customer" && (
              <>
                <div className="form-grid">
                  {input("name", "이름·업체명")}
                  {input("person", "고객 담당자")}
                  {input("phone", "연락처", "tel")}
                  {input("email", "이메일", "email")}
                </div>
                {textarea("reason", "수정 이유")}
                <p className="hint">
                  CRM 수정본을 변경합니다. 최초 접수 원문은 유지됩니다.
                </p>
              </>
            )}
            {e.kind === "stage" && (
              <>
                <label>
                  변경할 단계
                  <NativeSelect
                    value={v.stage}
                    onChange={(event) => field("stage", event.target.value)}
                  >
                    {STAGES.map((stage) => (
                      <option key={stage}>{stage}</option>
                    ))}
                  </NativeSelect>
                </label>
                {textarea(
                  "reason",
                  v.stage === "종료" ? "종료 이유" : "변경 메모",
                  v.stage !== "종료",
                )}
              </>
            )}
            {e.kind === "defer" && (
              <>
                <p>{p?.title}</p>
                {input("date", "다음 확인 날짜", "date")}
                {textarea("reason", "변경 이유")}
              </>
            )}
            {e.kind === "email-draft" && (
              <>
                {input("to", "받는 사람", "email")}
                {input("subject", "제목")}
                {textarea("body", "이메일 내용")}
                <p className="hint">
                  새 초안을 저장한 뒤 다시 검토합니다. 이 단계에서는 발송하거나
                  업무를 완료하지 않습니다.
                </p>
              </>
            )}
            {e.kind === "approve" && (
              <>
                <div className="ai-evidence">
                  <Sparkles size={18} />
                  <div>
                    <strong>제안 근거</strong>
                    <p>{p?.reason}</p>
                  </div>
                </div>
                {p?.kind === "email" && (
                  <>
                    {input("to", "받는 사람", "email")}
                    {input("subject", "제목")}
                    {textarea("body", "이메일 내용")}
                    {c.files.length > 0 && (
                      <div className="attachment-note">
                        <FileText size={15} />
                        첨부 없음 · 자료 탭의 파일은 자동으로 첨부되지 않습니다.
                      </div>
                    )}
                    {input("nextDate", "회신을 다시 확인할 날짜", "date", true)}
                    <p className="hint">
                      발송 업무만 완료합니다. 회신 확인은 선택한 날짜의 별도
                      업무로 등록됩니다.
                    </p>
                    <div className="simulation-note">
                      검수용 시연입니다. 실제 이메일은 발송되지 않습니다.
                    </div>
                  </>
                )}
                {p?.kind === "reassign" && (
                  <>
                    <div className="reassign-preview">
                      <div>
                        <span className="avatar">
                          {personName(c.assigneeId).slice(0, 1)}
                        </span>
                        <strong>{personName(c.assigneeId)}</strong>
                        <span>현재 담당자</span>
                      </div>
                      <ArrowRight size={20} />
                      <div>
                        <span className="avatar">
                          {personName(p.nextAssigneeId!).slice(0, 1)}
                        </span>
                        <strong>{personName(p.nextAssigneeId!)}</strong>
                        <span>변경할 담당자</span>
                      </div>
                    </div>
                    <p>
                      관련 미완료 업무 {remaining.length}건의 담당자가 함께
                      변경됩니다. 완료 이력의 실제 수행자는 유지됩니다.
                    </p>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={v.ack === "yes"}
                        onChange={(event) =>
                          field("ack", event.target.checked ? "yes" : "")
                        }
                      />
                      담당자와 영향받는 업무를 확인했습니다.
                    </label>
                  </>
                )}
                {blocked && (
                  <div className="form-error">
                    {role === "agent"
                      ? "AI는 제안만 할 수 있습니다. 권한 있는 직원의 확인이 필요합니다."
                      : "담당자 변경은 관리자만 확정할 수 있습니다."}
                  </div>
                )}
              </>
            )}
            {closing && (
              <div className="closure-warning">
                <strong>
                  <CircleAlert size={17} />
                  남은 업무 {remaining.length}건 · 후속 알림 중단
                </strong>
                <ul>
                  {remaining.map((t) => (
                    <li key={t.id}>
                      {t.title}
                      <span>{dateLabel(t.dueAt)}</span>
                    </li>
                  ))}
                </ul>
                <p>
                  미완료 업무는 기록으로 보관되며 완료 실적에 포함되지 않습니다.
                </p>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={v.ack === "yes"}
                    onChange={(event) =>
                      field("ack", event.target.checked ? "yes" : "")
                    }
                  />
                  남은 업무와 중단될 알림을 확인했습니다.
                </label>
              </div>
            )}
            {error && (
              <div className="form-error" role="alert">
                <CircleAlert size={17} />
                <span>{error}</span>
                {/실패|저장하지/.test(error) && (
                  <Button
                    type="button"
                    className="text-button"
                    onClick={() => submit(true)}
                  >
                    재시도 · 시연
                  </Button>
                )}
              </div>
            )}
          </div>
          <div className="dialog-footer">
            <Button type="button" className="button" onClick={close}>
              나중에 계속
            </Button>
            <Button className="button primary" type="submit" disabled={blocked}>
              {e.kind === "approve"
                ? p?.kind === "email"
                  ? "승인 후 발송 · 시연"
                  : "확인 후 반영"
                : "저장"}
              <Check size={16} />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Button({
  className,
  variant,
  size,
  ...props
}: ComponentProps<typeof ShadcnButton>) {
  const names = className?.split(" ") ?? [];
  const resolvedVariant =
    variant ??
    (names.includes("primary")
      ? "default"
      : names.includes("button")
        ? "outline"
        : "ghost");
  const resolvedSize =
    size ?? (names.includes("icon-button") ? "icon" : "default");
  return (
    <ShadcnButton
      variant={resolvedVariant}
      size={resolvedSize}
      className={cn(
        className,
        names.includes("stat") &&
          "h-auto w-full items-start justify-start whitespace-normal p-6 text-left",
      )}
      {...props}
    />
  );
}
