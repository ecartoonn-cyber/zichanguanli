import { describe, expect, it } from 'vitest';
import { estimateHoldingPerformance, groupPerformance } from './performance';
import type { Holding } from './types';

const base: Holding = {
  holdingId: 'h1', platform: '支付宝', productName: '基金 A', productCode: '000001',
  productType: '场外基金', analysisAssetClass: '基金', marketScope: '国内', countryOrRegion: '中国',
  currency: 'CNY', currentAmount: 800, pnlValue: -200, pnlBasis: '累计金额',
  amountUpdatedAt: '2026-10-17', pnlUpdatedAt: '2026-10-17', productNameSource: null,
  productNameVerified: false, classificationSource: null, classificationAsOf: null,
  classificationConfidence: 'unknown', userNotes: '', manualName: true,
  createdAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z',
};

describe('estimateHoldingPerformance', () => {
  it('derives an estimated loss rate from current amount and cumulative loss', () => {
    expect(estimateHoldingPerformance(base)).toMatchObject({
      status: 'estimated', pnl: -200, costBasis: 1000, returnPct: -20, method: 'amount-derived',
    });
  });

  it('uses a supplied cumulative percentage without averaging it with other holdings', () => {
    expect(estimateHoldingPerformance({
      ...base, currentAmount: 1200, pnlValue: 20, pnlBasis: '累计比例',
    })).toMatchObject({ status: 'estimated', returnPct: 20, costBasis: 1000, pnl: 200 });
  });

  it('does not treat daily P&L as cumulative return', () => {
    expect(estimateHoldingPerformance({ ...base, pnlBasis: '当日金额' }).status).toBe('not-cumulative');
  });

  it('rejects stale amount/P&L dates and invalid implied cost basis', () => {
    expect(estimateHoldingPerformance({ ...base, pnlUpdatedAt: '2026-10-16' }).status).toBe('date-mismatch');
    expect(estimateHoldingPerformance({ ...base, currentAmount: 100, pnlValue: 120 }).status).toBe('invalid-basis');
    expect(estimateHoldingPerformance({ ...base, currentAmount: 100, pnlValue: -100, pnlBasis: '累计比例' }).status).toBe('invalid-basis');
  });
});

describe('groupPerformance', () => {
  it('weights returns by implied basis, reports coverage, and separates currencies', () => {
    const second = { ...base, holdingId: 'h2', currentAmount: 1100, pnlValue: 100 };
    const otherCurrency = { ...base, holdingId: 'h3', currency: 'USD' as const };
    const groups = groupPerformance([base, second, otherCurrency], 'marketScope');
    const cny = groups.find((group) => group.currency === 'CNY')!;
    expect(cny.holdingCount).toBe(2);
    expect(cny.coveredCount).toBe(2);
    expect(cny.pnl).toBe(-100);
    expect(cny.costBasis).toBe(2000);
    expect(cny.returnPct).toBe(-5);
    expect(groups).toHaveLength(2);
  });
});
