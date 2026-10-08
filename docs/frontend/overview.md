# Frontend docs

Index for frontend documentation covering the Next.js application and infrastructure.

---

## Core Documentation

| Document | Description |
|----------|-------------|
| `app-architecture.md` | High-level map of the Next.js app structure and rendering strategy |
| `api-integration.md` | REST endpoints, server actions, and environment variables |
| `match-experience.md` | Queue through post-match UI flow, Colyseus WebSocket lifecycle |

---

## Infrastructure

| Document | Description |
|----------|-------------|
| `infra/OIDC_PERMISSIONS.md` | AWS IAM policy and setup for GitHub Actions OIDC deployments |

---

## Cross-Cutting References

Backend documentation relevant to frontend:

| Document | Description |
|----------|-------------|
| `../backend/environment-variables.md` | All environment variables including frontend vars |
| `../backend/deployment.md` | Backend deployment (needed for frontend connectivity) |

---

## Architecture Summary

### Directory Layout

```
client/src/
├── app/                    # Next.js App Router pages
│   ├── layout.tsx         # Root layout, theme providers
│   ├── page.tsx           # Landing page
│   ├── play/              # Authenticated dashboard & queue
│   ├── match/             # Live match experience
│   ├── admin/             # Admin panel (bots/problems)
│   └── settings/          # User settings + profile
├── components/            # Shared UI + feature widgets
│   ├── pages/            # Page-specific orchestrators
│   └── ui/               # shadcn primitives
├── lib/                   # Client/server utilities
│   └── actions/          # Modular server actions
├── constants/             # REST endpoints
├── rest/                  # REST handler
└── types/                 # Type declarations
```

### State & Data Flow

- **REST endpoints** defined in `constants/RestEndpoints.tsx`
- **Server actions** in `lib/actions/` (modular structure)
- **Colyseus WebSocket** lives in match components (`MatchClient.tsx`)
- **Session handling** via a session cookie backed by a MongoDB `sessions` collection

### Key Technologies

- Next.js 15 with App Router
- Tailwind CSS + shadcn/ui
- Framer Motion for animations
- Colyseus for real-time game state

---

## Server actions

| Module | Purpose |
|--------|---------|
| `actions/auth.ts` | Authentication (login, register, logout) |
| `actions/user.ts` | User management (stats, avatars) |
| `actions/queue.ts` | Queue operations (enqueue, dequeue) |
| `actions/match.ts` | Match operations (data, submissions) |
| `actions/problem.ts` | Problem management (LeetCode, generation) |
| `actions/bot.ts` | Bot management (profiles, deployment) |
| `actions/admin.ts` | Admin functions (user management) |
| `actions/matchHistory.ts` | Match history retrieval |

`actions/index.ts` re-exports every module.
