# Personal Invest OS repository instructions

## Project deployment memory

- Repository: `ecartoonn-cyber/zichanguanli`; local checkout is `/Users/ka/Documents/理财管理`; production branch is `main`.
- EdgeOne Makers project `personal-invest-os` is directly linked to this GitHub repository and branch. A normal push to `origin main` triggers EdgeOne's own Git build/deployment.
- GitHub CLI (`gh`) is installed and authenticated on the user's Mac; Git uses the GitHub CLI credential helper and macOS Keychain. Check with `gh auth status`. Never ask the user to paste passwords, access tokens, or one-time codes into chat.
- When the user asks to implement and publish a change, work in the existing checkout, inspect `git status` and the diff, make the requested change, run the applicable production build, commit to `main`, and push with `git push origin main`. Do not force-push. Avoid empty commits unless the user specifically asks to trigger a deployment without source changes; prefer EdgeOne's retry/redeploy control in that case.
- After pushing, verify the corresponding EdgeOne deployment in its console/logs when accessible. Record the EdgeOne deployment ID and resulting URL only when observed. A Git commit SHA, GitHub Actions run ID, and EdgeOne deployment ID are distinct identifiers.
- Do not report a GitHub Actions run as a successful deployment based on its top-level `success` conclusion alone. Inspect the Checkout, Build, and Deploy steps. If those steps are `skipped`, no deployment occurred through Actions.
- `.github/workflows/deploy-edgeone.yml` is a separate fallback path. It requires repository variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_SIGNUP_ENABLED` and secret `EDGEONE_API_TOKEN`. Missing Supabase URL or Publishable key causes build/deploy steps to skip.
- Supabase URL currently documented for this project: `https://dosomrwbcxvponmawdrh.supabase.co`. Use only the public anon/Publishable key in frontend build variables; never expose `service_role`, `sb_secret_`, database passwords, or connection strings.

## Build portability

- Never add a machine-specific absolute cache path to `pnpm-workspace.yaml`, `.npmrc`, or other shared build configuration. In particular, do not restore `storeDir: /Users/ka/Library/pnpm/store/v11`.
- EdgeOne builds run in a Linux container and must use the container's default writable pnpm store. The absolute macOS `storeDir` caused `EACCES: permission denied, mkdir '/Users'`; removing it in commit `5326d4a` resolved the user's reported EdgeOne build failure.

## Product safety

- This is an investment tracking and research-assistance app. No automated trading or account transactions are in scope.
- Do not upload, reveal, or commit personal holdings or credentials. Keep financial data local unless the user explicitly requests enabling authenticated cloud sync.
