# 实施状态

截至 2026-10-18，本地实现已升级到 schema v3，包含多维分类、收益/金额占比钻取、可选配置目标、备份导入恢复点和交易日行情估算代码。当前工作树变更尚未推送或发布。最近确认成功的 EdgeOne 线上版本为 `dpargjupipe2`（提交 `5326d4a`），地址 `https://personal-invest-os-dpargjupipe2.edgeone.dev`。Supabase 行情迁移、Function 和 Cron 尚未部署；线上尚未自动更新行情。持仓数据仍以用户本地/已启用云同步资料为准。

## 已完成

- Vite + React + TypeScript 模块化基础结构。
- 单项持仓录入：平台、产品代码、名称核验/手工标记、产品与资产分类、市场范围、当前金额、币种、盈亏口径与日期。
- 基金和 A 股代码名称查询尝试；查名失败保留原名称，编辑产品代码后核验状态重置。
- 本机浏览器保存、JSON 备份导出与显式确认后导入；旧版 MVP JSON 数据迁移支持。
- 理财体检问卷，保存目标、期限、现金需求、备用金、风险感受，不推导交易指令。
- 按产品类型和市场范围展示分组收益估算、币种拆分和累计盈亏数据覆盖数；正负收益以零线图表示。
- 多维资产分类与收益分析：分析资产类别、市场/地区、行业、流动性、平台、币种；同币种内成本加权，并可按维度钻取、看金额占比和累计盈亏覆盖。
- 可选配置目标按币种保存，校验目标合计 100%，展示当前资产类别比例与偏离；不会自动推导目标。
- AppState schema v2 → v3 本地/云端迁移；旧分类不确定时迁到“未知”；金额、盈亏、日期与持仓身份保留。
- 备份导入增加数量/金额/增删预览，并在导入前保存本地恢复点；可从页面恢复。
- 行情估算前后端代码：公开腾讯证券接口支持 A 股/沪深 ETF，东方财富公开基金净值接口支持场外基金；建立基准后按价格估算金额/盈亏，保留来源、日期、状态和幂等日记录。海外与银行产品目前显示不支持。
- Supabase SQL 迁移新增全局行情、用户跟踪基准、日估算和任务运行表，均按 RLS 保护；定时函数含用户鉴权、失败状态、重试上限和手动刷新接口。
- AI 研究 Prompt 预览和确认后复制；包含数据核验、时效、证据、反方观点、方案比较和不操作选项等约束。
- 登录后个人云同步代码与 RLS SQL 迁移已加入；迁移已在目标工作区执行，新版本已部署上线，登录表单在线上可见；端到端（真实账号登录 + 上传数据）尚未验收。
- 持仓按金额日期倒序展示并标记距今时间；日期不可填到未来，同平台重复代码会先提醒确认；查名过程中锁定代码/产品类型/名称字段，避免异步结果覆盖用户编辑。
- 无交易功能；不自动连接银行、支付平台、券商或账户。
- 2026-10-18 部署上线：火山引擎 Supabase IGA Pages 静态托管，工作区 personal-invest-os（glad-apple-e94f93e1），Pages 项目 personal-invest-os（q17ilxk1hv），绑定 main 分支；最新部署 y9tqz1qu3n 已注入 Supabase URL + anon key，线上登录表单正常显示。

## 尚未部署或尚待完善

- Supabase 行情迁移、`market-data` Edge Function 和 Vault/Cron 配置；部署步骤见 `MARKET_DATA_SETUP.md`。函数 CLI 当前环境不可用，未实际部署到云端。
- Supabase 交易日任务真实运行验收、免费接口在 Supabase 出网的可达性/条款核验；公开网页接口可能变更或延迟。
- 海外证券与银行理财行情暂不支持；底层基金持仓、跨产品重叠分析尚未实现。
- 自动定时市场研究与提醒。
- 应用内模型调用。当前须用户确认后复制 Prompt 到 ChatGPT；模型不能直接读取此浏览器的本地持仓。
- 火山 Supabase Auth 邮件设置与真实账号云同步端到端验收。
- 表格/CSV/批量持仓录入：明确不属于本期范围。

## 本地开发与检查

- `pnpm install`
- `pnpm dev`
- `pnpm test`
- `pnpm build`

当前实现本地 TypeScript 检查、Vite 生产构建通过；Vitest 14/14 通过。尚未连接 Supabase 运行迁移、Edge Function 或 RLS 实账测试，也未使用真实持仓数据验收。

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

## Git 与 EdgeOne 自动部署（2026-10-18）

