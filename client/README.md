# LeetBattle Client

Next.js 15 frontend for the LeetBattle competitive coding platform.

## Features

- **Real-time Matches**: Live 1v1 coding battles with WebSocket updates
- **Monaco Editor**: VS Code's editor with syntax highlighting
- **Server Actions**: Next.js server actions for authentication and data
- **Responsive UI**: Built with Tailwind CSS and shadcn/ui
- **Match History**: View past matches and statistics
- **Global Leaderboard**: ELO-based ranking system

## Tech Stack

- **Framework**: Next.js 15 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui, Radix UI
- **Code Editor**: Monaco Editor
- **Real-time**: Colyseus Client
- **Animations**: Framer Motion
- **Database**: MongoDB (via server actions)
- **Storage**: MinIO S3 (avatar uploads)

## Getting Started

### Prerequisites

- Node.js 18+
- Backend services running (see `backend/README.md`)

### Installation

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.local.example .env.local

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Environment Variables

Create `.env.local` from `.env.local.example`:

```env
# MongoDB (user data, sessions, match history)
MONGODB_URI=mongodb://localhost:27017/codeclashers

# Next.js Authentication
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-min-32-chars  # Generate: openssl rand -base64 32

# Colyseus (real-time game server)
NEXT_PUBLIC_COLYSEUS_HTTP_URL=http://localhost:2567
NEXT_PUBLIC_COLYSEUS_WS_URL=ws://localhost:2567

# MinIO (avatar storage - must match backend/.env)
S3_ENDPOINT=http://localhost:9000
AWS_ACCESS_KEY_ID=your_minio_username
AWS_SECRET_ACCESS_KEY=your_minio_password
S3_BUCKET_NAME=codeclashers-avatars

# Redis (must match backend/.env)
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password
```

## Project Structure

```
client/
├── src/
│   ├── app/                    # Next.js 15 App Router
│   │   ├── layout.tsx         # Root layout
│   │   ├── page.tsx           # Home page
│   │   ├── login/             # Authentication pages
│   │   ├── match/             # Live match view
│   │   ├── queue/             # Matchmaking queue
│   │   ├── play/              # Main lobby
│   │   ├── leaderboard/       # Global rankings
│   │   └── settings/          # User settings
│   ├── components/
│   │   ├── ui/                # shadcn/ui components
│   │   ├── Navbar.tsx
│   │   ├── Layout.tsx
│   │   ├── MatchupAnimation.tsx
│   │   └── MatchResultAnimation.tsx
│   ├── pages/                 # Page-level components
│   │   ├── match/
│   │   │   ├── MatchClient.tsx    # Real-time match UI
│   │   │   └── MatchQueue.tsx
│   │   └── ...
│   ├── lib/                   # Core utilities
│   │   ├── actions.ts         # Server actions (auth, data)
│   │   ├── mongodb.ts         # MongoDB client (singleton)
│   │   ├── redis.ts           # Redis client (singleton)
│   │   ├── minio.ts           # S3 client
│   │   └── queueWorker.ts     # Background matchmaking
│   ├── socket/
│   │   └── SocketManager.ts   # WebSocket client
│   └── types/                 # TypeScript definitions
└── problems.json              # Problem library
```

## Development

### Available Scripts

```bash
npm run dev          # Start development server (with Turbopack)
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
```

### Key Routes

- `/` - Home page
- `/landing` - Landing page (public)
- `/login` - Login page
- `/register` - Registration
- `/play` - Main lobby (requires auth)
- `/queue` - Matchmaking queue
- `/match` - Live match view
- `/leaderboard` - Global rankings
- `/settings` - User settings

## Architecture Notes

### Server Components vs Client Components

- **Server Components** (default): `/match`, `/queue`, `/play` pages
  - Fetch session data on server
  - Better performance, no client-side loading states

- **Client Components** (`'use client'`): Interactive components
  - Monaco Editor
  - Match animations
  - Forms with local state

### Server Actions

All authentication and data operations use Next.js server actions:
- `loginUser`, `registerUser`, `logoutUser`
- `getSession`, `getUserStatsCached`
- `persistMatchFromState`

### Real-time Communication

- **Colyseus Client**: Match state synchronization
- **WebSocket**: Live opponent updates
- **Redis Pub/Sub**: Match events (via server actions)

### State Management

- **Server State**: MongoDB (via server actions)
- **Cache**: Redis (session data, user stats)
- **Real-time State**: Colyseus rooms
- **Client State**: React hooks (local UI state)

## Production Deployment

### Vercel (Recommended for Frontend)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

**Environment Variables:**
- Add all `.env.local` variables in Vercel dashboard
- Update URLs to production domains
- ⚠️ Queue worker won't work - deploy Colyseus separately

### Self-Hosted

```bash
# Build
npm run build

# Start with PM2
pm2 start npm --name "leetbattle-client" -- start

# Or with custom port
PORT=3000 npm start
```

## Troubleshooting

### MongoDB Connection Errors
- Check `MONGODB_URI` in `.env.local`
- Ensure MongoDB is running (`docker-compose ps` in backend/)
- Test connection: `mongosh mongodb://localhost:27017/codeclashers`

### Colyseus Connection Failed
- Verify Colyseus is running on port 2567
- Check `NEXT_PUBLIC_COLYSEUS_WS_URL` matches
- View backend logs: `docker-compose logs colyseus`

### Avatar Upload Fails
- Ensure MinIO credentials match backend `.env`
- Check bucket exists: http://localhost:9001
- Verify CORS settings in `backend/minio-init/init.sh`

### Redis Authentication Errors
- Ensure `REDIS_PASSWORD` matches backend `.env`
- Restart Next.js after changing environment variables

## License

MIT

