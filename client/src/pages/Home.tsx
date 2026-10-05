import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  Calculator,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  FileCheck2,
  FileText,
  Filter,
  GitCompare,
  LayoutDashboard,
  LineChart as LineChartIcon,
  LockKeyhole,
  LogOut,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import LiveDartPanel from "../components/LiveDartPanel";
import { trpc } from "../lib/trpc";

type UserRole = "viewer" | "admin";
type View = "overview" | "ask" | "compare" | "sources" | "terms" | "companies";
type AskMode = "natural" | "category";
type MetricKey = "revenue" | "operatingProfit" | "netIncome" | "operatingMargin" | "operatingCashFlow" | "investmentCashFlow" | "financingCashFlow" | "capex" | "netDebt" | "debtRatio" | "currentRatio" | "interestCoverage" | "roe" | "roa" | "eps" | "ebitda" | "per" | "pbr";
type Basis = "CFS" | "OFS";
type PeriodKey = "latest" | "annual" | "half" | "q1" | "q3";

type Term = {
  key: string;
  label: string;
  definition: string;
  formula: string;
  note?: string;
};

const CORE_METRICS: MetricKey[] = ["revenue", "operatingProfit", "netIncome"];
const CUSTOM_OPTIONS: MetricKey[] = ["operatingCashFlow", "capex", "netDebt", "debtRatio"];

const TERMS: Term[] = [
  { key: "revenue", label: "매출액", definition: "기업이 제품·상품·서비스를 판매하고 얻은 수익입니다.", formula: "공시 손익계산서의 매출액(또는 수익)" },
  { key: "operatingProfit", label: "영업이익", definition: "본업에서 발생한 수익에서 본업 관련 비용을 차감한 이익입니다.", formula: "영업이익 = 매출액 − 매출원가 − 판매비와관리비" },
  { key: "netIncome", label: "순이익", definition: "영업외손익과 법인세 등을 반영한 최종 이익입니다.", formula: "순이익 = 세전이익 − 법인세비용" },
  { key: "operatingCashFlow", label: "영업활동현금흐름", definition: "영업활동에서 실제로 유입·유출된 현금의 순액입니다.", formula: "현금흐름표의 영업활동으로 인한 순현금흐름" },
  { key: "investmentCashFlow", label: "투자활동현금흐름", definition: "설비·투자자산 등의 투자활동에서 발생한 현금의 순액입니다.", formula: "현금흐름표의 투자활동으로 인한 순현금흐름" },
  { key: "financingCashFlow", label: "재무활동현금흐름", definition: "차입·상환·증자·배당 등 재무활동에서 발생한 현금의 순액입니다.", formula: "현금흐름표의 재무활동으로 인한 순현금흐름" },
  { key: "capex", label: "CAPEX", definition: "생산설비·기계장치·건물 등 장기자산을 취득하기 위해 지출한 투자액입니다.", formula: "CAPEX ≈ 현금흐름표의 유형자산 취득" },
  { key: "netDebt", label: "순차입금", definition: "이자부 차입금에서 현금성자산을 차감한 재무부담 지표입니다.", formula: "순차입금 = 총차입금 − 현금및현금성자산 − 단기금융상품", note: "이 서비스는 리스부채를 제외한 보수적 기준을 적용합니다." },
  { key: "debtRatio", label: "부채비율", definition: "자기자본 대비 부채가 얼마나 있는지를 보여주는 안정성 지표입니다.", formula: "부채비율 = 부채총계 ÷ 자본총계 × 100" },
  { key: "currentAssets", label: "유동자산", definition: "1년 이내 현금화하거나 정상 영업주기 내 회수할 것으로 예상되는 자산입니다.", formula: "재무상태표의 유동자산" },
  { key: "cash", label: "현금및현금성자산", definition: "즉시 현금화할 수 있는 현금과 현금성 자산입니다.", formula: "재무상태표의 현금및현금성자산" },
  { key: "shortTermFinancial", label: "단기금융상품", definition: "단기간 운용되는 금융상품입니다.", formula: "재무상태표의 단기금융상품" },
  { key: "receivables", label: "매출채권", definition: "제품·서비스 판매 후 아직 회수하지 않은 금액입니다.", formula: "재무상태표의 매출채권" },
  { key: "inventory", label: "재고자산", definition: "판매를 위해 보유하거나 생산과정에 있는 자산입니다.", formula: "재무상태표의 재고자산" },
  { key: "currentLiabilities", label: "유동부채", definition: "1년 이내 상환하거나 정상 영업주기 내 결제할 부채입니다.", formula: "재무상태표의 유동부채" },
  { key: "currentLongTermDebt", label: "유동성장기부채", definition: "장기차입금 중 1년 이내 상환기일이 도래해 유동부채로 분류된 금액입니다.", formula: "재무상태표의 유동성장기부채 또는 비유동차입금의 유동성 대체 부분" },
  { key: "longTermDebt", label: "장기차입금", definition: "상환기일이 1년을 초과하는 차입금입니다.", formula: "재무상태표의 장기차입금" },
  { key: "totalLiabilities", label: "부채총계", definition: "기업이 부담하는 모든 부채의 합계입니다.", formula: "유동부채 + 비유동부채" },
  { key: "totalEquity", label: "자본총계", definition: "주주지분과 비지배지분을 포함한 순자산입니다.", formula: "자산총계 − 부채총계" },
  { key: "retainedEarnings", label: "이익잉여금", definition: "기업이 벌어들인 이익 중 배당 등으로 유출되지 않고 누적된 금액입니다.", formula: "재무상태표의 이익잉여금(결손금)" },
  { key: "financialIncome", label: "금융수익", definition: "이자수익 등 금융활동에서 발생한 수익입니다.", formula: "손익계산서의 금융수익" },
  { key: "financialCost", label: "금융원가", definition: "차입금 이자 등 금융활동에서 발생한 비용입니다.", formula: "손익계산서의 금융원가" },
  { key: "preTaxIncome", label: "법인세차감전순손익", definition: "법인세비용을 차감하기 전의 순손익입니다.", formula: "세전이익" },
  { key: "taxExpense", label: "법인세비용", definition: "당기 손익에 반영되는 법인세 관련 비용입니다.", formula: "손익계산서의 법인세비용" },
  { key: "totalComprehensiveIncome", label: "총포괄손익", definition: "당기순손익에 기타포괄손익을 더한 전체 포괄손익입니다.", formula: "당기순손익 + 기타포괄손익" },
  { key: "basicEps", label: "기본주당순손익", definition: "기본주당순이익 또는 손실을 나타내는 주당 지표입니다.", formula: "공시된 기본주당순손익" },
  { key: "ebitda", label: "EBITDA", definition: "이자·세금·감가상각비 차감 전 이익으로 영업현금창출력을 비교할 때 자주 사용합니다.", formula: "EBITDA = 영업이익 + 감가상각비 + 무형자산상각비" },
  { key: "roe", label: "ROE", definition: "주주가 투자한 자기자본으로 얼마의 순이익을 벌었는지를 보여줍니다.", formula: "ROE = 당기순이익 ÷ 평균자기자본 × 100" },
  { key: "roa", label: "ROA", definition: "기업이 보유한 총자산을 활용해 얼마나 이익을 냈는지를 나타냅니다.", formula: "ROA = 당기순이익 ÷ 평균총자산 × 100" },
  { key: "eps", label: "EPS", definition: "보통주 1주에 귀속되는 순이익입니다.", formula: "EPS = 지배주주 보통주 귀속순이익 ÷ 가중평균유통주식수" },
  { key: "per", label: "PER", definition: "주가가 주당순이익의 몇 배인지 나타내는 밸류에이션 지표입니다.", formula: "PER = 주가 ÷ EPS" },
  { key: "pbr", label: "PBR", definition: "주가가 주당순자산가치의 몇 배인지 나타내는 지표입니다.", formula: "PBR = 주가 ÷ BPS" },
  { key: "currentRatio", label: "유동비율", definition: "1년 이내 현금화 가능한 유동자산으로 유동부채를 얼마나 감당할 수 있는지 보여줍니다.", formula: "유동비율 = 유동자산 ÷ 유동부채 × 100" },
  { key: "interestCoverage", label: "이자보상배율", definition: "영업이익으로 이자비용을 어느 정도 충당할 수 있는지를 보는 지표입니다.", formula: "이자보상배율 = 영업이익 ÷ 이자비용" },
];

