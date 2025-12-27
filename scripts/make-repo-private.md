# Making Repository Private

## Steps to Make Repository Private on GitHub

### Option 1: Via GitHub Web Interface (Easiest)

1. Go to your repository on GitHub: `https://github.com/rishabhvenu/CodeClashers` (or your repo URL)
2. Click on **Settings** (top right of the repository page)
3. Scroll down to the **Danger Zone** section (at the bottom)
4. Click **Change visibility**
5. Select **Make private**
6. Type your repository name to confirm
7. Click **I understand, change repository visibility**

### Option 2: Via GitHub CLI

```bash
# Install GitHub CLI if not already installed
brew install gh

# Authenticate
gh auth login

# Make repository private
gh repo edit rishabhvenu/CodeClashers --visibility private
```

### Option 3: Via GitHub API

```bash
# Set GITHUB_TOKEN environment variable first
export GITHUB_TOKEN=your_github_token

# Make repository private
curl -X PATCH \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/rishabhvenu/CodeClashers \
  -d '{"private":true}'
```

## Important Notes

⚠️ **After making the repository private:**

1. **Public forks will remain public** - Anyone who forked your repo will still have a public copy
2. **GitHub Pages** (if enabled) will be disabled automatically
3. **Public API access** will be restricted
4. **Webhooks** may need to be updated if they reference public URLs

## Verify Repository is Private

After making it private, verify by:
- Visiting the repository URL in an incognito window
- You should see a "Private repository" message
- Only you (and collaborators) can access it


