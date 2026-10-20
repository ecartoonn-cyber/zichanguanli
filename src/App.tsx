import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { estimateHoldingPerformance, groupPerformance, type PerformanceGroupBy } from './domain/performance';
import type { AppState, Currency, Holding, MarketScope, PnlBasis, ProductType } from './domain/types';
import { analysisAssetClasses, liquidityProfiles, marketScopes, platforms, productTypes } from './domain/types';
import { buildAnalysisPrompt } from './services/prompt';
import { emptyState, exportBackup, importBackup, loadRestorePoint, loadState, saveRestorePoint, saveState } from './services/storage';
import { lookupProductName } from './services/productLookup';
import { createSupabaseClient, signupEnabled } from './services/supabase';
import { loadCloudPortfolio, saveCloudPortfolio } from './services/cloudPortfolio';
import { enableMarketTracking, invokeMarketTracking, loadMarketDashboard, type MarketEstimateRow, type MarketJobRun, type MarketTrackingRow } from './services/marketTracking';

function MonthlyCalendar({ dailyPnlByDate }: { dailyPnlByDate: [string, { pnl: number; amount: number; count: number }][] }) {
  // 数据最新日期所在月
  const latestDate = dailyPnlByDate[0]?.[0] ?? new Date().toISOString().slice(0, 10);
  const [y, m] = latestDate.split('-').map(Number);
  const firstDay = new Date(y, m - 1, 1);
  const startWeekday = firstDay.getDay(); // 0=周日
  const daysInMonth = new Date(y, m, 0).getDate();
  const byDate = new Map(dailyPnlByDate);
  const monthTotal = dailyPnlByDate.filter(([d]) => d.startsWith(`${y}-${String(m).padStart(2, '0')}`)).reduce((s, [, v]) => s + v.pnl, 0);
  const cells: (string | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return (
    <section className="panel calendar-panel">
      <div className="panel-heading">
        <div><h2>{y}年{m}月 收益日历</h2><p>每个交易日格内显示当日估算总盈亏</p></div>
        <span className={`calendar-total ${monthTotal < 0 ? 'loss' : 'gain'}`}>本月合计 {monthTotal >= 0 ? '+' : ''}{monthTotal.toFixed(0)} 元</span>
      </div>
      <div className="calendar-grid">
        {['日','一','二','三','四','五','六'].map(d => <span key={d} className="calendar-weekday">{d}</span>)}
        {cells.map((date, i) => {
          if (!date) return <span key={i} className="calendar-cell empty" />;
          const v = byDate.get(date);
          if (!v) return <span key={i} className="calendar-cell nodata">{Number(date.slice(8))}</span>;
          return (
            <span key={i} className={`calendar-cell ${v.pnl < 0 ? 'down' : 'up'}`} title={`${date}：${v.pnl.toFixed(0)} 元`}>
              <em>{Number(date.slice(8))}</em>
              <small>{v.pnl >= 0 ? '+' : ''}{v.pnl.toFixed(0)}</small>
            </span>
          );
        })}
      </div>
    </section>
  );
}

function AssetAllocationDonut({ holdings, trackingById }: { holdings: Holding[]; trackingById: Record<string, MarketTrackingRow> }) {
  const total = holdings.reduce((s, h) => {
    const tracker = trackingById[h.holdingId];
    const amount = tracker?.status === 'active' && tracker.estimated_amount !== null ? tracker.estimated_amount : h.currentAmount;
    return s + amount;
  }, 0);
  if (total === 0) return null;
  const buckets = { '权益': 0, '固收': 0, '黄金': 0, '现金/其他': 0 };
  holdings.forEach((h) => {
    const tracker = trackingById[h.holdingId];
    const amount = tracker?.status === 'active' && tracker.estimated_amount !== null ? tracker.estimated_amount : h.currentAmount;
    const cls = h.analysisAssetClass ?? '';
    if (cls.includes('权益') || h.productType.includes('股票') || h.productType.includes('混合')) buckets['权益'] += amount;
    else if (cls.includes('固收') || h.productType.includes('债券')) buckets['固收'] += amount;
    else if (cls.includes('黄金') || h.productType.includes('黄金')) buckets['黄金'] += amount;
    else buckets['现金/其他'] += amount;
  });
  const target = { 权益: '30-35%', 固收: '60-65%', 黄金: '5-8%', '现金/其他': '—' };
  const colors = { 权益: '#e07a5f', 固收: '#81b29a', 黄金: '#e9c46a', '现金/其他': '#b0b0b0' };
  let angle = -90;
  const r = 60, cx = 80, cy = 80;
  const arcs = Object.entries(buckets).map(([label, val]) => {
    const pct = val / total;
    const start = angle;
    angle += pct * 360;
    const largeArc = pct > 0.5 ? 1 : 0;
    const x1 = cx + r * Math.cos(start * Math.PI / 180), y1 = cy + r * Math.sin(start * Math.PI / 180);
    const x2 = cx + r * Math.cos(angle * Math.PI / 180), y2 = cy + r * Math.sin(angle * Math.PI / 180);
    return { label, pct, val, color: colors[label as keyof typeof colors], d: `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2} Z` };
  });
  return (
    <section className="panel allocation-panel">
      <div className="panel-heading"><div><h2>资产配置概览</h2><p>方案 B 目标：权益 30-35% / 固收 60-65% / 黄金 5-8%</p></div></div>
      <div className="allocation-body">
        <svg width="160" height="160" viewBox="0 0 160 160">{arcs.map((a) => <path key={a.label} d={a.d} fill={a.color} />)}</svg>
        <div className="allocation-list">
          {arcs.map((a) => (
            <div key={a.label} className="allocation-row">
              <span className="dot" style={{ background: a.color }} />
              <span>{a.label}</span>
              <b>{(a.pct * 100).toFixed(1)}%</b>
              <small>目标 {target[a.label as keyof typeof target]}</small>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DailyContributionRanking({ marketEstimates, holdings }: { marketEstimates: MarketEstimateRow[]; holdings: Holding[] }) {
  if (!marketEstimates.length) return null;
  const latestDate = marketEstimates[0].quote_date;
  const today = marketEstimates.filter((e) => e.quote_date === latestDate && e.daily_return_pct !== null && e.estimated_amount !== null);
  if (!today.length) return null;
  const sorted = [...today].map((e) => ({
    holdingId: e.holding_id,
    dailyPnl: (e.daily_return_pct ?? 0) * (e.estimated_amount ?? 0) / 100,
  })).sort((a, b) => b.dailyPnl - a.dailyPnl);
  const topGain = sorted.slice(0, 5);
  const topLose = sorted.slice(-5).reverse();
  const nameOf = (id: string) => holdings.find((h) => h.holdingId === id)?.productName ?? id;
  return (
    <section className="panel contribution-panel">
      <div className="panel-heading"><div><h2>当日贡献排行（{latestDate}）</h2><p>今日赚最多 / 亏最多各 TOP5</p></div></div>
      <div className="contrib-grid">
        <div><h3 className="gain">赚最多</h3>{topGain.map((e) => <div key={e.holdingId} className="contrib-row gain"><span>{nameOf(e.holdingId)}</span><b>+{e.dailyPnl.toFixed(0)} 元</b></div>)}</div>
        <div><h3 className="loss">亏最多</h3>{topLose.map((e) => <div key={e.holdingId} className="contrib-row loss"><span>{nameOf(e.holdingId)}</span><b>{e.dailyPnl.toFixed(0)} 元</b></div>)}</div>
      </div>
    </section>
  );
}

type FormValues = {
  holdingId: string;
  platform: Holding['platform'];
  productName: string;
  productCode: string;
  productType: ProductType;
  analysisAssetClass: Holding['analysisAssetClass'];
  marketScope: MarketScope;
  countryOrRegion: string;
  industry: string;
  liquidityProfile: Holding['liquidityProfile'];
  currentAmount: string;
  currency: Holding['currency'];
  pnlValue: string;
  pnlBasis: PnlBasis;
  amountUpdatedAt: string;
  pnlUpdatedAt: string;
  manualName: boolean;
  nameVerified: boolean;
  nameSource: string | null;
};

const today = () => {
  const current = new Date();
  return `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
};
const blankForm = (): FormValues => ({
  holdingId: '', platform: '支付宝', productName: '', productCode: '', productType: '场外基金',
  analysisAssetClass: '基金', marketScope: '未知', currentAmount: '', currency: 'CNY',
  countryOrRegion: '', industry: '', liquidityProfile: '未知',
  pnlValue: '', pnlBasis: '累计金额', amountUpdatedAt: today(), pnlUpdatedAt: today(), manualName: false, nameVerified: false, nameSource: null,
});
const currencyLabels: Record<Holding['currency'], string> = { CNY: '人民币 CNY', USD: '美元 USD', HKD: '港币 HKD', OTHER: '其他 / 未知' };
const money = (value: number | null, currency: Holding['currency']) => value === null
  ? '—'
  : currency === 'OTHER'
    ? `${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}（币种未知）`
    : new Intl.NumberFormat('zh-CN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
const hasPortfolioData = (value: AppState) => value.holdings.length > 0 || Object.values(value.profile.answers).some((answer) => Array.isArray(answer) ? answer.length > 0 : Boolean(answer));
const holdingPreview = (value: AppState) => value.holdings.slice(0, 3).map((holding) => `${holding.productName}${holding.productCode ? `（${holding.productCode}）` : ''} · ${money(holding.currentAmount, holding.currency)}`).join('\n') || '当前没有持仓项目';
const portfolioAmounts = (holdings: Holding[]) => [...holdings.reduce((totals, holding) => totals.set(holding.currency, (totals.get(holding.currency) ?? 0) + holding.currentAmount), new Map<Holding['currency'], number>())]
  .map(([currency, amount]) => money(amount, currency)).join(' / ') || '无持仓金额';
const holdingIdentity = (holding: Holding) => holding.holdingId;

function readInitialState(): { state: AppState; error: string } {
  try {
    return { state: loadState(), error: '' };
  } catch {
    return { state: emptyState(), error: '本机数据格式无法识别。为避免覆盖原数据，当前先锁定保存；请导入有效备份后继续。' };
  }
}

const requiredQuestions = [
  ['goal', '投资目标', ['长期财富增长', '养老', '中期目标', '保值稳健', '不确定']],
  ['horizon', '资金期限', ['1 年内', '1–3 年', '3–5 年', '5 年以上', '不确定']],
  ['cashNeed', '未来 1–2 年现金需求', ['没有', '有', '不确定']],
  ['reserve', '备用金情况', ['有且足够', '可能不足', '没有', '不确定']],
  ['drawdown', '下跌约 20% 时可能的反应', ['继续持有', '暂停新增投入', '分批减仓', '不确定']],
  ['volatility', '主观波动偏好', ['尽量少波动', '接受一定波动', '可承受较大波动', '不确定']],
] as const;

export default function App() {
  const [initial] = useState(readInitialState);
  const [state, setState] = useState<AppState>(initial.state);
  const [form, setForm] = useState<FormValues | null>(null);
  const [status, setStatus] = useState(initial.error);
  const [storageError, setStorageError] = useState(initial.error);
  const [restoreAvailable, setRestoreAvailable] = useState(() => {
    try { return Boolean(localStorage.getItem('personal-invest-os-restore-point-v1')); } catch { return false; }
  });
  const [prompt, setPrompt] = useState('添加并核对持仓后，可生成一次性诊断请求。');
  const [toast, setToast] = useState('');
  const [querying, setQuerying] = useState(false);
  const cloudClient = useMemo(createSupabaseClient, []);
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [cloudReady, setCloudReady] = useState(false);
  const [cloudChoice, setCloudChoice] = useState<{ remote: Awaited<ReturnType<typeof loadCloudPortfolio>> } | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudMessage, setCloudMessage] = useState('');
  const [cloudSyncedAt, setCloudSyncedAt] = useState<string | null>(null);
  const cloudSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const cloudRevision = useRef<number | null>(null);
  const formPanelRef = useRef<HTMLElement | null>(null);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const formOpen = form !== null;

  useEffect(() => {
    if (!formOpen) return;
    const frame = requestAnimationFrame(() => {
      const panel = formPanelRef.current;
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const firstInput = panel?.querySelector<HTMLInputElement | HTMLSelectElement>('input, select');
      firstInput?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [formOpen]);

  useEffect(() => {
    if (!cloudClient) return;
    let active = true;
    void cloudClient.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setCloudMessage(`登录状态读取失败：${error.message}`);
      setSession(data.session);
    });
    const { data: { subscription } } = cloudClient.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      setSession(nextSession);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [cloudClient]);

  useEffect(() => {
    if (!cloudClient || !session?.user.id) {
      setCloudChoice(null);
      setCloudReady(false);
      cloudRevision.current = null;
      return;
    }
    let active = true;
    setCloudBusy(true);
    setCloudReady(false);
    setCloudMessage('正在读取云端资料…');
    void loadCloudPortfolio(cloudClient, session.user.id).then((remote) => {
      if (!active) return;
      cloudRevision.current = remote?.revision ?? null;
      // 记住用户上次的选择，刷新后自动恢复，不再弹窗
      const lastChoice = localStorage.getItem(`cloud-choice-${session.user.id}`);
      if (lastChoice === 'cloud' && remote) {
        try {
          saveState(remote.state);
          setState(remote.state);
          setStorageError('');
          cloudRevision.current = remote.revision;
          setCloudReady(true);
          setCloudChoice(null);
          setCloudSyncedAt(remote.updated_at);
          setCloudMessage('已从云端恢复资料（自动）。');
        } catch {
          setCloudChoice({ remote });
        }
      } else if (lastChoice === 'local' && remote) {
        setCloudReady(true);
        setCloudChoice(null);
        setCloudSyncedAt(new Date().toISOString());
        setCloudMessage('已启用云端同步（自动）。');
      } else {
        setCloudChoice({ remote });
        setCloudMessage(remote ? `云端资料更新时间：${new Date(remote.updated_at).toLocaleString('zh-CN')}` : '账号下还没有云端持仓资料。');
      }
    }).catch((error: unknown) => {
      if (!active) return;
      setCloudMessage(`云端读取失败：${error instanceof Error ? error.message : '未知错误'}。请检查数据库迁移和权限策略。`);
    }).finally(() => { if (active) setCloudBusy(false); });
    return () => { active = false; };
  }, [cloudClient, session?.user.id]);

  const [groupBy, setGroupBy] = useState<PerformanceGroupBy>('productType');
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);
  const [marketTracking, setMarketTracking] = useState<MarketTrackingRow[]>([]);
  const [marketEstimates, setMarketEstimates] = useState<MarketEstimateRow[]>([]);
  const [marketRuns, setMarketRuns] = useState<MarketJobRun[]>([]);
  const [marketBusy, setMarketBusy] = useState(false);
  const [targetCurrency, setTargetCurrency] = useState<Currency>('CNY');
  const [targetDraft, setTargetDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    const stored = state.profile.allocationTargets?.[targetCurrency] ?? {};
    setTargetDraft(Object.fromEntries(Object.entries(stored).map(([key, value]) => [key, String(value)])));
  }, [state.profile.allocationTargets, targetCurrency]);
  const effectiveMarketTracking = useMemo(() => marketTracking.map((tracking) => {
    const holding = state.holdings.find((item) => item.holdingId === tracking.holding_id);
    if (!holding || !tracking.enabled) return tracking;
    const sourcePnl = tracking.source_pnl_value === null ? null : Number(tracking.source_pnl_value);
    const changed = Number(tracking.source_amount) !== holding.currentAmount
      || sourcePnl !== holding.pnlValue || tracking.source_pnl_basis !== holding.pnlBasis
      || tracking.source_amount_updated_at !== holding.amountUpdatedAt || tracking.source_pnl_updated_at !== holding.pnlUpdatedAt;
    return changed ? { ...tracking, status: 'awaiting-baseline' as const, reason: '检测到金额或盈亏已手工更新；下一次有效行情将重设基准。' } : tracking;
  }), [marketTracking, state.holdings]);
  const trackingById = useMemo(() => Object.fromEntries(effectiveMarketTracking.map((item) => [item.holding_id, item])), [effectiveMarketTracking]);
  const latestEstimateById = useMemo(() => {
    const map: Record<string, MarketEstimateRow> = {};
    for (const estimate of marketEstimates) if (!map[estimate.holding_id] || estimate.quote_date > map[estimate.holding_id].quote_date) map[estimate.holding_id] = estimate;
    return map;
  }, [marketEstimates]);
  const performanceHoldings = useMemo(() => state.holdings.map((holding) => {
    const tracking = trackingById[holding.holdingId];
    if (tracking?.status !== 'active' || tracking.estimated_amount === null) return holding;
    const pnlValue = holding.pnlBasis === '累计比例'
      ? tracking.estimated_return_pct
      : holding.pnlBasis === '累计金额' ? tracking.estimated_pnl_value : holding.pnlValue;
    return {
      ...holding, currentAmount: tracking.estimated_amount,
      pnlValue: ['累计比例', '累计金额'].includes(holding.pnlBasis) ? pnlValue : holding.pnlValue,
      amountUpdatedAt: tracking.latest_price_date ?? holding.amountUpdatedAt,
      pnlUpdatedAt: ['累计比例', '累计金额'].includes(holding.pnlBasis) ? tracking.latest_price_date : holding.pnlUpdatedAt,
    };
  }), [state.holdings, trackingById]);
  const grouped = useMemo(() => groupPerformance(performanceHoldings, groupBy, trackingById), [performanceHoldings, groupBy, trackingById]);
  const assetAllocationGroups = useMemo(() => groupPerformance(performanceHoldings, 'assetClass'), [performanceHoldings]);
  const totalAmount = useMemo(() => performanceHoldings.reduce((sum, holding) => sum + holding.currentAmount, 0), [performanceHoldings]);
  const currencies = useMemo(() => new Set(performanceHoldings.map((holding) => holding.currency)), [performanceHoldings]);
  const overallAmount = currencies.size <= 1 ? money(totalAmount, performanceHoldings[0]?.currency ?? 'CNY') : '多币种分别统计';

  // 按交易日聚合当日总盈亏（从 user_market_estimates）
  const dailyPnlByDate = useMemo(() => {
    const map: Record<string, { pnl: number; amount: number; count: number }> = {};
    for (const e of marketEstimates) {
      const key = e.quote_date;
      if (!map[key]) map[key] = { pnl: 0, amount: 0, count: 0 };
      map[key].pnl += Number(e.estimated_pnl_value ?? 0);
      map[key].amount += Number(e.estimated_amount ?? 0);
      map[key].count += 1;
    }
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [marketEstimates]);

  const todaySummary = dailyPnlByDate[0] ?? null;
  const yesterdaySummary = dailyPnlByDate[1] ?? null;
  const last7Pnl = useMemo(() => dailyPnlByDate.slice(0, 7).reduce((s, [, v]) => s + v.pnl, 0), [dailyPnlByDate]);
  const last30Pnl = useMemo(() => dailyPnlByDate.slice(0, 30).reduce((s, [, v]) => s + v.pnl, 0), [dailyPnlByDate]);
  const trackingStats = useMemo(() => {
    const s = { active: 0, unsupported: 0, other: 0 };
    for (const t of effectiveMarketTracking) {
      if (t.status === 'active') s.active += 1;
      else if (t.status === 'unsupported') s.unsupported += 1;
      else s.other += 1;
    }
    return s;
  }, [effectiveMarketTracking]);

  async function refreshMarketDashboard() {
    if (!cloudClient || !session || !cloudReady) return;
    try {
      const dashboard = await loadMarketDashboard(cloudClient);
      setMarketTracking(dashboard.tracking);
      setMarketEstimates(dashboard.estimates);
      setMarketRuns(dashboard.runs);
    } catch (error) {
      setStatus(`读取行情估算记录失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  useEffect(() => {
    if (cloudReady) void refreshMarketDashboard();
    else {
      setMarketTracking([]); setMarketEstimates([]); setMarketRuns([]);
    }
  }, [cloudReady, session?.user.id]);

  async function checkMarketNow() {
    if (!cloudClient || !cloudReady) {
      setStatus('每日行情检查需要先登录并启用 Supabase 云同步。');
      return;
    }
    setMarketBusy(true);
    setStatus('正在检查已启用的产品行情…');
    try {
      const result = await invokeMarketTracking(cloudClient, 'refresh');
      await refreshMarketDashboard();
      setStatus(`行情检查完成：检查 ${result.result.checked} 项，更新 ${result.result.updated} 项，过期 ${result.result.stale} 项，不支持 ${result.result.unsupported} 项，失败 ${result.result.failed} 项。${result.result.reasons.slice(0, 2).join('；')}`);
    } catch (error) {
      setStatus(`行情检查未完成：${error instanceof Error ? error.message : '请检查 Supabase 函数是否已部署。'}`);
    } finally { setMarketBusy(false); }
  }

  async function startMarketTracking(holding: Holding) {
    if (!cloudClient || !cloudReady) {
      setStatus('每日行情估算需要先登录并启用 Supabase 云同步。');
      return;
    }
    const currentTracking = trackingById[holding.holdingId];
    const retrying = Boolean(currentTracking?.enabled && currentTracking.status !== 'active');
    const resetting = currentTracking?.status === 'active';
    const confirmation = retrying
      ? `重试“${holding.productName}”的行情检查并保留当前估算基准？`
      : resetting
        ? `以当前手工录入金额 ${money(holding.currentAmount, holding.currency)}（日期 ${holding.amountUpdatedAt}）为“${holding.productName}”重新建立估算基准？`
        : `将开始跟踪“${holding.productName}”的公开行情，并以当前金额 ${money(holding.currentAmount, holding.currency)} 和金额日期 ${holding.amountUpdatedAt} 建立估算基准。行情和估算记录会保存到你的 Supabase 账号。继续吗？`;
    if (!window.confirm(confirmation)) return;
    setMarketBusy(true);
    try {
      const result = retrying
        ? await invokeMarketTracking(cloudClient, 'refresh', holding.holdingId)
        : await enableMarketTracking(cloudClient, holding.holdingId);
      await refreshMarketDashboard();
      const outcome = 'outcomes' in result.result ? result.result.outcomes?.[0] : undefined;
      setStatus(outcome?.reason ?? (outcome?.status === 'active' ? '已开启每日估算，系统从此日期开始记录，不回填历史持仓。' : '请求已处理；请检查该持仓显示的行情状态。'));
    } catch (error) {
      setStatus(`无法启用每日估算：${error instanceof Error ? error.message : '未知错误'}`);
    } finally { setMarketBusy(false); }
  }

  async function pauseMarketTracking(holding: Holding) {
    if (!cloudClient || !cloudReady || !window.confirm(`暂停“${holding.productName}”的每日行情跟踪？已有估算历史会保留。`)) return;
    setMarketBusy(true);
    try {
      await invokeMarketTracking(cloudClient, 'disable', holding.holdingId);
      await refreshMarketDashboard();
      setStatus('已暂停该产品的每日跟踪，估算历史保留。');
    } catch (error) {
      setStatus(`暂停失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally { setMarketBusy(false); }
  }

  function announce(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(''), 2500);
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cloudClient) return;
    setCloudBusy(true);
    setCloudMessage(authMode === 'login' ? '正在登录…' : '正在创建账号…');
    try {
      if (passwordRecovery) {
        const { error } = await cloudClient.auth.updateUser({ password });
        if (error) throw error;
        setPassword('');
        setPasswordRecovery(false);
        setCloudMessage('密码已更新。');
        return;
      }
      const result = authMode === 'login'
        ? await cloudClient.auth.signInWithPassword({ email: email.trim(), password })
        : await cloudClient.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin } });
      if (result.error) throw result.error;
      if (authMode === 'signup' && !result.data.session) {
        setCloudMessage('账号申请已提交。若 Supabase 要求邮箱确认，请按邮件链接完成后返回登录。');
      } else {
        setCloudMessage('登录成功，正在检查本机与云端资料…');
      }
      setPassword('');
    } catch (error) {
      const raw = error instanceof Error ? error.message : '';
      let hint = '请检查邮箱、密码和 Supabase Auth 配置。';
      if (/invalid login credentials/i.test(raw)) {
        hint = '邮箱未确认或密码错误：若账号是新注册或手工创建的，请先在 Supabase Dashboard 的 Authentication → Users 中确认邮箱，再重试；忘记密码可用下方“忘记密码”重置。';
      } else if (/email not confirmed/i.test(raw)) {
        hint = '该邮箱尚未确认：请在 Supabase Dashboard 的 Authentication → Users 中点击 Confirm 完成确认后登录。';
      } else if (raw) {
        hint = raw;
      }
      setCloudMessage(`登录未完成：${hint}`);
    } finally {
      setCloudBusy(false);
    }
  }

  async function sendPasswordReset() {
    if (!cloudClient || !email.trim()) {
      setCloudMessage('请先填写邮箱地址。');
      return;
    }
    setCloudBusy(true);
    try {
      const { error } = await cloudClient.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
      if (error) throw error;
      setCloudMessage('如该邮箱已注册，密码重置邮件已发送。');
    } catch (error) {
      setCloudMessage(`无法发送重置邮件：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setCloudBusy(false);
    }
  }

  async function pauseForCloudConflict() {
    setCloudReady(false);
    setCloudMessage('检测到另一台设备可能已更新云端资料，自动同步已暂停。请选择本机或云端版本。');
    if (!cloudClient || !session) return;
    try {
      const remote = await loadCloudPortfolio(cloudClient, session.user.id);
      cloudRevision.current = remote?.revision ?? null;
      setCloudChoice({ remote });
    } catch {
      setCloudMessage('云端存在并发修改但当前无法读取；本机资料已保留。请恢复网络后重新登录。');
    }
  }

  async function chooseCloudSource(source: 'local' | 'cloud') {
    if (!cloudClient || !session) return;
    const remote = cloudChoice?.remote ?? null;
    if (source === 'local') {
      const message = remote
        ? `目标账号：${session.user.email ?? '当前账号'}\n将用本机资料覆盖云端资料。\n\n本机 ${state.holdings.length} 项：\n${holdingPreview(state)}\n\n云端 ${remote.state.holdings.length} 项，更新时间 ${new Date(remote.updated_at).toLocaleString('zh-CN')}。\n\n建议先导出本机 JSON 备份。继续吗？`
        : `目标账号：${session.user.email ?? '当前账号'}\n将把本机 ${state.holdings.length} 项持仓及问卷上传到云端：\n\n${holdingPreview(state)}\n\n建议先导出本机 JSON 备份。继续吗？`;
      if (!window.confirm(message)) return;
      setCloudBusy(true);
      try {
        cloudRevision.current = await saveCloudPortfolio(cloudClient, session.user.id, state, cloudRevision.current);
        setCloudReady(true);
        setCloudChoice(null);
        setCloudSyncedAt(new Date().toISOString());
        localStorage.setItem(`cloud-choice-${session.user.id}`, 'local');
        setCloudMessage('已启用云端同步；本机资料已保存到当前账号。');
      } catch (error) {
        setCloudMessage(`云端保存失败，本机数据未改动：${error instanceof Error ? error.message : '未知错误'}`);
        if (error instanceof Error && error.message.includes('其他设备')) void pauseForCloudConflict();
      } finally {
        setCloudBusy(false);
      }
      return;
    }
    if (!remote) {
      setCloudReady(true);
      setCloudChoice(null);
      setCloudMessage('已启用云端同步；云端为空，后续保存将同步到当前账号。');
      return;
    }
    if (!window.confirm(`将用云端资料覆盖本机资料。\n\n目标账号：${session.user.email ?? '当前账号'}\n云端 ${remote.state.holdings.length} 项：\n${holdingPreview(remote.state)}\n\n本机 ${state.holdings.length} 项：\n${holdingPreview(state)}\n\n云端更新时间：${new Date(remote.updated_at).toLocaleString('zh-CN')}\n\n建议先导出本机 JSON 备份。继续吗？`)) return;
    try {
      saveState(remote.state);
      setState(remote.state);
      setStorageError('');
      cloudRevision.current = remote.revision;
      setCloudReady(true);
      setCloudChoice(null);
      setCloudSyncedAt(remote.updated_at);
      localStorage.setItem(`cloud-choice-${session.user.id}`, 'cloud');
      setCloudMessage('已从云端恢复资料，并启用后续同步。');
    } catch {
      setCloudMessage('云端资料已读取，但本机保存失败；请检查浏览器存储空间。');
    }
  }

  async function syncNow() {
    if (!cloudClient || !session || !cloudReady) return;
    setCloudBusy(true);
    try {
      const task = cloudSaveQueue.current.catch(() => undefined).then(async () => {
        const revision = await saveCloudPortfolio(cloudClient, session.user.id, state, cloudRevision.current);
        cloudRevision.current = revision;
      });
      cloudSaveQueue.current = task;
      await task;
      setCloudSyncedAt(new Date().toISOString());
      setCloudMessage('本机资料已同步到云端。');
    } catch (error) {
      setCloudMessage(`本机资料保留不变；云端同步失败：${error instanceof Error ? error.message : '未知错误'}`);
      if (error instanceof Error && error.message.includes('其他设备')) void pauseForCloudConflict();
    } finally {
      setCloudBusy(false);
    }
  }

  function persist(next: AppState, recovering = false) {
    if (storageError && !recovering) {
      setStatus('保存已锁定：请先导入有效备份，避免覆盖无法读取的本机数据。');
      return;
    }
    try {
      saveState(next);
      setState(next);
      if (recovering) setStorageError('');
      setStatus('');
      if (cloudClient && session && cloudReady) {
        setCloudBusy(true);
        const task = cloudSaveQueue.current.catch(() => undefined).then(async () => {
          const revision = await saveCloudPortfolio(cloudClient, session.user.id, next, cloudRevision.current);
          cloudRevision.current = revision;
        });
        cloudSaveQueue.current = task;
        void task.then(() => {
          setCloudSyncedAt(new Date().toISOString());
          setCloudMessage('本机与云端已同步。');
        }).catch((error: unknown) => {
          setCloudMessage(`本机已保存，云端同步失败：${error instanceof Error ? error.message : '未知错误'}。可点击“立即同步”重试。`);
          if (error instanceof Error && error.message.includes('其他设备')) void pauseForCloudConflict();
        }).finally(() => setCloudBusy(false));
      }
    } catch {
      setStatus('保存失败：浏览器存储不可用或空间不足。请先导出备份后再重试。');
    }
  }

  function addHolding() {
    setForm(blankForm());
    setStatus('');
  }

  function editHolding(holding: Holding) {
    setForm({
      holdingId: holding.holdingId,
      platform: holding.platform,
      productName: holding.productName,
      productCode: holding.productCode,
      productType: holding.productType,
      analysisAssetClass: holding.analysisAssetClass,
      marketScope: holding.marketScope,
      countryOrRegion: holding.countryOrRegion ?? '',
      industry: holding.industry ?? '',
      liquidityProfile: holding.liquidityProfile,
      currentAmount: String(holding.currentAmount),
      currency: holding.currency,
      pnlValue: holding.pnlValue === null ? '' : String(holding.pnlValue),
      pnlBasis: holding.pnlBasis,
      amountUpdatedAt: holding.amountUpdatedAt,
      pnlUpdatedAt: holding.pnlUpdatedAt ?? '',
      manualName: holding.manualName,
      nameVerified: holding.productNameVerified,
      nameSource: holding.productNameSource,
    });
    setStatus(holding.productNameVerified ? `代码核验来源：${holding.productNameSource ?? '未记录'}` : holding.manualName ? '手工名称；代码未自动核验。' : '名称待核验。');
  }

  function saveHolding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || !form.productName.trim()) return setStatus('请先核对或手工填写产品名称。');
    const currentAmount = Number(form.currentAmount);
    if (!Number.isFinite(currentAmount) || currentAmount < 0) return setStatus('当前金额必须是大于或等于 0 的有效数字。');
    if (!form.amountUpdatedAt) return setStatus('请填写当前金额对应的日期。');
    if (form.pnlValue.trim() && !form.pnlUpdatedAt) return setStatus('请填写平台盈亏对应的日期。');
    if (form.amountUpdatedAt && form.amountUpdatedAt > today()) return setStatus('金额日期不能晚于今天。');
    if (form.pnlValue.trim() && form.pnlUpdatedAt && form.pnlUpdatedAt > today()) return setStatus('盈亏日期不能晚于今天。');
    const existing = state.holdings.find((holding) => holding.holdingId === form.holdingId);
    const duplicate = form.productCode.trim() && state.holdings.find((holding) =>
      holding.holdingId !== form.holdingId && holding.platform === form.platform && holding.productCode.trim() === form.productCode.trim(),
    );
    if (duplicate && !window.confirm(`同一平台已有相同代码：${duplicate.productName}（${duplicate.productCode}）。\n\n若这是不同账户或独立持仓，可继续保存；若是重复录入，请取消并编辑原项目。继续吗？`)) return;
    const now = new Date().toISOString();
    const nextHolding: Holding = {
      holdingId: form.holdingId || crypto.randomUUID(),
      platform: form.platform,
      productName: form.productName.trim(),
      productCode: form.productCode.trim(),
      productType: form.productType,
      analysisAssetClass: form.analysisAssetClass,
      marketScope: form.marketScope,
      countryOrRegion: form.countryOrRegion.trim() || null,
      industry: form.industry.trim() || null,
      liquidityProfile: form.liquidityProfile,
      currency: form.currency,
      currentAmount,
      pnlValue: form.pnlValue.trim() === '' ? null : Number(form.pnlValue),
      pnlBasis: form.pnlValue.trim() === '' ? '未知' : form.pnlBasis,
      amountUpdatedAt: form.amountUpdatedAt || today(),
      pnlUpdatedAt: form.pnlValue.trim() === '' ? null : form.pnlUpdatedAt || null,
      productNameSource: form.manualName ? '用户手工录入' : form.nameVerified ? form.nameSource : null,
      productNameVerified: form.manualName ? false : form.nameVerified || existing?.productNameVerified || false,
      classificationSource: '用户手工分类',
      classificationAsOf: today(),
      classificationConfidence: form.analysisAssetClass === '未知' || form.marketScope === '未知' ? 'unknown' : 'medium',
      classificationUserOverride: true,
      userNotes: existing?.userNotes ?? '',
      manualName: form.manualName,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (form.pnlValue.trim() !== '' && !Number.isFinite(nextHolding.pnlValue)) return setStatus('盈亏必须是有效数字。');
    const holdings = existing
      ? state.holdings.map((holding) => holding.holdingId === existing.holdingId ? nextHolding : holding)
      : [...state.holdings, nextHolding];
    persist({ ...state, holdings });
    setForm(null);
    announce('持仓已保存');
  }

  async function lookupName() {
    if (!form) return;
    setQuerying(true);
    setStatus('正在按产品类型和代码查询名称…');
    try {
      const result = await lookupProductName(form.productCode, form.productType);
      setForm((current) => current ? { ...current, productName: result.name, manualName: false, nameVerified: true, nameSource: `${result.source} · ${result.fetchedAt}` } : current);
      setStatus(`代码匹配，请核对名称后保存。查询源：${result.source}；查询时间：${new Date(result.fetchedAt).toLocaleString('zh-CN')}`);
    } catch (error) {
      setForm((current) => current ? { ...current, manualName: current.productName.trim() ? true : current.manualName } : current);
      setStatus(`自动核验未完成：${error instanceof Error ? error.message : '未知错误'}。已保留现有名称；可手工核对或保持“待核验”。`);
    } finally {
      setQuerying(false);
    }
  }

  function removeHolding(holding: Holding) {
    if (!window.confirm(`删除“${holding.productName}”？`)) return;
    persist({ ...state, holdings: state.holdings.filter((item) => item.holdingId !== holding.holdingId) });
    if (cloudClient && cloudReady) void invokeMarketTracking(cloudClient, 'remove', holding.holdingId).then(() => refreshMarketDashboard()).catch((error: unknown) => setStatus(`持仓已从本机删除，但行情历史清理未完成：${error instanceof Error ? error.message : '未知错误'}`));
    announce('持仓已删除');
  }

  function updateProfile(id: string, answer: string) {
    const next = { ...state, profile: { ...state.profile, answers: { ...state.profile.answers, [id]: answer }, savedAt: new Date().toISOString() } };
    persist(next);
  }

  function saveAllocationTargets() {
    const entries = Object.entries(targetDraft).filter(([, value]) => value.trim() !== '').map(([key, value]) => [key, Number(value)] as const);
    if (entries.some(([, value]) => !Number.isFinite(value) || value < 0 || value > 100)) return setStatus('配置目标必须在 0% 到 100% 之间。');
    const total = entries.reduce((sum, [, value]) => sum + value, 0);
    if (entries.length > 0 && Math.abs(total - 100) > 0.01) return setStatus(`当前目标合计 ${total.toFixed(2)}%，需要合计 100%。`);
    const currencyTargets = { ...state.profile.allocationTargets };
    if (entries.length === 0) delete currencyTargets[targetCurrency];
    else currencyTargets[targetCurrency] = Object.fromEntries(entries) as AppState['profile']['allocationTargets'][Currency];
    persist({ ...state, profile: { ...state.profile, allocationTargets: currencyTargets } });
    setStatus(entries.length ? `已保存 ${targetCurrency} 资产配置目标。` : `已清除 ${targetCurrency} 配置目标。`);
  }

  function downloadBackup() {
    const url = URL.createObjectURL(exportBackup(state));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'personal-invest-os-backup-v3.json';
    link.click();
    URL.revokeObjectURL(url);
    announce('备份已导出');
  }

  async function readBackup(file?: File) {
    if (!file) return;
    try {
      const imported = importBackup(JSON.parse(await file.text()));
      const preview = imported.holdings.slice(0, 5).map((holding) => `${holding.productName} · ${money(holding.currentAmount, holding.currency)}`).join('\n');
      const suffix = imported.holdings.length > 5 ? `\n……以及其余 ${imported.holdings.length - 5} 项` : '';
      const oldIds = new Set(state.holdings.map(holdingIdentity));
      const newIds = new Set(imported.holdings.map(holdingIdentity));
      const added = [...newIds].filter((id) => !oldIds.has(id)).length;
      const removed = [...oldIds].filter((id) => !newIds.has(id)).length;
      if (!window.confirm(`备份预览：${imported.holdings.length} 项持仓（${portfolioAmounts(imported.holdings)}）。\n当前本机：${state.holdings.length} 项（${portfolioAmounts(state.holdings)}）。\n按平台 + 产品代码/名称比对：新增 ${added} 项、将移除 ${removed} 项。\n\n${preview}${suffix}\n\n导入会替换当前资料，并先在本机保存恢复点。继续吗？`)) return;
      if (cloudReady && session && !window.confirm('云同步当前已开启。导入后也会用这份备份替换云端资料，并同步到当前账号。确定继续吗？')) return;
      saveRestorePoint(state);
      setRestoreAvailable(true);
      persist(imported, true);
      announce('备份已导入');
    } catch (error) {
      setStatus(`备份未导入：${error instanceof Error ? error.message : '文件格式不正确'}。现有数据保持不变。`);
    }
  }

  async function restorePreImportData() {
    try {
      const restored = loadRestorePoint();
      if (!restored) return setStatus('没有找到导入前恢复点。');
      if (!window.confirm(`恢复导入前资料：${restored.holdings.length} 项持仓（${portfolioAmounts(restored.holdings)}）。当前资料将被替换。继续吗？`)) return;
      if (cloudReady && session && !window.confirm('云同步已启用，恢复后也会覆盖云端资料。确定继续吗？')) return;
      persist(restored, true);
      announce('已恢复导入前资料');
    } catch (error) { setStatus(`恢复失败：${error instanceof Error ? error.message : '未知错误'}`); }
  }

  async function confirmAndCopyPrompt() {
    if (!window.confirm('此请求含你录入的持仓名称、代码、金额、盈亏、分类与已保存的行情估算。确认复制并发送给你选择的 AI 助手吗？')) return;
    const text = buildAnalysisPrompt(state, marketTracking);
    setPrompt(text);
    try {
      await navigator.clipboard.writeText(text);
      announce('已复制；请粘贴到 ChatGPT 对话中发送');
    } catch {
      setStatus('浏览器禁止自动复制。请手动复制下方 Prompt，再粘贴到 ChatGPT。');
    }
  }

  const questionnaireComplete = requiredQuestions.every(([id]) => Boolean(state.profile.answers[id]));

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">P</span><div><small>PERSONAL INVEST OS</small><h1>我的投资体检台</h1></div></div>
        <div className="toolbar">
          <button className="button" onClick={downloadBackup}>导出备份</button>
          <label className="button file-button">导入备份<input type="file" accept="application/json" onChange={(event) => void readBackup(event.target.files?.[0])} /></label>
          {restoreAvailable && <button className="button" onClick={() => void restorePreImportData()}>恢复导入前资料</button>}
        </div>
      </header>

      <section className="hero"><div><span className="eyebrow">先看清，再决定</span><h2>先整理事实，再评估风险</h2><p>默认保存在当前浏览器 · 可选择登录后同步到个人云端 · 不含交易功能</p></div><button className="button button-primary" onClick={addHolding}>＋ 添加一项持仓</button></section>

      {status && <div className="status" role="status">{status}</div>}

      <section className="panel cloud-panel"><div className="panel-heading"><div><h2>账号与云端同步</h2><p>登录后可在自己的设备间同步持仓和体检问卷</p></div><span className="status-pill">{!cloudClient ? '未配置' : session ? cloudReady ? '已启用' : '待确认' : '未登录'}</span></div>
        {!cloudClient ? <p className="helper-text">当前构建没有检测到 Supabase URL 和 anon key。IGA Pages 可使用绑定注入的公开连接变量；本地使用 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY。不要把 service role key、Postgres 密码或连接串放入浏览器配置。</p> : (!session || passwordRecovery) ? <form className="auth-form" onSubmit={(event) => void handleAuthSubmit(event)}>
          <label>邮箱<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="你的登录邮箱" /></label>
          <label>{passwordRecovery ? '新密码' : '密码'}<input type="password" autoComplete={passwordRecovery || authMode === 'signup' ? 'new-password' : 'current-password'} required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 位" /></label>
          <div className="auth-actions"><button className="button button-primary" type="submit" disabled={cloudBusy}>{passwordRecovery ? '更新密码' : authMode === 'login' ? '登录' : '创建账号'}</button>{!passwordRecovery && signupEnabled() && <button className="text-button" type="button" onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}>{authMode === 'login' ? '首次使用？创建账号' : '已有账号？返回登录'}</button>}{!passwordRecovery && authMode === 'login' && <button className="text-button" type="button" onClick={() => void sendPasswordReset()} disabled={cloudBusy}>忘记密码</button>}</div>
        </form> : <>
          <div className="cloud-user"><span>当前账号：{session.user.email ?? '已登录用户'}</span><button className="text-button" type="button" disabled={cloudBusy} onClick={() => void cloudClient.auth.signOut()}>退出登录</button></div>
          {cloudChoice && <div className="cloud-choice"><strong>{cloudChoice.remote ? '选择本次使用哪份资料' : hasPortfolioData(state) ? '把本机资料保存到云端？' : '账号尚无云端资料'}</strong><p>{cloudChoice.remote ? `云端 ${cloudChoice.remote.state.holdings.length} 项持仓，更新时间 ${new Date(cloudChoice.remote.updated_at).toLocaleString('zh-CN')}；本机 ${state.holdings.length} 项。` : `本机 ${state.holdings.length} 项持仓${hasPortfolioData(state) ? '及问卷回答' : ''}。选择后才会开始云端保存。`}</p><div className="auth-actions">{!storageError && (cloudChoice.remote || hasPortfolioData(state)) && <button className="button" type="button" disabled={cloudBusy} onClick={() => void chooseCloudSource('local')}>使用本机资料{cloudChoice.remote ? '覆盖云端' : '并上传'}</button>}{cloudChoice.remote ? <button className="button button-primary" type="button" disabled={cloudBusy} onClick={() => void chooseCloudSource('cloud')}>使用云端资料覆盖本机</button> : !hasPortfolioData(state) && <button className="button button-primary" type="button" disabled={cloudBusy} onClick={() => void chooseCloudSource('cloud')}>启用云端同步</button>}</div></div>}
          {cloudReady && <div className="cloud-active"><span>{cloudSyncedAt ? `最近同步：${new Date(cloudSyncedAt).toLocaleString('zh-CN')}` : '云端同步已启用'}</span><button className="button" type="button" disabled={cloudBusy} onClick={() => void syncNow()}>{cloudBusy ? '处理中…' : '立即同步'}</button></div>}
        </>}
        {cloudMessage && <p className="helper-text cloud-message" role="status">{cloudMessage}</p>}
        <p className="helper-text">同步采用显式选择，不会在首次登录时覆盖数据。持仓与问卷按账号隔离；同步启用后，编辑会同时写入本机和云端。云端保存失败时，本机记录仍保留。</p>
      </section>

      <section className="summary-grid">
        <article className="summary-card"><span>持仓金额{marketTracking.some((item) => item.status === 'active') ? '（含行情估算）' : ''}</span><strong>{overallAmount}</strong><small>不代表完整总资产；估算值会单独标记</small></article>
        <article className="summary-card"><span>持仓项目</span><strong>{state.holdings.length}</strong><small>仅统计已录入项目</small></article>
        <article className="summary-card"><span>理财体检</span><strong>{questionnaireComplete ? '已完成' : '未完成'}</strong><small>{state.profile.savedAt ? `更新于 ${state.profile.savedAt.slice(0, 10)}` : '可随时修改'}</small></article>
      </section>

      {todaySummary && (
        <section className="daily-summary panel">
          <div className="daily-summary-head">
            <div>
              <span className="daily-label">今日估算收益（{todaySummary[0]}）</span>
              <strong className={todaySummary[1].pnl < 0 ? 'loss' : 'gain'}>
                {todaySummary[1].pnl >= 0 ? '+' : ''}{todaySummary[1].pnl.toFixed(0)} 元
              </strong>
              <small className="daily-compare">
                {yesterdaySummary ? <>昨日 {yesterdaySummary[0]}：{yesterdaySummary[1].pnl.toFixed(0)} 元{todaySummary[1].pnl > yesterdaySummary[1].pnl ? '，亏损收窄' : '，亏损扩大'}</> : '昨日数据暂无'}
              </small>
            </div>
            <div className="daily-side">
              <div><span>近7天</span><strong className={last7Pnl < 0 ? 'loss' : 'gain'}>{last7Pnl >= 0 ? '+' : ''}{last7Pnl.toFixed(0)} 元</strong></div>
              <div><span>近30天</span><strong className={last30Pnl < 0 ? 'loss' : 'gain'}>{last30Pnl >= 0 ? '+' : ''}{last30Pnl.toFixed(0)} 元</strong></div>
            </div>
          </div>
          <div className="daily-stats">
            <span>已更新 {trackingStats.active} 项</span>
            <span>无行情 {trackingStats.unsupported} 项</span>
            <span>待重试 {trackingStats.other} 项</span>
          </div>
        </section>
      )}

      {dailyPnlByDate.length > 0 && (
        <MonthlyCalendar dailyPnlByDate={dailyPnlByDate} />
      )}

      <AssetAllocationDonut holdings={state.holdings} trackingById={trackingById} />

      {dailyPnlByDate.length > 0 && (
        <DailyContributionRanking marketEstimates={marketEstimates} holdings={state.holdings} />
      )}

      <div className="content-grid">
        <section className="panel market-panel"><div className="panel-heading"><div><h2>交易日行情检查</h2><p>跟踪基于免费公开行情的估算；数据日期和来源逐项展示</p></div><button className="button button-primary" disabled={marketBusy || !cloudReady} onClick={() => void checkMarketNow()}>{marketBusy ? '检查中…' : '立即检查已跟踪产品'}</button></div>
          <div className="market-summary"><span>已跟踪 {marketTracking.filter((item) => item.enabled).length} 项</span><span>最近载入估算记录 {marketEstimates.length} 条（最多 500 条）</span><span>最近任务：{marketRuns[0] ? `${marketRuns[0].status} · 更新 ${marketRuns[0].updated_count} / 检查 ${marketRuns[0].checked_count} · 开始 ${new Date(marketRuns[0].started_at).toLocaleString('zh-CN')}${marketRuns[0].completed_at ? ` · 完成 ${new Date(marketRuns[0].completed_at).toLocaleString('zh-CN')}` : ' · 运行中'}` : '尚无任务记录'}</span></div>
          {marketRuns[0]?.summary && <p className="helper-text">最近任务说明：{marketRuns[0].summary}</p>}
          {!cloudReady && <p className="helper-text">每日自动检查需要登录并启用云同步；本地数据不会自动上传。</p>}
          {cloudReady && !marketRuns.length && <p className="helper-text">尚无行情任务记录。Supabase 数据库迁移、函数部署和 Cron 配置完成后，系统才会自动运行。</p>}
          <p className="helper-text">免费公开数据源覆盖有限且可能延迟；未覆盖、过期或代码不匹配时会显示原因。估算历史从启用日开始。</p>
        </section>

        <section className="panel holdings-panel"><div className="panel-heading"><div><h2>当前持仓</h2><p>更新金额与平台盈亏，不维护交易流水</p></div><span className="muted">按录入日期显示</span></div>
          {state.holdings.length === 0 ? <div className="empty-state">还没有持仓。可以先添加一项，也可以导入旧版 JSON 备份。</div> : <div className="holding-list">{[...state.holdings].sort((a, b) => b.amountUpdatedAt.localeCompare(a.amountUpdatedAt)).map((holding) => {
            const tracking = trackingById[holding.holdingId];
            const isEstimated = tracking?.status === 'active' && tracking.estimated_amount !== null;
            const displayHolding = performanceHoldings.find((item) => item.holdingId === holding.holdingId) ?? holding;
            const performance = estimateHoldingPerformance(displayHolding);
            const latestEstimate = latestEstimateById[holding.holdingId];
            return <article className="holding-card" key={holding.holdingId}>
              <div className="holding-main"><h3>{holding.manualName && <span className="manual-badge">手工名称</span>}{holding.productName} <span className="type-badge">{holding.productType}</span>{holding.classificationUserOverride && <span className="manual-badge">分类手工确认</span>}</h3><p>{holding.platform}{holding.productCode && ` · ${holding.productCode}`} · {holding.marketScope}{holding.countryOrRegion ? ` · ${holding.countryOrRegion}` : ''}{holding.industry ? ` · ${holding.industry}` : ''} · 金额日期：{isEstimated ? `行情估算截至 ${tracking!.latest_price_date}` : holding.amountUpdatedAt} · 盈亏日期：{isEstimated && ['累计金额', '累计比例'].includes(holding.pnlBasis) ? tracking!.latest_price_date : holding.pnlUpdatedAt ?? '未提供'}</p>
                {tracking && <p className="market-detail">
                  <span className={`track-badge ${tracking.status === 'active' ? 'badge-active' : tracking.status === 'unsupported' ? 'badge-none' : 'badge-warn'}`}>
                    {tracking.status === 'active' ? '实测' : tracking.status === 'unsupported' ? '无行情' : tracking.status === 'awaiting-baseline' ? '待重设基准' : tracking.status}
                  </span>
                  {tracking.status === 'active' ? ` ${tracking.latest_price_date} · ${tracking.latest_source}` : ` ${tracking.reason ?? '待检查'}`}
                  {tracking.status === 'active' && tracking.latest_price_date && (() => {
                    const lagDays = Math.floor((Date.parse(today()) - Date.parse(tracking.latest_price_date)) / 86400000);
                    if (lagDays >= 1) return <span className="track-lag">（净值滞后 {lagDays} 天{holding.marketScope?.includes('海外') || holding.productType?.includes('QDII') ? ' · QDII T+2' : ''}）</span>;
                    return null;
                  })()}
                </p>}
              </div>
              <div className="holding-numbers"><strong>{money(isEstimated ? tracking!.estimated_amount : holding.currentAmount, holding.currency)}{isEstimated && <small>行情估算</small>}</strong><span className={performance.returnPct !== null && performance.returnPct < 0 ? 'loss' : 'gain'}>{performance.returnPct === null ? '累计收益率无法可靠计算' : `估算累计收益率 ${performance.returnPct.toFixed(2)}%`}</span>{tracking?.status === 'active' && (performance.returnPct === null || !['累计金额', '累计比例'].includes(holding.pnlBasis)) && <span className={(tracking.estimated_return_pct ?? 0) < 0 ? 'loss' : 'gain'}>启用以来 {tracking.estimated_return_pct?.toFixed(2)}%</span>}<small>{tracking?.status === 'active' ? `启用以来盈亏：${money(tracking.estimated_since_baseline, holding.currency)}` : holding.pnlValue === null ? '盈亏未录入' : `${holding.pnlBasis}：${holding.pnlValue}`}{latestEstimate ? ` · 日涨跌 ${latestEstimate.daily_return_pct === null ? '—' : `${latestEstimate.daily_return_pct.toFixed(2)}%`}` : ''}</small></div>
              <div className="holding-actions"><button disabled={marketBusy || !cloudReady} onClick={() => void startMarketTracking(holding)}>{tracking?.status === 'active' ? '重新设基准' : tracking?.enabled ? '重试行情' : '开启每日估算'}</button>{tracking?.enabled && <button disabled={marketBusy} onClick={() => void pauseMarketTracking(holding)}>暂停跟踪</button>}<button onClick={() => editHolding(holding)}>编辑</button><button onClick={() => removeHolding(holding)}>删除</button></div>
            </article>;
          })}</div>}
        </section>

        {form && <section className="panel form-panel" ref={formPanelRef}><div className="panel-heading"><div><h2>{form.holdingId ? '更新持仓' : '添加持仓'}</h2><p>产品类型和分析资产类别分开填写</p></div><button className="text-button" onClick={() => setForm(null)}>收起</button></div>
          <form className="holding-form" onSubmit={saveHolding}>
            <label>平台<select value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value as Holding['platform'] })}>{platforms.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>产品类型<select disabled={querying} value={form.productType} onChange={(event) => setForm({ ...form, productType: event.target.value as ProductType })}>{productTypes.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>分析资产类别<select value={form.analysisAssetClass} onChange={(event) => setForm({ ...form, analysisAssetClass: event.target.value as Holding['analysisAssetClass'] })}>{analysisAssetClasses.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>市场范围<select value={form.marketScope} onChange={(event) => setForm({ ...form, marketScope: event.target.value as MarketScope })}>{marketScopes.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>国家 / 地区<input value={form.countryOrRegion} onChange={(event) => setForm({ ...form, countryOrRegion: event.target.value })} placeholder="如中国、美国、全球混合；无依据可留空" /></label>
            <label>行业<input value={form.industry} onChange={(event) => setForm({ ...form, industry: event.target.value })} placeholder="如科技、医药；混合或未知可留空" /></label>
            <label>流动性<select value={form.liquidityProfile} onChange={(event) => setForm({ ...form, liquidityProfile: event.target.value as Holding['liquidityProfile'] })}>{liquidityProfiles.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="wide">产品代码<div className="inline-control"><input disabled={querying} value={form.productCode} onChange={(event) => setForm({ ...form, productCode: event.target.value, nameVerified: event.target.value.trim() === form.productCode.trim() ? form.nameVerified : false, nameSource: event.target.value.trim() === form.productCode.trim() ? form.nameSource : null })} placeholder="优先输入基金或证券代码" /><button className="button" type="button" disabled={querying} onClick={() => void lookupName()}>{querying ? '查询中…' : '查名称'}</button></div><small>查名会将代码发送给所选公开查询源；不发送金额或盈亏。</small></label>
            <label>产品名称<input disabled={querying} required value={form.productName} onChange={(event) => setForm({ ...form, productName: event.target.value, manualName: true, nameVerified: false, nameSource: '用户手工录入' })} placeholder="查询结果核对或手工填写" /></label>
            <label>名称状态<div className="inline-control"><span className="field-status">{form.manualName ? '手工' : '待核验 / 查询结果'}</span><button type="button" className="text-button" onClick={() => setForm({ ...form, manualName: true })}>标为手工</button></div></label>
            <label>当前金额<input type="number" min="0" step="0.01" required value={form.currentAmount} onChange={(event) => setForm({ ...form, currentAmount: event.target.value })} /></label>
            <label>币种<select value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value as Holding['currency'] })}>{Object.entries(currencyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>平台显示的盈亏<input type="number" step="0.01" value={form.pnlValue} onChange={(event) => setForm({ ...form, pnlValue: event.target.value })} placeholder="盈利填正，亏损填负" /></label>
            <label>盈亏口径<select value={form.pnlBasis} onChange={(event) => setForm({ ...form, pnlBasis: event.target.value as PnlBasis })}>{(['累计金额', '累计比例', '当日金额', '当日比例', '未知'] as const).map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>金额日期<input type="date" max={today()} value={form.amountUpdatedAt} onChange={(event) => setForm({ ...form, amountUpdatedAt: event.target.value })} /></label>
            <label>盈亏日期<input type="date" max={today()} value={form.pnlUpdatedAt} onChange={(event) => setForm({ ...form, pnlUpdatedAt: event.target.value })} /></label>
            {form.holdingId && trackingById[form.holdingId]?.status === 'active' && <div className="form-note wide"><span>行情估算截至 {trackingById[form.holdingId].latest_price_date}：{money(trackingById[form.holdingId].estimated_amount, form.currency)}。编辑其他字段时保留上次手工录入金额；若要按最新估算重设基准，请先将下面金额和盈亏更新为估算值。</span><button type="button" className="text-button" onClick={() => { const tracker = trackingById[form.holdingId]; if (!tracker || tracker.estimated_amount === null) return; const pnlValue = form.pnlBasis === '累计比例' ? tracker.estimated_return_pct : form.pnlBasis === '累计金额' ? tracker.estimated_pnl_value : null; setForm({ ...form, currentAmount: String(tracker.estimated_amount), pnlValue: pnlValue === null ? '' : String(pnlValue), amountUpdatedAt: tracker.latest_price_date ?? form.amountUpdatedAt, pnlUpdatedAt: ['累计金额', '累计比例'].includes(form.pnlBasis) ? tracker.latest_price_date ?? form.pnlUpdatedAt : form.pnlUpdatedAt }); }}>填入最新估算值并重设基准</button></div>}
            <p className="form-note wide">分类为手工确认，来源和日期会随记录保存。当前金额与累计盈亏日期不同或缺失时，不计算估算收益率。反推结果不等于平台真实收益率；部分赎回、分红和费用会造成误差。</p>
            {status && <p className="form-note wide">{status}</p>}
            <div className="form-actions wide"><button type="button" className="button" onClick={() => setForm(null)}>取消</button><button type="submit" className="button button-primary">保存持仓</button></div>
          </form>
        </section>}

        <section className="panel chart-panel"><div className="panel-heading"><div><h2>多维收益与盈亏</h2><p>累计盈亏与启用行情估算以来变化分开显示；币种不混算</p></div><label className="dimension-select">分组维度<select value={groupBy} onChange={(event) => { setGroupBy(event.target.value as PerformanceGroupBy); setExpandedGroupKey(null); }}><option value="productType">产品类型</option><option value="assetClass">分析资产类别</option><option value="marketScope">国内 / 海外市场</option><option value="countryOrRegion">国家 / 地区</option><option value="industry">行业</option><option value="platform">平台</option><option value="liquidity">流动性</option><option value="currency">币种</option></select></label></div>
          {grouped.length === 0 ? <div className="empty-state">添加持仓后显示分类收益。</div> : <div className="chart-list">{grouped.map((group) => {
            const returnPct = group.returnPct;
            const magnitude = returnPct === null ? 0 : Math.min(Math.abs(returnPct), 50);
            const left = returnPct === null ? 50 : returnPct < 0 ? 50 - magnitude : 50;
            const dataDates = [...new Set(group.holdings.map((holding) => trackingById[holding.holdingId]?.latest_price_date).filter((date): date is string => Boolean(date)))].sort();
            return <div className="chart-row" key={group.key}><button className="chart-group-toggle" onClick={() => setExpandedGroupKey(expandedGroupKey === group.key ? null : group.key)} aria-expanded={expandedGroupKey === group.key}><div className="chart-label"><span>{group.label} · {group.currency} · {group.holdingCount} 项</span><b className={returnPct !== null && returnPct < 0 ? 'loss' : 'gain'}>{returnPct === null ? '累计收益率未覆盖' : `${returnPct.toFixed(2)}%`}</b></div><div className="return-track" role="img" aria-label={returnPct === null ? '收益率无法可靠计算' : `估算收益率 ${returnPct.toFixed(2)}%`}><i className={returnPct !== null && returnPct < 0 ? 'negative-bar' : 'positive-bar'} style={{ left: `${left}%`, width: `${magnitude}%` }} /></div><small>持仓金额 {money(group.currentAmount, group.currency)} · 同币种占比 {group.amountSharePct === null ? '—' : `${group.amountSharePct.toFixed(1)}%`} · 累计盈亏覆盖 {group.coveredCount}/{group.holdingCount} · {money(group.pnl, group.currency)} · 行情覆盖 {group.marketCoveredCount}/{group.holdingCount} · 行情日期 {dataDates.join('、') || '无'} · 启用以来 {money(group.marketChangeSinceBaseline, group.currency)} ({group.marketReturnSinceBaseline === null ? '—' : `${group.marketReturnSinceBaseline.toFixed(2)}%`})</small></button>
              {expandedGroupKey === group.key && <div className="group-holdings">{group.holdings.map((holding) => { const tracker = trackingById[holding.holdingId]; const shownAmount = tracker?.status === 'active' && tracker.estimated_amount !== null ? tracker.estimated_amount : holding.currentAmount; return <div key={holding.holdingId}><span>{holding.productName} · {holding.productCode || '无代码'}<small>{tracker ? `行情${tracker.status}${tracker.latest_price_date ? ` · ${tracker.latest_price_date}` : ''}${tracker.reason ? ` · ${tracker.reason}` : ''}` : '未启用行情估算'}</small></span><b>{money(shownAmount, holding.currency)}</b></div>; })}</div>}
            </div>;
          })}</div>}
        </section>

        <section className="panel profile-panel"><div className="panel-heading"><div><h2>理财体检</h2><p>目标、期限、现金需求和风险感受</p></div><span className="status-pill">{questionnaireComplete ? '已完成' : '可分次填写'}</span></div><div className="question-list">{requiredQuestions.map(([id, title, options]) => <label key={id}>{title}<select value={String(state.profile.answers[id] ?? '')} onChange={(event) => updateProfile(id, event.target.value)}><option value="">选择或稍后填写</option>{options.map((option) => <option key={option}>{option}</option>)}</select></label>)}</div><p className="helper-text">问卷回答是个人偏好信息，不会自动推导配置比例或交易指令。</p>
          <div className="allocation-targets"><div className="panel-heading"><div><h3>可选配置目标</h3><p>按币种分别设定；不换算不同币种，也不会自动调仓</p></div><select value={targetCurrency} onChange={(event) => setTargetCurrency(event.target.value as Currency)}><option value="CNY">CNY 人民币</option><option value="USD">USD 美元</option><option value="HKD">HKD 港币</option><option value="OTHER">其他 / 未知</option></select></div>
            <div className="target-grid">{analysisAssetClasses.filter((item) => item !== '未知').map((assetClass) => { const current = assetAllocationGroups.find((group) => group.label === assetClass && group.currency === targetCurrency); const target = state.profile.allocationTargets?.[targetCurrency]?.[assetClass]; return <label key={assetClass}>{assetClass}<input type="number" min="0" max="100" step="0.1" placeholder="不设目标" value={targetDraft[assetClass] ?? ''} onChange={(event) => setTargetDraft((draft) => ({ ...draft, [assetClass]: event.target.value }))} />{current?.amountSharePct !== null && current?.amountSharePct !== undefined && <small>当前 {current.amountSharePct.toFixed(1)}%{target !== undefined ? ` · 偏离 ${(current.amountSharePct - target).toFixed(1)} 个百分点` : ''}</small>}</label>; })}</div>
            <div className="target-footer"><span>已填写目标合计：{Object.values(targetDraft).reduce((sum, value) => sum + (value.trim() ? Number(value) || 0 : 0), 0).toFixed(1)}%</span><button className="button" type="button" onClick={saveAllocationTargets}>保存目标</button></div>
          </div>
        </section>

        <section className="panel ai-panel"><div className="panel-heading"><div><h2>AI 研究请求</h2><p>Prompt 纳入分类来源、配置目标和已核验行情；仍由你确认后复制发送</p></div></div><div className="prompt-preview">{prompt}</div><div className="form-actions"><button className="button" onClick={() => setPrompt(buildAnalysisPrompt(state, marketTracking))}>生成预览</button><button className="button button-primary" onClick={() => void confirmAndCopyPrompt()}>确认并复制 Prompt</button></div></section>
      </div>
      <footer>默认数据保存在当前浏览器；启用账号同步后也会保存到个人云端。请定期导出备份；不连接账户、不自动交易。每日行情估算需完成 Supabase 后端部署后启用。</footer>
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