const periodLabels: Record<PeriodKey, string> = {
  latest: "최신 보고서",
  q1: "1분기",
  half: "반기",
  q3: "3분기",
  annual: "사업보고서",
};
const basisLabels: Record<Basis, string> = { CFS: "연결 기준", OFS: "별도 기준" };
const metricLabels: Record<MetricKey, string> = {
  revenue: "매출액",
  operatingProfit: "영업이익",
  netIncome: "순이익",
  operatingMargin: "영업이익률",
  operatingCashFlow: "영업활동현금흐름",
  investmentCashFlow: "투자활동현금흐름",
  financingCashFlow: "재무활동현금흐름",
  capex: "CAPEX",
  netDebt: "순차입금",
  debtRatio: "부채비율",
  currentRatio: "유동비율",
  interestCoverage: "이자보상배율",
  roe: "ROE",
  roa: "ROA",
  eps: "EPS",
  ebitda: "EBITDA",
  per: "PER",
  pbr: "PBR",
};

function money(value: number | null | undefined, unit = "억원") {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (unit === "%") return `${value.toFixed(1)}%`;
  return `${Math.round(value).toLocaleString("ko-KR")} ${unit}`;
}

function useStoredState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  }, [key, value]);
  return [value, setValue] as const;
}

function LogoMark() {
  return <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>;
}

