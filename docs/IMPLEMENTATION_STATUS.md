# 实施状态

截至 2026-10-18，本项目在原静态原型基础上建立了本地模块化 MVP，并已部署到火山引擎 Supabase（IGA Pages 静态托管）。用户确认暂不做表格/批量持仓录入；云同步所需的数据表迁移已在目标工作区执行，Auth 登录已随新版本上线，用户数据仍在本机浏览器、未上传云端。

## 已完成

- Vite + React + TypeScript 模块化基础结构。
- 单项持仓录入：平台、产品代码、名称核验/手工标记、产品与资产分类、市场范围、当前金额、币种、盈亏口径与日期。
- 基金和 A 股代码名称查询尝试；查名失败保留原名称，编辑产品代码后核验状态重置。
- 本机浏览器保存、JSON 备份导出与显式确认后导入；旧版 MVP JSON 数据迁移支持。
- 理财体检问卷，保存目标、期限、现金需求、备用金、风险感受，不推导交易指令。
- 按产品类型和市场范围展示分组收益估算、币种拆分和累计盈亏数据覆盖数；正负收益以零线图表示。
- AI 研究 Prompt 预览和确认后复制；包含数据核验、时效、证据、反方观点、方案比较和不操作选项等约束。
- 登录后个人云同步代码与 RLS SQL 迁移已加入；迁移已在目标工作区执行，新版本已部署上线，登录表单在线上可见；端到端（真实账号登录 + 上传数据）尚未验收。
- 持仓按金额日期倒序展示并标记距今时间；日期不可填到未来，同平台重复代码会先提醒确认；查名过程中锁定代码/产品类型/名称字段，避免异步结果覆盖用户编辑。
- 无交易功能；不自动连接银行、支付平台、券商或账户。
- 2026-10-18 部署上线：火山引擎 Supabase IGA Pages 静态托管，工作区 personal-invest-os（glad-apple-e94f93e1），Pages 项目 personal-invest-os（q17ilxk1hv），绑定 main 分支；最新部署 y9tqz1qu3n 已注入 Supabase URL + anon key，线上登录表单正常显示。

## 尚未实现

- 完整组合风险穿透：基金底层持仓、行业/国家敞口、跨产品重叠、集中度和目标配置偏离。
- 实时/定时行情净值更新及收盘后收益更新。
- 自动定时市场研究与提醒。
- 应用内模型调用。当前须用户确认后复制 Prompt 到 ChatGPT；模型不能直接读取此浏览器的本地持仓。
- 火山 Supabase Auth 自定义域名 / 邮件服务配置与线上云同步端到端验收（真实账号登录 + 上传数据）。
- 表格/CSV/批量持仓录入：明确不属于本期范围。

## 本地开发与检查

- `pnpm install`
- `pnpm dev`
- `pnpm test`
- `pnpm build`

原本地模块的 8 项单元测试通过；加入云同步后 TypeScript 检查、Vite 生产构建与 8 项单元测试均通过（2026-10-18 复跑）。没有连接 Supabase 写入测试持仓。

## 云同步实现状态

- 单用户资料表迁移：`supabase/migrations/202610180001_user_portfolios.sql`，按登录用户隔离、启用 RLS、拒绝匿名访问。
- Vite 构建只显式映射 Supabase URL 与 anon key；拒绝公开前缀变量名包含 service role、Postgres、password 等权限特征，也会拒绝把 service-role JWT 当作 anon key。
- 登录支持邮箱密码、由构建变量控制的注册与密码重置；注册默认关闭。
- 首次云同步显式选择本机或云端数据；后续写入用 revision 乐观锁发现多设备并发。
- 迁移已在目标工作区 main 分支执行（apply_migration 202610180001_user_portfolios，2026-10-18）；Auth 登录已随新版本上线，页面已验证显示「未登录」+ 登录表单。端到端读写（真实账号登录后上传/恢复资料）尚未验收，未写入任何用户数据。

## 线上部署（2026-10-18）

- 平台：火山引擎 AI 原生 BaaS 平台（Supabase 版）· IGA Pages 静态托管。
- 工作区：`personal-invest-os`（glad-apple-e94f93e1）· cn-beijing · Supabase_1_24 · Running。
- Pages 项目：`personal-invest-os`（q17ilxk1hv）· 部署状态 DeploySuccess · 历史部署 6jsishbtok / y9tqz1qu3n（最新）。
- 绑定：工作区默认分支 `main`（br-fancy-sika-899917f4），已注入 POSTGRES_* / SUPABASE_* 环境变量。
- 部署内容：`pnpm build` 产物 dist（index.html + assets，约 493 KB，含 @supabase/supabase-js）。
- 连接变量：构建时注入 `NEXT_PUBLIC_SUPABASE_URL` 与 `NEXT_PUBLIC_SUPABASE_ANON_KEY`（anon key 为浏览器公开 key；service role key / Postgres 密码从未进入构建，vite 配置含特权变量拦截保护）。
- 数据库迁移：已执行 `202610180001_user_portfolios`（user_portfolios 表 + RLS 行级安全 + updated_at 触发器），云同步数据库结构就绪。
- 验证：线上抓取确认页面正常渲染（标题「我的投资体检台」；账号面板显示「未登录」+ 登录表单，连接变量生效）。
- 预览链接：一次性 token、短期有效，失效后需重新生成；控制台入口：https://console.volcengine.com/aidap/region:aidap+cn-beijing/workspaces
- 用户数据：持仓 / 问卷仍在本机浏览器，未上传；首次登录时应用会显式询问选择上传本机或恢复云端，不会静默覆盖。现有环境绑定中的敏感服务密钥不得暴露给浏览器。

