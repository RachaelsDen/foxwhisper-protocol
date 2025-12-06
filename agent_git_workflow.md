# AI Agent Git & PR Workflow

This document defines mandatory rules for how AI agents interact with Git and GitHub in this repository.

The goals:
- Protect long-lived branches (`main`, `develop`, `epic/*`, etc.).
- Enforce short-lived, well-named branches for all work.
- Use consistent commit messages.
- Automatically open a GitHub Pull Request using GitHub MCP if available, or `gh` CLI as a fallback.

## 1. Protected Branches (DO NOT COMMIT HERE)
You must treat the following branches as protected:
- `main`
- `master`
- `develop`
- Any branch matching: `epic/*`
- Any branch matching: `release/*`

Rules:
- Never commit directly to these branches.
- Never push directly to these branches.
- Never open a PR from these branches.

If on a protected branch, you must sync it, create a new branch, and work there.

## 2. Branch Type Selection (feature / bugfix / chore)
Choose type based on the nature of work:
- `feature/` for new functionality or user-facing changes.
- `bugfix/` for fixes to logic, regressions, failing tests due to incorrect code.
- `chore/` for refactors, tooling, docs, CI, or maintenance.

Priority if ambiguous:
1. bugfix
2. feature
3. chore

## 3. Branch Naming Rules
Format:
```
<prefix>/<short-kebab-description>[-<optional-issue-id>]
```
Examples:
- `feature/add-user-settings-panel`
- `bugfix/handle-null-session-token`
- `chore/update-prettier-config`

## 4. Standard Workflow for Any Change
### 4.1. Ensure Git is configured
Set user identity if missing.

### 4.2. Sync the default branch
```
git fetch origin
git checkout main
git pull --ff-only origin main
```

### 4.3. Decide branch type and name
Analyze task → choose prefix → generate kebab summary → create branch.
```
git checkout -b <branch-name>
```

### 4.4. Apply changes
Keep scope small and coherent.

### 4.5. Stage only relevant files
Avoid `git add .`.

### 4.6. Commit message format
Use prefix types: `feat:`, `fix:`, `chore:`, `test:`.
```
git commit -m "<type>: <short description>"
```

## 5. Rebase Before Push
```
git fetch origin
git rebase origin/main
```

## 6. Push the Branch
```
git push -u origin HEAD
```
Never push protected branches.

## 7. Pull Request Creation
Use GitHub MCP when available; fallback to `gh` CLI.

### 7.1 Using MCP
Fill PR metadata → call tool → return PR URL.

### 7.2 Using gh CLI
```
gh pr create --base main --head <branch> --title "<title>" --body "<body>"
```
Include PR URL in output.

### 7.3 If No MCP or gh
Output instructions for a human with suggested PR details.

## 8. Safety & Sanity Checks
Run tests; report failures honestly.

## 9. Quick Summary Algorithm
1. Sync main.
2. Determine change type.
3. Create branch.
4. Edit & test.
5. Stage relevant files only.
6. Commit.
7. Rebase.
8. Push.
9. Create PR.
10. Summarize results.

