#!/bin/bash
set -e

REPO="mobinice/Hacksong"
PR_ID="$1"

if [ -z "$PR_ID" ]; then
  echo "Usage: $0 <PR_NUMBER>"
  echo "Open Pull Requests:"
  gh pr list -R "$REPO"
  exit 1
fi

echo "=================================================="
echo "PR #$PR_ID Review Overview ($REPO)"
echo "=================================================="
gh pr view "$PR_ID" -R "$REPO" --json number,title,author,state,headRefName,baseRefName,url,mergeable,reviews \
  --template 'Title: {{.title}}
Author: {{.author.login}}
Branch: {{.headRefName}} -> {{.baseRefName}}
Mergeable: {{.mergeable}}
URL: {{.url}}
'

echo "--------------------------------------------------"
echo "CI / Status Checks:"
gh pr checks "$PR_ID" -R "$REPO" 2>&1 || echo "No status checks configured or pending."

echo "--------------------------------------------------"
echo "Scanning Diff for Security / Secrets Leakage..."
DIFF=$(gh pr diff "$PR_ID" -R "$REPO")

SECRETS_FOUND=0
for pattern in "AKIA[0-9A-Z]{16}" "ASIA[0-9A-Z]{16}" "AWS_SECRET_ACCESS_KEY" "BEGIN RSA PRIVATE KEY" "BEGIN OPENSSH PRIVATE KEY" "ghp_[0-9a-zA-Z]{36}"; do
  if echo "$DIFF" | grep -E "$pattern" > /dev/null 2>&1; then
    echo "⚠️ ALERT: Potential secret pattern matched: $pattern"
    SECRETS_FOUND=1
  fi
done

if [ "$SECRETS_FOUND" -eq 0 ]; then
  echo "✅ No sensitive credentials detected in PR diff."
else
  echo "❌ CRITICAL: Sensitive credentials suspected! Request changes immediately."
fi

echo "--------------------------------------------------"
echo "Changed Files:"
gh pr diff "$PR_ID" -R "$REPO" --name-only

echo "=================================================="
echo "Ready for review. Use gh pr review $PR_ID --approve or --request-changes"
