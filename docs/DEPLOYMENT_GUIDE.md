# Personal Invest OS · Git 推送与 EdgeOne 部署

更新日期：2026-10-18。

## 当前部署方式

主流程是 **本地 Git → GitHub `main` → EdgeOne Git 关联自动构建和部署**。

| 项目 | 当前记录 |
|---|---|
| 本地仓库 | `/Users/ka/Documents/理财管理` |
| GitHub | [`ecartoonn-cyber/zichanguanli`](https://github.com/ecartoonn-cyber/zichanguanli)，生产分支 `main` |
| EdgeOne Makers | `personal-invest-os`（`makers-l7akpc0tkpgz`），已关联上述仓库/分支 |
| 构建命令 | `pnpm install`，`pnpm build` |
| 构建产物 | `dist/` |
| 后端 | 官方 Supabase `dosomrwbcxvponmawdrh` |
| 最近确认的代码 | `5326d4a Fix EdgeOne pnpm store path`；用户确认该次 EdgeOne Git 构建成功，部署 ID 未记录 |

最近确认成功的部署为 `dpargjupipe2`，地址为 `https://personal-invest-os-dpargjupipe2.edgeone.dev/`。本次未提交的本地功能变更不在该线上版本内。每次新部署的 ID 和部署专属地址以 EdgeOne 控制台最新部署记录为准；如有稳定自定义域名，优先使用自定义域名。

## 日常发布操作

用户明确要求发布/推送时，在本地仓库完成变更、检查并提交到 `main`。本机 GitHub CLI 已安装并授权；凭据由 GitHub CLI/macOS Keychain 管理，不要把密码、token 或验证码写入项目文件或聊天。

```sh
gh auth status
git status --short --branch
git diff --check
pnpm build
git add <本次修改的文件>
git commit -m "简要描述修改"
git push origin main
```

若 Git 报认证错误，先运行 `gh auth login` 完成浏览器登录，再运行 `gh auth setup-git`，最后重试推送。不要使用 `git push --force` 覆盖远端历史。不要为了触发部署而默认创建空提交；优先使用 EdgeOne 控制台的重试/重新部署功能，或在有实际修改时正常推送。

推送后检查 EdgeOne 控制台 **Build & Deploy / Deployments**：确认对应提交的构建日志、部署状态 `Success`，并记录 EdgeOne 部署 ID 和最终访问地址。访问线上页面确认标题、登录表单和关键页面可用。GitHub commit SHA、GitHub Actions run ID 与 EdgeOne deployment ID 是不同标识，不能混称。

## pnpm 配置约束

- `pnpm-workspace.yaml` 不得写入开发机专属的绝对缓存路径，例如 `/Users/<用户名>/Library/pnpm/store/...`。EdgeOne Linux 构建容器没有 macOS `/Users` 路径，曾因此报 `EACCES: permission denied, mkdir '/Users'`。
- 让 pnpm 在 EdgeOne 构建容器中使用默认缓存目录。该修复已在提交 `5326d4a` 删除 `storeDir: /Users/ka/Library/pnpm/store/v11`；用户确认后续 EdgeOne Git 构建成功。
- 不要把本机绝对路径写入影响构建的配置文件。文档中的本机路径仅用于说明本机仓库位置。

## EdgeOne 与 GitHub Actions 的区别

- **主流程**：EdgeOne 自己关联 GitHub `main` 并执行构建/部署；部署 ID 在 EdgeOne 控制台产生和查看。
- **备用流程**：`.github/workflows/deploy-edgeone.yml` 会尝试由 GitHub Actions 构建并通过 EdgeOne CLI 部署。它需要 GitHub `Settings → Secrets and variables → Actions` 中的变量 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`NEXT_PUBLIC_SUPABASE_SIGNUP_ENABLED`，以及 secret `EDGEONE_API_TOKEN`。
- Supabase URL 当前记录为 `https://dosomrwbcxvponmawdrh.supabase.co`；anon/publishable key 从对应 Supabase 项目的 Settings → API Keys 获取，只能使用公开 Publishable/anon key，禁止使用 `service_role` 或 `sb_secret_`。
- GitHub Actions 的 `success` 只表示工作流本身没有失败；如果 `Checkout`、`Build`、`Deploy to the existing EdgeOne project` 显示 `skipped`，就没有通过 Actions 部署。提交 `5326d4a` 的 Actions run `39106864689` 就是这种情况：因缺少 Supabase URL 和 Publishable key 两个 Repository variables，构建与部署步骤跳过。EdgeOne 原生 Git 构建是独立流程。
- 如果未来决定使用 Actions 作为主部署流程，先补齐上述 GitHub 配置，再运行工作流并确认 Build/Deploy 步骤确实执行；同时可关闭 EdgeOne 原生 Git 自动部署，避免重复构建和重复发布。

## Supabase 和安全边界

- 前端构建只注入 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY` 和注册开关 `NEXT_PUBLIC_SUPABASE_SIGNUP_ENABLED`（默认 `false`）。anon/Publishable key 是浏览器公开配置。
- 绝不将 Supabase `service_role` key、数据库密码或连接串放进前端构建、Repository variables、源码或日志。
- `EDGEONE_API_TOKEN` 只应保存在 GitHub Actions secret 或 EdgeOne 平台的安全变量中；不要提交到 Git。
- 数据库结构未变化时，普通前端发布不需要重新执行 Supabase SQL 迁移。

## 部署失败时

1. 先区分失败发生在 EdgeOne Git 构建、GitHub Actions 备用构建，还是线上运行阶段。
2. 查看失败阶段和完整错误上下文。若 pnpm 提示无法在 `/Users` 创建目录，检查 `pnpm-workspace.yaml` 和 `.npmrc` 是否残留本机绝对路径，并删除该机器专属 store 配置后正常提交推送。
3. 若 GitHub Actions 中 Supabase 配置检查未通过，按上一节设置缺少的公开变量；不要将 `success` 总结成已经部署。
4. 构建成功后，仍需以 EdgeOne 控制台的部署状态和线上页面验证作为部署完成依据。

## 历史备用方式

若 Git 集成不可用，可在 EdgeOne Makers 控制台的 `personal-invest-os` 项目中手动上传 `dist/` 或按平台提供的流程重试部署。手动部署也应记录 EdgeOne 部署 ID，并确认生产页面可访问。火山 IGA Pages 旧部署继续保留，除非用户明确要求，不要删除。