function LoginScreen({ onLogin }: { onLogin: (role: UserRole) => void }) {
  const [role, setRole] = useState<UserRole>("viewer");
  const [email, setEmail] = useState("viewer@daehan.co.kr");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState("");
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== (role === "viewer" ? "demo1234" : "admin1234")) { setError("데모 비밀번호를 확인해 주세요."); return; }
    onLogin(role);
  };
  return <main className="login-shell login-shell-v2">
    <div className="login-grid" />
    <header className="login-nav"><div className="brand-lockup"><LogoMark /><span>DISCLOSURE<br /><b>NAVIGATOR</b></span></div><span className="login-nav-status"><span className="status-dot" /> Secure enterprise workspace</span></header>
    <section className="login-stage">
      <div className="login-intro"><p className="eyebrow">THE EVIDENCE-FIRST WORKSPACE</p><h1>질문에서<br /><em>근거까지.</em></h1><p className="login-description">공시를 검색하는 데서 멈추지 않습니다. 최신 공시를 읽고, 계정을 조합하고, 검증 가능한 재무지표로 바꿉니다.</p><div className="login-flow"><div><span>01</span><b>최신 공시</b><small>DART 실시간 조회</small></div><div><span>02</span><b>재무 지표</b><small>계정 · 산식 · 검증</small></div><div><span>03</span><b>출처 확인</b><small>문서 · 기준 · 기간</small></div></div></div>
      <form className="login-card login-card-v2" onSubmit={submit}><div className="card-kicker"><span className="status-dot" /> DAEHAN GROUP · INTERNAL ACCESS</div><div className="login-card-title"><div><h2>Workspace 입장</h2><p className="muted">회사 계정으로 안전하게 연결하세요.</p></div><div className="login-badge"><ShieldCheck size={16} /><span>SSO<br />READY</span></div></div>
        <label className="field-label" htmlFor="login-id">회사 이메일</label><div className="input-shell"><Building2 size={17} /><input id="login-id" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <label className="field-label" htmlFor="login-password">비밀번호</label><div className="input-shell"><LockKeyhole size={17} /><input id="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {error && <p className="form-error">{error}</p>}<button className="primary-button login-button" type="submit">Continue to workspace <ArrowUpRight size={17} /></button>
        <div className="login-divider"><span>또는 데모로 체험</span></div><div className="demo-choice">
          <button type="button" className={role === "viewer" ? "active" : ""} onClick={() => { setRole("viewer"); setEmail("viewer@daehan.co.kr"); setPassword("demo1234"); }}><span>Viewer</span><small>viewer / demo1234</small></button>
          <button type="button" className={role === "admin" ? "active" : ""} onClick={() => { setRole("admin"); setEmail("admin@daehan.co.kr"); setPassword("admin1234"); }}><span>Admin</span><small>admin / admin1234</small></button>
        </div><p className="login-note"><LockKeyhole size={13} /> 운영 환경에서는 사내 SSO로 교체됩니다.</p>
      </form>
    </section><footer className="login-footer">© 2026 Disclosure Navigator · Internal prototype</footer>
  </main>;
}

function MetricCard({ label, value, unit, active, icon: Icon, onClick, addMode, onAdd }: { label: string; value?: number | null; unit?: string; active?: boolean; icon: typeof BarChart3; onClick?: () => void; addMode?: boolean; onAdd?: () => void }) {
  if (addMode) return <button className="metric-card metric-add" onClick={onAdd}><Plus size={18} /><strong>지표 추가</strong><span>커스텀 KPI를 선택하세요</span></button>;
  return <button className={`metric-card ${active ? "active" : ""}`} onClick={onClick}><div className="metric-top"><span>{label}</span><div className="metric-icon"><Icon size={16} /></div></div><div className="metric-value">{money(value, unit)}</div><div className="metric-delta">최근 공시 기준 · 원문 연결</div></button>;
}

function CompanyPicker({ companies, active, onChange, onAdd }: { companies: string[]; active: string; onChange: (company: string) => void; onAdd: () => void }) {
  return <div className="company-picker-wrap"><div className="company-picker-label">기준 기업</div><div className="company-picker-row"><select value={active} onChange={(e) => onChange(e.target.value)}>{companies.map((c) => <option key={c}>{c}</option>)}</select><button className="outline-button" onClick={onAdd}><Plus size={15} /> 타 기업 추가</button></div></div>;
}

function CompanyModal({ onClose, onAdded }: { onClose: () => void; onAdded: (company: string) => void }) {
  const [search, setSearch] = useState("");
  const q = trpc.dart.searchCompanies.useQuery({ query: search, limit: 10 }, { enabled: search.trim().length >= 2, retry: false, staleTime: 60000 });
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal-card" onMouseDown={(e) => e.stopPropagation()}>
    <div className="modal-head"><div><p className="eyebrow dark">COMPANY MONITORING</p><h2>타 기업 추가</h2><p>기업명을 검색하고 추가하면 이 브라우저의 모니터링 목록에 계속 포함됩니다.</p></div><button className="icon-button" onClick={onClose} aria-label="닫기"><X size={18} /></button></div>
    <div className="search-input modal-search"><Search size={16} /><input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="예: LS ELECTRIC, 삼성전자, 한국콜마" /></div>
    <div className="company-results">{q.isLoading && <div className="empty-result">기업목록 조회 중…</div>}{q.error && <div className="empty-result">조회 오류: {q.error.message}</div>}{!q.isLoading && search.length >= 2 && q.data?.length === 0 && <div className="empty-result">일치하는 DART 기업이 없습니다.</div>}{q.data?.map((item) => <button key={item.code} className="company-result" onClick={() => { onAdded(item.name); onClose(); }}><div><strong>{item.name}</strong><span>{item.stock || "비상장"}</span></div><Plus size={16} /></button>)}</div>
    <div className="modal-note"><CircleHelp size={14} /> 추가 기업은 매출액·영업이익·순이익을 포함해 최신 공시에서 다시 조회합니다.</div>
  </div></div>;
}

