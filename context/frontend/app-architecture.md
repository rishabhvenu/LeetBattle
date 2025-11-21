# Frontend App Architecture

Overview of the Next.js 15 application structure, key entry points, and shared
utilities. Use as a field guide when orienting in the `client/` workspace.

## Directory Layout

```
client/
├── src/
│   ├── app/
│   │   ├── layout.tsx            # Root layout, theme providers
│   │   ├── page.tsx              # Landing page
│   │   ├── play/                 # Authenticated dashboard & queue entry
│   │   ├── match/                # Live match experience
│   │   ├── register/, login/     # Auth flows (NextAuth)
│   │   ├── admin/                # Admin panel (bots/problems)
│   │   └── settings/             # User settings + profile
│   ├── components/               # Shared UI + feature widgets
│   │   ├── pages/                # Page-specific orchestrators
│   │   └── ui/                   # shadcn primitives & wrappers
│   ├── lib/                      # Client/server utilities (REST, Redis, auth)
│   ├── constants/RestEndpoints.tsx
│   ├── rest/RestHandler.tsx      # REST wrapper around fetch
│   ├── types/                    # Type declarations
│   └── middleware.ts             # Auth + routing guards
├── public/                       # Static assets (logo, audio cues)
└── infra/                        # CDK infrastructure (see context/frontend/infra)
```

## Rendering Strategy

- **Next.js App Router** with nested layouts
- Mix of Server Components (data fetching) and Client Components (interactive
  match UI)
- Authentication via NextAuth session middleware (`middleware.ts`)
- Uses `app/play/page.tsx` as gateway into queue/match features

## State & Data Flow

- REST endpoints defined in `constants/RestEndpoints.tsx`
- `lib/actions.ts`, `lib/server-actions.ts`, `lib/guest-actions.ts` wrap the
  server actions invoked from forms/buttons
- Colyseus WebSocket client lives in match components (`MatchClient.tsx`)
- Redis interactions (client-side) limited; most caching done server-side

## Styling & UI

- Tailwind CSS + shadcn/ui for base components
- Global styles in `app/globals.css`
- Theme configuration in `themes/codeClashTheme.ts`
- Animations handled in components like `MatchResultAnimation.tsx` using Framer
  Motion

## Testing Hooks

- Important components expose `data-testid` attributes in queue/match flows
- Ensure to import utilities from `client/src/lib/test-utils` (if present) for
  integration tests

## Related Docs

- `context/frontend/overview.md`
- `context/frontend/match-experience.md`
- `context/frontend/api-integration.md`
- `README.md` (root project overview)


