---
name: Auto git push + VPS deploy command
description: User preference — after any code change, commit + push to GitHub, then hand them the exact VPS deploy command
type: feedback
---

**After any code change, always:**
1. Commit with a descriptive message (feat/fix/refactor/docs prefix)
2. `git push origin main`
3. Give the user the exact VPS deploy command they need to run

**Why:** User does not want to manually run `git add` / `git commit` / `git push` each time. They deploy via SSH to `root@46.202.166.89`, so I should hand them the ready-to-paste command.

**How to apply:**
- Stage specific files by name (never `git add -A` — may grab secrets/unrelated junk)
- Use HEREDOC for multi-line commit messages
- VPS command format depends on what changed:
  - Backend only: `cd /root/skynity && git pull && docker compose up -d --build backend`
  - Frontend only: `cd /root/skynity && git pull && docker compose up -d --build frontend`
  - Both: `cd /root/skynity && git pull && docker compose up -d --build backend frontend`
  - Docs / markdown / settings.json only: `cd /root/skynity && git pull && docker compose restart backend` (volume-mounted)
  - New npm deps: force rebuild with `--no-cache` hint only if user reports failure
- Mention which service is rebuilding and why so they know what to expect
- Never push to `main` with force; never skip hooks (`--no-verify`)

**Git author config:** `samimtsbd19-commits` (already set by user). Do not touch git config.