## EdgeOne 迁移（官方 Supabase 后端，2026-10-18）

- 前端托管迁移到 EdgeOne Makers：项目 `personal-invest-os`（makers-l7akpc0tkpgz），部署 `dp2erx2b4adl`，状态 Success，访问地址 `https://personal-invest-os-dp2erx2b4adl.edgeone.dev`（全球加速，中国大陆除外）。
- 后端切换为官方 Supabase 项目 `dosomrwbcxvponmawdrh`（URL `https://dosomrwbcxvponmawdrh.supabase.co`）；构建注入其 anon key（公开），登录表单已在 EdgeOne 线上验证显示「未登录」，连接生效。
- 官方 Supabase 数据库迁移：**待用户在 Dashboard SQL Editor 手动执行**（MCP 通道只读无法建表）；SQL 与步骤见对话记录，执行后云同步（user_portfolios + RLS + 触发器）方在官方后端生效。
- 火山 IGA Pages 旧版（连火山工作区）保留可访问，未删除；后续如需下线可再处理。

## EdgeOne 修复版部署（官方 Supabase 后端，2026-10-18）

排查结论（线上实测 + 官方 Supabase 只读核查）：

1. **登录失败的根因 = 邮箱未确认**。目标账号尚未确认邮箱时，Supabase 默认会拒绝登录并返回 `Invalid login credentials`。前端已对此显示中文提示（指明先到 Dashboard → Authentication → Users 确认邮箱）。
2. **「编辑持仓不能用」实为 UX 缺陷，功能正常**。页面含 40 项持仓时表单渲染在持仓列表下方（实测 top=4436px、视口 908px，完全不可见）；点击「添加/编辑」后页面不会自动滚动到表单，用户误以为失效。已修复：打开表单时 `scrollIntoView({behavior:'smooth', block:'start'})` 并聚焦第一个输入框（线上验证 top 4436→772px、表单进入视口、自动聚焦「支付宝」下拉）。
3. RLS 4 条策略（portfolio_select/insert/update/delete_own）已在官方库确认存在，迁移已生效。

- 新部署：`dpclhix9460m`，状态 Success，访问地址 `https://personal-invest-os-dpclhix9460m.edgeone.dev`（修复版，推荐访问）；旧部署 `dp2erx2b4adl` 仍在线指向旧版。
- 构建验证：tsc 通过、vite build 成功（`index-b7dKkAkP.js`）、单元测试 8/8 通过。
- **待用户操作（登录仍不可用）**：
  1. Supabase Dashboard → Authentication → Users → 对目标账号点击 **Confirm** 确认邮箱；
  2. 若不知道密码：Authentication → URL Configuration 把 `Site URL` 与 `Redirect URLs` 加入 EdgeOne 域名（https://personal-invest-os-*.edgeone.dev），再到登录页用「忘记密码」重置；
  3. 完成后用真实密码登录，端到端验收云同步（登录后首次提示选择上传本机或恢复云端）。

## 输入框焦点与自动部署说明（2026-10-18）

- 修复持仓表单输入焦点：原先表单状态每次变化都会触发打开表单时的聚焦逻辑，输入一个字符就将焦点重新放到「平台」下拉框；现在只在表单从关闭变为打开时滚动和聚焦。此修复需重新构建并发布后才会出现在 EdgeOne 线上。
- EdgeOne Makers 支持 Git 仓库集成及生产分支提交自动部署。当前工作区 `.git` 还没有提交记录，也未配置远端仓库；需要用户指定/创建 GitHub、Gitee 或 Coding 仓库并在 EdgeOne 导入关联，之后日常推送到配置分支即可触发构建部署。
- 推荐构建设置：`pnpm install --frozen-lockfile && pnpm build`，产物目录 `dist`。在 EdgeOne 构建环境配置 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`（或对应 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`）和 `NEXT_PUBLIC_SUPABASE_SIGNUP_ENABLED`；只配置公开 anon/publishable key，禁止放入 service role、数据库密码等服务端密钥。

## 数据迁移

启用云同步后首次登录会显示本机和云端记录数量，必须明确选用一侧；应用不自动合并或覆盖。建议先导出本机 JSON 备份。云端同步启用后，每次更改会同时保存本机和 Supabase；如果网络失败，本机版本保留并显示同步错误。

原单文件 HTML 和模块化应用使用不同的浏览器存储空间。若原型中已有真实数据，请先从原型导出 JSON，再在新应用里通过“导入备份”恢复。导入会替换当前本地数据，必须先导出现有备份。不要通过清理浏览器数据来迁移。
