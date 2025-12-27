# AWS Secrets Manager - Quick Start Guide

## 🚀 Setup in 3 Steps

### Step 1: Create Secrets (2 minutes)
```bash
cd /Users/ase/Documents/CodeClashers
./scripts/secrets/create-secrets-manager.sh
```

### Step 2: Populate Values (10 minutes)
**Easy way:** Use AWS Console
1. Open [AWS Secrets Manager Console](https://console.aws.amazon.com/secretsmanager/)
2. Open [GitHub Secrets](https://github.com/YOUR_REPO/settings/secrets/actions) in another tab
3. For each secret (`codeclashers/backend`, `codeclashers/frontend`, `codeclashers/ghcr`):
   - Click secret name → "Retrieve secret value" → "Edit"
   - Copy values from GitHub Secrets (match the key names)
   - Save

**Alternative:** Interactive script
```bash
./scripts/secrets/migrate-to-aws.sh
```

### Step 3: Configure IAM (2 minutes)
```bash
./scripts/secrets/attach-iam-policy.sh
# When prompted, enter: GitHubActionsRole (or your OIDC role name)
```

## ✅ Test It

### Test Backend (Kubernetes)
1. Go to GitHub Actions
2. Run workflow: **"Sync Secrets to Kubernetes"**
3. Check logs for ✅ success

### Test Frontend (Lambda)
1. Go to GitHub Actions
2. Run workflow: **"Build Frontend (OpenNext)"** (wait for completion)
3. Run workflow: **"Deploy Frontend to AWS (CDK)"**
4. Check logs for ✅ success

## 📋 What Changed?

### Secrets Location
- **Before:** GitHub Secrets (42 secrets)
- **After:** AWS Secrets Manager (3 secret groups) + GitHub (1 secret for OIDC)

### Workflows Updated
- ✅ `sync-secrets.yml` - Now fetches from AWS
- ✅ `frontend-deploy.yml` - Now fetches from AWS
- ✅ `frontend-build.yml` - Now fetches from AWS

### New Components
- ✅ `.github/actions/fetch-secrets` - Reusable action
- ✅ `scripts/secrets/` - Management scripts
- ✅ IAM policy for Secrets Manager access

## 🔒 Security Benefits

- ✅ No more long-lived credentials in GitHub
- ✅ Centralized secret management
- ✅ AWS CloudTrail audit logs
- ✅ Automatic secret masking in logs
- ✅ Least-privilege IAM policies

## 📖 Documentation

- **Full Implementation:** `AWS_SECRETS_MANAGER_IMPLEMENTATION.md`
- **Scripts Guide:** `scripts/secrets/README.md`
- **IAM Setup:** `backend/k8s/argocd/README-IAM-POLICY.md`
- **Environment Vars:** `context/backend/environment-variables.md`

## 🆘 Troubleshooting

### "Not authorized to perform: secretsmanager:GetSecretValue"
```bash
./scripts/secrets/attach-iam-policy.sh
```

### "Secret not found: codeclashers/backend"
```bash
./scripts/secrets/create-secrets-manager.sh
```

### Workflow fails
1. Check AWS_ROLE_ARN in GitHub Secrets is correct
2. Verify IAM policy is attached: `aws iam list-attached-role-policies --role-name GitHubActionsRole`
3. Check Secrets Manager: `aws secretsmanager list-secrets`

## 🔄 Updating Secrets

**Via AWS Console:**
1. Go to Secrets Manager
2. Click secret name
3. "Retrieve secret value" → "Edit"
4. Modify JSON → "Save"

**Via CLI:**
```bash
aws secretsmanager update-secret \
  --secret-id codeclashers/backend \
  --secret-string '{"KEY":"new-value",...}'
```

**Then re-deploy:**
- K8s: Run `sync-secrets.yml` workflow
- Lambda: Run `frontend-deploy.yml` workflow

## 💡 Tips

- Keep `AWS_ROLE_ARN` in GitHub Secrets (needed for OIDC)
- After successful migration, you can delete old GitHub Secrets
- Costs: ~$1.30/month for 3 secrets
- Secrets are automatically masked in GitHub Actions logs

## ✨ What's Next?

1. Run the 3 setup steps above
2. Test both deployments
3. Verify applications work correctly
4. (Optional) Delete old GitHub Secrets

---

**Need Help?** Check `scripts/secrets/README.md` for detailed troubleshooting.

