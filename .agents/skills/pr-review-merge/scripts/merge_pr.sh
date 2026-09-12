#!/bin/bash
set -e

REPO="mobinice/Hacksong"
PR_ID="$1"
METHOD="${2:-squash}"

if [ -z "$PR_ID" ]; then
  echo "Usage: $0 <PR_NUMBER> [squash|merge|rebase]"
  exit 1
fi

echo "Checking PR #$PR_ID mergeability..."
MERGEABLE=$(gh pr view "$PR_ID" -R "$REPO" --json mergeable -q .mergeable)

if [ "$MERGEABLE" != "MERGEABLE" ]; then
  echo "❌ PR #$PR_ID is not cleanly mergeable ($MERGEABLE). Please resolve conflicts."
  exit 1
fi

echo "Merging PR #$PR_ID into main using method: --$METHOD ..."
gh pr merge "$PR_ID" -R "$REPO" --"$METHOD" --delete-branch

echo "Pulling latest main locally..."
git checkout main
git pull origin main

echo "=================================================="
echo "✅ PR #$PR_ID merged successfully and branch deleted."
echo "To deploy to AWS EC2, run:"
echo "  git tag deploy_\$(date +%Y%m%d_%H%M%S)"
echo "  git push origin --tags"
echo "=================================================="
