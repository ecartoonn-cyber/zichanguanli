# Personal Invest OS · 项目架构

> 更新日期：2026-10-18。本文档描述当前仓库的代码架构、数据流与线上部署形态；与 `README.md`、`docs/IMPLEMENTATION_STATUS.md`、`docs/DEPLOYMENT_GUIDE.md`、`docs/SUPABASE_SYNC.md` 互为补充，以后者为准可查看演进记录。

## 1. 项目定位

个人投资体检台（Personal Invest OS）：用于个人持仓盘点、多维分类、风险信息整理与 AI 研究请求准备的 SPA。没有账户连接或自动交易。代码库新增了 Supabase 交易日行情估算和定时任务；数据库迁移、Edge Function 与 Cron 尚未部署，因此线上页面目前仍无自动行情更新。核心原则：**先整理事实，再评估风险**；区分录入事实、外部来源、计算结果与推断。

## 2. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 框架 | Vite 7 + React 19 + TypeScript 5.9 | `type: module`，ESM 构建 |
| 样式 | 原生 CSS（`src/styles.css`） | 单文件，无 UI 框架 |
| 测试 | Vitest 3 + jsdom | `pnpm test`，14 项单测（收益/分组 6 + 行情估算 3 + 存储/迁移/恢复 5） |
| 云后端 | `@supabase/supabase-js` 2.118 | Auth + Postgres（RLS）+ 云同步 |
| 托管 | EdgeOne Makers（主，Git 关联自动构建）/ 火山 IGA Pages（保留旧版） | EdgeOne 从 GitHub `main` 构建 `dist` |
| 包管理 | pnpm | `pnpm-workspace.yaml` |

## 3. 代码架构

### 3.1 目录结构

```
理财管理/
├── index.html                  # Vite 入口（挂载 #root）
├── vite.config.ts              # 构建配置 + 特权变量拦截保护
├── tsconfig.json / package.json
├── prototype/                  # 旧版单文件原型（参考用，不参与构建）
├── src/
│   ├── main.tsx                # React 挂载入口
│   ├── App.tsx                 # 主界面与全部交互逻辑（约 530 行）
│   ├── styles.css              # 全局样式
│   ├── domain/
│   │   ├── types.ts            # 领域模型：Holding / InvestorProfile / AppState
│   │   ├── performance.ts      # 持仓收益估算（按分组成本基数加权）
│   │   └── performance.test.ts
│   └── services/
│       ├── storage.ts          # 本机 localStorage 读写、备份导入/导出、旧版迁移
│       ├── supabase.ts         # Supabase 客户端工厂（仅 URL + anon key）+ 受控注册开关
│       ├── cloudPortfolio.ts   # 云端资料读写（v2→v3 兼容迁移 + revision 乐观锁）
│       ├── marketTracking.ts   # 行情跟踪、状态和历史估算读取
│       ├── sectorValuation.ts  # 板块估值快照读取（anon 只读 sector_valuation 最新 as_of_date）
│       ├── productLookup.ts    # 产品代码→名称查询（JSONP，A 股/场外基金等）
│       ├── prompt.ts           # 生成研究 Prompt（含收益估算与安全约束）
│       └── storage.test.ts
├── supabase/migrations/
│   ├── 202610180001_user_portfolios.sql   # 云同步建表 + RLS + 触发器（幂等）
│   ├── 202610180002_market_tracking.sql   # 行情、私有估算/任务记录与 RLS
│   └── 202610200001_sector_valuation.sql  # 板块估值快照表 + RLS（anon 只读）
├── supabase/functions/market-data/        # 行情 Provider + 估算与任务函数（待部署）
├── supabase/cron/                          # 工作日 Cron SQL 模板
├── scripts/
│   └── sector_valuation.py                # 板块估值快照（乐咕分位 + 申万涨跌 + 股债利差 → 双指数）
├── .github/workflows/
│   ├── deploy-edgeone.yml                 # EdgeOne 备用部署通道（需仓库变量）
│   └── sector-valuation.yml               # 每日 23:30 快照任务（需 SUPABASE_SERVICE_KEY）
├── docs/                       # 规格、使用说明、架构、部署、实施状态等
└── dist/                       # 构建产物（index.html + assets/）
```

