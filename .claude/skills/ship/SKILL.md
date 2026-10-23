---
name: ship
description: Ship finished work for Sklopko. Use when a feature or fix the user asked for is implemented and ready to push: branch, bump the version, run the scoped tests, push, open a PR, wait for CI, then ask before merging. Do not use for plans, questions, exploration or investigation, or when the user said not to push.
argument-hint: "[branch-slug]"
---

# Ship the current work

Follow the project rules in `CLAUDE.md` (versioning, workflow, testing). This skill is the checklist; if it ever disagrees
with `CLAUDE.md`, `CLAUDE.md` wins. `$ARGUMENTS`, if given, is the branch slug.

1. **Branch.** Never commit to `main`. If on `main`, create a feature branch named after the work (`$ARGUMENTS`, or e.g.
   `m10a-tristate`). If already on a feature branch, stay on it. If the working tree has nothing to ship, stop and say so.
2. **Version.** Bump once per PR, not once per push: if `package.json` already differs from `origin/main`'s version, skip this.
   Otherwise run `npm version prerelease --no-git-tag-version` (smallest bump, `0.0.1-N` → `0.0.1-N+1`). If `main` already
   reached that version, bump again past it. Change other parts of the version only when explicitly asked.
3. **Test, scoped as in `CLAUDE.md`** (quiet reporters; don't run the whole e2e suite locally):
   - `npm test -- --reporter=dot` (all unit tests)
   - `npx oxlint <changed files>`
   - `npx tsc -b` when types or signatures changed
   - `npx playwright test --reporter=line e2e/<spec>.spec.ts` for each e2e spec file covering the changed area (whole files, not
     `-g`). If Playwright can't find its Chromium, prefix with `PW_CHROMIUM=/opt/pw-browsers/chromium`.
   Fix failures before going on. Report anything you could not run.
4. **Commit and push.** Stage the changed files by name (no `git add -A` of unrelated files), commit with a descriptive message
   that ends with the attribution line from the session's system reminder, then `git push -u origin <branch>`. Retry a failed
   push on network errors only (2 s, 4 s, 8 s, 16 s).
5. **Open the PR** with `gh pr create` (title ends with the version, e.g. `(0.0.1-33)`). Use `.github/pull_request_template.md`
   if there is one; otherwise a short Summary and Test plan. End the body with the PR attribution line from the system reminder.
6. **Wait for CI:** `gh pr checks --watch`.
   - **Red:** read the log (`gh run view --log-failed`), fix the cause, re-run only the failed tests locally (`-g`), push, and
     wait again. Repeat until green. Don't bump the version again for these pushes.
   - **Green:** tell the user the result and the PR URL, and **ask whether to merge**. Merge only on their yes, with
     `gh pr merge --squash --delete-branch`, then `git checkout main && git pull`. Merging deploys to Cloudflare Pages.

Pitfalls on this machine (macOS): BSD `sed -i` fails without an argument for the backup suffix, so edit files with the Edit tool.
If a push is rejected because the `gh` token lacks the `workflow` scope, ask the user to refresh it (`gh auth refresh -s workflow`).
