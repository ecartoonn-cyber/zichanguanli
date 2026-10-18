import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { estimateHoldingPerformance, groupPerformance } from './domain/performance';
import type { AppState, Holding, MarketScope, PnlBasis, ProductType } from './domain/types';
import { analysisAssetClasses, marketScopes, platforms, productTypes } from './domain/types';
import { buildAnalysisPrompt } from './services/prompt';
import { emptyState, exportBackup, importBackup, loadState, saveState } from './services/storage';
import { lookupProductName } from './services/productLookup';
import { createSupabaseClient, signupEnabled } from './services/supabase';
import { loadCloudPortfolio, saveCloudPortfolio } from './services/cloudPortfolio';

type FormValues = {
  holdingId: string;
  platform: Holding['platform'];
  productName: string;
  productCode: string;
  productType: ProductType;
  analysisAssetClass: Holding['analysisAssetClass'];
  marketScope: MarketScope;
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
const ageLabel = (date: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '日期无效';
  const [year, month, day] = date.split('-').map(Number);
  const now = new Date();
  const target = Date.UTC(year, month - 1, day);
  const todayAtMidnight = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((todayAtMidnight - target) / 86_400_000);
  return days < 0 ? `日期在未来 ${Math.abs(days)} 天` : days === 0 ? '今天' : `${days} 天前`;
};
const blankForm = (): FormValues => ({
  holdingId: '', platform: '支付宝', productName: '', productCode: '', productType: '场外基金',
  analysisAssetClass: '基金', marketScope: '未知', currentAmount: '', currency: 'CNY',
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
      setCloudChoice({ remote });
      setCloudMessage(remote ? `云端资料更新时间：${new Date(remote.updated_at).toLocaleString('zh-CN')}` : '账号下还没有云端持仓资料。');
    }).catch((error: unknown) => {
      if (!active) return;
      setCloudMessage(`云端读取失败：${error instanceof Error ? error.message : '未知错误'}。请检查数据库迁移和权限策略。`);
    }).finally(() => { if (active) setCloudBusy(false); });
    return () => { active = false; };
  }, [cloudClient, session?.user.id]);

  const totalAmount = useMemo(() => state.holdings.reduce((sum, holding) => sum + holding.currentAmount, 0), [state.holdings]);
  const currencies = useMemo(() => new Set(state.holdings.map((holding) => holding.currency)), [state.holdings]);
  const overallAmount = currencies.size <= 1 ? money(totalAmount, state.holdings[0]?.currency ?? 'CNY') : '多币种分别统计';
  const grouped = useMemo(() => groupPerformance(state.holdings, 'productType'), [state.holdings]);
  const groupedMarket = useMemo(() => groupPerformance(state.holdings, 'marketScope'), [state.holdings]);
  const chartSeries: Array<{ title: string; groups: typeof grouped }> = [
    { title: '产品类型', groups: grouped },
    { title: '国内 / 海外市场', groups: groupedMarket },
  ];

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
      countryOrRegion: existing?.countryOrRegion ?? null,
      currency: form.currency,
      currentAmount,
      pnlValue: form.pnlValue.trim() === '' ? null : Number(form.pnlValue),
      pnlBasis: form.pnlValue.trim() === '' ? '未知' : form.pnlBasis,
      amountUpdatedAt: form.amountUpdatedAt || today(),
      pnlUpdatedAt: form.pnlValue.trim() === '' ? null : form.pnlUpdatedAt || null,
      productNameSource: form.manualName ? '用户手工录入' : form.nameVerified ? form.nameSource : null,
      productNameVerified: form.manualName ? false : form.nameVerified || existing?.productNameVerified || false,
      classificationSource: existing?.classificationSource ?? null,
      classificationAsOf: existing?.classificationAsOf ?? null,
      classificationConfidence: existing?.classificationConfidence ?? 'unknown',
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
    announce('持仓已删除');
  }

  function updateProfile(id: string, answer: string) {
    const next = { ...state, profile: { ...state.profile, answers: { ...state.profile.answers, [id]: answer }, savedAt: new Date().toISOString() } };
    persist(next);
  }

  function downloadBackup() {
    const url = URL.createObjectURL(exportBackup(state));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'personal-invest-os-backup-v2.json';
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
      if (!window.confirm(`备份包含 ${imported.holdings.length} 项持仓；导入将替换本机当前数据。\n\n${preview}${suffix}\n\n继续前请确认已导出现有备份。`)) return;
      if (cloudReady && session && !window.confirm('云同步当前已开启。导入后也会用这份备份替换云端资料，并同步到当前账号。确定继续吗？')) return;
      persist(imported, true);
      announce('备份已导入');
    } catch (error) {
      setStatus(`备份未导入：${error instanceof Error ? error.message : '文件格式不正确'}。现有数据保持不变。`);
    }
  }

  async function confirmAndCopyPrompt() {
    if (!window.confirm('此请求含你录入的持仓名称、代码、金额和盈亏。确认复制并发送给你选择的 AI 助手吗？')) return;
    const text = buildAnalysisPrompt(state);
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
        <article className="summary-card"><span>已录入持仓金额</span><strong>{overallAmount}</strong><small>不代表完整总资产</small></article>
        <article className="summary-card"><span>持仓项目</span><strong>{state.holdings.length}</strong><small>仅统计已录入项目</small></article>
        <article className="summary-card"><span>理财体检</span><strong>{questionnaireComplete ? '已完成' : '未完成'}</strong><small>{state.profile.savedAt ? `更新于 ${state.profile.savedAt.slice(0, 10)}` : '可随时修改'}</small></article>
      </section>

      <div className="content-grid">
        <section className="panel holdings-panel"><div className="panel-heading"><div><h2>当前持仓</h2><p>更新金额与平台盈亏，不维护交易流水</p></div><span className="muted">按录入日期显示</span></div>
          {state.holdings.length === 0 ? <div className="empty-state">还没有持仓。可以先添加一项，也可以导入旧版 JSON 备份。</div> : <div className="holding-list">{[...state.holdings].sort((a, b) => b.amountUpdatedAt.localeCompare(a.amountUpdatedAt)).map((holding) => {
            const performance = estimateHoldingPerformance(holding);
            return <article className="holding-card" key={holding.holdingId}>
              <div className="holding-main"><h3>{holding.manualName && <span className="manual-badge">手工</span>}{holding.productName} <span className="type-badge">{holding.productType}</span></h3><p>{holding.platform}{holding.productCode && ` · ${holding.productCode}`} · {holding.marketScope} · 金额更新：${holding.amountUpdatedAt}（${ageLabel(holding.amountUpdatedAt)}） · 盈亏更新：${holding.pnlUpdatedAt ? `${holding.pnlUpdatedAt}（${ageLabel(holding.pnlUpdatedAt)}）` : '未提供'}</p></div>
              <div className="holding-numbers"><strong>{money(holding.currentAmount, holding.currency)}</strong><span className={performance.returnPct !== null && performance.returnPct < 0 ? 'loss' : 'gain'}>{performance.returnPct === null ? '收益率无法可靠计算' : `估算累计收益率 ${performance.returnPct.toFixed(2)}%`}</span><small>{holding.pnlValue === null ? '盈亏未录入' : `${holding.pnlBasis}：${holding.pnlValue}`}</small></div>
              <div className="holding-actions"><button onClick={() => editHolding(holding)}>编辑</button><button onClick={() => removeHolding(holding)}>删除</button></div>
            </article>;
          })}</div>}
        </section>

        {form && <section className="panel form-panel" ref={formPanelRef}><div className="panel-heading"><div><h2>{form.holdingId ? '更新持仓' : '添加持仓'}</h2><p>产品类型和分析资产类别分开填写</p></div><button className="text-button" onClick={() => setForm(null)}>收起</button></div>
          <form className="holding-form" onSubmit={saveHolding}>
            <label>平台<select value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value as Holding['platform'] })}>{platforms.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>产品类型<select disabled={querying} value={form.productType} onChange={(event) => setForm({ ...form, productType: event.target.value as ProductType })}>{productTypes.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>分析资产类别<select value={form.analysisAssetClass} onChange={(event) => setForm({ ...form, analysisAssetClass: event.target.value as Holding['analysisAssetClass'] })}>{analysisAssetClasses.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>市场范围<select value={form.marketScope} onChange={(event) => setForm({ ...form, marketScope: event.target.value as MarketScope })}>{marketScopes.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="wide">产品代码<div className="inline-control"><input disabled={querying} value={form.productCode} onChange={(event) => setForm({ ...form, productCode: event.target.value, nameVerified: event.target.value.trim() === form.productCode.trim() ? form.nameVerified : false, nameSource: event.target.value.trim() === form.productCode.trim() ? form.nameSource : null })} placeholder="优先输入基金或证券代码" /><button className="button" type="button" disabled={querying} onClick={() => void lookupName()}>{querying ? '查询中…' : '查名称'}</button></div><small>查名会将代码发送给所选公开查询源；不发送金额或盈亏。</small></label>
            <label>产品名称<input disabled={querying} required value={form.productName} onChange={(event) => setForm({ ...form, productName: event.target.value, manualName: true, nameVerified: false, nameSource: '用户手工录入' })} placeholder="查询结果核对或手工填写" /></label>
            <label>名称状态<div className="inline-control"><span className="field-status">{form.manualName ? '手工' : '待核验 / 查询结果'}</span><button type="button" className="text-button" onClick={() => setForm({ ...form, manualName: true })}>标为手工</button></div></label>
            <label>当前金额<input type="number" min="0" step="0.01" required value={form.currentAmount} onChange={(event) => setForm({ ...form, currentAmount: event.target.value })} /></label>
            <label>币种<select value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value as Holding['currency'] })}>{Object.entries(currencyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>平台显示的盈亏<input type="number" step="0.01" value={form.pnlValue} onChange={(event) => setForm({ ...form, pnlValue: event.target.value })} placeholder="盈利填正，亏损填负" /></label>
            <label>盈亏口径<select value={form.pnlBasis} onChange={(event) => setForm({ ...form, pnlBasis: event.target.value as PnlBasis })}>{(['累计金额', '累计比例', '当日金额', '当日比例', '未知'] as const).map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>金额日期<input type="date" max={today()} value={form.amountUpdatedAt} onChange={(event) => setForm({ ...form, amountUpdatedAt: event.target.value })} /></label>
            <label>盈亏日期<input type="date" max={today()} value={form.pnlUpdatedAt} onChange={(event) => setForm({ ...form, pnlUpdatedAt: event.target.value })} /></label>
            <p className="form-note wide">当前金额与累计盈亏日期不同或缺失时，不计算估算收益率。反推结果不等于平台真实收益率；部分赎回、分红和费用会造成误差。</p>
            {status && <p className="form-note wide">{status}</p>}
            <div className="form-actions wide"><button type="button" className="button" onClick={() => setForm(null)}>取消</button><button type="submit" className="button button-primary">保存持仓</button></div>
          </form>
        </section>}

        <section className="panel chart-panel"><div className="panel-heading"><div><h2>收益概览</h2><p>按分组成本基数加权估算，显示可计算覆盖数</p></div></div>
          {grouped.length === 0 ? <div className="empty-state">添加持仓后显示分类收益。</div> : <div className="chart-columns">{chartSeries.map(({ title, groups }) => <div key={title}><h3 className="chart-subtitle">{title}</h3><div className="chart-list">{groups.map((group) => {
            const returnPct = group.returnPct;
            const magnitude = returnPct === null ? 0 : Math.min(Math.abs(returnPct), 50);
            const left = returnPct === null ? 50 : returnPct < 0 ? 50 - magnitude : 50;
            return <div className="chart-row" key={group.key}><div className="chart-label"><span>{group.label} · {group.currency}</span><b className={returnPct !== null && returnPct < 0 ? 'loss' : 'gain'}>{returnPct === null ? '无法可靠计算' : `${returnPct.toFixed(2)}%`}</b></div><div className="return-track" role="img" aria-label={returnPct === null ? '收益率无法可靠计算' : `估算收益率 ${returnPct.toFixed(2)}%`}><i className={returnPct !== null && returnPct < 0 ? 'negative-bar' : 'positive-bar'} style={{ left: `${left}%`, width: `${magnitude}%` }} /></div><small>有累计数据 {group.coveredCount} / {group.holdingCount} 项 · 盈亏 {money(group.pnl, group.currency)}</small></div>;
          })}</div></div>)}</div>}
        </section>

        <section className="panel profile-panel"><div className="panel-heading"><div><h2>理财体检</h2><p>目标、期限、现金需求和风险感受</p></div><span className="status-pill">{questionnaireComplete ? '已完成' : '可分次填写'}</span></div><div className="question-list">{requiredQuestions.map(([id, title, options]) => <label key={id}>{title}<select value={String(state.profile.answers[id] ?? '')} onChange={(event) => updateProfile(id, event.target.value)}><option value="">选择或稍后填写</option>{options.map((option) => <option key={option}>{option}</option>)}</select></label>)}</div><p className="helper-text">问卷回答是个人偏好信息，不会自动推导配置比例或交易指令。</p></section>

        <section className="panel ai-panel"><div className="panel-heading"><div><h2>AI 研究请求</h2><p>暂时保留复制工作流，应用内模型调用需要后端和你确认数据授权</p></div></div><div className="prompt-preview">{prompt}</div><div className="form-actions"><button className="button" onClick={() => setPrompt(buildAnalysisPrompt(state))}>生成预览</button><button className="button button-primary" onClick={() => void confirmAndCopyPrompt()}>确认并复制 Prompt</button></div></section>
      </div>
      <footer>默认数据保存在当前浏览器；启用账号同步后也会保存到个人云端。请定期导出备份；没有行情自动更新或自动交易。</footer>
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
