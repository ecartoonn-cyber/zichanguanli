import { createClient } from 'npm:@supabase/supabase-js@2';

function calculateHoldingEstimate(input: {
  baselineAmount: number;
  baselinePnlValue: number | null;
  baselinePnlBasis: string;
  baselinePrice: number;
  latestPrice: number;
}) {
  if (![input.baselineAmount, input.baselinePrice, input.latestPrice].every(Number.isFinite)
    || input.baselineAmount < 0 || input.baselinePrice <= 0 || input.latestPrice <= 0) {
    throw new Error('基准金额或行情价格无效');
  }
  const estimatedAmount = input.baselineAmount * input.latestPrice / input.baselinePrice;
  const change = estimatedAmount - input.baselineAmount;
  let pnl: number | null = null;
  let returnPct = (input.latestPrice / input.baselinePrice - 1) * 100;
  const basePnl = input.baselinePnlValue;
  if (basePnl !== null && input.baselinePnlBasis === '累计金额') {
    const cost = input.baselineAmount - basePnl;
    if (cost > 0) {
      pnl = basePnl + change;
      returnPct = pnl / cost * 100;
    }
  } else if (basePnl !== null && input.baselinePnlBasis === '累计比例' && basePnl > -100) {
    const cost = input.baselineAmount / (1 + basePnl / 100);
    if (cost > 0) {
      pnl = input.baselineAmount - cost + change;
      returnPct = pnl / cost * 100;
    }
  }
  return { estimatedAmount, change, pnl, returnPct };
}

type Holding = {
  holdingId: string; productCode: string; productType: string; currentAmount: number;
  pnlValue: number | null; pnlBasis: string; amountUpdatedAt: string; pnlUpdatedAt: string | null;
  marketScope?: string;
};
type Quote = { code: string; type: string; price: number; dailyReturnPct: number | null; currency: string; source: string; asOfDate: string; fetchedAt: string };
type Tracking = Record<string, unknown> & {
  baseline_amount: number | null; baseline_pnl_value: number | null; baseline_pnl_basis: string;
  baseline_price: number | null; baseline_price_date: string | null;
  source_amount: number; source_pnl_value: number | null; source_pnl_basis: string;
  source_amount_updated_at: string; source_pnl_updated_at: string | null;
};

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cronSecret = Deno.env.get('MARKET_CRON_SECRET') ?? '';
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function chinaDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function isChinaWeekday() {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short' }).format(new Date());
  return weekday !== 'Sat' && weekday !== 'Sun';
}
function isTradingHours(): boolean {
  // A股交易时段：工作日 9:30-11:30, 13:00-15:00
  if (!isChinaWeekday()) return false;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const minutes = Number(values.hour) * 60 + Number(values.minute);
  return (minutes >= 570 && minutes <= 690) || (minutes >= 780 && minutes <= 900);
}
function tencentSymbol(code: string): string | null {
  const original = code.trim().toUpperCase();
  const suffix = original.match(/\.(SH|SZ|BJ)$/)?.[1] ?? null;
  const normalized = original.replace(/\.(SH|SZ|BJ)$/, '');
  if (!/^\d{6}$/.test(normalized)) return null;
  // 按代码前缀自动判断交易所，不依赖 productType
  let exchange: string | null = null;
  if (/^(60|68|51|58|56)/.test(normalized)) exchange = 'SH';
  else if (/^(00|30|15|16|18)/.test(normalized)) exchange = 'SZ';
  else if (/^(4|8)/.test(normalized)) exchange = 'BJ';
  if (!exchange) return null;
  if (suffix && suffix !== exchange) return null;
  return `${exchange.toLowerCase()}${normalized}`;
}

