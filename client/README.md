# LeetBattle Client

Next.js 15 frontend for the LeetBattle competitive coding platform.

## Features

- **Real-time Matches**: Live 1v1 coding battles with WebSocket updates
- **Monaco Editor**: VS Code's editor with syntax highlighting
- **Server Actions**: Next.js server actions for authentication and data
- **Responsive UI**: Built with Tailwind CSS and shadcn/ui
- **Match History**: View past matches and statistics
- **Global Leaderboard**: ELO-based ranking system
- **Admin Panel**: Bot management, problem management, user management
- **Bot Opponents**: AI-powered opponents for instant matches
- **Data Structure Support**: ListNode and TreeNode helpers for multiple languages
- **Private Rooms**: Create custom 1v1 matches with room codes
- **Guest Mode**: Play without registration (one-time match)
- **Guest Sign-Up Modal**: Convert guest matches to permanent accounts

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

# Internal Service Authentication
INTERNAL_SERVICE_SECRET=dev_internal_secret
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
│   │   ├── match-history/     # Match history viewing
│   │   ├── admin/             # Admin panel
│   │   │   ├── BotManagement.tsx
│   │   │   ├── ProblemManagement.tsx
│   │   │   ├── UserManagement.tsx
│   │   │   └── ActiveMatches.tsx
│   │   └── settings/          # User settings
│   ├── components/
│   │   ├── ui/                # shadcn/ui components
│   │   ├── Navbar.tsx
│   │   ├── Layout.tsx
│   │   ├── MatchupAnimation.tsx
│   │   ├── MatchResultAnimation.tsx
│   │   └── MatchDetailsModal.tsx
│   ├── pages/                 # Page-level components
│   │   ├── match/
│   │   │   ├── MatchClient.tsx    # Real-time match UI
│   │   │   └── MatchQueue.tsx
│   │   ├── match-history/
│   │   │   └── MatchHistory.tsx   # Match history viewer
│   │   └── ...
│   ├── lib/                   # Core utilities
│   │   ├── actions.ts         # Server actions (auth, data)
│   │   ├── mongodb.ts         # MongoDB client (singleton)
│   │   ├── redis.ts           # Redis client (singleton)
│   │   ├── minio.ts           # S3 client
│   │   └── utilsObjectId.ts   # ObjectId utilities
│   ├── socket/
│   │   └── SocketManager.ts   # WebSocket client
│   └── types/                 # TypeScript definitions
│       ├── bot.d.ts           # Bot type definitions
│       └── ...
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
- `/match` - Live match view (supports guest mode)
- `/match-history` - Match history viewer
- `/leaderboard` - Global rankings
- `/admin` - Admin panel (requires admin access)
  - `/admin/bots` - Bot management
  - `/admin/problems` - Problem management
  - `/admin/users` - User management
  - `/admin/matches` - Active matches monitoring
- `/settings` - User settings
- `/unauthorized` - Access denied page (admin protection)

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

## New Features

### Admin Panel

The admin panel provides comprehensive management capabilities:

#### Bot Management (`/admin/bots`)
- **Create Bots**: Generate new AI bot identities with customizable profiles
- **Deploy/Undeploy**: Dynamically manage bot deployment status
- **Bot Statistics**: View real-time bot performance metrics
- **Bot Configuration**: Adjust bot ratings and difficulty levels
- **Bulk Operations**: Deploy/undeploy multiple bots simultaneously

#### Problem Management (`/admin/problems`)
- **AI Problem Generation**: Create problems using OpenAI GPT-4o-mini
- **Solution Verification**: Automatic solution testing across multiple languages
- **Problem Library**: Manage and organize the problem database
- **Difficulty Assignment**: Set appropriate difficulty levels for problems
- **Bulk Import/Export**: Manage large problem sets efficiently

#### User Management (`/admin/users`)
- **User Analytics**: View user statistics and performance metrics
- **Account Management**: Handle user accounts and permissions
- **Rating Adjustments**: Modify user ratings when necessary
- **Match History**: Access detailed user match histories

#### Active Matches (`/admin/matches`)
- **Live Monitoring**: Real-time view of ongoing matches
- **Match Details**: Detailed match information and progress
- **Performance Metrics**: Track match completion times and success rates

### Match History

The match history feature provides comprehensive match analytics:

- **Complete Match History**: View all past matches with detailed results
- **Performance Analytics**: Track win/loss ratios, rating changes, and trends
- **Match Details**: Detailed breakdown of individual matches
- **Problem Analysis**: See which problems were solved and completion times
- **Rating Progression**: Visual representation of rating changes over time

### Bot Integration

- **Instant Matches**: Bots provide immediate opponents when human players aren't available
- **Realistic Behavior**: Bots use configurable timing distributions for natural completion times
- **ELO-Based Matching**: Bots are matched based on their current ratings
- **Statistics Tracking**: Bot performance is tracked and displayed in admin panel

### Private Rooms

Create custom 1v1 matches with friends:

- **Room Creation**: Generate unique room codes for private matches
- **Problem Selection**: Room creator chooses specific problems
- **Room Joining**: Share room codes with friends to join
- **Match Start**: Creator controls when to start the match
- **10-Minute Timeout**: Rooms automatically expire after 10 minutes
- **Seamless Transition**: Matches follow same rules as competitive matches

### Guest Mode

Play without registration:

- **One-Time Matches**: Play a single match without creating an account
- **7-Day Session**: Guest session stored as cookie for 7 days
- **Automatic Bot Matching**: Guests are automatically matched with AI bots
- **Post-Match Sign-Up**: Prompt to create account and save match results
- **Match Claiming**: Convert guest matches to permanent account after registration
- **Redis Storage**: Guest data stored in Redis with `guest:session:{guestId}` key

### Guest Sign-Up Modal

Seamless account creation flow:

- **Match Result Display**: Shows match results (win/loss/draw, tests passed)
- **Registration Form**: Complete user registration without losing match data
- **Match Preservation**: Guest match automatically claimed for new account
- **No Data Loss**: All match data transferred to permanent account

### Unauthorized Access Page

Enhanced admin panel protection:

- **Access Control**: Dedicated page for unauthorized admin access attempts
- **User-Friendly**: Clear explanation and navigation options
- **Secure Redirect**: Prevents unauthorized users from accessing admin features

### Data Structure Support

Enhanced support for complex data structures:

- **ListNode Support**: Automatic helper code for linked list problems
- **TreeNode Support**: Automatic helper code for binary tree problems
- **Multi-Language**: Support for Python, JavaScript, Java, and C++
- **Automatic Injection**: Helper code is automatically added to editor
- **Serialization**: Built-in serialization/deserialization functions

## Production Deployment

### AWS Lambda + CloudFront (Recommended)

**Deploy Next.js to Lambda using SST:**

```bash
# Install SST
npm install -g sst

# Initialize SST
sst init

# Deploy to AWS
sst deploy --stage production
```

**Environment Variables in Lambda:**
- Set all `.env.local` variables in Lambda configuration
- Update URLs to production domains:
  - `NEXT_PUBLIC_COLYSEUS_HTTP_URL=https://api.yourapp.com`
  - `NEXT_PUBLIC_COLYSEUS_WS_URL=wss://api.yourapp.com`
  - `S3_ENDPOINT=https://s3.amazonaws.com`
- Use MongoDB Atlas connection string
- Configure IAM role for S3 access (preferred over access keys)

**CloudFront Configuration:**
- Origin 1: S3 bucket (static `_next` assets)
- Origin 2: Lambda function URL (SSR, API routes)
- Custom domain with SSL certificate from ACM

See main README.md for complete Lambda deployment guide.

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

