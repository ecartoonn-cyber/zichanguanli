# Personal Invest OS · 线上部署触发指南

供你在任何 AI 工具（豆包、Cursor、Claude 等）中触发本项目「推送到线上」时使用。项目代码位于 `/Users/ka/Documents/理财管理`。

## 1. 现状速览（2026-10-18）

| 资源 | 标识 | 说明 |
|---|---|---|
| 前端托管（主） | EdgeOne Makers：项目 `personal-invest-os`（makers-l7akpc0tkpgz） | 最新已知部署 `dpclhix9460m` · Success · https://personal-invest-os-dpclhix9460m.edgeone.dev |
| 后端 | 官方 Supabase：`dosomrwbcxvponmawdrh` | URL `https://dosomrwbcxvponmawdrh.supabase.co`；Auth + Postgres RLS |
| 前端托管（保留） | 火山 IGA Pages：`personal-invest-os`（q17ilxk1hv） | 旧版保留；工作区 glad-apple-e94f93e1 |
| 数据库迁移 | `202610180001_user_portfolios` | 火山 ✅ 已执行；**官方 ⏳ 待 Dashboard 手动执行** |
| 构建注入 | `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` + `NEXT_PUBLIC_SUPABASE_SIGNUP_ENABLED` | 仅公开变量；特权变量构建直接失败 |

## 2. 一句话触发话术

> 把 `/Users/ka/Documents/理财管理` 的更改推送到 GitHub `main`；GitHub Actions 构建后用 EdgeOne CLI 更新现有 `personal-invest-os` 站点。

## 3. 前置条件

1. 项目依赖已安装（`node_modules` 就绪；如需重装：`pnpm install`）。
2. 获取官方 Supabase 公开连接变量：Dashboard → 项目 `dosomrwbcxvponmawdrh` → Settings → API（或 `get_publishable_keys`）：取 URL 与 anon key / publishable key；**service_role key 不得用于前端构建**。

## 4. GitHub Actions 自动部署到现有 EdgeOne 项目

当前 EdgeOne 项目由直接上传创建。EdgeOne 官方说明这类项目不能切换成原生 Git 集成；本仓库改用 GitHub Actions 构建，再由 EdgeOne CLI 部署到同一个 `personal-invest-os` 项目，因此不需要另建站点。

仓库工作流：`.github/workflows/deploy-edgeone.yml`。推送到 `main` 后，它会安装依赖、构建 `dist`，再执行 EdgeOne CLI 正式部署。工作流缺少配置时会跳过，不会更改线上版本。

首次启用前，在 GitHub 仓库 `Settings → Secrets and variables → Actions` 配置：

- **Repository variables**：`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`NEXT_PUBLIC_SUPABASE_SIGNUP_ENABLED`（设为 `false`；anon/publishable key 是浏览器公开配置）。
- **Repository secret**：`EDGEONE_API_TOKEN`（在 EdgeOne Makers 控制台生成；不要提交到代码或写进仓库变量）。

设置完后，在 GitHub `Actions → Build and deploy to EdgeOne → Run workflow` 手动运行一次。随后每次推送到 `main` 都会自动构建并部署到当前 EdgeOne 项目。若需要预览，先使用 EdgeOne 控制台预览部署；当前工作流只部署生产环境。

日常更新只需提交并推送代码。Supabase 数据库结构没有变化时，不需要重新执行 SQL 迁移。

## 5. 手动上传备用流程

1. **检查代码**：`node_modules/.bin/tsc -b`。
2. **写临时 .env**（仅公开变量）：
   ```ini
   NEXT_PUBLIC_SUPABASE_URL=https://dosomrwbcxvponmawdrh.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key，Dashboard Settings→API 获取>
   NEXT_PUBLIC_SUPABASE_SIGNUP_ENABLED=false   # 受控注册：默认关闭；要开放改为 true
   ```
3. **生产构建**：`node_modules/.bin/vite build`。
4. **验证产物**：`dist/assets/*.js` 含 URL 与 anon key 特征串，且不含 `service_role` / `POSTGRES_PASSWORD` / 旧火山 `aidap-global` 特征。vite 配置自带拦截：.env 中出现特权变量或把 service-role JWT 当 anon key 时构建直接失败，属预期保护。
5. **清理临时 .env**（勿提交）。
6. **打包**：`cd dist && zip -r ../edgeone-dist-upload.zip .`（index.html 必须在 zip 根目录）。
7. **部署到 EdgeOne（手动备用）**：控制台：https://console.tencentcloud.com/edgeone/makers → 项目 `personal-invest-os` → **Build & Deploy → New Deployment** → 选择/拖入 zip → 部署 → 等 Success。新部署域名形如 `https://personal-invest-os-<deployId>.edgeone.dev`。
8. **验证并交付**：浏览器打开新部署域名，确认页面渲染、账号面板显示「未登录」+ 登录表单。

> EdgeOne Git 导入/构建遇到问题时，可暂时沿用手动上传；火山 IGA Pages 也保留为备选。

## 6. 数据库迁移（仅结构变更时需要）

- 迁移文件：`supabase/migrations/202610180001_user_portfolios.sql`（建表 + RLS + 触发器，幂等可重跑）。
- 官方 Supabase：**必须手动执行**（自动化通道只读）——Dashboard → SQL Editor → New query → 粘贴文件内容 → Run。
- 火山（备选）：`apply_migration(name=<文件名>, query=<文件内容>, workspace_id, branch_id)`。
- 仅当线上提示「请检查数据库迁移和权限策略」或表结构变更时才执行；日常前端部署无需动数据库。

## 7. 安全约束（必须遵守）

- 前端构建**只**注入 `NEXT_PUBLIC_SUPABASE_URL` 与 `NEXT_PUBLIC_SUPABASE_ANON_KEY`。
- 绝不把 service role key、Postgres 密码、连接串写入 .env 或前端代码。
- EdgeOne 部署域名稳定可长期访问；火山预览链接为一次性 token，不要反复抓取消耗，交付前取新链接。

## 8. 交付前验证清单

- [ ] `tsc -b` 与 `vite build` 通过
- [ ] dist 含官方 Supabase URL 与 anon key，无特权变量、无旧火山引用
- [ ] EdgeOne 部署状态 Success（控制台确认）
- [ ] 线上页面显示「未登录」+ 登录表单（连接生效）
- [ ] 交付新部署域名，并提示官方迁移是否已执行

## 9. 常见问题

| 现象 | 处理 |
|---|---|
| 页面显示「未配置」 | 构建时未注入 URL/anon key，重新按第 4 步构建部署 |
| 登录后提示「检查数据库迁移」 | 官方项目未执行迁移，按第 5 节在 Dashboard 执行 |
| EdgeOne 新部署打不开 | 确认控制台部署状态 Success，域名以实际部署 ID 为准 |
| GitHub Action 跳过部署 | 检查上述三个 Repository variables 和 `EDGEONE_API_TOKEN` secret 是否已设置，再手动运行工作流 |
| 注册按钮不显示 | 受控注册默认关闭（`NEXT_PUBLIC_SUPABASE_SIGNUP_ENABLED=false`），如需开放改为 true 重新构建 |