async function fetchEastMoneyFund(holding: Holding, fetchedAt: string): Promise<Quote> {
  const query = new URLSearchParams({ fundCode: holding.productCode, pageIndex: '1', pageSize: '5', startDate: '', endDate: '' });
  const response = await fetch(`https://api.fund.eastmoney.com/f10/lsjz?${query}`, {
    headers: { 'User-Agent': 'PersonalInvestOS/1.0', Referer: `https://fundf10.eastmoney.com/jjjz_${holding.productCode}.html` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`基金净值源返回 HTTP ${response.status}`);
  const payload = await response.json();
  const rows = payload?.Data?.LSJZList ?? [];
  const row = rows.find((item: Record<string, string>) => /^\d{4}-\d{2}-\d{2}$/.test(item.FSRQ ?? '') && parseNumber(item.DWJZ) !== null);
  if (!row) throw new Error('公开净值源没有返回可核验的单位净值');
  if (row.FSRQ > chinaDate()) throw new Error('公开净值源返回未来日期，已拒绝使用');
  return {
    code: holding.productCode, type: holding.productType, price: Number(row.DWJZ),
    dailyReturnPct: parseNumber(row.JZZZL), currency: 'CNY', source: '东方财富基金历史净值（公开网页接口，非正式 API）',
    asOfDate: row.FSRQ, fetchedAt,
  };
}

async function fetchTencentQuote(holding: Holding, fetchedAt: string): Promise<Quote> {
  const code = holding.productCode.trim().toUpperCase();
  const symbol = tencentSymbol(holding.productCode);
  if (!symbol) throw new Error('腾讯行情无法识别该代码的交易所');
  const expectedCode = holding.productCode.trim().toUpperCase().replace(/\.(SH|SZ|BJ)$/, '');
  const response = await fetch(`https://qt.gtimg.cn/q=${symbol}`, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`证券行情源返回 HTTP ${response.status}`);
  const raw = await response.text();
  const value = raw.match(/="([^"]+)"/)?.[1];
  if (!value) throw new Error('公开行情源未返回证券数据');
  const fields = value.split('~');
  const price = parseNumber(fields[3]);
  const previousClose = parseNumber(fields[4]);
  const timestamp = fields.find((field) => /^\d{14}$/.test(field));
  if (!price || !timestamp || fields[2] !== expectedCode) throw new Error('行情源代码或价格字段与输入不匹配');
  const asOfDate = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
  if (asOfDate > chinaDate()) throw new Error('公开行情源返回未来日期，已拒绝使用');
  return {
    code: holding.productCode, type: holding.productType, price,
    dailyReturnPct: previousClose ? ((price / previousClose) - 1) * 100 : null,
    currency: 'CNY', source: '腾讯证券公开行情接口（非正式 API）', asOfDate, fetchedAt,
  };
}

async function fetchQuote(holding: Holding): Promise<Quote> {
  const fetchedAt = new Date().toISOString();
  const code = holding.productCode.trim();

  // 按代码特征路由：A股/ETF 走腾讯，场外基金走东财
  if (/^\d{6}$/.test(code)) {
    const isStockOrETF = /^(60|00|30|51|15|56|58)/.test(code);
    if (isStockOrETF) {
      // A股/ETF：先试腾讯，失败 fallback 东财（应对部分 ETF 代码格式特殊）
      try {
        return await fetchTencentQuote(holding, fetchedAt);
      } catch (tencentError) {
        try {
          return await fetchEastMoneyFund(holding, fetchedAt);
        } catch {
          throw tencentError;
        }
      }
    }
    // 场外基金：先试东财，失败 fallback 腾讯
    try {
      return await fetchEastMoneyFund(holding, fetchedAt);
    } catch (fundError) {
      try {
        return await fetchTencentQuote(holding, fetchedAt);
      } catch {
        throw fundError;
      }
    }
  }

  // 带后缀代码（如 002384.SZ）：走腾讯
  if (/^\d{6}\.(SH|SZ|BJ)$/.test(code)) {
    return fetchTencentQuote(holding, fetchedAt);
  }

  throw new Error('当前免费公开行情适配器不支持该产品类型或代码格式');
}

async function fetchQuoteWithRetry(holding: Holding): Promise<Quote> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { return await fetchQuote(holding); }
    catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : '';
      if (/不支持|代码或价格字段|没有返回可核验|HTTP 4(?!29)\d{2}/.test(message) || attempt === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('行情请求失败');
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await run(items[index]);
    }
  }));
  return results;
}

async function recordQuote(quote: Quote) {
  const { error } = await admin.from('market_quotes').upsert({
    product_code: quote.code, product_type: quote.type, price: quote.price,
    daily_return_pct: quote.dailyReturnPct, currency: quote.currency, source: quote.source,
    as_of_date: quote.asOfDate, fetched_at: quote.fetchedAt,
  }, { onConflict: 'product_code,product_type,source,as_of_date' });
  if (error) throw error;
}