### 3.2 模块职责与数据流

```
录入/编辑（App.tsx）
  ├─→ storage.saveState()         本机 localStorage（key: personal-invest-os-v2）
  ├─→ cloudPortfolio.saveCloudPortfolio()   云端（启用同步后，revision 乐观锁）
  ├─→ productLookup.lookup()      查名（代码→名称，异步，查名时锁定字段防覆盖）
  ├─→ performance.estimateHoldingPerformance()   多维分组收益与金额占比
  └─→ marketTracking.ts → Supabase Function       行情跟踪、状态和估算历史

备份/恢复（App.tsx）
  └─→ storage.exportBackup() / importBackup()   JSON 导出 / 导入（含旧版 v1 迁移）

登录/云同步（App.tsx → supabase.ts + cloudPortfolio.ts）
  首次登录 → 显式选择【上传本机 / 恢复云端 / 启用空白云端】
  后续写入 → 同时写本机 + 云端；云端失败保留本机并提示
  多设备并发 → revision 不匹配时暂停同步、重新选择，杜绝静默覆盖
```

数据模型（`domain/types.ts`）：
- `AppState { schemaVersion: 3; holdings: Holding[]; profile: InvestorProfile }`；本地与云端 v2 会迁移到 v3，保留金额和盈亏
- `Holding` 在既有字段上增加行业、流动性、分类来源/日期/置信度和用户覆盖标记
- `InvestorProfile` 保存问卷及按币种填写的可选配置目标；目标不会自动生成交易指令
- 行情跟踪基准、估算历史和任务记录单独保存在 Supabase 表，不覆盖持仓手工录入

### 3.3 收益估算口径

`performance.ts` 仅在**累计盈亏与当前金额口径匹配且日期一致**时估算累计收益率，按分组成本基数加权，显示可计算覆盖数。行情跟踪另按确认的基准金额与价格推算持仓金额；每日/未知盈亏口径只展示启用以来的估算变化。申赎、分红、费用和份额变化会造成误差；手工改金额或盈亏后需重设基准。

### 3.4 板块估值模块（抄底 / 风险指数，2026-10-21）

数据流：GitHub Actions（每日 23:30，或 `scripts/sector_valuation.py` 手动）→ 乐咕乐股行业 PE/PB/股息率+历史分位、申万指数日线涨跌幅、沪深300 PE 与 10 年国债的股债利差 → 按权重计算抄底/风险指数 → upsert `public.sector_valuation`（unique(sector_code, as_of_date)）→ 前端 `SectorValuationPanel` anon 只读最新快照。

- 抄底指数 = 0.3·(100−PE分位) + 0.3·(100−PB分位) + 0.2·股债利差分位 + 0.1·clamp(−近3月涨跌×4) + 0.1·股息率分位；≥75 极度低估 / 60–75 低估 / 40–60 中性 / 25–40 合理偏高 / <25 高估
- 风险指数 = 0.3·PE分位 + 0.3·PB分位 + 0.25·clamp(近1月涨跌×3) + 0.15·(100−股息率分位)；分位缺失按 50 中性处理
- 数据源：乐咕乐股 `sw-industry-overview`（页面内嵌历史分位）、申万宏源指数日线 API、乐咕沪深300 PE + 东财 10 年国债（股债利差）。启发式打分，非投资建议。

## 4. 部署架构（2026-10-18）