- GitHub 仓库：`ecartoonn-cyber/zichanguanli`；生产分支：`main`。本地 GitHub CLI（`gh`）已登录并配置为 Git 凭据助手。
- EdgeOne Makers 项目 `personal-invest-os` 已直接关联该仓库/分支；日常 `git push origin main` 会触发 EdgeOne Git 构建与部署。
- 表单输入焦点修复包含在 `4946c7e`；随后 EdgeOne 构建失败的根因是 `pnpm-workspace.yaml` 把 storeDir 写死成 Mac 路径 `/Users/ka/Library/pnpm/store/v11`。`5326d4a` 删除了该配置，恢复 pnpm 在构建容器中的默认可写缓存位置；本地 `pnpm build` 通过，用户确认 EdgeOne 对该提交的后续 Git 构建成功。最新 EdgeOne 部署 ID 尚未记录。
- 仓库 `.github/workflows/deploy-edgeone.yml` 是独立备用部署流程，不等同于 EdgeOne 原生 Git 集成。提交 `5326d4a` 对应的 Actions run 显示 `success`，但其 Checkout、Build、Deploy 步骤均 `skipped`，原因是 GitHub Repository variables 中缺少 Supabase URL 与 Publishable key；不能把工作流 `success` 误报为实际部署成功。
- 后续发布操作顺序、认证、部署核验和常见错误处理见 [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md)。发布完成后记录 EdgeOne 控制台给出的实际部署 ID；Git commit SHA、GitHub Actions run ID 和 EdgeOne deployment ID 分别记录。

## 数据迁移

启用云同步后首次登录会显示本机和云端记录数量，必须明确选用一侧；应用不自动合并或覆盖。建议先导出本机 JSON 备份。云端同步启用后，每次更改会同时保存本机和 Supabase；如果网络失败，本机版本保留并显示同步错误。

原单文件 HTML 和模块化应用使用不同的浏览器存储空间。若原型中已有真实数据，请先从原型导出 JSON，再在新应用里通过“导入备份”恢复。导入会替换当前本地数据，必须先导出现有备份。不要通过清理浏览器数据来迁移。

## 板块估值模块（2026-10-20/21）

**已上线**：EdgeOne 部署 `dpi3b2prs3yd`（提交 `4aa0541`），访问 `https://personal-invest-os-dpi3b2prs3yd.edgeone.dev`；线上实测板块估值面板正常渲染（因数据表未建，按设计显示「读取失败…请确认已执行迁移 SQL」指引）。

- 前端：`src/services/sectorValuation.ts`（anon 只读最新 as_of_date 快照）+ `src/App.tsx` 内 `SectorValuationPanel`（排序、双指数仪表条、信号灯、因子分解、空态/错误指引）+ `src/styles.css`（sector-* 样式）。
- 数据源与算法：申万一级 31 行业；乐咕乐股行业 PE/PB/股息率+历史分位、申万指数日线（近1月/3月/年初涨跌）、沪深300 PE 与 10 年国债的股债利差分位。抄底指数 = 0.3·(100−PE分位)+0.3·(100−PB分位)+0.2·股债利差分位+0.1·clamp(−近3月涨跌×4)+0.1·股息率分位；风险指数 = 0.3·PE分位+0.3·PB分位+0.25·clamp(近1月涨跌×3)+0.15·(100−股息率分位)；分位缺失按 50。启发式打分，非投资建议。
- 快照脚本：`scripts/sector_valuation.py`，`--dry-run` 实测 31 行业全通（2026-10-20 数据）；写库需 `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`，POST `/rest/v1/sector_valuation?on_conflict=sector_code,as_of_date` + `Prefer: resolution=merge-duplicates`。
- 每日任务：`.github/workflows/sector-valuation.yml`（cron `30 15 * * *` UTC = 每天 23:30 北京时间 + workflow_dispatch；变量 `NEXT_PUBLIC_SUPABASE_URL` + 密钥 `SUPABASE_SERVICE_KEY`，缺失则跳过并提示）。
- 迁移：`supabase/migrations/202610200001_sector_valuation.sql`（unique(sector_code, as_of_date) 供 upsert；RLS：anon/authenticated 只读 + 索引）。**尚未在官方 Supabase Dashboard 执行**（官方 MCP execute_sql 只读，无法代跑）。
- 构建验证：tsc 通过、vite build 成功（`index-UJiOP-Wp.js` + 独立 supabase chunk + `index-FR3v-c03.css`）、Vitest 14/14 通过；本地 preview 实测无连接/表未建两态提示正确。

**待用户操作（数据生效链路，两项缺一不可）**：
1. Supabase Dashboard → SQL Editor 粘贴执行 `supabase/migrations/202610200001_sector_valuation.sql`；
2. GitHub 仓库 Settings → Secrets and variables → Actions：新增变量 `NEXT_PUBLIC_SUPABASE_URL`（https://dosomrwbcxvponmawdrh.supabase.co）与密钥 `SUPABASE_SERVICE_KEY`（Dashboard → Settings → API → service_role，只进 repo secret 与本地 env，绝不进前端），然后在 Actions 页手动 Run workflow 一次（或等次日 23:30 自动执行）。完成后前端面板即显示各行业估值与双指数。
- 说明：Actions 顶层 success 不代表部署/写库成功；每日任务需核对其日志。`SUPABASE_SERVICE_KEY` 有完整写库权限，只配置为 Actions secret，不要暴露给浏览器。
