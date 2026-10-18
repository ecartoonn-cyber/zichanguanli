import type { ProductType } from '../domain/types';

export interface ProductLookupResult {
  code: string;
  name: string;
  source: string;
  fetchedAt: string;
}

function jsonp<T>(url: string, timeoutMs = 9000): Promise<T> {
  return new Promise((resolve, reject) => {
    const callback = `pios_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    let settled = false;
    const timer = window.setTimeout(() => finish(new Error('查询超时')), timeoutMs);
    const finish = (error?: Error, data?: T) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      script.remove();
      delete (window as unknown as Record<string, unknown>)[callback];
      error ? reject(error) : resolve(data as T);
    };
    (window as unknown as Record<string, unknown>)[callback] = (data: T) => finish(undefined, data);
    script.onerror = () => finish(new Error('查询源不可用或网络请求被拦截'));
    script.src = url.replace('{callback}', callback);
    script.async = true;
    document.head.append(script);
  });
}

function lookupAshare(code: string): Promise<ProductLookupResult> {
  return new Promise((resolve, reject) => {
    const raw = code.toUpperCase().replace(/\.(SH|SZ|BJ)$/, '');
    const prefix = /^[69]/.test(raw) ? 'sh' : /^[023]/.test(raw) ? 'sz' : /^[48]/.test(raw) ? 'bj' : null;
    if (!prefix) return reject(new Error('代码格式不能映射到支持的 A 股市场'));
    const symbol = `${prefix}${raw}`;
    const script = document.createElement('script');
    let settled = false;
    const timer = window.setTimeout(() => finish(new Error('证券查询超时')), 9000);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      script.remove();
      if (error) reject(error);
    };
    script.onload = () => {
      if (settled) return;
      window.clearTimeout(timer);
      script.remove();
      settled = true;
      const value = (window as unknown as Record<string, string>)[`v_${symbol}`];
      delete (window as unknown as Record<string, unknown>)[`v_${symbol}`];
      if (!value) return reject(new Error('查询源未返回证券数据'));
      const fields = value.split('~');
      if (fields[2] !== raw) return reject(new Error(`查询源返回代码 ${fields[2] || '为空'}，与输入代码不一致`));
      resolve({ code: raw, name: fields[1], source: '腾讯证券代码查询', fetchedAt: new Date().toISOString() });
    };
    script.onerror = () => finish(new Error('证券查询源不可用或网络请求被拦截'));
    script.src = `https://qt.gtimg.cn/q=${encodeURIComponent(symbol)}`;
    script.async = true;
    document.head.append(script);
  });
}

export async function lookupProductName(code: string, type: ProductType): Promise<ProductLookupResult> {
  const normalized = code.trim();
  if (!normalized) throw new Error('请先输入产品代码');
  if (type === 'A股股票') return lookupAshare(normalized);
  if (type === '银行理财' || type === '银行存款' || type === '现金类产品' || type === '其他' || type === '未知') {
    throw new Error('该产品类型没有接入统一的公开代码目录');
  }

  const url = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(normalized)}&callback={callback}&_=${Date.now()}`;
  const result = await jsonp<{ Datas?: Array<{ CODE?: string; NAME?: string }> }>(url);
  const rows = result.Datas ?? [];
  const exact = rows.filter((row) => String(row.CODE ?? '').trim() === normalized);
  if (exact.length !== 1) {
    if (exact.length > 1) throw new Error(`查询源返回 ${exact.length} 条同码结果，不能自动确认名称`);
    const nearby = rows.slice(0, 5).map((row) => String(row.CODE ?? '未知')).join('、');
    throw new Error(nearby ? `未找到完全匹配代码；查询源返回的相近代码：${nearby}` : '查询源未返回匹配代码');
  }
  const found = exact[0];
  if (!found.NAME) throw new Error('查询源匹配到代码，但名称字段为空');
  return { code: String(found.CODE), name: found.NAME, source: '东方财富基金代码查询', fetchedAt: new Date().toISOString() };
}
