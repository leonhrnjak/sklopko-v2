---
name: ship
description: Ship finished work for Sklopko. Use when a feature or fix the user asked for is implemented and ready to push: branch, run the scoped tests, push, open a PR, wait for CI, then ask before merging. Do not use for plans, questions, exploration or investigation, or when the user said not to push.
argument-hint: "[branch-slug]"
---

# Ship the current work

Follow the project rules in `CLAUDE.md` (versioning, workflow, testing). This skill is the checklist; if it ever disagrees
with `CLAUDE.md`, `CLAUDE.md` wins. `$ARGUMENTS`, if given, is the branch slug.

1. **Branch.** Never commit to `main`. If on `main`, create a feature branch named after the work (`$ARGUMENTS`, or e.g.
   `m10a-tristate`). If already on a feature branch, stay on it. If the working tree has nothing to ship, stop and say so.
2. **Version.** Nothing to do: the shown version is built from the commit count (see `CLAUDE.md`), so a PR does not bump it.
3. **Test, scoped as in `CLAUDE.md`** (quiet reporters; don't run the whole e2e suite locally):
   - `npm test -- --reporter=dot` (all unit tests)
   - `npx oxlint <changed files>`
   - `npx tsc -b` when types or signatures changed
   - `npx playwright test --reporter=line e2e/<spec>.spec.ts` for each e2e spec file covering the changed area (whole files, not
     `-g`). If Playwright can't find its Chromium, prefix with `PW_CHROMIUM=/opt/pw-browsers/chromium`.
   Fix failures before going on. Report anything you could not run.
4. **Commit and push.** Stage the changed files by name (no `git add -A` of unrelated files), commit with a descriptive message
   with no attribution trailers (see CLAUDE.md, "No Claude attribution on GitHub"), then `git push -u origin <branch>`. Retry a failed
   push on network errors only (2 s, 4 s, 8 s, 16 s).
5. **Screenshots, then open the PR.**
   - **Screenshots** of everything the change makes visible (new screen, changed screen: before and after; a phone view when the layout
     changed). With the app running (`npx vite --port 5199`): `node scripts/screenshot.mjs /some-example shot.png` (add
     `PW_CHROMIUM=/opt/pw-browsers/chromium` if Playwright lacks a browser); for a state that needs clicking, a throw-away
     Playwright script that calls `page.screenshot()`. Look at each picture before using it. Keep them small (viewport only).
   - **Upload them** to the `pr-assets` branch, which holds only pictures (images never go on the feature branch or on `main`):
     ```sh
     git fetch origin pr-assets 2>/dev/null || true
     git worktree add /tmp/pr-assets pr-assets 2>/dev/null || git worktree add --orphan -b pr-assets /tmp/pr-assets
     mkdir -p /tmp/pr-assets/<branch>/ && cp shot*.png /tmp/pr-assets/<branch>/
     git -C /tmp/pr-assets add -A && git -C /tmp/pr-assets commit -m "Screenshots for <branch>" && git -C /tmp/pr-assets push -u origin pr-assets
     git worktree remove /tmp/pr-assets
     ```
     and show each one in the description as
     `![what it shows](https://github.com/<owner>/<repo>/blob/pr-assets/<branch>/shot.png?raw=true)`.
   - **Open the PR** (`gh pr create`, or the GitHub tool when `gh` is not available). The title has no version.
     The body follows `.github/pull_request_template.md`, all five sections: *What this adds* (two or three sentences for someone who has
     not read the code), *How it works* (short, technical), *How to test* (numbered steps a person can follow), *Screenshots* (or "No
     visible change." with a line why), *Checks* (what was run). No attribution footer or session link.
6. **Wait for CI:** `gh pr checks --watch`.
   - **Red:** read the log (`gh run view --log-failed`), fix the cause, re-run only the failed tests locally (`-g`), push, and
     wait again. Repeat until green.
   - **Green:** tell the user the result and the PR URL, and **ask whether to merge**. Merge only on their yes, with
     `gh pr merge --squash --delete-branch`, then `git checkout main && git pull`. Merging deploys to Cloudflare Pages.

Pitfalls on this machine (macOS): BSD `sed -i` fails without an argument for the backup suffix, so edit files with the Edit tool.
If a push is rejected because the `gh` token lacks the `workflow` scope, ask the user to refresh it (`gh auth refresh -s workflow`).