function MetricPicker({ existing, onAdd, onClose }: { existing: MetricKey[]; onAdd: (metric: MetricKey) => void; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal-card small-modal" onMouseDown={(e) => e.stopPropagation()}><div className="modal-head"><div><p className="eyebrow dark">CUSTOM KPI</p><h2>커스텀 지표 추가</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div><div className="term-picker-list">{CUSTOM_OPTIONS.map((key) => <button key={key} className={`term-pick ${existing.includes(key) ? "disabled" : ""}`} disabled={existing.includes(key)} onClick={() => onAdd(key)}><span>{metricLabels[key]}</span><small>{existing.includes(key) ? "이미 추가됨" : "대시보드에 추가"}</small><ChevronRight size={15} /></button>)}</div></div></div>;
}

function TermsView() {
  const uniqueTerms = TERMS.filter((t, i, arr) => arr.findIndex((x) => x.label === t.label) === i);
  const [selected, setSelected] = useState(uniqueTerms[0]);
  return <section className="terms-page"><div className="subpage-heading"><div><p className="eyebrow dark">FINANCIAL GLOSSARY</p><h1>재무 용어</h1><p className="subhead">용어를 선택하면 실무에서 쓰는 기본 정의와 계산식을 바로 확인합니다.</p></div></div><div className="terms-layout"><div className="terms-list">{uniqueTerms.map((term) => <button key={term.label} className={selected.label === term.label ? "active" : ""} onClick={() => setSelected(term)}><span>{term.label}</span><ChevronRight size={15} /></button>)}</div><article className="term-detail"><div className="term-icon"><Calculator size={19} /></div><p className="eyebrow dark">TERM DEFINITION</p><h2>{selected.label}</h2><p>{selected.definition}</p><div className="definition-box"><span>계산식 / 산식</span><strong>{selected.formula}</strong></div>{selected.note && <div className="callout"><CircleHelp size={17} /><div><strong>주의</strong><p>{selected.note}</p></div></div>}</article></div></section>;
}

function Overview({ company, onCompanyChange, companies, onAddCompany, onAddMetric, customMetrics, snapshot, snapshotLoading, onRefresh, refreshing, onOpenAsk }: {
  company: string; onCompanyChange: (v: string) => void; companies: string[]; onAddCompany: () => void; onAddMetric: () => void; customMetrics: MetricKey[]; snapshot?: any; snapshotLoading: boolean; onRefresh: () => void; refreshing: boolean; onOpenAsk: () => void;
}) {
  const metrics = snapshot?.metrics as Record<MetricKey, { value: number; unit: string } | null> | undefined;
  return <>
    <section className="welcome-row"><div><p className="eyebrow dark">LATEST DART PULSE</p><h1>오늘의 공시 인사이트</h1><p className="subhead">최근 보고서의 핵심 재무지표를 먼저 보고, 필요한 숫자는 직접 확장하세요.</p></div><button className="outline-button" onClick={onRefresh} disabled={refreshing}><RefreshCw size={15} className={refreshing ? "spin" : ""} /> {refreshing ? "갱신 중" : "최신 데이터 갱신"}</button></section>
    <CompanyPicker companies={companies} active={company} onChange={onCompanyChange} onAdd={onAddCompany} />
    <section className="dashboard-banner"><div><span className="hero-eyebrow"><Sparkles size={14} /> LIVE OPEN DART</span><h2>{company} <em>최근 공시</em></h2><p>{snapshot?.period ?? "최근 보고서를 조회하고 있습니다."} · {snapshot?.basis ?? "연결 기준"}</p></div><button className="primary-button" onClick={onOpenAsk}>질문으로 파고들기 <ArrowUpRight size={15} /></button></section>
    <section className="section-row"><div><p className="eyebrow dark">PULSE CHECK</p><h2>핵심 지표</h2></div><span className="section-note">최근 매출액 · 영업이익 · 순이익</span></section>
    <div className="metric-grid core-metrics"><MetricCard label={`${company} · 매출액`} value={metrics?.revenue?.value} unit={metrics?.revenue?.unit} icon={BarChart3} active /><MetricCard label={`${company} · 영업이익`} value={metrics?.operatingProfit?.value} unit={metrics?.operatingProfit?.unit} icon={TrendingUp} /><MetricCard label={`${company} · 순이익`} value={metrics?.netIncome?.value} unit={metrics?.netIncome?.unit} icon={LineChartIcon} /></div>
    {customMetrics.length > 0 && <><section className="section-row custom-section"><div><p className="eyebrow dark">CUSTOM METRICS</p><h2>내가 추가한 지표</h2></div><span className="section-note">브라우저에 저장되어 계속 유지됩니다.</span></section><div className="metric-grid custom-metrics">{customMetrics.map((key) => <div key={key}><MetricCard label={`${company} · ${metricLabels[key]}`} value={metrics?.[key]?.value} unit={metrics?.[key]?.unit} icon={key === "netDebt" ? Calculator : key === "capex" ? BarChart3 : LineChartIcon} /></div>)}<MetricCard label="" addMode icon={Plus} onAdd={onAddMetric} /></div></>}
    {customMetrics.length === 0 && <button className="metric-add-wide" onClick={onAddMetric}><Plus size={16} /> 커스텀 지표 추가 <span>영업현금흐름 · CAPEX · 순차입금 · 부채비율</span></button>}
    <div className="lower-grid"><section className="recent-panel"><div className="panel-heading"><div><p className="eyebrow dark">LATEST REPORT</p><h2>최신 데이터 상태</h2></div><FileCheck2 size={17} className="panel-muted" /></div><div className="status-card"><div><strong>{snapshot?.period ?? "조회 중"}</strong><span>{snapshot?.basis ?? ""}</span></div><span className="verified-pill"><Check size={12} /> DART</span></div><div className="status-lines"><div><span>최근 갱신</span><b>{snapshot?.refreshedAt ? new Date(snapshot.refreshedAt).toLocaleString("ko-KR") : "—"}</b></div><div><span>데이터 상태</span><b>{snapshotLoading ? "조회 중…" : snapshot?.found === false ? "자료 없음" : "최신 조회 가능"}</b></div></div></section><section className="trust-panel"><div className="trust-illustration"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="trust-center"><ShieldCheck size={27} /></div><span className="float-chip chip-one"><FileCheck2 size={13} /> 원문 출처</span><span className="float-chip chip-two"><Calculator size={13} /> 계산 추적</span></div><div><p className="eyebrow dark">BUILT FOR TRUST</p><h2>숫자보다 중요한 건<br />숫자의 <em>근거</em>입니다.</h2><p>각 지표는 선택된 보고기간과 연결/별도 기준을 함께 표시합니다.</p></div></section></div>
  </>;
}

function CategoryQuestion({ company, onSubmit }: { company: string; onSubmit: (query: string, mode?: AskMode) => void }) {
  const nowYear = new Date().getFullYear();
  const [year, setYear] = useState(String(nowYear));
  const [period, setPeriod] = useState<PeriodKey>("latest");
  const [basis, setBasis] = useState<Basis>("CFS");
  const [metric, setMetric] = useState<MetricKey>("revenue");
  const [keyword, setKeyword] = useState("");
  const run = () => onSubmit(`${company} ${year}년 ${periodLabels[period]} ${basisLabels[basis]} ${metricLabels[metric]}${keyword.trim() ? ` ${keyword.trim()}` : ""}`, "category");
  return <section className="category-panel"><div className="category-grid"><label><span>년도</span><select value={year} onChange={(e) => setYear(e.target.value)}>{Array.from({ length: 8 }, (_, i) => nowYear - i).map((y) => <option key={y}>{y}</option>)}</select></label><label><span>보고서</span><select value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)}><option value="latest">최신 보고서</option><option value="q1">1분기</option><option value="half">반기</option><option value="q3">3분기</option><option value="annual">사업보고서</option></select></label><label><span>기준</span><select value={basis} onChange={(e) => setBasis(e.target.value as Basis)}><option value="CFS">연결 기준</option><option value="OFS">별도 기준</option></select></label><label><span>궁금한 검색어</span><select value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)}><option value="revenue">매출액</option><option value="operatingProfit">영업이익</option><option value="netIncome">순이익</option><option value="operatingMargin">영업이익률</option><option value="operatingCashFlow">영업활동현금흐름</option><option value="investmentCashFlow">투자활동현금흐름</option><option value="financingCashFlow">재무활동현금흐름</option><option value="capex">CAPEX</option><option value="netDebt">순차입금</option><option value="debtRatio">부채비율</option><option value="currentRatio">유동비율</option><option value="interestCoverage">이자보상배율</option><option value="roe">ROE</option><option value="roa">ROA</option><option value="eps">EPS</option><option value="ebitda">EBITDA</option><option value="per">PER</option><option value="pbr">PBR</option></select></label><label className="category-keyword"><span>세부 검색어 (선택)</span><input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="예: 증가 원인, 최근 추이, 전년 대비" /></label></div><button className="primary-button category-run" onClick={run}><Search size={16} /> 조건으로 조회</button></section>;
}

