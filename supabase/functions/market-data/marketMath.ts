export type CumulativeBasis = '累计金额' | '累计比例';

export function calculateHoldingEstimate(input: {
  baselineAmount: number;
  baselinePnlValue: number | null;
  baselinePnlBasis: string;
  baselinePrice: number;
  latestPrice: number;
}) {
  if (![input.baselineAmount, input.baselinePrice, input.latestPrice].every(Number.isFinite)
    || input.baselineAmount < 0 || input.baselinePrice <= 0 || input.latestPrice <= 0) {
    throw new Error('基准金额或行情价格无效');
  }
  const estimatedAmount = input.baselineAmount * input.latestPrice / input.baselinePrice;
  const change = estimatedAmount - input.baselineAmount;
  let pnl: number | null = null;
  let returnPct = (input.latestPrice / input.baselinePrice - 1) * 100;
  const basePnl = input.baselinePnlValue;
  if (basePnl !== null && input.baselinePnlBasis === '累计金额') {
    const cost = input.baselineAmount - basePnl;
    if (cost > 0) {
      pnl = basePnl + change;
      returnPct = pnl / cost * 100;
    }
  } else if (basePnl !== null && input.baselinePnlBasis === '累计比例' && basePnl > -100) {
    const cost = input.baselineAmount / (1 + basePnl / 100);
    if (cost > 0) {
      pnl = input.baselineAmount - cost + change;
      returnPct = pnl / cost * 100;
    }
  }
  return { estimatedAmount, change, pnl, returnPct };
}
