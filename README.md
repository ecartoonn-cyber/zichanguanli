# Personal Invest OS · 本地 MVP

一个用于个人持仓盘点、风险信息整理和 AI 研究请求准备的本地模块化应用。它不连接账户、不下单，也不自动生成买卖指令。

## 本地运行

需要 Node.js 20.19+ 或 22.12+ 与 pnpm：

```sh
pnpm install
pnpm dev
```

浏览器打开终端显示的本地地址。生产构建使用 `pnpm build`，自动检查使用 `pnpm test`。

## 使用顺序

1. 录入平台、产品代码、金额、币种、盈亏与数据日期；可以用代码查询名称，查不到时手工补充并保留手工标记。
2. 完成理财体检问卷；答案表达个人目标和风险感受，不会自动转换为资产配置或交易指令。
3. 查看持仓与分组收益估算，确认持仓、币种和数据日期。
4. 生成研究 Prompt，确认后复制到 ChatGPT。Prompt 要求核验信息时效、证据、反方观点、利弊和不操作选项。
5. 每次修改前后导出 JSON 备份。导入会替换本机当前记录，应用会先预览数量和部分项目并再次确认。

## 线上部署（2026-10-18）

前端托管在 **EdgeOne Makers**（主），后端连接 **官方 Supabase**：

- EdgeOne 项目：`personal-invest-os`（makers-l7akpc0tkpgz）· 已关联 GitHub 仓库 `ecartoonn-cyber/zichanguanli` 的 `main` 分支
- 最近确认成功的 EdgeOne 部署：`dpargjupipe2`，地址 https://personal-invest-os-dpargjupipe2.edgeone.dev（本地新功能变更尚未部署）
- 用户确认提交 `5326d4a` 后 EdgeOne Git 构建成功；该次 EdgeOne 部署 ID 未记录
- 官方 Supabase 后端：项目 `dosomrwbcxvponmawdrh` · URL `https://dosomrwbcxvponmawdrh.supabase.co`（Auth 邮箱密码登录 + Postgres RLS）
- 部署内容：`pnpm build` 产物 dist（index.html + assets）；构建时仅注入 Supabase URL 与 anon key（公开），service-role key / 数据库密码从不进入构建
- 火山 IGA Pages 旧版（`personal-invest-os` → q17ilxk1hv）保留可访问，未删除

当前代码增加了多维分类、资产配置目标、导入恢复点和交易日行情估算。行情后端采用独立 Supabase 迁移、Edge Function 和 Cron；完成配置前，线上页面不会自动取行情。完整部署步骤见 [`docs/MARKET_DATA_SETUP.md`](docs/MARKET_DATA_SETUP.md)，架构见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

新增的分类/行情数据库迁移、`market-data` Edge Function 与交易日 Cron 配置尚未部署，步骤见 [`docs/MARKET_DATA_SETUP.md`](docs/MARKET_DATA_SETUP.md)。

日常发布流程：本地提交并推送到 GitHub `main`，EdgeOne Git 关联自动构建并部署。部署是否成功、EdgeOne 部署 ID 和访问地址以 EdgeOne 控制台部署记录为准。仓库内 `.github/workflows/deploy-edgeone.yml` 是独立备用通道；GitHub Actions 显示 `success` 不一定代表部署成功，必须确认 Build 和 Deploy 步骤实际运行。详见 [`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md)。

> 前端只使用明确指定的 Supabase URL 和 anon key；不会使用 service-role key 或数据库连接密钥。首次登录必须明确选择本机或云端资料，不能静默覆盖；多设备并发由 revision 乐观锁保护。

## 数据与边界

- 默认本地存储；启用登录后的云同步会把持仓和问卷保存到登录用户的官方 Supabase 账号（项目 `dosomrwbcxvponmawdrh`），详见 [`docs/SUPABASE_SYNC.md`](docs/SUPABASE_SYNC.md)。

- 未登录或未启用云同步时，持仓和问卷保存在当前浏览器；不同设备的数据彼此独立。云同步只有在目标工作区完成数据库迁移并由用户登录、明确选定资料后才生效。
- 查询产品名称时会将代码发给第三方公开查询源；金额和盈亏不会随查询发送。
- 本地代码已包含行情跟踪与定时任务；Supabase 行情迁移、Edge Function 与 Cron 仍需部署，未完成前线上不自动更新。没有账户直连、自动交易或应用内 AI 调用。
- 可录入单项持仓与导入旧版 JSON 备份。**表格/批量持仓录入本期明确不做。**
- 收益率仅在累计盈亏与当前金额口径匹配且日期一致时尝试估算；会显示数据覆盖数。部分赎回、分红、费用和平台口径差异会影响估算。
- 资产分类和产品名称需要用户核对；没有可靠来源时不应把推断当成已验证事实。

详细说明见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)、[`docs/MVP-使用说明.md`](docs/MVP-使用说明.md)、[`docs/SUPABASE_SYNC.md`](docs/SUPABASE_SYNC.md)、[`docs/项目规格.md`](docs/项目规格.md)、[`docs/UPGRADE_AUDIT.md`](docs/UPGRADE_AUDIT.md) 和 [`docs/投资管理与监控计划.md`](docs/投资管理与监控计划.md)（外部投资目标、归并计划与每日/周/月/季监控节奏）。
