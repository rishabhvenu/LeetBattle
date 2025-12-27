#!/bin/bash
# Script to delete old GitHub Actions artifacts to free up storage quota
# Usage: ./scripts/cleanup-artifacts.sh [days_to_keep]

set -e

DAYS_TO_KEEP=${1:-7}  # Default: keep artifacts from last 7 days
CUTOFF_DATE=$(date -u -v-${DAYS_TO_KEEP}d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "${DAYS_TO_KEEP} days ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u --date="${DAYS_TO_KEEP} days ago" +%Y-%m-%dT%H:%M:%SZ)

echo "🧹 Cleaning up GitHub Actions artifacts older than ${DAYS_TO_KEEP} days"
echo "   Cutoff date: ${CUTOFF_DATE}"
echo ""

# Get all artifacts
ARTIFACTS=$(gh api repos/rishabhvenu/LeetBattle/actions/artifacts --jq '.artifacts[] | select(.created_at < "'"${CUTOFF_DATE}"'") | {id: .id, name: .name, created: .created_at, size: .size_in_bytes}')

if [ -z "$ARTIFACTS" ]; then
  echo "✅ No artifacts older than ${DAYS_TO_KEEP} days found"
  exit 0
fi

# Count artifacts to delete
COUNT=$(echo "$ARTIFACTS" | jq -s 'length')
TOTAL_SIZE=$(echo "$ARTIFACTS" | jq -s '[.[].size] | add')

echo "📊 Found ${COUNT} artifacts to delete"
echo "   Total size: $(echo "${TOTAL_SIZE}" | awk '{printf "%.2f MB\n", $1/1024/1024}')"
echo ""

# Ask for confirmation
read -p "Delete these artifacts? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Cancelled"
  exit 1
fi

# Delete artifacts
DELETED=0
FAILED=0

echo "$ARTIFACTS" | jq -r '.id' | while read -r artifact_id; do
  if gh api repos/rishabhvenu/LeetBattle/actions/artifacts/${artifact_id} -X DELETE 2>/dev/null; then
    DELETED=$((DELETED + 1))
    echo "✅ Deleted artifact ${artifact_id}"
  else
    FAILED=$((FAILED + 1))
    echo "❌ Failed to delete artifact ${artifact_id}"
  fi
done

echo ""
echo "✅ Cleanup complete!"
echo "   Deleted: ${DELETED} artifacts"
if [ ${FAILED} -gt 0 ]; then
  echo "   Failed: ${FAILED} artifacts"
fi
echo ""
echo "ℹ️  Note: GitHub may take 6-12 hours to recalculate storage usage"