async function markError(userId: string, holding: Holding, reason: string, previous?: Tracking) {
  const row = {
    user_id: userId, holding_id: holding.holdingId, product_code: holding.productCode,
    product_type: holding.productType, enabled: true,
    status: reason.includes('不支持') ? 'unsupported' : 'error', reason,
    baseline_amount: previous?.baseline_amount ?? null, baseline_pnl_value: previous?.baseline_pnl_value ?? null,
    baseline_pnl_basis: previous?.baseline_pnl_basis ?? holding.pnlBasis, baseline_price: previous?.baseline_price ?? null,
    baseline_price_date: previous?.baseline_price_date ?? null,
    source_amount: holding.currentAmount, source_pnl_value: holding.pnlValue, source_pnl_basis: holding.pnlBasis,
    source_amount_updated_at: holding.amountUpdatedAt, source_pnl_updated_at: holding.pnlUpdatedAt,
    last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from('user_market_tracking').upsert(row, { onConflict: 'user_id,holding_id' });
  if (error) throw error;
}

async function processHolding(userId: string, holding: Holding, mode: 'enable' | 'refresh', existing?: Tracking) {
  let quote: Quote;
  try {
    quote = await fetchQuoteWithRetry(holding);
  } catch (error) {
    const reason = error instanceof Error ? error.message : '行情查询失败';
    await markError(userId, holding, reason, existing);
    return { status: reason.includes('不支持') ? 'unsupported' : 'failed', reason };
  }
  await recordQuote(quote);
  // 交易时段：只更新状态标记为盘中实时，不更新持久化收益数据
  if (isTradingHours() && !['现金类产品', '银行理财'].includes(holding.productType)) {
    const reason = `盘中实时行情（最新 ${quote.asOfDate}，涨跌 ${quote.dailyReturnPct?.toFixed(2)}%），收盘后正式更新`;
    const { error } = await admin.from('user_market_tracking').update({
      status: 'intraday', reason, last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('user_id', userId).eq('holding_id', holding.holdingId);
    if (error) throw error;
    return { status: 'intraday', reason };
  }
  const sourceChanged = existing && (
    parseNumber(existing.source_amount) !== holding.currentAmount ||
    parseNumber(existing.source_pnl_value) !== holding.pnlValue || existing.source_pnl_basis !== holding.pnlBasis ||
    existing.source_amount_updated_at !== holding.amountUpdatedAt || existing.source_pnl_updated_at !== holding.pnlUpdatedAt
  );
  if (existing && !sourceChanged && isChinaWeekday()) {
    const daysBehind = Math.floor((Date.parse(chinaDate()) - Date.parse(quote.asOfDate)) / 86400000);
    const isQDII = holding.productType?.includes('QDII') || holding.marketScope?.includes('海外');
    const maxDelay = isQDII ? 2 : 0;
    if (daysBehind > maxDelay) {
      const reason = `工作日检查未发现今日行情（最新数据日期 ${quote.asOfDate}）；可能休市或数据源延迟，未用旧行情生成新估算。`;
      const { error } = await admin.from('user_market_tracking').update({
        status: 'stale', reason, last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('user_id', userId).eq('holding_id', holding.holdingId);
      if (error) throw error;
      return { status: 'stale', reason };
    }
  }
  const needsBaseline = mode === 'enable' || !existing?.baseline_price || sourceChanged;
  const shared = {
    user_id: userId, holding_id: holding.holdingId, product_code: holding.productCode,
    product_type: holding.productType, enabled: true, source_amount: holding.currentAmount,
    source_pnl_value: holding.pnlValue, source_pnl_basis: holding.pnlBasis,
    source_amount_updated_at: holding.amountUpdatedAt, source_pnl_updated_at: holding.pnlUpdatedAt,
    latest_price: quote.price, latest_price_date: quote.asOfDate, latest_source: quote.source,
    last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  if (needsBaseline) {
    const cumulativePnlDateMismatch = ['累计金额', '累计比例'].includes(holding.pnlBasis)
      && holding.pnlValue !== null && holding.pnlUpdatedAt !== holding.amountUpdatedAt;
    if (cumulativePnlDateMismatch) {
      const reason = `累计盈亏日期 ${holding.pnlUpdatedAt ?? '未提供'} 与金额日期 ${holding.amountUpdatedAt} 不一致；请先核对并更新盈亏日期。`;
      const { error } = await admin.from('user_market_tracking').upsert({
        ...shared, status: 'awaiting-baseline', reason,
        baseline_amount: null, baseline_pnl_value: null, baseline_pnl_basis: holding.pnlBasis,
        baseline_price: null, baseline_price_date: null, estimated_amount: null,
        estimated_pnl_value: null, estimated_since_baseline: null, estimated_return_pct: null,
      }, { onConflict: 'user_id,holding_id' });
      if (error) throw error;
      return { status: 'awaiting-baseline', reason };
    }
    const cumulativePnl = ['累计金额', '累计比例'].includes(holding.pnlBasis) ? holding.pnlValue : null;
    const row = {
      ...shared, status: 'active', reason: sourceChanged ? '检测到手工更新，已按最新行情重置估算基准。' : null,
      baseline_amount: holding.currentAmount, baseline_pnl_value: cumulativePnl,
      baseline_pnl_basis: holding.pnlBasis, baseline_price: quote.price, baseline_price_date: quote.asOfDate,
      estimated_amount: holding.currentAmount, estimated_pnl_value: cumulativePnl,
      estimated_since_baseline: 0, estimated_return_pct: 0,
    };
    const { error } = await admin.from('user_market_tracking').upsert(row, { onConflict: 'user_id,holding_id' });
    if (error) throw error;
    const { error: snapshotError } = await admin.from('user_market_estimates').upsert({
      user_id: userId, holding_id: holding.holdingId, product_code: holding.productCode,
      product_type: holding.productType, quote_date: quote.asOfDate, price: quote.price,
      daily_return_pct: quote.dailyReturnPct, estimated_amount: holding.currentAmount,
      estimated_pnl_value: cumulativePnl, estimated_since_baseline: 0, estimated_return_pct: 0,
      source: quote.source, computed_at: new Date().toISOString(),
    }, { onConflict: 'user_id,holding_id,quote_date' });
    if (snapshotError) throw snapshotError;
    return { status: 'active', quoteDate: quote.asOfDate, baselineReset: Boolean(sourceChanged) };
  }
  const values = calculateHoldingEstimate({
    baselineAmount: Number(existing!.baseline_amount),
    baselinePnlValue: parseNumber(existing!.baseline_pnl_value),
    baselinePnlBasis: existing!.baseline_pnl_basis,
    baselinePrice: Number(existing!.baseline_price), latestPrice: quote.price,
  });
  const { error } = await admin.from('user_market_tracking').upsert({
    ...shared, status: 'active', reason: null,
    baseline_amount: existing!.baseline_amount, baseline_pnl_value: existing!.baseline_pnl_value,
    baseline_pnl_basis: existing!.baseline_pnl_basis, baseline_price: existing!.baseline_price,
    baseline_price_date: existing!.baseline_price_date,
    estimated_amount: values.estimatedAmount, estimated_pnl_value: values.pnl,
    estimated_since_baseline: values.change, estimated_return_pct: values.returnPct,
  }, { onConflict: 'user_id,holding_id' });
  if (error) throw error;
  const { error: snapshotError } = await admin.from('user_market_estimates').upsert({
    user_id: userId, holding_id: holding.holdingId, product_code: holding.productCode,
    product_type: holding.productType, quote_date: quote.asOfDate, price: quote.price,
    daily_return_pct: quote.dailyReturnPct, estimated_amount: values.estimatedAmount,
    estimated_pnl_value: values.pnl, estimated_since_baseline: values.change,
    estimated_return_pct: values.returnPct, source: quote.source, computed_at: new Date().toISOString(),
  }, { onConflict: 'user_id,holding_id,quote_date' });
  if (snapshotError) throw snapshotError;
  return { status: 'active', quoteDate: quote.asOfDate };
}

async function processUser(userId: string, holdings: Holding[], mode: 'enable' | 'refresh' | 'scheduled', targetHoldingId?: string) {
  const runResult = await admin.from('user_market_job_runs').insert({ user_id: userId, market_scope: '国内', status: 'running' }).select('run_id').single();
  if (runResult.error) return { runId: null, checked: 0, updated: 0, unsupported: 0, stale: 0, failed: 1, reasons: [`无法创建任务记录：${runResult.error.message}`], outcomes: [] };
  const runId = runResult.data?.run_id;
  const { data: trackingRows, error: trackingError } = await admin.from('user_market_tracking').select('*').eq('user_id', userId).eq('enabled', true);
  if (trackingError) {
    const reason = `读取跟踪状态失败：${trackingError.message}`;
    if (runId) await admin.from('user_market_job_runs').update({ status: 'failed', completed_at: new Date().toISOString(), failed_count: 1, summary: reason }).eq('run_id', runId);
    return { runId, checked: 0, updated: 0, unsupported: 0, stale: 0, failed: 1, reasons: [reason], outcomes: [] };
  }
  const byId = new Map<string, Tracking>((trackingRows ?? []).map((row) => [row.holding_id, row as Tracking]));
  const selected = mode === 'enable'
    ? holdings.filter((item) => item.holdingId === targetHoldingId)
    : mode === 'refresh'
      ? holdings.filter((item) => byId.has(item.holdingId) && (!targetHoldingId || item.holdingId === targetHoldingId))
      : holdings.filter((item) => byId.has(item.holdingId));
  const outcomes = await mapConcurrent(selected, 5, async (holding) => {
    try {
      const result = await processHolding(userId, holding, mode === 'enable' ? 'enable' : 'refresh', byId.get(holding.holdingId));
      return { holdingId: holding.holdingId, code: holding.productCode || holding.productName, status: result.status, reason: result.reason };
    } catch (error) {
      const reason = error instanceof Error ? error.message : '保存失败';
      return { holdingId: holding.holdingId, code: holding.productCode || holding.productName, status: 'failed', reason };
    }
  });
  let updated = 0; let unsupported = 0; let stale = 0; let failed = 0;
  const reasons: string[] = [];
  for (const outcome of outcomes) {
    if (outcome.status === 'active') updated += 1;
    else if (outcome.status === 'unsupported') unsupported += 1;
    else if (outcome.status === 'stale') stale += 1;
    else failed += 1;
    if (outcome.reason) reasons.push(`${outcome.code}: ${outcome.reason}`);
  }
  const publicOutcomes = outcomes.map(({ code: _code, ...outcome }) => outcome);
  const status = failed === 0 && stale === 0 && unsupported === 0 ? 'success' : updated || unsupported || stale ? 'partial' : 'failed';
  if (runId) {
    const { error: runUpdateError } = await admin.from('user_market_job_runs').update({
      status, completed_at: new Date().toISOString(), checked_count: selected.length,
      updated_count: updated, unsupported_count: unsupported, stale_count: stale, failed_count: failed,
      summary: reasons.slice(0, 10).join('；') || null,
    }).eq('run_id', runId);
    if (runUpdateError) reasons.push(`更新任务记录失败：${runUpdateError.message}`);
  }
  return { runId, checked: selected.length, updated, unsupported, stale, failed, reasons, outcomes: publicOutcomes };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: '仅支持 POST' }, 405);
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const cronHeader = request.headers.get('x-market-cron-secret') ?? '';
  const scheduled = cronSecret.length >= 32 && cronHeader === cronSecret;
  let payload: { action?: string; holdingId?: string };
  try { payload = await request.json(); } catch { return json({ error: '请求 JSON 无效' }, 400); }
  if (scheduled) {
    if (payload.action !== 'scheduled') return json({ error: '计划任务请求无效' }, 400);
    const { data: portfolios, error } = await admin.from('user_portfolios').select('user_id,state');
    if (error) return json({ error: error.message }, 500);
    const results = [];
    for (const portfolio of portfolios ?? []) {
      const holdings = (portfolio.state?.holdings ?? []) as Holding[];
      if (holdings.length) results.push(await processUser(portfolio.user_id, holdings, 'scheduled'));
    }
    return json({ status: 'complete', users: results.length, results });
  }
  if (!token) return json({ error: '需要登录后使用行情检查' }, 401);
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: userData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !userData.user) return json({ error: '登录状态无效' }, 401);
  if (!['enable', 'refresh', 'disable', 'remove'].includes(payload.action ?? '')) return json({ error: '不支持的操作' }, 400);
  const { data: portfolio, error } = await admin.from('user_portfolios').select('state').eq('user_id', userData.user.id).maybeSingle();
  if (error || !portfolio) return json({ error: '未找到该账号已同步的持仓资料' }, 404);
  const holdings = (portfolio.state?.holdings ?? []) as Holding[];
  if (payload.action === 'disable' || payload.action === 'remove') {
    if (!payload.holdingId) return json({ error: '缺少持仓编号' }, 400);
    if (payload.action === 'disable') {
      const { error: updateError } = await admin.from('user_market_tracking').update({ enabled: false, status: 'disabled', reason: '用户已暂停行情跟踪。', updated_at: new Date().toISOString() }).eq('user_id', userData.user.id).eq('holding_id', payload.holdingId);
      if (updateError) return json({ error: updateError.message }, 500);
      return json({ status: 'disabled' });
    }
    const { error: estimateError } = await admin.from('user_market_estimates').delete().eq('user_id', userData.user.id).eq('holding_id', payload.holdingId);
    if (estimateError) return json({ error: estimateError.message }, 500);
    const { error: trackingError } = await admin.from('user_market_tracking').delete().eq('user_id', userData.user.id).eq('holding_id', payload.holdingId);
    if (trackingError) return json({ error: trackingError.message }, 500);
    return json({ status: 'removed' });
  }
  if (payload.action === 'enable' && !holdings.some((item) => item.holdingId === payload.holdingId)) return json({ error: '持仓不属于当前账号' }, 403);
  if (payload.action === 'refresh' && payload.holdingId && !holdings.some((item) => item.holdingId === payload.holdingId)) return json({ error: '持仓不属于当前账号' }, 403);
  const result = await processUser(userData.user.id, holdings, payload.action as 'enable' | 'refresh', payload.holdingId);
  return json({ status: 'complete', result });
});