```
┌────────────── 用户浏览器 ──────────────┐
│  EdgeOne 托管前端（主）                 │
│  最近确认部署：                                     │
│  https://personal-invest-os-dpargjupipe2.edgeone.dev│
│  （火山 IGA Pages 旧版保留：            │
│    personal-invest-os → q17ilxk1hv）   │
└──────────────┬─────────────────────────┘
               │ HTTPS
               ▼
┌────────────────────────────────────────┐
│ 官方 Supabase（后端，项目 dosomrwbcxvponmawdrh）│
│  URL: https://dosomrwbcxvponmawdrh.supabase.co   │
│  ├─ Auth（邮箱密码登录 / 受控注册 / 密码重置）      │
│  ├─ Postgres：public.user_portfolios（RLS 按账号隔离）│
│  ├─ 行情/用户估算/任务表（新迁移待部署）             │
│  ├─ market-data Edge Function（待部署）              │
│  └─ Cron + Vault 工作日调度（待配置）                 │
│  └─ anon key（浏览器公开，构建时注入）             │
└────────────────────────────────────────┘
```

| 资源 | 标识 | 状态 |
|---|---|---|
| EdgeOne 项目 | `personal-invest-os`（makers-l7akpc0tkpgz） | ✅ 已关联 GitHub `ecartoonn-cyber/zichanguanli` 的 `main` 分支；最近部署 `dpi3b2prs3yd`（提交 `4aa0541`，板块估值模块） |
| EdgeOne 访问地址 | `https://personal-invest-os-dpi3b2prs3yd.edgeone.dev` | ✅ 板块估值面板已上线（数据表未建时显示迁移指引） |
| 官方 Supabase | `dosomrwbcxvponmawdrh` | 云同步表已配置；`sector_valuation` 迁移待 Dashboard 执行；行情迁移/函数/Cron 尚未部署/验收 |
| 火山工作区 | `personal-invest-os`（glad-apple-e94f93e1） | 保留（旧版前端 + 已迁移数据库） |
| 火山 Pages | `personal-invest-os`（q17ilxk1hv） | 保留，未删除 |

### 4.1 构建与注入

- 构建命令：`pnpm build`（`tsc -b && vite build`）；测试：`pnpm test`。
- 构建时通过临时 `.env` 注入**仅两个公开变量**：`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`，以及 `NEXT_PUBLIC_SUPABASE_SIGNUP_ENABLED`（注册开关，默认 `false`）。构建完成后删除 `.env`。
- `vite.config.ts` 内建拦截保护：拒绝名称含 `SERVICE_ROLE|POSTGRES|DATABASE|PASSWORD|SECRET` 的公开前缀变量，拒绝把 service-role JWT 当作 anon key（`sb_secret_` 开头或 JWT role=service_role 均拒绝）→ 构建直接失败。

### 4.2 数据库迁移

- 迁移文件：`supabase/migrations/202610180001_user_portfolios.sql`（幂等）。
- 内容：`user_portfolios` 表（user_id 主键 + schema_version 2/3 + revision 乐观锁 + state jsonb + updated_at 触发器）+ RLS（仅 `auth.uid() = user_id` 可增删改查）+ 撤销匿名访问。
- 状态：云同步旧表已在目标 Supabase 工作区部署；此次行情迁移为新增结构，部署状态见 `IMPLEMENTATION_STATUS.md`。
- 行情迁移：`supabase/migrations/202610180002_market_tracking.sql`；兼容 user_portfolios v2/v3，新增共享行情表及用户级跟踪、日估算、任务记录，按 user_id 开启 RLS。当前尚未执行。
- 定时处理：`supabase/functions/market-data` 使用 Supabase 服务端密钥；用户请求通过 Auth 校验，定时调用使用独立 `MARKET_CRON_SECRET`。Cron 模板在 `supabase/cron/market-data.sql`，尚未配置。

### 4.3 托管平台差异