function CompareView({ companies, selected, setSelected }: { companies: string[]; selected: string[]; setSelected: (v: string[]) => void }) {
  const [metric, setMetric] = useState<MetricKey>("revenue");
  const [period, setPeriod] = useState<PeriodKey>("latest");
  const [year, setYear] = useState(String(new Date().getFullYear() - 1));
  const [basis, setBasis] = useState<Basis>("CFS");
  const compare = trpc.dart.compare.useQuery({ companies: selected, metric, period, year: period === "latest" ? undefined : Number(year), basis }, { enabled: selected.length >= 2, retry: false, staleTime: 0, refetchOnWindowFocus: false });
  const toggle = (company: string) => setSelected(selected.includes(company) ? selected.filter((x) => x !== company) : [...selected, company].slice(0, 8));
  return <section className="compare-page"><div className="compare-controls"><div><p className="eyebrow dark">LIVE PEER ANALYSIS</p><h2>비교 분석</h2><p>선택한 기업만 동일한 지표·기간·기준으로 직접 비교합니다.</p></div><div className="compare-filter-grid"><label>지표<select value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)}>{Object.entries(metricLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>보고서<select value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)}><option value="latest">최신 보고서</option><option value="q1">1분기</option><option value="half">반기</option><option value="q3">3분기</option><option value="annual">사업보고서</option></select></label><label>년도<select value={year} onChange={(e) => setYear(e.target.value)} disabled={period === "latest"}>{[2026,2025,2024,2023,2022].map((y) => <option key={y}>{y}</option>)}</select></label><label>기준<select value={basis} onChange={(e) => setBasis(e.target.value as Basis)}><option value="CFS">연결</option><option value="OFS">별도</option></select></label></div></div>
    <div className="compare-company-list"><span>비교 기업</span>{companies.map((company) => <button key={company} className={selected.includes(company) ? "selected" : ""} onClick={() => toggle(company)}>{selected.includes(company) ? <Check size={13} /> : null}{company}</button>)}</div>
    <div className="compare-live"><div className="compare-live-head"><div><span className="answer-label">{metricLabels[metric]} · {periodLabels[period]} · {basisLabels[basis]}</span><h3>실제 DART 공시값 비교</h3></div>{compare.isFetching && <span className="fetching"><RefreshCw size={13} className="spin" /> 조회 중</span>}</div>{selected.length < 2 ? <div className="compare-empty"><GitCompare size={26} /><strong>2개 이상의 기업을 선택하세요.</strong><span>타 기업 추가 후 비교 목록에서 체크할 수 있습니다.</span></div> : compare.error ? <div className="compare-empty"><CircleHelp size={26} /><strong>비교 조회 오류</strong><span>{compare.error.message}</span></div> : compare.data ? <div className="compare-table-wrap"><table className="compare-table"><thead><tr><th>기업</th><th>값</th><th>보고기간</th><th>기준</th><th>출처</th></tr></thead><tbody>{compare.data.rows.map((row) => <tr key={row.company}><td><strong>{row.company}</strong></td><td>{row.found ? money(row.value, row.unit) : "—"}</td><td>{row.period || "—"}</td><td>{row.basis}</td><td>{row.citation ? <a href={row.citation.match(/\(https[^)]+\)/)?.[0].slice(1, -1)} target="_blank" rel="noreferrer">DART 원문</a> : <span className="table-error">{row.message}</span>}</td></tr>)}</tbody></table></div> : null}<div className="compare-formula">{metric === "netDebt" ? "순차입금 = 총차입금 − 현금및현금성자산 − 단기금융상품" : metric === "debtRatio" ? "부채비율 = 부채총계 ÷ 자본총계 × 100" : "모든 기업에 동일한 보고기간·기준을 적용하여 원천 계정을 비교합니다."}</div></div>
  </section>;
}

