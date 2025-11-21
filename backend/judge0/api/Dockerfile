# Judge0 API Server Dockerfile for ARM64
# Based on Judge0 repository with ARM64 compatibility patches

# Multi-stage build
FROM ubuntu:22.04 AS production

# Install Ruby, Node.js, and dependencies
RUN DEBIAN_FRONTEND=noninteractive TZ=UTC apt-get update && \
    DEBIAN_FRONTEND=noninteractive TZ=UTC apt-get install -y --no-install-recommends \
      curl \
      git \
      build-essential \
      ca-certificates \
      gnupg2 \
      software-properties-common \
      tzdata && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    apt-get install -y ruby-full ruby-dev libpq-dev && \
    gem install bundler:2.1.4 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /api

# Copy application code
COPY . .

# Install Ruby gems (required for Rails/Judge0)
RUN bundle config set --local without "development test" && \
    bundle install

# Copy scripts explicitly
COPY scripts/ ./scripts/

# Make scripts executable
RUN chmod +x ./scripts/* || true

# Patch server script to handle existing database gracefully
RUN sed -i "s/rails db:create db:migrate db:seed/rails db:create || true; rails db:migrate || true; rails db:seed || true/" /api/scripts/server || true

# Development stage (inherits from production)
FROM production AS development

# Default command for API server
ENTRYPOINT ["/api/scripts/server"]
