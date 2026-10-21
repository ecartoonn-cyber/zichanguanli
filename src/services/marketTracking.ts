import type { SupabaseClient } from '@supabase/supabase-js';
import type { PnlBasis } from '../domain/types';

export type MarketTrackingRow = {
  holding_id: string;
  product_code: string;
  product_type: string;
  enabled: boolean;
  status: 'awaiting-baseline' | 'active' | 'unsupported' | 'stale' | 'error' | 'disabled' | 'intraday';
  reason: string | null;
  baseline_amount: number | null;
  baseline_pnl_basis: PnlBasis;
  latest_price: number | null;
  latest_price_date: string | null;
  latest_source: string | null;
  source_amount: number;
  source_pnl_value: number | null;
  source_pnl_basis: PnlBasis;
  source_amount_updated_at: string;
  source_pnl_updated_at: string | null;
  estimated_amount: number | null;
  estimated_pnl_value: number | null;
  estimated_since_baseline: number | null;
  estimated_return_pct: number | null;
  last_checked_at: string | null;
};
export type MarketEstimateRow = {
  holding_id: string;
  quote_date: string;
  price: number;
  daily_return_pct: number | null;
  estimated_amount: number | null;
  estimated_pnl_value: number | null;
  estimated_since_baseline: number;
  estimated_return_pct: number;
  source: string;
};
export type MarketJobRun = {
  run_id: number;
  status: 'running' | 'success' | 'partial' | 'failed';
  started_at: string;
  completed_at: string | null;
  checked_count: number;
  updated_count: number;
  unsupported_count: number;
  stale_count: number;
  failed_count: number;
  summary: string | null;
};

export async function loadMarketDashboard(client: SupabaseClient) {
  const [tracking, estimates, runs] = await Promise.all([
    client.from('user_market_tracking').select('*'),
    client.from('user_market_estimates').select('*').order('quote_date', { ascending: false }).limit(500),
    client.from('user_market_job_runs').select('*').order('started_at', { ascending: false }).limit(20),
  ]);
  if (tracking.error) throw tracking.error;
  if (estimates.error) throw estimates.error;
  if (runs.error) throw runs.error;
  return {
    tracking: (tracking.data ?? []) as MarketTrackingRow[],
    estimates: (estimates.data ?? []) as MarketEstimateRow[],
    runs: (runs.data ?? []) as MarketJobRun[],
  };
}

export async function invokeMarketTracking(client: SupabaseClient, action: 'enable' | 'refresh' | 'disable' | 'remove', holdingId?: string) {
  const { data, error } = await client.functions.invoke('market-data', { body: { action, holdingId } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as { status: string; result: { runId: number | null; checked: number; updated: number; unsupported: number; stale: number; failed: number; reasons: string[] } };
}

export async function enableMarketTracking(client: SupabaseClient, holdingId: string) {
  const { data, error } = await client.functions.invoke('market-data', { body: { action: 'enable', holdingId } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as { status: string; result: { outcomes?: Array<{ holdingId: string; status: string; reason?: string }> } };
}
