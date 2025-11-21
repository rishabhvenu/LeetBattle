# LeetBattle 🏆

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)
![Colyseus](https://img.shields.io/badge/Realtime-Colyseus-blue)
![Judge0](https://img.shields.io/badge/Judge0-Code_Execution-orange)
![MongoDB](https://img.shields.io/badge/Database-MongoDB-green)
![Redis](https://img.shields.io/badge/Cache-Redis-red)
![Docker](https://img.shields.io/badge/Dockerized-Yes-blue)
![Contributions Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)

**LeetBattle** is a real-time multiplayer coding arena where developers compete head-to-head in timed challenges. Built with Next.js, Colyseus, and Judge0, it combines live collaboration, instant code execution, competitive matchmaking, AI-powered bot opponents, private rooms, and chill-out guest mode — all in one seamless platform.

> 🎯 **1v1 coding battles** • ⚡ **Real-time execution** • 🏅 **ELO-based matchmaking** • 🤖 **AI Bot opponents** • 🎮 **Private Rooms** • 👤 **Guest Mode** • 🌐 **89+ languages**

---

## 🖼️ Demo

> 📸 **Screenshots and demo video coming soon!**

**Key Features:**
- ⚡ Real-time competitive matches with live opponent updates
- 🎮 Monaco Editor (VS Code engine) with syntax highlighting
- 🏆 Global leaderboard with ELO rating system
- 🤖 AI-powered bot opponents for instant matches
- 🔥 Instant code execution and test results
- 💾 Complete match history and statistics
- 🎨 Clean, modern UI with dark mode
- 🛠️ Admin panel for bot and problem management
- 📊 Advanced analytics with difficulty-adjusted ratings
- 🎮 **Private Rooms** - Create custom 1v1 matches with room codes
- 👤 **Guest Mode** - Play without registration (one-time match)
- 🔐 **Internal Service Auth** - Secure service-to-service communication
- ⏱️ **Dynamic ELO Matchmaking** - Progressive threshold expansion

---

## ⚙️ Tech Stack

| Layer | Technologies |
|-------|---------------|
| **Frontend** | Next.js 15, TypeScript, Tailwind CSS, shadcn/ui, Monaco Editor, Framer Motion |
| **Realtime** | Colyseus, WebSockets, Redis (Pub/Sub) |
| **Backend** | Node.js, Judge0 (Code Execution), MongoDB, Redis, Bot Service |
| **Storage** | MinIO (S3-compatible for avatars) |
| **Infrastructure** | Docker, Docker Compose |

---

## 🧩 Architecture Overview

```mermaid
graph TD
    A[Next.js Client] -->|WebSocket| B[Colyseus Server]
    A -->|Server Actions| C[Next.js API]
    C -->|Auth & Data| D[MongoDB]
    B -->|Submit Code| E[Judge0 API]
    B -->|Queue & Events| F[Redis]
    C -->|Avatar Storage| G[MinIO S3]
    E -->|Results| B
    B -->|Match End| H[Match Persistence Worker]
    H -->|Save Results| D
    F -->|Matchmaking| I[Background Worker]
    I -->|Create Match| B
    J[Bot Service] -->|Bot Queue| F
    J -->|Bot Matches| B
    F -->|Bot Commands| J
    K[Admin Panel] -->|Bot Management| C
    K -->|Problem Management| C
```

**Flow:**
1. **User queues** → Redis sorted set (by ELO)
2. **Background worker** pairs players or allocates bots
3. **Bot Service** maintains AI opponents for instant matches
4. **Colyseus MatchRoom** manages real-time state
5. **Judge0** executes code in isolated containers
6. **Results stream** back via WebSocket
7. **MongoDB** persists match history & updates ratings
8. **Admin Panel** manages bots, problems, and users

---

## 🗂️ Context Docs

- Backend reference index: [`context/backend/overview.md`](./context/backend/overview.md)
- Frontend reference index: [`context/frontend/overview.md`](./context/frontend/overview.md)
- Highlighted deep dives:
  - Matchmaking internals (`context/backend/matchmaking-flow.md`)
  - Bot service lifecycle (`context/backend/bot-lifecycle.md`)
  - Judge0 troubleshooting (`context/backend/judge0-runbook.md`)
  - Backend debugging checklist (`context/backend/debugging-playbook.md`)
  - Next.js app map (`context/frontend/app-architecture.md`)
  - Match UI flow (`context/frontend/match-experience.md`)

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18+
- **Docker** and **Docker Compose**
- **npm** or **pnpm**

### ⚡ Quick Start

```bash
# 1️⃣ Clone the repository
git clone https://github.com/rishabhvenu/LeetBattle.git
cd LeetBattle

# 2️⃣ Start backend services (MongoDB, Redis, Judge0, Colyseus, MinIO)
cd backend
docker-compose up -d

# 3️⃣ Verify services are running
docker-compose ps

# 4️⃣ Install and start frontend
cd ../client
npm install
npm run dev
```

**🎉 Open http://localhost:3000** — Your coding arena is ready!

<details>
<summary>📋 <b>Verify Backend Services</b></summary>

Check all services are healthy:

```bash
cd backend
docker-compose ps
```

Expected output:
```
NAME                    STATUS              PORTS
codeclashers-mongodb    Up                  27017
codeclashers-redis      Up                  6379
codeclashers-minio      Up (healthy)        9000-9001
codeclashers-judge0     Up                  2358
codeclashers-colyseus   Up                  2567
```

Access points:
- 🎮 **Colyseus**: ws://localhost:2567
- 🗄️ **MongoDB**: mongodb://localhost:27017
- 💾 **Redis**: localhost:6379
- 📦 **MinIO Console**: http://localhost:9001 (minioadmin/minioadmin123)
- ⚡ **Judge0 API**: http://localhost:2358

</details>

<details>
<summary>⚙️ <b>Environment Variables</b></summary>

### Backend (`backend/.env`)
```env
# MinIO (S3-compatible avatar storage)
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin123

# Redis (matchmaking queue + caching)
REDIS_PASSWORD=redis_dev_password_123

# Judge0 Database
JUDGE0_POSTGRES_DB=judge0
JUDGE0_POSTGRES_USER=judge0
JUDGE0_POSTGRES_PASSWORD=judge0_secure_pass_456

# Bot Service Configuration
BOTS_ENABLED=true
BOT_COUNT=30
BOT_SERVICE_SECRET=dev_bot_secret
BOT_FILL_DELAY_MS=15000
BOT_TIME_DIST=lognormal
BOT_TIME_PARAMS_EASY={"muMinutes":30,"sigma":0.35}
BOT_TIME_PARAMS_MEDIUM={"muMinutes":35,"sigma":0.35}
BOT_TIME_PARAMS_HARD={"muMinutes":40,"sigma":0.35}

# Internal Service Authentication
INTERNAL_SERVICE_SECRET=dev_internal_secret

# OpenAI API (for complexity analysis and problem generation)
OPENAI_API_KEY=sk-your-openai-key

# Environment
NODE_ENV=development
```

### Client (`client/.env.local`)
```env
# MongoDB (user data + sessions)
MONGODB_URI=mongodb://localhost:27017/codeclashers

# Next.js Authentication
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=dev-secret-key-change-in-production-min-32-chars-required

# Colyseus (real-time game server)
NEXT_PUBLIC_COLYSEUS_HTTP_URL=http://localhost:2567
NEXT_PUBLIC_COLYSEUS_WS_URL=ws://localhost:2567

# MinIO (avatar storage)
S3_ENDPOINT=http://localhost:9000
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin123
S3_BUCKET_NAME=codeclashers-avatars
AWS_REGION=us-east-1

# Redis (matchmaking + events)
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=redis_dev_password_123

# Internal Service Authentication
INTERNAL_SERVICE_SECRET=dev_internal_secret
```

**⚠️ Security Note:** These are development credentials. Generate strong passwords for production!

</details>

---

## 🎮 How It Works

```mermaid
sequenceDiagram
    participant User as 👤 Player
    participant Client as Next.js Client
    participant Queue as QueueRoom
    participant Redis as Redis Queue
    participant Worker as Matchmaker
    participant Match as MatchRoom
    participant Judge0 as Judge0
    participant DB as MongoDB

    User->>Client: Click "Find Match"
    Client->>Queue: Join queue with ELO
    Queue->>Redis: Add to sorted set
    
    Worker->>Redis: Poll for matches
    Worker->>Worker: Pair by ELO (±200)
    Worker->>Match: Create MatchRoom
    Match->>Client: WebSocket connect
    Match->>Client: Send problem
    
    User->>Client: Write code
    Client->>Match: Submit solution
    Match->>Judge0: Execute code
    Judge0->>Match: Return results
    Match->>Client: Stream results
    
    Match->>Match: First to pass wins
    Match->>DB: Save match results
    Match->>DB: Update ELO ratings
    Match->>Redis: Publish match_end
    Redis->>Worker: Persist to MongoDB
```

### Key Features

**1. Smart Matchmaking**
- **Dynamic ELO-based pairing** with progressive threshold expansion
  - 0-10s wait: ±50 ELO range
  - 10-20s wait: ±100 ELO range
  - 20-30s wait: ±150 ELO range
  - 30-45s wait: ±200 ELO range
  - 45s+ wait: ±250 ELO range
- Fair queue using Redis sorted sets
- Difficulty-based problem selection (Easy/Medium/Hard)
- Automatic timeout handling (45-minute matches)

**2. Real-Time Sync**
- Live opponent code execution status
- Instant test case results
- Countdown timer synchronization
- WebSocket reconnection handling

**3. Code Execution & Validation**
- 89+ programming languages supported (Judge0)
- Isolated Docker containers per submission
- Test case streaming (pass/fail indicators)
- **AI time complexity analysis** (OpenAI GPT-4o-mini)
  - Validates submitted code meets optimal Big-O requirements
  - Uses recurrence relations and loop analysis
  - Rejects inefficient solutions
- **Data Structure Support** (ListNode, TreeNode)
  - Multi-language serialization (Python, JavaScript, Java, C++)
  - Automatic helper code injection

**4. Persistence & Performance**
- MongoDB connection pooling (17x faster than per-request)
- Redis pub/sub for match events
- Background matchmaker (1-second polling)
- Distributed rate limiting (prevents abuse)

**5. Bot System**
- AI-powered bot opponents for instant matches
- Configurable timing distributions (lognormal, gamma)
- Dynamic bot deployment/undeployment
- Bot lifecycle management via admin panel
- ELO-based bot difficulty scaling

**6. Admin Tools**
- AI-powered problem generation (OpenAI)
- Automatic solution verification across languages
- Bulk problem import/export
- Bot management (create, deploy, configure)
- User management and analytics
- Active match monitoring

**7. Private Rooms**
- Create custom 1v1 matches with unique room codes
- Share room codes with friends for private competitions
- Room creator selects specific problems
- Up to 10-minute room timeout for joining
- Seamless transition to competitive match
- Creator-only permissions for problem selection and match start

**8. Guest Mode**
- Play without registration (one-time match)
- 7-day guest session cookies
- Automatic match against AI bots
- Post-match sign-up prompt to save results
- Match claiming system when converting to permanent account
- Redis-based guest data storage

**9. Internal Service Authentication**
- Secure service-to-service communication with `X-Internal-Secret` header
- Bot service authentication with `X-Bot-Secret` header
- Rate limiting bypass for authenticated internal services
- Combined authentication middleware for flexible service access
- Protection against unauthorized backend access

---

## 📁 Project Structure

<details>
<summary>Click to expand full structure</summary>

```
LeetBattle/
├── backend/                      # Backend infrastructure
│   ├── colyseus/                # Real-time game server
│   │   ├── src/
│   │   │   ├── index.ts         # Server entry point
│   │   │   ├── rooms/           # Game room logic
│   │   │   │   ├── MatchRoom.ts # 1v1 competitive match
│   │   │   │   ├── QueueRoom.ts # Matchmaking queue
│   │   │   │   └── PrivateRoom.ts # Private room with codes
│   │   │   ├── lib/
│   │   │   │   ├── codeRunner.ts    # Judge0 integration
│   │   │   │   ├── testExecutor.ts  # Test case runner
│   │   │   │   ├── eloSystem.ts     # Advanced ELO calculations
│   │   │   │   ├── matchCreation.ts # Match creation logic
│   │   │   │   ├── dataStructureHelpers.ts # ListNode/TreeNode support
│   │   │   │   ├── internalAuth.ts  # Internal service authentication
│   │   │   │   └── queue.ts         # Matchmaking logic
│   │   │   └── workers/
│   │   │       └── matchmaker.ts    # Background pairing
│   │   └── package.json
│   ├── bots/                     # AI Bot Service
│   │   ├── index.js             # Bot lifecycle manager
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── docker-compose.yml       # All services
│   └── .env                     # Dev credentials
│
├── client/                       # Next.js frontend
│   ├── src/
│   │   ├── app/                 # Next.js 15 App Router
│   │   │   ├── match/           # Live match UI
│   │   │   ├── queue/           # Matchmaking queue
│   │   │   ├── leaderboard/     # Global rankings
│   │   │   ├── match-history/   # Match history viewing
│   │   │   ├── admin/           # Admin panel
│   │   │   │   ├── BotManagement.tsx
│   │   │   │   ├── ProblemManagement.tsx
│   │   │   │   ├── UserManagement.tsx
│   │   │   │   └── AdminServer.tsx
│   │   │   ├── play/            # Main lobby
│   │   │   └── unauthorized/    # Access denied page
│   │   ├── components/
│   │   │   ├── ui/              # shadcn/ui components
│   │   │   ├── GuestSignUpModal.tsx # Guest conversion modal
│   │   │   └── ...              # Match animations, timers
│   │   ├── lib/
│   │   │   ├── actions.ts       # Server actions (auth, data)
│   │   │   ├── guest-actions.ts # Guest mode server actions
│   │   │   ├── mongodb.ts       # DB singleton
│   │   │   └── redis.ts         # Cache client
│   │   ├── types/
│   │   │   └── bot.d.ts         # Bot type definitions
│   │   └── pages/
│   │       └── match/
│   │           └── MatchClient.tsx  # Real-time match
│   └── package.json
│
└── problems.json                 # Problem library
```

</details>

---

## 🧪 Development

### Useful Commands

   ```bash
# Backend Services
   cd backend
docker-compose logs -f           # View all logs
docker-compose restart [service] # Restart specific service
docker-compose down              # Stop all services

# Frontend
cd client
npm run dev                      # Development server (Turbopack)
npm run build                    # Production build
npm run lint                     # ESLint

# Colyseus Standalone
cd backend/colyseus
npm run dev                      # Watch mode with hot reload
npm run build                    # Compile TypeScript
```

### Key Ports

| Service | Port | Description |
|---------|------|-------------|
| Next.js | 3000 | Frontend app |
| Colyseus | 2567 | Game server (WebSocket) |
| Bot Service | 3000 | AI bot management |
| MongoDB | 27017 | Database |
| Redis | 6379 | Queue & cache |
| MinIO | 9000 | S3 API |
| MinIO Console | 9001 | Web UI |
| Judge0 | 2358 | Code execution |

---

## 🐛 Troubleshooting

<details>
<summary><b>MongoDB Connection Errors</b></summary>

   ```bash
# Check if MongoDB is running
docker-compose ps mongodb

# View logs
docker-compose logs mongodb

# Restart
docker-compose restart mongodb
```

</details>

<details>
<summary><b>Redis Authentication Failed</b></summary>

Ensure passwords match in both `backend/.env` and `client/.env.local`:
```env
REDIS_PASSWORD=redis_dev_password_123
```

Restart Next.js after changing env vars:
   ```bash
cd client
# Stop with Ctrl+C, then
   npm run dev
   ```

</details>

<details>
<summary><b>Judge0 Not Executing Code</b></summary>

```bash
# Check Judge0 services
docker-compose logs judge0-server
docker-compose logs judge0-worker

# Restart both
docker-compose restart judge0-server judge0-worker judge0-db
```

</details>

<details>
<summary><b>MinIO Bucket Not Found</b></summary>

```bash
# Re-run bucket initialization
docker-compose restart minio-init
docker-compose logs minio-init
```

</details>

---

## 🛣️ Roadmap

- [ ] 👥 **Team-based matches** (2v2, 3v3 competitive teams)
- [ ] 🏆 **Tournament brackets** (scheduled events with prizes)
- [ ] 👁️ **Spectator mode** (watch live matches)
- [x] 📊 **Advanced analytics** (code complexity, time metrics)
- [ ] 🎯 **Custom problems** (user-submitted challenges)
- [ ] 🌍 **Regional servers** (reduce latency worldwide)
- [ ] 📱 **Mobile app** (React Native client)

---

## 📦 Deployment

### Development (Docker Compose)

```bash
# Local development - all services in Docker
cd backend
docker-compose up -d

# Check all services
docker-compose ps
```

### Production Architecture

#### Recommended AWS Setup

```mermaid
graph TB
    Internet[Internet] -->|HTTPS| CF[CloudFront CDN]
    CF -->|Static Assets| S3Static[S3 Static Assets]
    CF -->|Dynamic Routes| Lambda[AWS Lambda<br/>Next.js SSR]
    
    Internet -->|WSS/HTTPS| ALB[Application Load Balancer<br/>Public Subnet]
    ALB -->|Private Network| EC2[AWS EC2 - Private Subnet<br/>Colyseus + Judge0 + Redis]
    
    Lambda -->|Server Actions| ALB
    Lambda -->|Database| Atlas[MongoDB Atlas]
    EC2 -->|Database| Atlas
    EC2 -->|S3 API| S3Avatars[AWS S3<br/>Avatar Storage]
    Lambda -->|S3 API| S3Avatars
    
    style EC2 fill:#f9f,stroke:#333,stroke-width:4px
    style ALB fill:#bbf,stroke:#333,stroke-width:2px
    style Lambda fill:#ffa,stroke:#333,stroke-width:2px
    style Internet fill:#ddd,stroke:#333,stroke-width:2px
```

#### Production Services Distribution

| Service | Platform | Notes |
|---------|----------|-------|
| **Frontend (Next.js)** | CloudFront + Lambda | Serverless, auto-scaling, global CDN |
| **Static Assets** | S3 + CloudFront | CSS, JS, images cached at edge |
| **Backend (Colyseus + Judge0)** | AWS EC2 (Private Subnet) | t3.medium or larger |
| **Redis** | Run on EC2 (or ElastiCache) | Low-latency required for matchmaking |
| **MongoDB** | MongoDB Atlas | Managed, backups, monitoring included |
| **Storage (Avatars)** | AWS S3 | Native S3, not MinIO |

---

### 🔒 Production EC2 Security Setup

#### 1️⃣ Keep EC2 Backend in Private Network

**Goal:** Backend should NOT be publicly accessible from the internet.

**Recommended Setup:**

```
VPC (10.0.0.0/16)
├── Public Subnet (10.0.1.0/24)
│   └── Application Load Balancer (ALB)
│       - Security Group: Allow 443 from 0.0.0.0/0
│       - SSL Certificate from ACM
│
└── Private Subnet (10.0.2.0/24)
    └── EC2 Instance (NO PUBLIC IP)
        - Colyseus (port 2567)
        - Judge0 (port 2358)
        - Redis (port 6379)
        - Security Group: Only allow traffic from ALB security group
```

**Security Group Rules:**

```hcl
# ALB Security Group
resource "aws_security_group" "alb" {
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]  # Public HTTPS
  }
  
  egress {
    from_port       = 2567
    to_port         = 2567
    protocol        = "tcp"
    security_groups = [aws_security_group.ec2.id]  # To EC2 only
  }
}

# EC2 Security Group
resource "aws_security_group" "ec2" {
  ingress {
    from_port       = 2567
    to_port         = 2567
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]  # From ALB only
  }
  
  ingress {
    from_port       = 2358
    to_port         = 2358
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]  # Judge0 from ALB
  }
  
  # No public internet access
}
```

**Why Private Subnet?**
- ✅ Backend not exposed to internet attacks
- ✅ Only accessible through ALB
- ✅ ALB handles SSL termination
- ✅ Can still access MongoDB Atlas and S3 via NAT Gateway
- ✅ Better security posture

---

### Production Deployment Steps

#### Step 1: Database (MongoDB Atlas)

```bash
# Create MongoDB Atlas cluster (free tier available)
# 1. Go to https://www.mongodb.com/cloud/atlas
# 2. Create cluster (M10+ for production)
# 3. Whitelist EC2 private IP
# 4. Get connection string
```

**Connection String:**
```
mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/leetbattle?retryWrites=true&w=majority
```

#### Step 2: Storage (AWS S3)

```bash
# Create S3 bucket
aws s3 mb s3://leetbattle-avatars --region us-east-1

# Enable public read for avatars
aws s3api put-bucket-policy --bucket leetbattle-avatars --policy '{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicReadGetObject",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::leetbattle-avatars/*"
  }]
}'

# Configure CORS
aws s3api put-bucket-cors --bucket leetbattle-avatars --cors-configuration '{
  "CORSRules": [{
    "AllowedOrigins": ["https://yourapp.com"],
    "AllowedMethods": ["GET", "PUT", "POST"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"]
  }]
}'
```

#### Step 3: Backend (EC2 in Private Subnet)

```bash
# Launch EC2 instance
# - AMI: Ubuntu 22.04 LTS
# - Instance Type: t3.medium (2 vCPU, 4GB RAM minimum)
# - VPC: Your VPC
# - Subnet: PRIVATE subnet (no auto-assign public IP)
# - Security Group: ec2-backend-sg (allow 2567, 2358 from ALB only)

# SSH via bastion host or AWS Systems Manager Session Manager
# Install Docker
sudo apt update && sudo apt install -y docker.io docker-compose

# Deploy backend
cd /opt
git clone https://github.com/rishabhvenu/LeetBattle.git
cd LeetBattle/backend

# Create .env with PRODUCTION credentials
cat > .env <<EOF
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/leetbattle
REDIS_PASSWORD=$(openssl rand -base64 32)
JUDGE0_POSTGRES_PASSWORD=$(openssl rand -base64 32)
OPENAI_API_KEY=sk-proj-your-production-key
NODE_ENV=production
EOF

# Start services (no MinIO - using S3)
# Remove minio and minio-init from docker-compose or create production override
docker-compose up -d
```

#### Step 4: Application Load Balancer

```bash
# Create Target Group
aws elbv2 create-target-group \
  --name leetbattle-backend \
  --protocol HTTP \
  --port 2567 \
  --vpc-id vpc-xxxxx \
  --health-check-path /

# Register EC2 instance
aws elbv2 register-targets \
  --target-group-arn arn:aws:elasticloadbalancing:... \
  --targets Id=i-xxxxx

# Create ALB in public subnet
aws elbv2 create-load-balancer \
  --name leetbattle-alb \
  --subnets subnet-public1 subnet-public2 \
  --security-groups sg-alb

# Create HTTPS listener (requires SSL cert from ACM)
aws elbv2 create-listener \
  --load-balancer-arn arn:aws:elasticloadbalancing:... \
  --protocol HTTPS \
  --port 443 \
  --certificates CertificateArn=arn:aws:acm:... \
  --default-actions Type=forward,TargetGroupArn=arn:...
```

#### Step 5: Frontend (CloudFront + Lambda)

**Option A: Using SST (Recommended)**

```bash
# Install SST
npm install -g sst

# Initialize SST in client directory
cd client
sst init

# Create sst.config.ts
cat > sst.config.ts <<EOF
import { SSTConfig } from "sst";
import { NextjsSite } from "sst/constructs";

export default {
  config(_input) {
    return {
      name: "leetbattle",
      region: "us-east-1",
    };
  },
  stacks(app) {
    app.stack(function Site({ stack }) {
      const site = new NextjsSite(stack, "site", {
        environment: {
          MONGODB_URI: process.env.MONGODB_URI!,
          NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET!,
          NEXT_PUBLIC_COLYSEUS_HTTP_URL: "https://api.yourapp.com",
          NEXT_PUBLIC_COLYSEUS_WS_URL: "wss://api.yourapp.com",
          AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID!,
          AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY!,
          S3_BUCKET_NAME: "leetbattle-avatars",
          REDIS_HOST: process.env.REDIS_HOST!,
          REDIS_PASSWORD: process.env.REDIS_PASSWORD!,
        },
      });
      
      stack.addOutputs({
        SiteUrl: site.url,
      });
    });
  },
} satisfies SSTConfig;
EOF

# Deploy to AWS
sst deploy --stage production
```

**Option B: Using Serverless Framework**

```bash
# Install Serverless Next.js
npm install -g serverless
npm install --save-dev serverless-nextjs-plugin

# Create serverless.yml
cat > serverless.yml <<EOF
service: leetbattle-frontend

provider:
  name: aws
  runtime: nodejs18.x
  region: us-east-1

plugins:
  - serverless-nextjs-plugin

custom:
  nextjs:
    bucket: leetbattle-nextjs-bucket
    cloudFront:
      priceClass: PriceClass_100
      defaultTTL: 0
      minTTL: 0
      maxTTL: 31536000
EOF

# Deploy
serverless deploy
```

**Environment Variables for Lambda:**

Set in AWS Lambda console or via SST/Serverless config:
```env
MONGODB_URI=mongodb+srv://...       # MongoDB Atlas
NEXTAUTH_SECRET=...                 # Generate with openssl rand -base64 32
NEXT_PUBLIC_COLYSEUS_HTTP_URL=https://api.yourapp.com
NEXT_PUBLIC_COLYSEUS_WS_URL=wss://api.yourapp.com
AWS_ACCESS_KEY_ID=AKIA...          # IAM role (better) or access key
AWS_SECRET_ACCESS_KEY=...
S3_ENDPOINT=https://s3.amazonaws.com
S3_BUCKET_NAME=leetbattle-avatars
REDIS_HOST=10.0.2.10               # EC2 private IP or ElastiCache
REDIS_PASSWORD=your-production-password
OPENAI_API_KEY=sk-proj-...
```

**CloudFront Distribution:**
- Origin 1: S3 bucket (static assets - `_next/static/*`)
- Origin 2: Lambda function URL (SSR pages, API routes)
- Cache behavior: Static assets cached, dynamic content forwarded to Lambda

---

### 🛡️ Edge-Level Protection (AWS WAF + Shield)

#### Use AWS WAF for CloudFront

**This is the first and easiest layer — handled fully by AWS, no code needed.**

Attach WAF to CloudFront and create rate-based rules:

```bash
# Create WAF WebACL
aws wafv2 create-web-acl \
  --name leetbattle-waf \
  --scope CLOUDFRONT \
  --default-action Allow={} \
  --region us-east-1 \
  --rules '[
    {
      "Name": "RateLimitAPI",
      "Priority": 1,
      "Statement": {
        "RateBasedStatement": {
          "Limit": 1000,
          "AggregateKeyType": "IP",
          "ScopeDownStatement": {
            "ByteMatchStatement": {
              "FieldToMatch": {
                "UriPath": {}
              },
              "PositionalConstraint": "STARTS_WITH",
              "SearchString": "/api/"
            }
          }
        }
      },
      "Action": {
        "Block": {}
      },
      "VisibilityConfig": {
        "SampledRequestsEnabled": true,
        "CloudWatchMetricsEnabled": true,
        "MetricName": "RateLimitAPI"
      }
    }
  ]'

# Associate WAF with CloudFront distribution
aws wafv2 associate-web-acl \
  --web-acl-arn arn:aws:wafv2:us-east-1:xxx:global/webacl/leetbattle-waf/xxx \
  --resource-arn arn:aws:cloudfront::xxx:distribution/xxx
```

#### WAF Configuration

| Setting | Value | Purpose |
|---------|-------|---------|
| **Scope** | CloudFront | Edge-level protection |
| **Rule Type** | Rate-based | Limit requests per IP |
| **Limit** | 1000 requests per 5 minutes | Prevent abuse |
| **Action** | Block or Throttle | Stop excessive requests |
| **Path Condition** | `/api/*` or `/actions/*` | Protect server actions |

**✅ Handles:**
- 🛡️ Global DDoS-style spam
- 🤖 Anonymous scraping and bots
- 🚫 API abuse and brute force attempts
- 📊 Provides CloudWatch metrics

#### Additional WAF Rules (Recommended)

```bash
# Block common attack patterns
- SQL Injection protection (AWS Managed Rule)
- XSS protection (AWS Managed Rule)
- Known bad inputs (AWS Managed Rule)
- Geographic restrictions (if needed)

# Example: Add AWS Managed Rules
aws wafv2 update-web-acl \
  --scope CLOUDFRONT \
  --id xxx \
  --name leetbattle-waf \
  --add-managed-rule-group-statement \
    Name=AWSManagedRulesCommonRuleSet
```

#### AWS Shield Standard (Free DDoS Protection)

**Automatically enabled for CloudFront and ALB:**
- ✅ Protection against common DDoS attacks (SYN floods, UDP floods)
- ✅ Automatic attack detection and mitigation
- ✅ No additional cost
- ✅ Works alongside WAF

**Optional: AWS Shield Advanced ($3000/month)**
- 24/7 DDoS Response Team (DRT)
- Advanced attack mitigation
- Cost protection (refunds for scaling costs during attacks)
- Only needed for high-value targets

#### CloudWatch Alarms for WAF

```bash
# Alert on rate limit triggers
aws cloudwatch put-metric-alarm \
  --alarm-name leetbattle-rate-limit-alert \
  --metric-name BlockedRequests \
  --namespace AWS/WAFV2 \
  --statistic Sum \
  --period 300 \
  --threshold 100 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1
```

---

### Alternative: All-in-One VPS Deployment

For simpler deployment (single DigitalOcean/Linode droplet):

```bash
# On VPS with public IP
git clone https://github.com/rishabhvenu/LeetBattle.git
cd LeetBattle

# Set up .env files with production credentials
# Start everything with Docker Compose
cd backend
docker-compose up -d

cd ../client
npm install && npm run build
pm2 start npm --name leetbattle -- start
```

**Pros:** Simple, all-in-one  
**Cons:** Less scalable, single point of failure

---

## 🔒 Security & Rate Limiting

### Application-Level Rate Limiting

**Already Implemented** ✅ - Rate limiting is built into the application using `rate-limiter-flexible` with Redis.

#### Next.js Server Actions (Protected)

| Action Type | Limit | Window | Use Case |
|-------------|-------|--------|----------|
| **Authentication** | 5 requests | 60s | Login, Register |
| **Queue Operations** | 20 requests | 10s | Join/Leave queue |
| **File Uploads** | 2 requests | 60s | Avatar uploads |
| **Admin Actions** | 3 requests | 60s | Problem generation |
| **General Actions** | 10 requests | 10s | Other server actions |

**Protected Actions:**
- ✅ `registerUser()`, `loginUser()` - Auth limiter
- ✅ `enqueueUser()`, `dequeueUser()` - Queue limiter
- ✅ `generatePresignedUploadUrl()` - Upload limiter
- ✅ `generateProblem()`, `verifyProblemSolutions()` - Admin limiter

#### Colyseus Backend (Protected)

**Internal Service Authentication** 🔐 - New security layer for service-to-service communication.

| Endpoint Type | Authentication | Rate Limiting | Endpoints |
|---------------|---------------|---------------|-----------|
| **Internal Admin** | `X-Internal-Secret` | ❌ Bypassed | `/admin/*` (all admin endpoints) |
| **Internal Queue** | `X-Internal-Secret` or `X-Bot-Secret` | ❌ Bypassed | `/queue/enqueue`, `/queue/dequeue`, `/queue/clear` |
| **Public Queue** | None | ✅ 20/10s | `/queue/reservation`, `/reserve/consume` |
| **Public Match** | None | ✅ 50/10s | `/match/snapshot`, `/match/submissions` |
| **Public Private** | None | ✅ 20/10s | `/private/*` (join, room, leave) |

**Internal Authentication Headers:**
```http
X-Internal-Secret: your-secret-token
X-Service-Name: nextjs-actions (optional, for logging)
```

**Bot Service Authentication:**
```http
X-Bot-Secret: your-bot-secret-token
```

**Rate Limit Response (429):**
```json
{
  "error": "rate_limit_exceeded",
  "message": "Too many requests. Please try again in 30 seconds.",
  "retryAfter": 30
}
```

**Authentication Error Response (401):**
```json
{
  "error": "missing_internal_secret"
}
```

**Security Benefits:**
- ✅ Internal endpoints protected from public access
- ✅ Rate limiting bypassed for authenticated services
- ✅ Separate secrets for different service types
- ✅ Docker network isolation provides additional layer
- ✅ DDoS protection maintained for public endpoints

---

## ⚠️ Before Production Deployment

### Required Actions

**1. Rotate All Credentials** 🔑
```bash
# Generate new production secrets
openssl rand -base64 32  # For NEXTAUTH_SECRET
openssl rand -base64 32  # For REDIS_PASSWORD
openssl rand -base64 32  # For JUDGE0_POSTGRES_PASSWORD

# Create new OpenAI key at https://platform.openai.com/api-keys
```

**Update in:**
- ✅ `backend/.env` - Backend services
- ✅ `client/.env.local` - Frontend (for local testing)
- ✅ Lambda environment variables (AWS Console or SST config)

**2. Update Service Endpoints** 🔗
- [ ] Replace MinIO with AWS S3
- [ ] Update MongoDB URI to Atlas connection string
- [ ] Configure S3 bucket CORS for CloudFront domain
- [ ] Update all environment variables in Lambda
- [ ] Point `NEXT_PUBLIC_COLYSEUS_HTTP_URL` to ALB domain

**3. Infrastructure Deployment:** 🏗️

**AWS Setup Required:**
- [ ] VPC with public + private subnets created
- [ ] EC2 launched in private subnet (NO public IP)
- [ ] Application Load Balancer in public subnet
- [ ] Security groups configured (ALB → EC2 only)
- [ ] ACM SSL certificate for ALB domain
- [ ] CloudFront distribution created
- [ ] AWS WAF attached to CloudFront (rate limiting at edge)
- [ ] MongoDB Atlas cluster provisioned
- [ ] S3 bucket created with CORS + policies
- [ ] Lambda deployed via SST or Serverless Framework
- [ ] IAM roles configured for Lambda S3 access
- [ ] CloudWatch alarms set up
- [ ] Route53 DNS pointing to CloudFront

**Already Implemented in Code:** ✅
- [x] Application-level rate limiting (Redis-backed)
- [x] MongoDB connection pooling (singleton pattern)
- [x] Match persistence with validation
- [x] Server Actions using proper Next.js patterns
- [x] Background matchmaker (runs in Colyseus)
- [x] Session management with TTL indexes
- [x] CORS configuration templates

---

## 👥 Maintainers

**Rishabh Ryan Venu** – [@rishabhvenu](https://github.com/rishabhvenu)

Contributions are welcome! See our [Contributing Guide](#-contributing) below.

---

## 🤝 Contributing

We welcome contributions! Here's how to get started:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Development Guidelines

- Follow existing code style (ESLint + Prettier)
- Write clear commit messages
- Add tests for new features
- Update documentation as needed
- Test locally with `docker-compose up`

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

Built with amazing open-source technologies:

- [**Judge0**](https://judge0.com/) - Robust code execution engine
- [**Colyseus**](https://colyseus.io/) - Multiplayer game server framework
- [**Next.js**](https://nextjs.org/) - The React framework for production
- [**shadcn/ui**](https://ui.shadcn.com/) - Beautiful, accessible UI components
- [**Monaco Editor**](https://microsoft.github.io/monaco-editor/) - VS Code's powerful editor
- [**MongoDB**](https://www.mongodb.com/) - Flexible document database
- [**Redis**](https://redis.io/) - In-memory data structure store

---

<div align="center">

**⭐ Star this repo if you found it helpful!**

Built with ❤️ by competitive programmers, for competitive programmers.

[Report Bug](https://github.com/rishabhvenu/LeetBattle/issues) · [Request Feature](https://github.com/rishabhvenu/LeetBattle/issues) · [Documentation](https://github.com/rishabhvenu/LeetBattle/wiki)

</div>
