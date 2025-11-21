# Judge0 ARM64 Build

This directory contains static Dockerfiles for building Judge0 API and Worker images for ARM64 architecture.

## Structure

- `api/Dockerfile` - Judge0 API server Dockerfile
- `api/config.json` - Language configuration for API (filtered for ARM64)
- `api/scripts/` - API-specific scripts (server, etc.)
- `worker/Dockerfile` - Judge0 worker Dockerfile  
- `worker/config.json` - Language configuration for worker (filtered for ARM64)
- `worker/scripts/` - Worker-specific scripts (workers, etc.)

## Initial Setup

**IMPORTANT:** Before building, you need to populate this directory with Judge0 source code:

1. Clone the Judge0 repository:
   ```bash
   git clone https://github.com/judge0/judge0.git /tmp/judge0-src
   ```

2. Copy required files (preserving static Dockerfiles):
   ```bash
   # Copy API files (exclude Dockerfile to preserve ARM64 version)
   rsync -av --exclude='Dockerfile' /tmp/judge0-src/ backend/judge0/api/
   cp /tmp/judge0-src/config.json backend/judge0/api/config.json
   
   # Copy worker files (exclude Dockerfile to preserve ARM64 version)
   rsync -av --exclude='Dockerfile' /tmp/judge0-src/ backend/judge0/worker/
   cp /tmp/judge0-src/config.json backend/judge0/worker/config.json
   ```
   
   **Note:** If `rsync` is not available, manually copy files while preserving the Dockerfiles:
   ```bash
   # Backup Dockerfiles first
   cp backend/judge0/api/Dockerfile backend/judge0/api/Dockerfile.bak
   cp backend/judge0/worker/Dockerfile backend/judge0/worker/Dockerfile.bak
   
   # Copy source
   cp -r /tmp/judge0-src/* backend/judge0/api/
   cp -r /tmp/judge0-src/* backend/judge0/worker/
   
   # Restore Dockerfiles
   mv backend/judge0/api/Dockerfile.bak backend/judge0/api/Dockerfile
   mv backend/judge0/worker/Dockerfile.bak backend/judge0/worker/Dockerfile
   ```

3. Filter config.json for ARM64 compatibility (removes unsupported languages):
   ```bash
   # For API
   cd backend/judge0/api
   jq 'del(.languages[] | select(.name | test("Swift|Pascal|Mono|C#|Go|Kotlin|PHP|Perl|Ruby"; "i")))' config.json > config.json.tmp && mv config.json.tmp config.json
   
   # For worker
   cd ../worker
   jq 'del(.languages[] | select(.name | test("Swift|Pascal|Mono|C#|Go|Kotlin|PHP|Perl|Ruby"; "i")))' config.json > config.json.tmp && mv config.json.tmp config.json
   ```

## Building Images

### API Image
```bash
docker buildx build --platform linux/arm64 \
  -t ghcr.io/rishabhvenu/codeclashers-judge0-api-arm64:latest \
  -f backend/judge0/api/Dockerfile \
  backend/judge0/api/
```

### Worker Image
```bash
docker buildx build --platform linux/arm64 \
  -t ghcr.io/rishabhvenu/codeclashers-judge0-worker-arm64:latest \
  -f backend/judge0/worker/Dockerfile \
  backend/judge0/worker/
```

## Notes

- The Dockerfiles use `ubuntu:22.04` as base (instead of `judge0/compilers`) for ARM64 compatibility
- Ruby and Node.js are installed manually in the Dockerfiles
- Scripts are explicitly copied and made executable
- The server script is patched to handle existing database gracefully

