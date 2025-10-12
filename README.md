# LeetBattle 🏆

A real-time competitive coding platform where developers face off in timed coding challenges. Built with Next.js, Colyseus, and Judge0 for a seamless multiplayer coding experience.

## 🎯 Features

- **Real-Time Matches**: 1v1 competitive coding matches with live updates via Colyseus
- **Code Execution**: Run and test code in 89+ languages using Judge0
- **Matchmaking System**: ELO-based matchmaking with Redis-powered queue
- **Live Rankings**: Global leaderboard with rating system
- **Session Management**: Secure authentication with MongoDB
- **Problem Library**: Curated coding problems with test cases
- **Avatar System**: Profile pictures stored in MinIO (S3-compatible)
- **Match History**: Persistent match records and statistics

## 📁 Project Structure

```
LeetBattle/
├── backend/                      # Backend infrastructure
│   ├── colyseus/                # Real-time game server
│   │   ├── src/
│   │   │   ├── index.ts         # Colyseus server entry
│   │   │   ├── rooms/           # Game room logic
│   │   │   │   ├── MatchRoom.ts # Competitive match room
│   │   │   │   └── QueueRoom.ts # Matchmaking queue
│   │   │   ├── lib/
│   │   │   │   ├── codeRunner.ts    # Judge0 integration
│   │   │   │   ├── judge0.ts        # Judge0 API client
│   │   │   │   ├── testExecutor.ts  # Test case runner
│   │   │   │   ├── problemData.ts   # Problem management
│   │   │   │   ├── queue.ts         # Matchmaking logic
│   │   │   │   └── redis.ts         # Redis client
│   │   │   └── workers/
│   │   │       └── matchmaker.ts    # Background matchmaker
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── docker-compose.yml       # All services orchestration
│   ├── minio-init/
│   │   └── init.sh              # MinIO bucket setup
│   ├── .env                     # Development credentials
│   └── README.md
│
├── client/                       # Next.js frontend
│   ├── src/
│   │   ├── app/                 # Next.js 15 App Router
│   │   │   ├── layout.tsx       # Root layout
│   │   │   ├── page.tsx         # Home page
│   │   │   ├── login/           # Authentication
│   │   │   ├── register/
│   │   │   ├── play/            # Main lobby
│   │   │   ├── queue/           # Matchmaking queue
│   │   │   ├── match/           # Active match view
│   │   │   ├── leaderboard/     # Global rankings
│   │   │   ├── settings/        # User settings
│   │   │   └── learning/        # Practice mode
│   │   ├── components/
│   │   │   ├── ui/              # shadcn/ui components
│   │   │   ├── Navbar.tsx       # Navigation
│   │   │   ├── Layout.tsx       # Page layout wrapper
│   │   │   ├── MatchupAnimation.tsx
│   │   │   └── MatchResultAnimation.tsx
│   │   ├── pages/               # Page-level components
│   │   │   ├── match/
│   │   │   │   ├── MatchClient.tsx  # Real-time match UI
│   │   │   │   └── MatchQueue.tsx   # Queue UI
│   │   │   ├── Home.tsx
│   │   │   ├── Landing.tsx
│   │   │   ├── Play.tsx
│   │   │   └── Settings.tsx
│   │   ├── lib/                 # Core utilities
│   │   │   ├── actions.ts       # Server actions (auth, data)
│   │   │   ├── mongodb.ts       # MongoDB singleton
│   │   │   ├── redis.ts         # Redis singleton
│   │   │   ├── minio.ts         # S3 client
│   │   │   ├── queueWorker.ts   # Background queue worker
│   │   │   └── matchEventsSubscriber.ts
│   │   ├── socket/
│   │   │   └── SocketManager.ts # WebSocket client
│   │   ├── types/               # TypeScript definitions
│   │   └── middleware.ts        # Auth middleware
│   ├── problems.json            # Problem library
│   ├── .env.local               # Client environment
│   ├── tailwind.config.js
│   └── package.json
│
└── README.md                     # This file
```

## 🛠️ Tech Stack

### Frontend
- **Next.js 15** - React framework with App Router
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **shadcn/ui** - UI component library
- **Monaco Editor** - Code editor (VS Code engine)
- **Colyseus Client** - Real-time state sync
- **Framer Motion** - Animations

### Backend
- **Colyseus** - Real-time game server
- **MongoDB** - User data, sessions, match history
- **Redis** - Matchmaking queue, caching, pub/sub
- **Judge0** - Code execution engine (89+ languages)
- **MinIO** - S3-compatible object storage (avatars)
- **Docker** - Containerization

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18+
- **Docker** and **Docker Compose**
- **npm** or **pnpm**

### 1. Clone the Repository

```bash
git clone https://github.com/rishabhvenu/LeetBattle.git
cd LeetBattle
```

### 2. Start Backend Services

   ```bash
   cd backend
docker-compose up -d
```

This starts:
- MongoDB (port 27017)
- Redis (port 6379)
- MinIO (ports 9000, 9001)
- Judge0 Server (port 2358)
- Judge0 Worker
- Colyseus Server (port 2567)

**Verify services are running:**
```bash
docker-compose ps
```

### 3. Set Up Client

   ```bash
cd ../client
   npm install
   ```

**Environment is already configured** in `.env.local`:
- MongoDB URI
- Redis connection
- MinIO credentials
- Colyseus WebSocket URL

