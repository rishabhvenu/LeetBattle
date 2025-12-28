# Judge0 Worker Dockerfile for ARM64
# Worker needs: Ruby/Rails (for resque), isolate (for sandbox), compilers/runtimes
# Build context: ./backend/judge0 (not ./backend/judge0/worker)

FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

# Install system dependencies, Ruby, compilers, and runtimes
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      # Build tools
      build-essential \
      gcc \
      g++ \
      make \
      pkg-config \
      libcap-dev \
      # Ruby and Rails dependencies
      ruby-full \
      ruby-dev \
      libpq-dev \
      postgresql-client \
      # Node.js
      curl \
      ca-certificates \
      gnupg2 \
      # Python
      python3 \
      python3-pip \
      # Java
      openjdk-17-jdk \
      # Other utilities
      git \
      sudo \
      unzip \
      cgroup-tools \
      libseccomp-dev \
      asciidoc \
      tzdata && \
    # Install Node.js
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    # Install bundler
    gem install bundler -v 2.1.4 && \
    rm -rf /var/lib/apt/lists/*

# Build and install isolate from source (ARM64 compatible)
RUN cd /tmp && \
    git clone https://github.com/ioi/isolate.git && \
    cd isolate && \
    make -j$(nproc) isolate && \
    make install && \
    cd / && rm -rf /tmp/isolate

# Create isolate cgroup directories (may fail on some systems, that's ok)
RUN mkdir -p /sys/fs/cgroup/memory/isolate && \
    mkdir -p /sys/fs/cgroup/cpuacct/isolate && \
    mkdir -p /sys/fs/cgroup/pids/isolate || true

# Set up working directory with API code (includes Gemfile, app/, etc.)
WORKDIR /api

# Copy the API code from the build context (context is ./backend/judge0)
COPY api/ .

# Install Ruby gems
RUN bundle config set --local without 'development test' && \
    bundle install

# Make scripts executable
RUN chmod +x ./scripts/* || true

# Create symlinks for language compatibility
RUN ln -sf /usr/bin/python3 /usr/bin/python || true

# Worker runs resque workers
CMD ["bash", "-c", "source ./scripts/load-config && COUNT=2 QUEUE=* bundle exec rake resque:workers"]
