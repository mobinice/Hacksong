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
echo "Scanning Added Lines for Actual Secrets / Credentials..."
# Extract only added lines from diff
ADDED_LINES=$(gh pr diff "$PR_ID" -R "$REPO" | grep '^+[^+]' || true)

SECRETS_FOUND=0
PATTERNS=(
  "AKIA[0-9A-Z]{16}"
  "ASIA[0-9A-Z]{16}"
  "(aws_secret_access_key|AWS_SECRET_ACCESS_KEY)[[:space:]]*=[[:space:]]*['\"][A-Za-z0-9/+=]{20,}['\"]"
  "-----BEGIN[[:space:]]+(RSA|OPENSSH|EC|DSA)?[[:space:]]*PRIVATE KEY-----"
  "ghp_[0-9a-zA-Z]{36}"
)

for pattern in "${PATTERNS[@]}"; do
  # Filter out patterns in comments or security checklist files
  MATCHES=$(echo "$ADDED_LINES" | grep -E -e "$pattern" | grep -v "pattern in" | grep -v "checklist" || true)
  if [ -n "$MATCHES" ]; then
    echo "⚠️ ALERT: Potential secret detected matching pattern: $pattern"
    echo "$MATCHES" | head -n 3
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
