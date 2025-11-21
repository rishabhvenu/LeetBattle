# Kubernetes Secrets Templates

This directory contains secret templates that are synced from GitHub Secrets/Variables to Kubernetes.

## Important Notes

- **DO NOT** commit actual secret values - only templates with `${VAR}` placeholders
- **DO NOT** apply these templates directly - use the `sync-secrets.yml` workflow
- The deploy workflow **excludes** this directory when applying manifests
- Only the `sync-secrets.yml` workflow touches this directory

## Secret Templates

### secrets.yaml.template

Contains all application secrets:
- `app-secrets` - Main application secrets (Redis, MongoDB, AWS, etc.)
- `mongodb-secrets` - MongoDB credentials for StatefulSet
- `mongodb-keyfile` - MongoDB replica set keyfile (generated automatically)

### Registry Secret

The `ghcr-secret` is created separately using `docker-registry` type in the sync workflow.
It cannot be templated the same way, so it's created directly from GitHub secrets.

## Usage

To sync secrets from GitHub to Kubernetes:

1. Ensure all required secrets are set in GitHub Secrets/Variables
2. Run the `sync-secrets.yml` workflow manually (workflow_dispatch)
3. The workflow will:
   - Read secrets from GitHub
   - Substitute into templates using envsubst
   - Apply to Kubernetes cluster

## Required GitHub Secrets

- `REDIS_PASSWORD`
- `MONGODB_URI` (or `MONGODB_USERNAME` + `MONGODB_PASSWORD`)
- `JUDGE0_POSTGRES_USER`
- `JUDGE0_POSTGRES_PASSWORD`
- `JUDGE0_POSTGRES_DB`
- `OPENAI_API_KEY`
- `INTERNAL_SERVICE_SECRET`
- `BOT_SERVICE_SECRET`
- `COLYSEUS_RESERVATION_SECRET`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `GITHUB_TOKEN` (for registry secret)

## Required GitHub Variables

- `S3_BUCKET_NAME`
- `AWS_REGION` (defaults to us-east-1)
- `REDIS_PORT` (defaults to 6379)
- `JUDGE0_PORT` (defaults to 2358)
- `MONGODB_PORT` (defaults to 27017)
- `COLYSEUS_PORT` (defaults to 2567)

## MongoDB Keyfile

The MongoDB keyfile is automatically generated if not provided in `MONGODB_KEYFILE` secret.
It uses: `openssl rand -base64 756`