function CompaniesView({ companies, active, onAdd, onSelect, onRemove }: { companies: string[]; active: string; onAdd: () => void; onSelect: (name: string) => void; onRemove: (name: string) => void }) {
  return <section className="companies-page"><div className="subpage-heading"><div><p className="eyebrow dark">COMPANY MONITORING</p><h1>기업 모니터링</h1><p className="subhead">추가한 기업은 브라우저에 저장되어 대시보드와 비교분석에 계속 포함됩니다.</p></div><button className="primary-button" onClick={onAdd}><Plus size={15} /> 타 기업 추가</button></div><div className="company-list-card">{companies.map((name) => <div className="company-row" key={name}><div className="company-avatar">{name.slice(0, 2)}</div><div className="company-row-copy"><strong>{name}</strong><span>{name === "대한전선" ? "기본 모니터링 기업" : "추가된 모니터링 기업"}</span></div><div className="company-row-actions">{active === name && <span className="verified-pill"><Check size={12} /> 선택됨</span>}<button className="outline-button" onClick={() => onSelect(name)}>대시보드 보기</button>{name !== "대한전선" && <button className="icon-button danger-icon" onClick={() => onRemove(name)} aria-label={`${name} 삭제`}><X size={16} /></button>}</div></div>)}</div></section>;
}

