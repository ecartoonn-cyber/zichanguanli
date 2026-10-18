# 官方 Supabase 登录与个人云同步

> 2026-10-18 起，云同步后端为官方 Supabase 项目 `dosomrwbcxvponmawdrh`（URL `https://dosomrwbcxvponmawdrh.supabase.co`）。火山 Supabase 工作区旧版前端仍保留，但其绑定后端已不再作为主同步目标。

## 数据流与安全边界

- 前端通过 `@supabase/supabase-js` 使用 Supabase Auth 和公开 anon key（构建时注入 `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`）。
- 页面不会读取 `SUPABASE_SERVICE_ROLE_KEY`、`POSTGRES_URL`、数据库密码或连接串；Vite 构建会拒绝带有高权限特征的 `VITE_` / `NEXT_PUBLIC_` 环境变量，也拒绝把 service-role JWT 当作 anon key。
- 每个登录用户只读写 `public.user_portfolios` 中 `user_id = auth.uid()` 的一条资料。SQL 迁移撤销匿名角色权限，并给已登录用户加上逐行 RLS 策略。
- 保存使用 revision 乐观锁；若另一台设备先更新，页面暂停云同步并要求用户选本机或云端版本，避免无提示的最后写入覆盖。
- 首次登录不会自动上传或覆盖。登录后，用户需要明确选择上传本机资料、恢复云端资料或启用空白云端资料。启用后单项持仓/问卷修改会同步到云端。
- 云端资料包含产品代码、名称、金额、盈亏和问卷答案，属于敏感个人财务信息。不要将登录邮箱之外的账户凭据录入本应用。

## 在官方 Supabase 中初始化

1. 登录 https://supabase.com/dashboard ，打开项目 `dosomrwbcxvponmawdrh`。
2. 在 **SQL Editor** 执行 [`../supabase/migrations/202610180001_user_portfolios.sql`](../supabase/migrations/202610180001_user_portfolios.sql)（建表 + RLS + 触发器，幂等可重跑；只操作本应用私有表，不动其他表）。**这是云同步生效的最后一步，尚未执行。**
3. Auth 配置（可选但推荐）：Settings → Authentication → URL Configuration，把当前 EdgeOne 访问域名加入 Site URL 与 Redirect URLs，否则邮箱确认/密码重置链接可能无法回跳。密码重置邮件使用平台默认邮件服务即可起步。
4. 受控注册：注册开关由公开构建变量 `NEXT_PUBLIC_SUPABASE_SIGNUP_ENABLED` 控制，默认 `false`（前端无注册按钮）。需要新增账号时改为 `true` 重新构建部署，创建后改回 `false` 再部署；或在控制台 Auth → Users 邀请邮箱。
5. 部署后先用空资料测试登录、读写隔离和退出登录，再导入或上传真实持仓。所有设备登录同一账号后会使用同一份云端资料。

## 本地开发

复制 `.env.example` 为 `.env.local`，只填本地开发使用的官方 Supabase URL 和 anon key（公开）。不要把真实 `.env.local` 纳入版本控制。未配置时应用仍使用本机存储。

## 冲突处理

同步启用前，页面显示本机与云端持仓数量和云端更新时间。用户选择一侧作为本次来源；选择本机覆盖云端或云端覆盖本机之前会要求确认。该流程不做自动合并，也不保存历史快照。继续使用前请导出 JSON 备份。若另一台设备先保存，当前端会暂停同步并重新显示两份资料供选择。

## 当前限制

- 官方 Supabase 的 `user_portfolios` 迁移尚未执行（需在 Dashboard SQL Editor 手动执行；自动化通道只读）。
- 前端构建仅显式映射 Supabase URL 和 anon key，不把 service-role、数据库密码或连接串放入浏览器包。
- 云端同步仅保存当前清单与问卷，不记录交易流水或历史快照；没有行情定时更新和自动交易。