- **EdgeOne Makers**（主）：项目 `personal-invest-os` 已直接关联 GitHub 仓库 `ecartoonn-cyber/zichanguanli` 的 `main` 分支。推送提交会触发 EdgeOne 自己的 Git 构建与部署；应在 EdgeOne 控制台核验部署状态并记录 EdgeOne deployment ID。
- **GitHub Actions**：`.github/workflows/deploy-edgeone.yml` 是另一条独立备用路径，使用 `EDGEONE_API_TOKEN` 调用 EdgeOne CLI。它需要 Repository variables 中有 Supabase URL 和 anon/Publishable key；否则工作流可以整体显示 `success`，但 Checkout、Build、Deploy 都被跳过。Actions run ID 不能当作 EdgeOne deployment ID。
- `pnpm-workspace.yaml` 不得指定开发机绝对缓存目录。提交 `5326d4a` 删除 Mac 专属 `storeDir` 后，EdgeOne Git 构建错误 `EACCES mkdir '/Users'` 已解决；用户确认该提交后续构建成功。
- **火山 IGA Pages**（保留旧版）：MCP 可部署（upload → deploy → 预览链接，一次性 token）。

## 5. 数据与安全边界

- 本机存储：`localStorage`（key `personal-invest-os-v2`），未登录/未启用同步时数据仅存当前浏览器，设备间独立。
- 云同步：仅登录用户自己的 `user_portfolios` 一行；**首次登录必须显式选择本机/云端**，不自动上传、不静默覆盖；多设备并发用 revision 乐观锁检测，冲突时暂停并让用户重选。
- 查询名称时把产品代码发给第三方公开查询源（JSONP），金额/盈亏不随查询发送。
- 行情功能目前代码支持公开网页接口的 A 股/沪深 ETF 报价和场外基金净值；非正式数据接口没有服务等级保证，海外与银行理财暂不支持。仅个人低频请求，数据日期、来源和失败状态会展示。
- 前端只打包公开 URL + anon key；service role / Postgres 密码 / 连接串绝不出现在构建产物中（构建拦截兜底）。
- 每日行情快照从用户启用后开始；不记录交易流水，也不回填之前的持仓历史。无账户直连、自动交易或应用内 AI 调用。

## 6. 当前状态与待办

**已完成**：本地 MVP → 火山上线 → 云同步代码 + 迁移（火山）→ 官方 Supabase 后端切换 → EdgeOne 主托管上线（已验证登录表单可见）→ 多维分类/收益汇总/配置目标/导入恢复点及行情估算前后端代码 → 板块估值模块（代码、脚本、Actions、前端、EdgeOne 部署上线）。
**待办**：
1. 在官方 Supabase 执行 `202610180002_market_tracking.sql`，部署 `market-data` Function，安全保存 Cron secret 并配置 Cron；详见 `MARKET_DATA_SETUP.md`。
2. 在官方 Supabase Dashboard 执行 `202610200001_sector_valuation.sql`（板块估值表）；在 GitHub 仓库配置 Actions 变量 `NEXT_PUBLIC_SUPABASE_URL` + 密钥 `SUPABASE_SERVICE_KEY`，触发一次或等每日任务生成首份快照，验证面板数据渲染。
3. 使用一个明确确认的基准持仓测试行情取数、RLS 隔离、每日幂等记录、手工重设基准和任务失败状态。
4. 端到端验收登录云同步、备份恢复和部署。
5. （可选）EdgeOne 自定义域名/备案；火山旧版下线。

## 7. 关键标识速查

| 项 | 值 |
|---|---|
| EdgeOne 项目/最近部署 | makers-l7akpc0tkpgz / dpi3b2prs3yd（提交 4aa0541） |
| 官方 Supabase 项目 | dosomrwbcxvponmawdrh |
| 火山工作区 / Pages | glad-apple-e94f93e1 / q17ilxk1hv |
| 本地迁移文件 | supabase/migrations/202610180001_user_portfolios.sql、202610180002_market_tracking.sql、202610200001_sector_valuation.sql |
| 板块估值脚本 / Actions | scripts/sector_valuation.py / .github/workflows/sector-valuation.yml |
| 构建产物 | dist/（index.html + assets/index-*.js + assets/index-*.css） |
