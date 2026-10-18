import type { AppState } from '../domain/types';
import { estimateHoldingPerformance } from '../domain/performance';

type PromptMarketTracking = {
  holding_id: string; status: string; reason: string | null;
  latest_price: number | null; latest_price_date: string | null; latest_source: string | null;
  estimated_amount: number | null; estimated_pnl_value: number | null;
  estimated_since_baseline: number | null; estimated_return_pct: number | null; last_checked_at: string | null;
};

export function buildAnalysisPrompt(state: AppState, marketTracking: PromptMarketTracking[] = []): string {
  const trackingById = new Map(marketTracking.map((item) => [item.holding_id, item]));
  const holdings = state.holdings.map((holding) => ({
    平台: holding.platform,
    产品名称: holding.productName,
    产品代码: holding.productCode || '未提供',
    名称状态: holding.productNameVerified ? `代码核对，来源：${holding.productNameSource ?? '未记录'}` : holding.manualName ? '手工名称，未自动核验' : '待核验',
    产品类型: holding.productType,
    分析资产类别: holding.analysisAssetClass,
    市场范围: holding.marketScope,
    国家地区: holding.countryOrRegion ?? '未知',
    行业: holding.industry ?? '未知',
    流动性: holding.liquidityProfile,
    分类来源和置信度: `${holding.classificationSource ?? '未记录'} / ${holding.classificationConfidence}${holding.classificationUserOverride ? ' / 用户手工确认' : ''}`,
    当前金额: trackingById.get(holding.holdingId)?.status === 'active'
      ? trackingById.get(holding.holdingId)?.estimated_amount ?? holding.currentAmount
      : holding.currentAmount,
    币种: holding.currency,
    当前盈亏: holding.pnlValue ?? '未提供',
    盈亏口径: holding.pnlBasis,
    金额日期: holding.amountUpdatedAt,
    盈亏日期: holding.pnlUpdatedAt ?? '未提供',
    估算累计收益率: estimateHoldingPerformance(holding).returnPct ?? '无法可靠计算',
    行情检查: (() => {
      const tracking = trackingById.get(holding.holdingId);
      return tracking ? {
        状态: tracking.status,
        说明: tracking.reason ?? '无',
        行情日期: tracking.latest_price_date ?? '无',
        行情来源: tracking.latest_source ?? '无',
        最新价格: tracking.latest_price ?? '无',
        估算金额: tracking.estimated_amount ?? '无',
        启用以来估算盈亏: tracking.estimated_since_baseline ?? '无',
        启用以来估算收益率: tracking.estimated_return_pct ?? '无',
        最近检查: tracking.last_checked_at ?? '无',
      } : '未启用';
    })(),
  }));
  return `你是个人投资组合研究助手。请基于下列用户资料进行风险诊断和决策辅助。先区分录入事实、外部来源、计算结果和推断。不要编造持仓、行情、来源或底层基金资产；所有市场事实附来源链接和数据/发布时间。数据过期、缺失或口径不一致时明确说明，并停止给出具体交易方向。不得自动交易、承诺收益或把亏损本身作为交易理由。每次报告必须包含支持证据、反方证据、方案利弊、不操作选项、复核触发条件和数据缺口。

【投资画像】
${JSON.stringify(state.profile.answers, null, 2)}

【用户设定的配置目标】
${JSON.stringify(state.profile.allocationTargets, null, 2)}

【已录入持仓】
${JSON.stringify(holdings, null, 2)}

本 Prompt 含持仓名称、代码、金额和盈亏。仅在用户确认发送后再交给 AI 服务。`;
}
