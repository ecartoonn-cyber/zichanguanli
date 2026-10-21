# 行情估算部署与使用

## 当前支持范围

- A 股股票、常见沪深 ETF：腾讯公开证券行情接口。
- 代码为 6 位数字的场外基金：东方财富公开历史净值页面接口。
- 海外证券、银行理财、存款和其他产品暂不自动估值；点击跟踪时会返回不支持原因。
- 上述证券/基金接口是公开网页使用的非正式接口，不是有服务等级保证的正式行情 API。它们可能限流、变更或延迟；项目只按个人持仓低频请求，并在页面记录接口来源和数据日期。公开可访问不等于取得商业再分发许可；此功能不向第三方分发行情。

金额估算假设用户在建立基准时确认的金额与行情日期一致，并假设此后份额不变。系统不维护申购、赎回、分红和费用流水。用户编辑金额或盈亏后，下一条有效且日期匹配的行情会重设基准；基准不匹配时暂停估算。每日历史从启用日开始。

## 部署步骤

> **当前实际部署方式**：Edge Function 直接在 Supabase Dashboard 手动粘贴代码部署（免费版无 CLI 环境），Cron 改用外部触发（GitHub Actions 或本地定时脚本），未使用 pg_cron。

1. 先备份当前 JSON 持仓。
2. 在 Supabase SQL Editor 执行 `supabase/migrations/202610180002_market_tracking.sql`。
3. 在 Supabase Dashboard → Edge Functions → 新建 market-data 函数，粘贴 `supabase/functions/market-data/index.ts` 最新代码，点 Deploy。
4. 在 Supabase Edge Function Secrets 中设置 `MARKET_CRON_SECRET`。
5. 定时触发：免费版无 pg_cron，改用 GitHub Actions 或本地脚本工作日收盘后手动/自动调用。
6. EdgeOne 按 Git 关联构建前端；Supabase Function 需单独手动部署。
7. 登录并启用云同步后，在持仓卡片选择”开启每日估算”。

## 验收和恢复

- 确认一次“开启每日估算”产生来源、行情日期和基准记录；手动改金额后，旧估算立即不再作为当前金额显示，下一次有效行情重置基准。
- 检查 `user_market_estimates` 按 `(user_id, holding_id, quote_date)` 幂等，不同账号不能读到对方记录。
- 用 `user_market_job_runs` 和 Supabase Cron 运行记录检查成功、部分成功、过期和失败原因。
- 若不再使用，先在持仓卡片“暂停跟踪”；停止 Cron 可在 SQL Editor 执行：

   ```sql
   select cron.unschedule('pios-market-data-weekdays');
   ```

- 不要为了让数据看起来更新而放宽代码匹配、金额日期或来源校验。
