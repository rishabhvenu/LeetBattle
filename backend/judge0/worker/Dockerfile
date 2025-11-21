# Judge0 Worker Dockerfile for ARM64
# Worker does NOT use Ruby/Rails/Bundler - it's a shell-based executor

FROM ubuntu:22.04

# Install compilers and runtimes used by Judge0 Worker
RUN DEBIAN_FRONTEND=noninteractive TZ=UTC apt-get update && \
    DEBIAN_FRONTEND=noninteractive TZ=UTC apt-get install -y --no-install-recommends \
      build-essential \
      gcc \
      g++ \
      python3 \
      python3-pip \
      openjdk-17-jdk \
      curl \
      ca-certificates \
      git \
      tzdata && \
    rm -rf /var/lib/apt/lists/*

# Create working directory
WORKDIR /worker

# Copy worker code (includes scripts/)
COPY . .

# Make scripts executable
RUN chmod +x ./scripts/* || true

# Use Judge0 worker entrypoint
ENTRYPOINT ["./scripts/workers"]
