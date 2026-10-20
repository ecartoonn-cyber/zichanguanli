-- 板块估值快照表（A股板块估值 + 抄底/风险指数）
-- 2026-10-20 新增功能模块：申万一级行业估值 + 双指数
-- 数据来源：乐咕乐股（申万行业 PE/PB/股息率及历史百分位）+ 申万指数日线（涨跌幅）+ 国债收益率（股债利差）
-- 写入方式：GitHub Actions 每日收盘后以 service_role 写入（upsert）；前端仅以 anon 只读

create table if not exists public.sector_valuation (
  id bigint generated always as identity primary key,
  sector_code text not null,            -- 申万一级行业代码，如 801010.SI
  sector_name text not null,            -- 行业名称
  pe_ttm numeric,                       -- TTM 滚动市盈率
  pe_ttm_pct numeric,                   -- PE-TTM 历史百分位 0-100（乐咕口径）
  pb numeric,                           -- 市净率
  pb_pct numeric,                       -- PB 历史百分位 0-100
  div_yield numeric,                    -- 股息率 %
  div_pct numeric,                      -- 股息率历史百分位 0-100
  chg_1m numeric,                       -- 近 1 月涨跌幅 %（申万指数）
  chg_3m numeric,                       -- 近 3 月涨跌幅 %
  chg_ytd numeric,                      -- 年初至今涨跌幅 %
  equity_bond_spread_pct numeric,       -- 市场股债利差（沪深300市盈率倒数-10年国债）当前百分位 0-100
  opportunity_score numeric,            -- 抄底指数 0-100（越高越值得抄底）
  risk_score numeric,                   -- 风险指数 0-100（越高越要逃离）
  signal text,                          -- 信号：极度低估/低估/中性/合理偏高/高估
  as_of_date date not null,             -- 数据日期（交易日）
  created_at timestamptz not null default now(),
  unique (sector_code, as_of_date)      -- upsert 依赖此唯一约束
);

-- 索引：前端按日期查最新快照
create index if not exists sector_valuation_date_idx on public.sector_valuation (as_of_date desc, sector_code);

-- RLS：估值为公开行情数据，允许匿名只读；写入由 service_role（绕过 RLS）完成
alter table public.sector_valuation enable row level security;

drop policy if exists "sector_valuation_anon_read" on public.sector_valuation;
create policy "sector_valuation_anon_read" on public.sector_valuation
  for select to anon using (true);

-- 已登录用户同样可读（authenticated 继承 anon 能力之外的显式策略）
drop policy if exists "sector_valuation_auth_read" on public.sector_valuation;
create policy "sector_valuation_auth_read" on public.sector_valuation
  for select to authenticated using (true);
