# CodeClashers

A competitive coding platform built with Next.js and MongoDB.

## Project Structure

```
CodeClashers/
├── client/                 # Next.js frontend application
│   ├── src/
│   │   ├── app/           # App Router pages and API routes
│   │   ├── components/    # React components
│   │   ├── lib/          # Utility functions and configurations
│   │   └── types/        # TypeScript type definitions
│   └── package.json
├── backend/               # MongoDB setup and configuration
│   ├── Dockerfile        # MongoDB container configuration
│   ├── docker-compose.yml # Docker Compose for MongoDB
│   ├── init-mongo.js     # MongoDB initialization script
│   └── package.json      # Backend dependencies
└── README.md
```

## Features

- **Session Management**: Server-side session handling with MongoDB storage
- **Turbopack**: Fast development builds with Turbopack instead of Webpack
- **Server Components**: Next.js server components for session management
- **MongoDB Integration**: Persistent session storage in MongoDB
- **Docker Setup**: Easy MongoDB setup with Docker

## Getting Started

### Prerequisites

- Node.js 18+ 
- Docker and Docker Compose
- npm or yarn

### Setup

1. **Start MongoDB with Docker:**
   ```bash
   cd backend
   npm run docker:up
   ```

2. **Install client dependencies:**
   ```bash
   cd client
   npm install
   ```

3. **Set up environment variables:**
   ```bash
   # Copy the example environment file
   cp .env.local.example .env.local
   
   # Edit .env.local with your configuration
   ```

4. **Start the development server:**
   ```bash
   npm run dev
   ```

The application will be available at `http://localhost:3000`.

### Environment Variables

Create a `.env.local` file in the client directory:

```env
# MongoDB Configuration
MONGODB_URI=mongodb://codeclashers_user:codeclashers_pass@localhost:27017/codeclashers
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-nextauth-secret-key-here

# Backend API
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## Session Management

The application uses Next.js server components and API routes for session management:

- **API Routes**: `/api/session` handles login, logout, and session validation
- **Server Components**: `UserProfile`, `LoginForm`, `ProtectedRoute` for UI
- **MongoDB Storage**: Sessions are stored in MongoDB with automatic expiration

## Docker Commands

```bash
# Start MongoDB
npm run docker:up

# Stop MongoDB
npm run docker:down

# View MongoDB logs
npm run docker:logs

# Restart MongoDB
npm run docker:restart
```

## Development

- **Frontend**: Next.js with Turbopack for fast development
- **Backend**: MongoDB with Docker for easy setup
- **Sessions**: Server-side session management with MongoDB storage
- **TypeScript**: Full TypeScript support throughout the application

## License

MIT