export const platforms = ['支付宝', '理财通', '银行', '证券账户', '其他'] as const;
export type Platform = (typeof platforms)[number];

export const productTypes = [
  '场外基金',
  '银行理财',
  'A股股票',
  '场内ETF',
  '银行存款',
  '现金类产品',
  '其他',
  '未知',
] as const;
export type ProductType = (typeof productTypes)[number];

export const analysisAssetClasses = ['现金', '固收', '股票/ETF', '商品/黄金', '房地产/REITs', '基金', '混合', '其他', '未知'] as const;
export type AnalysisAssetClass = (typeof analysisAssetClasses)[number];

export const liquidityProfiles = ['随时可用', '每日可赎回', '有锁定期', '到期/封闭', '未知'] as const;
export type LiquidityProfile = (typeof liquidityProfiles)[number];

export const marketScopes = ['国内', '海外', '全球/混合', '未知'] as const;
export type MarketScope = (typeof marketScopes)[number];

export type Currency = 'CNY' | 'USD' | 'HKD' | 'OTHER';
export type PnlBasis = '累计金额' | '累计比例' | '当日金额' | '当日比例' | '未知';
export type AllocationTargets = Partial<Record<Currency, Partial<Record<AnalysisAssetClass, number>>>>;

export interface Holding {
  holdingId: string;
  platform: Platform;
  productName: string;
  productCode: string;
  productType: ProductType;
  analysisAssetClass: AnalysisAssetClass;
  marketScope: MarketScope;
  countryOrRegion: string | null;
  industry: string | null;
  liquidityProfile: LiquidityProfile;
  currency: Currency;
  currentAmount: number;
  pnlValue: number | null;
  pnlBasis: PnlBasis;
  amountUpdatedAt: string;
  pnlUpdatedAt: string | null;
  productNameSource: string | null;
  productNameVerified: boolean;
  classificationSource: string | null;
  classificationAsOf: string | null;
  classificationConfidence: 'high' | 'medium' | 'low' | 'unknown';
  classificationUserOverride: boolean;
  userNotes: string;
  manualName: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InvestorProfile {
  answers: Record<string, string | string[]>;
  savedAt: string | null;
  allocationTargets: AllocationTargets;
}

export interface AppState {
  schemaVersion: 3;
  holdings: Holding[];
  profile: InvestorProfile;
}

export interface LegacyHolding {
  id?: string;
  platform?: string;
  name?: string;
  code?: string;
  assetType?: string;
  market?: string;
  value?: number;
  currency?: string;
  pnlValue?: number | '';
  pnlBasis?: string;
  updatedAt?: string;
  nameVerified?: boolean;
  lookupSource?: string;
  manualName?: boolean;
  verifiedType?: string;
}

export interface LegacyBackup {
  holdings: LegacyHolding[];
  profile?: Record<string, string | string[] | undefined>;
  profileSavedAt?: string | null;
}
