# Personal Invest OS · 项目架构

> 更新日期：2026-10-18。本文档描述当前仓库的代码架构、数据流与线上部署形态；与 `README.md`、`docs/IMPLEMENTATION_STATUS.md`、`docs/DEPLOYMENT_GUIDE.md`、`docs/SUPABASE_SYNC.md` 互为补充，以后者为准可查看演进记录。

## 1. 项目定位

个人投资体检台（Personal Invest OS）：用于个人持仓盘点、风险信息整理与 AI 研究请求准备的**纯前端单页应用**。不连接账户、不下单、不自动生成买卖指令，无行情自动更新与定时任务。核心原则：**先整理事实，再评估风险**；区分录入事实、外部来源、计算结果与推断。

## 2. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 框架 | Vite 7 + React 19 + TypeScript 5.9 | `type: module`，ESM 构建 |
| 样式 | 原生 CSS（`src/styles.css`） | 单文件，无 UI 框架 |
| 测试 | Vitest 3 + jsdom | `npm test`，8 项单测（性能 5 + 存储 3） |
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
│       ├── cloudPortfolio.ts   # 云端资料读写（schema_version=2 校验 + revision 乐观锁）
│       ├── productLookup.ts    # 产品代码→名称查询（JSONP，A 股/场外基金等）
│       ├── prompt.ts           # 生成研究 Prompt（含收益估算与安全约束）
│       └── storage.test.ts
├── supabase/migrations/
│   └── 202610180001_user_portfolios.sql   # 云同步建表 + RLS + 触发器（幂等）
├── docs/                       # 规格、使用说明、架构、部署、实施状态等
└── dist/                       # 构建产物（index.html + assets/）
```

### 3.2 模块职责与数据流

```
录入/编辑（App.tsx）
  ├─→ storage.saveState()         本机 localStorage（key: personal-invest-os-v2）
  ├─→ cloudPortfolio.saveCloudPortfolio()   云端（启用同步后，revision 乐观锁）
  ├─→ productLookup.lookup()      查名（代码→名称，异步，查名时锁定字段防覆盖）
  └─→ performance.estimateHoldingPerformance()   分组收益估算

备份/恢复（App.tsx）
  └─→ storage.exportBackup() / importBackup()   JSON 导出 / 导入（含旧版 v1 迁移）

登录/云同步（App.tsx → supabase.ts + cloudPortfolio.ts）
  首次登录 → 显式选择【上传本机 / 恢复云端 / 启用空白云端】
  后续写入 → 同时写本机 + 云端；云端失败保留本机并提示
  多设备并发 → revision 不匹配时暂停同步、重新选择，杜绝静默覆盖
```

数据模型（`domain/types.ts`）：
- `AppState { schemaVersion: 2; holdings: Holding[]; profile: InvestorProfile }`
- `Holding`：平台/产品名称/代码/类型/资产类别/市场/币种/金额/盈亏（值+口径）/金额与盈亏日期/名称核验状态/分类置信度/手工标记/时间戳
- `InvestorProfile`：问卷答案 + 保存时间（答案不自动推导配置比例或交易指令）

### 3.3 收益估算口径

`performance.ts` 仅在**累计盈亏与当前金额口径匹配且日期一致**时估算收益率，按分组成本基数加权，显示可计算覆盖数；部分赎回、分红、费用与平台口径差异会明确影响估算精度（详见 `UPGRADE_AUDIT.md` 4.3）。

## 4. 部署架构（2026-10-18）

```
┌────────────── 用户浏览器 ──────────────┐
│  EdgeOne 托管前端（主）                 │
│  https://personal-invest-os-dpclhix9460m.edgeone.dev │
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
│  └─ anon key（浏览器公开，构建时注入）             │
└────────────────────────────────────────┘
```

| 资源 | 标识 | 状态 |
|---|---|---|
| EdgeOne 项目 | `personal-invest-os`（makers-l7akpc0tkpgz） | ✅ 已关联 GitHub `ecartoonn-cyber/zichanguanli` 的 `main` 分支；最近一次用户确认的 Git 构建提交为 `5326d4a`，EdgeOne deployment ID 未记录 |
| EdgeOne 访问地址 | 最近记录：`https://personal-invest-os-dpclhix9460m.edgeone.dev` | ✅ 已验证渲染 + 登录表单；后续部署地址以 EdgeOne 控制台为准 |
| 官方 Supabase | `dosomrwbcxvponmawdrh` | ✅ 连接生效；**迁移待用户手动执行** |
| 火山工作区 | `personal-invest-os`（glad-apple-e94f93e1） | 保留（旧版前端 + 已迁移数据库） |
| 火山 Pages | `personal-invest-os`（q17ilxk1hv） | 保留，未删除 |

