import type { Currency, Holding, PnlBasis } from './types';

export type PerformanceStatus = 'estimated' | 'missing-pnl' | 'not-cumulative' | 'invalid-basis' | 'date-mismatch';

export interface HoldingPerformance {
  status: PerformanceStatus;
  pnl: number | null;
  costBasis: number | null;
  returnPct: number | null;
  method: 'amount-derived' | 'platform-ratio' | null;
}

export interface GroupPerformance {
  key: string;
  label: string;
  currency: Currency;
  holdingCount: number;
  coveredCount: number;
  pnl: number | null;
  costBasis: number | null;
  returnPct: number | null;
}

const cumulativeBases: PnlBasis[] = ['累计金额', '累计比例'];

export function estimateHoldingPerformance(holding: Pick<
  Holding,
  'currentAmount' | 'pnlValue' | 'pnlBasis' | 'amountUpdatedAt' | 'pnlUpdatedAt'
>): HoldingPerformance {
  if (holding.pnlValue === null || !Number.isFinite(holding.pnlValue)) {
    return { status: 'missing-pnl', pnl: null, costBasis: null, returnPct: null, method: null };
  }
  if (!cumulativeBases.includes(holding.pnlBasis)) {
    return { status: 'not-cumulative', pnl: null, costBasis: null, returnPct: null, method: null };
  }
  if (!holding.pnlUpdatedAt || !holding.amountUpdatedAt || holding.pnlUpdatedAt !== holding.amountUpdatedAt) {
    return { status: 'date-mismatch', pnl: null, costBasis: null, returnPct: null, method: null };
  }
  if (!Number.isFinite(holding.currentAmount) || holding.currentAmount < 0) {
    return { status: 'invalid-basis', pnl: null, costBasis: null, returnPct: null, method: null };
  }

  if (holding.pnlBasis === '累计比例') {
    const returnPct = holding.pnlValue;
    if (returnPct <= -100 || holding.currentAmount === 0) {
      return { status: 'invalid-basis', pnl: null, costBasis: null, returnPct: null, method: null };
    }
    const costBasis = holding.currentAmount / (1 + returnPct / 100);
    const pnl = holding.currentAmount - costBasis;
    return { status: 'estimated', pnl, costBasis, returnPct, method: 'platform-ratio' };
  }

  const costBasis = holding.currentAmount - holding.pnlValue;
  if (costBasis <= 0) {
    return { status: 'invalid-basis', pnl: null, costBasis: null, returnPct: null, method: null };
  }
  return {
    status: 'estimated',
    pnl: holding.pnlValue,
    costBasis,
    returnPct: (holding.pnlValue / costBasis) * 100,
    method: 'amount-derived',
  };
}

export function groupPerformance(
  holdings: Holding[],
  groupBy: 'productType' | 'assetClass' | 'marketScope' | 'platform',
): GroupPerformance[] {
  const groups = new Map<string, GroupPerformance>();
  for (const holding of holdings) {
    const label = groupBy === 'productType'
      ? holding.productType
      : groupBy === 'assetClass'
        ? holding.analysisAssetClass
        : groupBy === 'marketScope'
          ? holding.marketScope
          : holding.platform;
    const key = `${label}::${holding.currency}`;
    const group = groups.get(key) ?? {
      key,
      label,
      currency: holding.currency,
      holdingCount: 0,
      coveredCount: 0,
      pnl: 0,
      costBasis: 0,
      returnPct: null,
    };
    group.holdingCount += 1;
    const estimate = estimateHoldingPerformance(holding);
    if (estimate.status === 'estimated' && estimate.pnl !== null && estimate.costBasis !== null) {
      group.coveredCount += 1;
      group.pnl = (group.pnl ?? 0) + estimate.pnl;
      group.costBasis = (group.costBasis ?? 0) + estimate.costBasis;
    }
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => ({
    ...group,
    pnl: group.coveredCount > 0 ? group.pnl : null,
    costBasis: group.coveredCount > 0 ? group.costBasis : null,
    returnPct: group.coveredCount > 0 && group.costBasis && group.costBasis > 0
      ? (group.pnl! / group.costBasis) * 100
      : null,
  }));
}
