import type { SupabaseClient } from '@supabase/supabase-js';

export type SectorValuationRow = {
  sector_code: string;
  sector_name: string;
  pe_ttm: number | null;
  pe_ttm_pct: number | null;
  pb: number | null;
  pb_pct: number | null;
  div_yield: number | null;
  div_pct: number | null;
  chg_1m: number | null;
  chg_3m: number | null;
  chg_ytd: number | null;
  equity_bond_spread_pct: number | null;
  opportunity_score: number | null;
  risk_score: number | null;
  signal: string | null;
  as_of_date: string;
};

export type SectorValuationResult = {
  rows: SectorValuationRow[];
  asOfDate: string | null;
  error: string | null;
};

/** 读取最新交易日板块估值快照（anon 只读；数据由每日 Actions 快照任务写入） */
export async function loadSectorValuation(client: SupabaseClient | null): Promise<SectorValuationResult> {
  if (!client) return { rows: [], asOfDate: null, error: null };
  const { data, error } = await client
    .from('sector_valuation')
    .select('*')
    .order('as_of_date', { ascending: false })
    .limit(64);
  if (error) return { rows: [], asOfDate: null, error: error.message };
  if (!data || data.length === 0) return { rows: [], asOfDate: null, error: null };
  const asOf = String(data[0].as_of_date);
  const rows = data
    .filter((row) => String(row.as_of_date) === asOf)
    .map((row) => row as unknown as SectorValuationRow);
  return { rows, asOfDate: asOf, error: null };
}