### 4.1 构建与注入

- 构建命令：`pnpm build`（`tsc -b && vite build`）；测试：`pnpm test`。
- 构建时通过临时 `.env` 注入**仅两个公开变量**：`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`，以及 `NEXT_PUBLIC_SUPABASE_SIGNUP_ENABLED`（注册开关，默认 `false`）。构建完成后删除 `.env`。
- `vite.config.ts` 内建拦截保护：拒绝名称含 `SERVICE_ROLE|POSTGRES|DATABASE|PASSWORD|SECRET` 的公开前缀变量，拒绝把 service-role JWT 当作 anon key（`sb_secret_` 开头或 JWT role=service_role 均拒绝）→ 构建直接失败。

### 4.2 数据库迁移

- 迁移文件：`supabase/migrations/202610180001_user_portfolios.sql`（幂等）。
- 内容：`user_portfolios` 表（user_id 主键 + schema_version=2 + revision 乐观锁 + state jsonb + updated_at 触发器）+ RLS（仅 `auth.uid() = user_id` 可增删改查）+ 撤销 anon/authenticated 默认权限。
- 状态：火山工作区 ✅ 已执行；官方 Supabase ⏳ 待用户在 Dashboard SQL Editor 手动执行（MCP 通道只读）。

### 4.3 托管平台差异

- **EdgeOne Makers**（主）：项目 `personal-invest-os` 已直接关联 GitHub 仓库 `ecartoonn-cyber/zichanguanli` 的 `main` 分支。推送提交会触发 EdgeOne 自己的 Git 构建与部署；应在 EdgeOne 控制台核验部署状态并记录 EdgeOne deployment ID。
- **GitHub Actions**：`.github/workflows/deploy-edgeone.yml` 是另一条独立备用路径，使用 `EDGEONE_API_TOKEN` 调用 EdgeOne CLI。它需要 Repository variables 中有 Supabase URL 和 anon/Publishable key；否则工作流可以整体显示 `success`，但 Checkout、Build、Deploy 都被跳过。Actions run ID 不能当作 EdgeOne deployment ID。
- `pnpm-workspace.yaml` 不得指定开发机绝对缓存目录。提交 `5326d4a` 删除 Mac 专属 `storeDir` 后，EdgeOne Git 构建错误 `EACCES mkdir '/Users'` 已解决；用户确认该提交后续构建成功。
- **火山 IGA Pages**（保留旧版）：MCP 可部署（upload → deploy → 预览链接，一次性 token）。

## 5. 数据与安全边界

- 本机存储：`localStorage`（key `personal-invest-os-v2`），未登录/未启用同步时数据仅存当前浏览器，设备间独立。
- 云同步：仅登录用户自己的 `user_portfolios` 一行；**首次登录必须显式选择本机/云端**，不自动上传、不静默覆盖；多设备并发用 revision 乐观锁检测，冲突时暂停并让用户重选。
- 查询名称时把产品代码发给第三方公开查询源（JSONP），金额/盈亏不随查询发送。
- 前端只打包公开 URL + anon key；service role / Postgres 密码 / 连接串绝不出现在构建产物中（构建拦截兜底）。
- 不记录交易流水与历史快照；无账户直连、定时任务、行情自动刷新、应用内 AI 调用。

## 6. 当前状态与待办

**已完成**：本地 MVP → 火山上线 → 云同步代码 + 迁移（火山）→ 官方 Supabase 后端切换 → EdgeOne 主托管上线（已验证登录表单可见）。
**待办**：
1. 官方 Supabase 执行 `user_portfolios` 迁移（Dashboard SQL Editor）。
2. 端到端验收：建测试账号 → 登录 → 上传本机资料 → 多设备并发测试 → 密码重置邮件。
3. （可选）EdgeOne 自定义域名/备案；火山旧版下线。

## 7. 关键标识速查

| 项 | 值 |
|---|---|
| EdgeOne 项目/最近记录部署 | makers-l7akpc0tkpgz / dpclhix9460m（后续 Git 部署 ID 待补录） |
| 官方 Supabase 项目 | dosomrwbcxvponmawdrh |
| 火山工作区 / Pages | glad-apple-e94f93e1 / q17ilxk1hv |
| 本地迁移文件 | supabase/migrations/202610180001_user_portfolios.sql |
| 构建产物 | dist/（index.html + assets/index-*.js + assets/index-*.css） |
