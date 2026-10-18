# 行情估算部署与使用

## 当前支持范围

- A 股股票、常见沪深 ETF：腾讯公开证券行情接口。
- 代码为 6 位数字的场外基金：东方财富公开历史净值页面接口。
- 海外证券、银行理财、存款和其他产品暂不自动估值；点击跟踪时会返回不支持原因。
- 上述证券/基金接口是公开网页使用的非正式接口，不是有服务等级保证的正式行情 API。它们可能限流、变更或延迟；项目只按个人持仓低频请求，并在页面记录接口来源和数据日期。公开可访问不等于取得商业再分发许可；此功能不向第三方分发行情。

金额估算假设用户在建立基准时确认的金额与行情日期一致，并假设此后份额不变。系统不维护申购、赎回、分红和费用流水。用户编辑金额或盈亏后，下一条有效且日期匹配的行情会重设基准；基准不匹配时暂停估算。每日历史从启用日开始。

## 部署步骤

1. 先备份当前 JSON 持仓。
   在 Supabase Dashboard 核对当前项目套餐、`pg_cron` / `pg_net` / Vault 扩展可用性和预计用量；部署前不升级套餐、不启用会新增付费的资源。Supabase 官方支持通过 Cron + `pg_net` 定时调用 Edge Function，并建议把调用凭据存进 Vault，套餐和函数运行时限制以当前项目的 Usage/Billing 页面为准。[Cron 文档](https://supabase.com/docs/guides/cron) · [函数定时调用](https://supabase.com/docs/guides/functions/schedule-functions) · [函数限制](https://supabase.com/docs/guides/functions/limits)
2. 在 Supabase SQL Editor 执行 `supabase/migrations/202610180002_market_tracking.sql`。迁移保留现有 `user_portfolios` 记录，只允许登录用户读取自己的估算、任务历史；行情表只允许登录用户读，所有写入由 Edge Function 服务端执行。
3. 用 Supabase CLI 部署 `market-data` Edge Function：

   ```sh
   supabase functions deploy market-data --project-ref dosomrwbcxvponmawdrh
   ```

4. 在 Supabase Edge Function Secrets 中设置 `MARKET_CRON_SECRET`，使用随机生成、至少 32 字符的值。该值不得写入仓库或前端变量。
5. 在 Supabase Dashboard 启用 `pg_cron`、`pg_net` 和 Vault 扩展。将 `supabase/cron/market-data.sql` 中的项目 URL、公开 Publishable/anon key 和同一个随机 Cron secret 保存为 Vault secrets（名称必须分别为 `pios_project_url`、`pios_publishable_key`、`pios_market_cron_secret`），替换占位符后执行该 SQL。Cron 按工作日 15:30 UTC（北京时间 23:30）调用函数；Supabase Cron 会记录调度运行结果。[Supabase Cron 文档](https://supabase.com/docs/guides/cron)、[定时调用 Edge Function](https://supabase.com/docs/guides/functions/schedule-functions)
6. EdgeOne 仍按原有 Git 关联构建前端。EdgeOne 不会部署 Supabase Function 或 SQL；前后端须分别发布。
7. 登录并启用云同步后，在持仓卡片选择“开启每日估算”。首次基准要求金额日期与来源最新行情日期相同；累计盈亏日期也必须与金额日期一致。可在“交易日行情检查”点“立即检查”进行手动验证。

## 验收和恢复

- 确认一次“开启每日估算”产生来源、行情日期和基准记录；手动改金额后，旧估算立即不再作为当前金额显示，下一次有效行情重置基准。
- 检查 `user_market_estimates` 按 `(user_id, holding_id, quote_date)` 幂等，不同账号不能读到对方记录。
- 用 `user_market_job_runs` 和 Supabase Cron 运行记录检查成功、部分成功、过期和失败原因。
- 若不再使用，先在持仓卡片“暂停跟踪”；停止 Cron 可在 SQL Editor 执行：

   ```sql
   select cron.unschedule('pios-market-data-weekdays');
   ```

- 不要为了让数据看起来更新而放宽代码匹配、金额日期或来源校验。
