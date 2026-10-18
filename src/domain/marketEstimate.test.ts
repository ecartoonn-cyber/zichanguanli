import { describe, expect, it } from 'vitest';
import { calculateHoldingEstimate } from '../../supabase/functions/market-data/marketMath';

describe('daily holding valuation estimates', () => {
  it('updates cumulative P&L from the confirmed amount and quote baseline', () => {
    expect(calculateHoldingEstimate({
      baselineAmount: 800, baselinePnlValue: -200, baselinePnlBasis: '累计金额',
      baselinePrice: 2, latestPrice: 1.8,
    })).toMatchObject({ estimatedAmount: 720, change: -80, pnl: -280 });
    expect(calculateHoldingEstimate({ baselineAmount: 800, baselinePnlValue: -200, baselinePnlBasis: '累计金额', baselinePrice: 2, latestPrice: 1.8 }).returnPct).toBeCloseTo(-28, 8);
  });

  it('keeps daily or unknown P&L separate from cumulative P&L', () => {
    expect(calculateHoldingEstimate({
      baselineAmount: 1000, baselinePnlValue: null, baselinePnlBasis: '当日金额',
      baselinePrice: 10, latestPrice: 11,
    })).toMatchObject({ estimatedAmount: 1100, change: 100, pnl: null });
    expect(calculateHoldingEstimate({ baselineAmount: 1000, baselinePnlValue: null, baselinePnlBasis: '当日金额', baselinePrice: 10, latestPrice: 11 }).returnPct).toBeCloseTo(10, 8);
  });

  it('rejects zero or invalid quote baselines', () => {
    expect(() => calculateHoldingEstimate({
      baselineAmount: 100, baselinePnlValue: null, baselinePnlBasis: '未知',
      baselinePrice: 0, latestPrice: 10,
    })).toThrow('基准金额或行情价格无效');
  });
});
