#!/bin/bash
# Script to create a secret GitHub Gist with credentials
# This moves sensitive credentials out of the repository

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CREDENTIALS_DIR="$SCRIPT_DIR/../credentials"

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) is not installed."
    echo "Install it with: brew install gh"
    echo "Then authenticate with: gh auth login"
    exit 1
fi

# Check if authenticated
if ! gh auth status &> /dev/null; then
    echo "❌ Not authenticated with GitHub CLI."
    echo "Run: gh auth login"
    exit 1
fi

echo "🔐 Creating secret GitHub Gist for credentials..."
echo ""

# Create temporary directory for gist files
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Copy credential files to temp directory
if [ -f "$CREDENTIALS_DIR/oracle_info" ]; then
    cp "$CREDENTIALS_DIR/oracle_info" "$TEMP_DIR/oracle_info"
    echo "✅ Found oracle_info"
fi

if [ -f "$CREDENTIALS_DIR/venurishabh@gmail.com-2025-11-28T02_29_09.637Z.pem" ]; then
    cp "$CREDENTIALS_DIR/venurishabh@gmail.com-2025-11-28T02_29_09.637Z.pem" "$TEMP_DIR/oci_private_key.pem"
    echo "✅ Found private key"
fi

if [ -f "$CREDENTIALS_DIR/venurishabh@gmail.com-2025-11-28T02_29_11.233Z_public.pem" ]; then
    cp "$CREDENTIALS_DIR/venurishabh@gmail.com-2025-11-28T02_29_11.233Z_public.pem" "$TEMP_DIR/oci_public_key.pem"
    echo "✅ Found public key"
fi

# Create README for the gist
cat > "$TEMP_DIR/README.md" << 'EOF'
# CodeClashers Credentials

This secret Gist contains sensitive credentials for the CodeClashers project.

## Files

- `oracle_info` - Oracle Cloud Infrastructure credentials (region, OCIDs, IP, username)
- `oci_private_key.pem` - SSH private key for Oracle Cloud VM access
- `oci_public_key.pem` - SSH public key for Oracle Cloud VM access

## Access

This Gist is secret and only accessible to you. To download:

```bash
# Install GitHub CLI if needed
brew install gh

# Authenticate
gh auth login

# Clone the gist (replace GIST_ID with the ID from the URL)
gh gist clone <GIST_ID>

# Or download individual files
gh gist view <GIST_ID> --raw oracle_info > oracle_info
```

## Security Notes

- Never share this Gist publicly
- Keep your local copies secure
- Rotate credentials if compromised
- Use `chmod 600` for private key files
EOF

# Create the secret gist
echo ""
echo "📤 Uploading to GitHub as secret Gist..."
GIST_URL=$(cd "$TEMP_DIR" && gh gist create --secret --desc "CodeClashers Production Credentials" *.md *.pem oracle_info 2>/dev/null | head -1)

if [ -z "$GIST_URL" ]; then
    echo "❌ Failed to create Gist. Make sure all files are valid."
    exit 1
fi

# Extract Gist ID from URL
GIST_ID=$(echo "$GIST_URL" | sed -E 's/.*\/([a-f0-9]+)$/\1/')

echo ""
echo "✅ Secret Gist created successfully!"
echo ""
echo "🔗 Gist URL: $GIST_URL"
echo "🆔 Gist ID: $GIST_ID"
echo ""
echo "📝 To download credentials later:"
echo "   gh gist clone $GIST_ID"
echo ""
echo "💾 Save this Gist ID for reference: $GIST_ID"
echo ""

# Create a local reference file (without actual credentials)
cat > "$CREDENTIALS_DIR/.gist-reference" << EOF
# Credentials are stored in a secret GitHub Gist
# Gist ID: $GIST_ID
# Gist URL: $GIST_URL
#
# To download credentials:
#   gh gist clone $GIST_ID
#   cp <gist-dir>/* credentials/
#
# To update credentials in Gist:
#   gh gist edit $GIST_ID
EOF

echo "📄 Created .gist-reference file in credentials/ directory"
echo ""
echo "⚠️  Next steps:"
echo "   1. Verify the Gist contains all files: $GIST_URL"
echo "   2. Make your repository private on GitHub"
echo "   3. Consider removing credentials from local git history"
echo "   4. Keep the Gist ID safe for future access"