### 4. Start Development Server

   ```bash
   npm run dev
   ```

The application will be available at **http://localhost:3000**

## 📝 Environment Variables

### Backend (`backend/.env`)
```env
# MinIO (S3-compatible storage)
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin123

# Redis
REDIS_PASSWORD=redis_dev_password_123

# Judge0 Database
JUDGE0_POSTGRES_PASSWORD=judge0_secure_pass_456

# Colyseus
NODE_ENV=development
```

### Client (`client/.env.local`)
```env
# MongoDB
MONGODB_URI=mongodb://localhost:27017/codeclashers

# Next.js Auth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=dev-secret-key-change-in-production

# Colyseus (Real-time game server)
NEXT_PUBLIC_COLYSEUS_HTTP_URL=http://localhost:2567
NEXT_PUBLIC_COLYSEUS_WS_URL=ws://localhost:2567

# MinIO (Avatar storage)
S3_ENDPOINT=http://localhost:9000
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin123
S3_BUCKET_NAME=codeclashers-avatars

# Redis
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=redis_dev_password_123
```

## 🎮 How It Works

### Match Flow

1. **Queue Up**: User clicks "Find Match" → joins Redis-backed queue
2. **Matchmaking**: Background worker pairs users by ELO rating
3. **Match Start**: Colyseus creates a `MatchRoom`, both players connect via WebSocket
4. **Live Coding**: Players write code, run tests, submit solutions in real-time
5. **Execution**: Code sent to Judge0, results streamed back via Colyseus
6. **Match End**: First to pass all tests wins, ELO ratings updated
7. **Persistence**: Match results saved to MongoDB, Redis queue cleaned up

### Architecture Highlights

- **Server Actions**: Next.js server actions for auth, data fetching
- **Connection Pooling**: MongoDB singleton pattern (17x fewer connections)
- **Real-time Sync**: Colyseus handles state sync, WebSocket reconnection
- **Background Workers**: Queue processor runs in Node.js child process
- **Event Subscribers**: Redis pub/sub for match events, result persistence

## 🧪 Development

### Useful Commands

```bash
# Backend
cd backend
docker-compose up -d          # Start all services
docker-compose logs -f        # View logs
docker-compose down           # Stop all services
docker-compose restart        # Restart services

# Client
cd client
npm run dev                   # Start dev server (with Turbopack)
npm run build                 # Production build
npm run start                 # Start production server
npm run lint                  # Run ESLint

# Colyseus (if running standalone)
cd backend/colyseus
npm run dev                   # Development mode
npm run build                 # Compile TypeScript
npm run start                 # Start compiled server
```

### Key Services & Ports

| Service | Port | Description |
|---------|------|-------------|
| Next.js Client | 3000 | Frontend application |
| Colyseus Server | 2567 | Real-time game server |
| MongoDB | 27017 | Database |
| Redis | 6379 | Queue & caching |
| MinIO | 9000 | S3 API |
| MinIO Console | 9001 | Web UI |
| Judge0 API | 2358 | Code execution |

### Accessing Services

- **Client**: http://localhost:3000
- **MinIO Console**: http://localhost:9001 (minioadmin / minioadmin123)
- **MongoDB**: `mongodb://localhost:27017/codeclashers`

## 🐛 Troubleshooting

### Common Issues

**MongoDB connection errors:**
```bash
# Check if MongoDB is running
docker-compose ps
# Restart if needed
docker-compose restart mongodb
```

**Redis authentication errors:**
- Ensure `REDIS_PASSWORD` matches in `backend/.env` and `client/.env.local`
- Restart Next.js dev server after changing env vars

**Judge0 not executing code:**
```bash
# Check Judge0 worker is running
docker-compose logs judge0-worker
# Restart Judge0 services
docker-compose restart judge0-server judge0-worker
```

**MinIO bucket not found:**
```bash
# Re-run initialization
docker-compose restart minio-init
```

## 🔐 Security Notes

### Development Credentials
- `.env` files are committed with **development credentials only**
- Safe for local development and testing

### Production Deployment
⚠️ **Before deploying to production:**
1. Generate strong passwords for all services
2. Update all `.env` files with production credentials
3. Enable SSL/TLS for all connections
4. Set `NODE_ENV=production`
5. Use secrets management (AWS Secrets Manager, etc.)
6. Never commit production credentials to git

## 📦 Deployment

### Docker Compose (Recommended)

1. Update environment variables in `backend/.env`
2. Build and start all services:
```bash
docker-compose -f backend/docker-compose.yml up -d --build
```

### Separate Deployments

- **Frontend**: Deploy Next.js to Vercel, Netlify, or any Node.js host
- **Backend**: Deploy Colyseus to DigitalOcean, AWS EC2, or Railway
- **Database**: Use MongoDB Atlas for managed MongoDB
- **Storage**: Use AWS S3 instead of MinIO
- **Cache**: Use Redis Cloud or AWS ElastiCache

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License.

## 🙏 Acknowledgments

- [Judge0](https://judge0.com/) - Code execution engine
- [Colyseus](https://colyseus.io/) - Real-time game server framework
- [Next.js](https://nextjs.org/) - React framework
- [shadcn/ui](https://ui.shadcn.com/) - Beautiful UI components
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) - VS Code's editor

---

**Built with ❤️ for competitive programmers**

Repository: https://github.com/rishabhvenu/LeetBattle
