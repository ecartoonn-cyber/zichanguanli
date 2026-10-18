import type { AppState, Holding, LegacyBackup, LegacyHolding } from '../domain/types';

export const STORAGE_KEY = 'personal-invest-os-v2';

export function emptyState(): AppState {
  return { schemaVersion: 2, holdings: [], profile: { answers: {}, savedAt: null } };
}

export function loadState(storage: Storage = localStorage): AppState {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return emptyState();
  const parsed: unknown = JSON.parse(raw);
  if (!isAppState(parsed)) throw new Error('本机数据格式无法识别；请先导入备份，避免覆盖原数据');
  return parsed;
}

export function saveState(state: AppState, storage: Storage = localStorage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function isAppState(value: unknown): value is AppState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AppState>;
  return candidate.schemaVersion === 2 && Array.isArray(candidate.holdings) && !!candidate.profile;
}

function mapPlatform(value?: string): Holding['platform'] {
  if (value?.includes('支付宝')) return '支付宝';
  if (value?.includes('理财通') || value?.includes('腾讯')) return '理财通';
  if (value?.includes('证券')) return '证券账户';
  if (value?.includes('银行')) return '银行';
  return '其他';
}

function mapProductType(value?: string): Holding['productType'] {
  if (value === 'A股个股' || value === 'A股股票') return 'A股股票';
  if (value?.includes('场内') || value?.includes('ETF')) return '场内ETF';
  if (value?.includes('银行理财')) return '银行理财';
  if (value?.includes('存款')) return '银行存款';
  if (value?.includes('现金') || value?.includes('货币')) return '现金类产品';
  if (value?.includes('基金')) return '场外基金';
  if (value === '其他') return '其他';
  return '未知';
}

function mapAssetClass(type: Holding['productType'], original: LegacyHolding): Holding['analysisAssetClass'] {
  if (type === 'A股股票' || type === '场内ETF') return '股票/ETF';
  if (type === '银行理财' || type === '银行存款' || type === '现金类产品') return '灵活资金';
  if (type === '场外基金') return '基金';
  if (original.assetType === '债券') return '债券';
  return '未知';
}

function mapCurrency(value?: string): Holding['currency'] {
  if (value === 'USD' || value === 'HKD' || value === 'CNY') return value;
  return 'OTHER';
}

function migrateLegacyHolding(item: LegacyHolding, index: number, now: string): Holding {
  if (typeof item.name !== 'string' || !item.name.trim()) throw new Error(`第 ${index + 1} 项缺少名称`);
  if (typeof item.value !== 'number' || !Number.isFinite(item.value) || item.value < 0) throw new Error(`第 ${index + 1} 项金额无效`);
  const productType = mapProductType(item.assetType);
  const amountDate = item.updatedAt || now.slice(0, 10);
  const pnl = typeof item.pnlValue === 'number' && Number.isFinite(item.pnlValue) ? item.pnlValue : null;
  const pnlBasis = ['累计金额', '累计比例', '当日金额', '当日比例'].includes(item.pnlBasis ?? '')
    ? item.pnlBasis as Holding['pnlBasis']
    : '未知';
  return {
    holdingId: item.id || crypto.randomUUID(),
    platform: mapPlatform(item.platform),
    productName: item.name.trim(),
    productCode: item.code?.trim() ?? '',
    productType,
    analysisAssetClass: mapAssetClass(productType, item),
    marketScope: item.market === '国内' || item.market === '海外' || item.market === '全球/混合' ? item.market : '未知',
    countryOrRegion: null,
    currency: mapCurrency(item.currency),
    currentAmount: item.value,
    pnlValue: pnl,
    pnlBasis,
    amountUpdatedAt: amountDate,
    pnlUpdatedAt: pnl === null ? null : amountDate,
    productNameSource: item.lookupSource || null,
    productNameVerified: Boolean(item.nameVerified),
    classificationSource: null,
    classificationAsOf: null,
    classificationConfidence: item.verifiedType === '已核实' ? 'medium' : 'unknown',
    userNotes: '',
    manualName: Boolean(item.manualName),
    createdAt: now,
    updatedAt: now,
  };
}

export function importBackup(input: unknown, now = new Date().toISOString()): AppState {
  if (!input || typeof input !== 'object') throw new Error('备份内容不是有效对象');
  const backup = input as Partial<AppState> & Partial<LegacyBackup>;
  if (!Array.isArray(backup.holdings)) throw new Error('备份中没有持仓清单');

  const holdings: Holding[] = backup.schemaVersion === 2
    ? backup.holdings as Holding[]
    : (backup.holdings as LegacyHolding[]).map((item, index) => migrateLegacyHolding(item, index, now));

  if (backup.schemaVersion === 2) {
    for (const [index, holding] of holdings.entries()) {
      if (!holding || typeof holding.holdingId !== 'string' || typeof holding.productName !== 'string' || !Number.isFinite(holding.currentAmount) || typeof holding.amountUpdatedAt !== 'string') {
        throw new Error(`第 ${index + 1} 项数据不完整，未导入`);
      }
    }
  }
  const profile = backup.schemaVersion === 2
    ? backup.profile ?? { answers: {}, savedAt: null }
    : { answers: backup.profile ?? {}, savedAt: backup.profileSavedAt ?? null };
  return { schemaVersion: 2, holdings, profile: profile as AppState['profile'] };
}

export function exportBackup(state: AppState): Blob {
  return new Blob([JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2)], {
    type: 'application/json',
  });
}
