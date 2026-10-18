import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppState } from '../domain/types';
import type { CloudPortfolio } from './supabase';

export async function loadCloudPortfolio(client: SupabaseClient, userId: string): Promise<CloudPortfolio | null> {
  const { data, error } = await client
    .from('user_portfolios')
    .select('user_id,schema_version,revision,state,updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (data.schema_version !== 2 || !data.state || data.state.schemaVersion !== 2 || !Array.isArray(data.state.holdings)) {
    throw new Error('云端资料版本无法识别；为避免覆盖数据，已停止同步。');
  }
  return data as unknown as CloudPortfolio;
}

export async function saveCloudPortfolio(client: SupabaseClient, userId: string, state: AppState, expectedRevision: number | null): Promise<number> {
  if (expectedRevision === null) {
    const { data, error } = await client.from('user_portfolios').insert({
      user_id: userId, schema_version: state.schemaVersion, revision: 1, state,
    }).select('revision').single();
    if (error) {
      if (error.code === '23505') throw new Error('云端资料已在其他设备创建，当前同步已暂停以避免覆盖。');
      throw error;
    }
    return data.revision as number;
  }
  const nextRevision = expectedRevision + 1;
  const { data, error } = await client.from('user_portfolios').update({
    schema_version: state.schemaVersion, revision: nextRevision, state,
  }).eq('user_id', userId).eq('revision', expectedRevision).select('revision').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('云端资料已在其他设备更新，当前同步已暂停以避免覆盖。');
  return data.revision as number;
}
