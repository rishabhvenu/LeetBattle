#!/bin/bash
# Run GitHub workflows locally using act
# This allows testing the exact same workflow that runs in production

set -e

echo "🎬 Running GitHub workflows locally with act"
echo ""

# Check if act is installed
if ! command -v act &> /dev/null; then
    echo "❌ Error: act is not installed"
    echo ""
    echo "Install act:"
    echo "  macOS:   brew install act"
    echo "  Linux:   curl https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash"
    echo "  Manual:  https://github.com/nektos/act"
    exit 1
fi

# Check if .env.dev exists
if [ ! -f .env.dev ]; then
    echo "❌ Error: .env.dev not found"
    echo ""
    echo "Create .env.dev from template:"
    echo "  cp .env.dev.template .env.dev"
    echo "  # Then edit .env.dev with your values"
    exit 1
fi

# Check if .secrets.dev exists
if [ ! -f .secrets.dev ]; then
    echo "⚠️  Warning: .secrets.dev not found"
    echo ""
    echo "Create .secrets.dev from template:"
    echo "  cp .secrets.dev.template .secrets.dev"
    echo "  # Then edit .secrets.dev with your secret values"
    echo ""
    read -p "Continue without .secrets.dev? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Parse arguments
WORKFLOW="deploy"
JOB=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --workflow|-w)
            WORKFLOW="$2"
            shift 2
            ;;
        --job|-j)
            JOB="$2"
            shift 2
            ;;
        --dry-run|-n)
            DRY_RUN=true
            shift
            ;;
        --list|-l)
            echo "Available workflows:"
            act -l
            exit 0
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  -w, --workflow WORKFLOW   Workflow to run (default: deploy)"
            echo "  -j, --job JOB             Specific job to run"
            echo "  -n, --dry-run             Show what would run without executing"
            echo "  -l, --list                List available workflows and jobs"
            echo "  -h, --help                Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                              # Run deploy workflow"
            echo "  $0 --workflow sync-secrets      # Run sync-secrets workflow"
            echo "  $0 --job deploy --dry-run       # Preview deploy job"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Run with --help for usage information"
            exit 1
            ;;
    esac
done

# Build act command
ACT_CMD="act"

if [ -n "$JOB" ]; then
    ACT_CMD="$ACT_CMD -j $JOB"
fi

if [ "$DRY_RUN" = true ]; then
    ACT_CMD="$ACT_CMD --dryrun"
fi

# Add workflow-specific triggers
case "$WORKFLOW" in
    deploy|deploy-backend)
        ACT_CMD="$ACT_CMD push"
        WORKFLOW_FILE=".github/workflows/deploy-backend.yml"
        ;;
    sync-secrets)
        ACT_CMD="$ACT_CMD workflow_dispatch"
        WORKFLOW_FILE=".github/workflows/sync-secrets.yml"
        ;;
    frontend-build)
        ACT_CMD="$ACT_CMD push"
        WORKFLOW_FILE=".github/workflows/frontend-build.yml"
        ;;
    frontend-deploy)
        ACT_CMD="$ACT_CMD workflow_dispatch"
        WORKFLOW_FILE=".github/workflows/frontend-deploy.yml"
        ;;
    *)
        echo "Unknown workflow: $WORKFLOW"
        echo "Available workflows: deploy, sync-secrets, frontend-build, frontend-deploy"
        exit 1
        ;;
esac

# Add workflow file if specified
if [ -n "$WORKFLOW_FILE" ]; then
    ACT_CMD="$ACT_CMD -W $WORKFLOW_FILE"
fi

echo "Running: $ACT_CMD"
echo ""

# Execute act
eval "$ACT_CMD"

