---
name: pr-review-merge
description: >-
  Review, validate, comment, approve, and safely merge GitHub Pull Requests.
  Use when the user asks to review a PR, inspect PR diffs, check security or code quality,
  verify CI/CD checks, submit reviews, approve, or merge pull requests into main.
---

# PR Review & Merge Skill

This skill provides step-by-step procedures and automation helpers for reviewing and merging Pull Requests in GitHub repositories (specifically `mobinice/Hacksong`).

## Quick Command Reference

- **Review PR**: `./scripts/review_pr.sh <PR_NUMBER>`
- **Merge PR**: `./scripts/merge_pr.sh <PR_NUMBER> [squash|merge|rebase]`

---

## Workflow Steps

### Step 1: Discover and Inspect Pull Request

1. List active pull requests:
   ```bash
   gh pr list -R mobinice/Hacksong
   ```
2. View PR summary and details:
   ```bash
   gh pr view <PR_NUMBER> -R mobinice/Hacksong
   ```
3. Inspect complete code diff:
   ```bash
   gh pr diff <PR_NUMBER> -R mobinice/Hacksong
   ```

---

### Step 2: Thorough Code Review & Verification

Review the changes using the [PR Review Checklist](./references/checklist.md). Ensure the following:

1. **Security & Secrets Check (Critical)**:
   - Ensure NO AWS credentials, access keys (`AKIA*`, `ASIA*`), secret keys, or session tokens are introduced.
   - Ensure `.env`, private keys (`*.pem`, `*.key`), and sensitive documents (`RESTORE*`) are NOT committed.
   - Verify that `.gitignore` patterns remain intact.
2. **Functional & Regression Check**:
   - Verify frontend functionality: HTML structure, JS logic, CSS styling.
   - Verify that assets and relative links (e.g., `assets/...`) resolve properly.
3. **CI / Status Checks**:
   - Check if automated CI runs are passing:
     ```bash
     gh pr checks <PR_NUMBER> -R mobinice/Hacksong
     ```

---

### Step 3: Provide Structured Review Feedback

Submit feedback using GitHub CLI:

- **Approve**:
  ```bash
  gh pr review <PR_NUMBER> -R mobinice/Hacksong --approve -b "LGTM! Verified security, code quality, and functionality."
  ```
- **Request Changes**:
  ```bash
  gh pr review <PR_NUMBER> -R mobinice/Hacksong --request-changes -b "Please address the following issues before merging: ..."
  ```
- **Comment**:
  ```bash
  gh pr review <PR_NUMBER> -R mobinice/Hacksong --comment -b "Review comments: ..."
  ```

---

### Step 4: Safe Merge Procedure

When approved and all checks pass:

1. Merge using the helper script or `gh pr merge`:
   ```bash
   # Using squash merge and deleting head branch
   gh pr merge <PR_NUMBER> -R mobinice/Hacksong --squash --delete-branch
   ```
2. Pull latest `main` locally:
   ```bash
   git checkout main
   git pull origin main
   ```
3. **Deploy to EC2 (Optional / Prompt User)**:
   If the merged changes should be deployed to production/EC2 immediately, create and push a `deploy_*` tag:
   ```bash
   git tag deploy_$(date +%Y%m%d_%H%M%S)
   git push origin --tags
   ```