function Dashboard({ role, onLogout }: { role: UserRole; onLogout: () => void }) {
  const [view, setView] = useState<View>("overview");
  const [askMode, setAskMode] = useState<AskMode>("natural");
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("대한전선 최근 매출액");
  const [showProfile, setShowProfile] = useState(false);
  const [showAddCompany, setShowAddCompany] = useState(false);
  const [showAddMetric, setShowAddMetric] = useState(false);
  const [monitoredCompanies, setMonitoredCompanies] = useStoredState<string[]>("dn-monitored-companies", ["대한전선"]);
  const [activeCompany, setActiveCompany] = useStoredState<string>("dn-active-company", "대한전선");
  const [customMetrics, setCustomMetrics] = useStoredState<MetricKey[]>("dn-custom-metrics", []);
  const [compareSelected, setCompareSelected] = useStoredState<string[]>("dn-compare-companies", ["대한전선"]);
  const utils = trpc.useUtils();
  const snapshot = trpc.dart.snapshot.useQuery({ company: activeCompany }, { retry: false, staleTime: 0, refetchOnWindowFocus: false });
  const refreshMutation = trpc.dart.refresh.useMutation({ onSuccess: async () => { await snapshot.refetch(); await utils.dart.compare.invalidate(); } });

  useEffect(() => { if (!monitoredCompanies.includes(activeCompany)) setActiveCompany(monitoredCompanies[0] ?? "대한전선"); }, [monitoredCompanies, activeCompany, setActiveCompany]);
  useEffect(() => { if (compareSelected.filter((x) => monitoredCompanies.includes(x)).length < 2 && monitoredCompanies.length >= 2) setCompareSelected(monitoredCompanies.slice(0, 2)); }, [monitoredCompanies, compareSelected, setCompareSelected]);

  const currentTitle = useMemo(() => ({ overview: "Overview", ask: "질문하기", compare: "비교 분석", sources: "공시 라이브러리", terms: "재무 용어", companies: "기업 모니터링" }[view]), [view]);
  const submitQuery = (nextQuery = query, mode: AskMode = "natural") => { if (!nextQuery.trim()) return; setActiveQuery(nextQuery); setQuery(""); setView("ask"); setAskMode(mode); };
  const addCompany = (name: string) => { const next = monitoredCompanies.includes(name) ? monitoredCompanies : [...monitoredCompanies, name]; setMonitoredCompanies(next); setActiveCompany(name); if (compareSelected.length < 2 && !compareSelected.includes(name)) setCompareSelected([...compareSelected, name]); };
  const removeCompany = (name: string) => { setMonitoredCompanies(monitoredCompanies.filter((x) => x !== name)); setCompareSelected(compareSelected.filter((x) => x !== name)); if (activeCompany === name) setActiveCompany("대한전선"); };
  const addMetric = (metric: MetricKey) => { if (!customMetrics.includes(metric)) setCustomMetrics([...customMetrics, metric]); setShowAddMetric(false); };

  return <div className="app-shell">
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="sidebar-top"><div className="brand-lockup compact"><LogoMark /><span>DISCLOSURE<br /><b>NAVIGATOR</b></span></div><button className="collapse-button" onClick={() => setCollapsed((v) => !v)}>{collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button></div>
      <div className="workspace-switch"><div className="workspace-avatar">DN</div><div className="workspace-label"><strong>Daehan Group</strong><span>Finance workspace <ChevronRight size={13} /></span></div></div>
      <nav className="side-nav"><p className="nav-label">WORKSPACE</p>
        <button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}><LayoutDashboard size={17} /><span>Overview</span><kbd>⌘1</kbd></button>
        <button className={view === "ask" ? "active" : ""} onClick={() => { setView("ask"); setAskMode("natural"); }}><MessageSquareText size={17} /><span>질문하기</span><ChevronDown className={askMode === "category" ? "rotated" : ""} size={13} /></button>
        {!collapsed && <div className="nav-sub"><button className={view === "ask" && askMode === "natural" ? "active" : ""} onClick={() => { setView("ask"); setAskMode("natural"); }}>자연어</button><button className={view === "ask" && askMode === "category" ? "active" : ""} onClick={() => { setView("ask"); setAskMode("category"); }}>카테고리</button></div>}
        <button className={view === "compare" ? "active" : ""} onClick={() => setView("compare")}><GitCompare size={17} /><span>비교 분석</span><kbd>⌘3</kbd></button>
        <button className={view === "sources" ? "active" : ""} onClick={() => setView("sources")}><BookOpen size={17} /><span>공시 라이브러리</span></button>
        <button className={view === "terms" ? "active" : ""} onClick={() => setView("terms")}><Calculator size={17} /><span>재무 용어</span></button>
        <p className="nav-label spaced">MANAGE</p><button className={view === "companies" ? "active" : ""} onClick={() => setView("companies")}><Building2 size={17} /><span>기업 모니터링</span><span className="nav-count">{monitoredCompanies.length}</span></button><button onClick={() => setView("companies")}><Settings2 size={17} /><span>워크스페이스 설정</span></button>
      </nav>
      <div className="sidebar-bottom"><div className="connection-status"><span className="status-dot" /><div><strong>DART 데이터 연결</strong><span>OpenDART · 최신 조회 지원</span></div></div><div className="user-mini"><div className="user-avatar">{role === "admin" ? "AD" : "YU"}</div><div className="user-details"><strong>{role === "admin" ? "관리자" : "일반 임직원"}</strong><span>{role}@daehan.co.kr</span></div><button onClick={onLogout}><LogOut size={16} /></button></div></div>
    </aside>
    <main className="main-area"><header className="topbar"><div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{currentTitle}</strong></div><div className="topbar-actions"><button className="top-refresh" onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending}><RefreshCw size={15} className={refreshMutation.isPending ? "spin" : ""} /> {refreshMutation.isPending ? "갱신 중" : "최신 데이터 갱신"}</button><button className="top-icon" aria-label="알림"><Bell size={18} /></button><div className="profile-wrap"><button className="profile-button" onClick={() => setShowProfile((v) => !v)}><span className="profile-avatar">{role === "admin" ? "AD" : "YU"}</span><span>{role === "admin" ? "관리자" : "유진호"}</span><ChevronRight size={14} /></button>{showProfile && <div className="profile-menu"><strong>{role === "admin" ? "관리자" : "유진호"}</strong><span>{role}@daehan.co.kr</span><button onClick={onLogout}>로그아웃</button></div>}</div></div></header>
      <div className="content-scroll"><div className="content-container">
        {view === "overview" && <Overview company={activeCompany} onCompanyChange={setActiveCompany} companies={monitoredCompanies} onAddCompany={() => setShowAddCompany(true)} onAddMetric={() => setShowAddMetric(true)} customMetrics={customMetrics} snapshot={snapshot.data} snapshotLoading={snapshot.isLoading} onRefresh={() => refreshMutation.mutate()} refreshing={refreshMutation.isPending} onOpenAsk={() => setView("ask")} />}
        {view === "ask" && <><section className="subpage-heading"><div><p className="eyebrow dark">ANALYSIS WORKSPACE</p><h1>질문하기</h1><p className="subhead">자연어 또는 카테고리 선택으로 공시 수치를 조회하세요.</p></div></section><div className="ask-tabs"><button className={askMode === "natural" ? "active" : ""} onClick={() => setAskMode("natural")}><MessageSquareText size={15} /> 자연어</button><button className={askMode === "category" ? "active" : ""} onClick={() => setAskMode("category")}><Filter size={15} /> 카테고리</button></div>{askMode === "natural" ? <section className="ask-workspace"><div className="ask-input-large"><span className="mini-avatar">DN</span><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitQuery()} placeholder="예: 대한전선 2026년 반기 연결 기준 순이익" /><button className="primary-button" onClick={() => submitQuery()}><Send size={16} /> 분석 실행</button></div><div className="natural-query-guide"><strong>질문 작성 기준</strong><span><b>회사</b> · <b>기간</b> · <b>보고서</b> · <b>기준</b> · <b>지표</b> · <b>비교/추이/원인</b></span><small>예: 대한전선 2026년 반기 연결 기준 순이익 / 최근 4개년 상반기 매출액 / 2024~2026 매출과 영업이익 비교</small></div><div className="quick-prompts"><button onClick={() => submitQuery(`${activeCompany} 최근 매출액`)}>최근 매출액</button><button onClick={() => submitQuery(`${activeCompany} 최근 영업이익`)}>최근 영업이익</button><button onClick={() => submitQuery(`${activeCompany} 최근 순이익`)}>최근 순이익</button><button onClick={() => submitQuery(`${activeCompany} 최근 순차입금`)}>최근 순차입금</button></div></section> : <CategoryQuestion company={activeCompany} onSubmit={submitQuery} />}<div className="query-context"><span><Search size={13} /> Query</span><strong>{activeQuery}</strong></div><LiveDartPanel question={activeQuery} /></>}
        {view === "compare" && <><section className="subpage-heading"><div><p className="eyebrow dark">ANALYSIS WORKSPACE</p><h1>비교 분석</h1><p className="subhead">정적 샘플이 아니라 선택한 기업의 실제 OpenDART 데이터를 비교합니다.</p></div></section><CompareView companies={monitoredCompanies} selected={compareSelected} setSelected={setCompareSelected} /></>}
        {view === "terms" && <TermsView />}
        {view === "companies" && <CompaniesView companies={monitoredCompanies} active={activeCompany} onAdd={() => setShowAddCompany(true)} onSelect={(name) => { setActiveCompany(name); setView("overview"); }} onRemove={removeCompany} />}
        {view === "sources" && <section className="sources-page"><section className="subpage-heading"><div><p className="eyebrow dark">DOCUMENT CONTROL</p><h1>공시 라이브러리</h1><p className="subhead">현재 선택된 기업의 최신 공시 기준과 출처를 확인합니다.</p></div></section><section className="library-panel"><div className="library-toolbar"><div><strong>{snapshot.data?.company ?? activeCompany}</strong><span>{snapshot.data?.period ?? "최근 보고서 조회 중"}</span></div><button className="outline-button" onClick={() => refreshMutation.mutate()}><RefreshCw size={14} /> 최신화</button></div><div className="source-list">{CORE_METRICS.concat(customMetrics).filter((v, i, a) => a.indexOf(v) === i).map((key) => <div className="source-list-row" key={key}><div className="pdf-icon"><FileText size={18} /></div><div><strong>{metricLabels[key]}</strong><span>{snapshot.data?.metrics?.[key]?.citation ?? "아직 조회된 출처가 없습니다."}</span></div>{snapshot.data?.metrics?.[key]?.citation && <a href={snapshot.data.metrics[key].citation.match(/\(https[^)]+\)/)?.[0].slice(1, -1)} target="_blank" rel="noreferrer">원문</a>}</div>)}</div></section></section>}
      </div></div>
    </main>
    {showAddCompany && <CompanyModal onClose={() => setShowAddCompany(false)} onAdded={addCompany} />}
    {showAddMetric && <MetricPicker existing={customMetrics} onClose={() => setShowAddMetric(false)} onAdd={addMetric} />}
  </div>;
}

export default function Home() {
  const [user, setUser] = useState<UserRole | null>(null);
  return user ? <Dashboard role={user} onLogout={() => setUser(null)} /> : <LoginScreen onLogin={setUser} />;
}
