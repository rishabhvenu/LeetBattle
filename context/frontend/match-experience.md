# Match Experience Flow

Debug companion for the match UI. Use it to understand how the frontend talks
to Colyseus, renders state transitions, and handles guest/user divergence.

## Entry Points

- `app/play/page.tsx` – entry to queue; server component fetching session
- `components/pages/match/MatchClient.tsx` – main orchestrator for active
  matches (client component)
- `components/pages/match/MatchQueue.tsx` – handles queue animations and
  triggers Colyseus join
- `components/pages/match/GuestQueue.tsx` – guest-specific queue flow
- `components/pages/match/GuestResult.tsx` – prompts guest to claim match

## WebSocket Lifecycle

1. `MatchQueue` calls REST endpoint (`/api/match/queue`) via actions in
   `lib/actions.ts`
2. Server action responds with reservation (room + seat)
3. `MatchClient` instantiates Colyseus client with
   `NEXT_PUBLIC_COLYSEUS_WS_URL`
4. On `onStateChange`, React state updates drive UI transitions
5. Submission events call server action which in turn posts to Judge0
6. Room events (e.g., `match:ready`, `match:completed`) update progress steps

## Key Components

- `MatchResultAnimation.tsx` – plays finish animations; ensures idempotent
  playback
- `MatchupAnimation.tsx` – entrance animation while connecting to opponent
- `GuestSignUpModal.tsx` – triggered for guest conversions after match
- `CountdownTimer.tsx` – matches server-sent start times

## State Management

- Uses React state/hooks instead of external store
- Server action responses normalized via helper functions in `lib/actions.ts`
- WebSocket message handling centralized in `MatchClient`
- UI-level state (e.g., modals) composed with local state + shadcn dialog

## Troubleshooting

- **WebSocket fails to connect:** Check `NEXT_PUBLIC_COLYSEUS_WS_URL`; ensure
  CORS configured (backend `CORS_ORIGIN`)
- **Queue stuck:** Inspect action return values, verify `queued` and
  `already_in_match` events handled in `MatchQueue`
- **Judge0 result missing:** Confirm server action resolved; inspect backend
  `MatchRoom` logs and see `context/backend/judge0-runbook.md`
- **Guest flow loops:** Validate cookies and session fallback in
  `middleware.ts`

## Testing Tips

- Use `npm run lint` to catch missing dependencies
- Storybook not configured; to test animations, render components in isolation
  inside `/app/debug` route (create if needed)
- Integration tests should mock Colyseus client (wrap with jest mock)

## Related Docs

- `context/frontend/app-architecture.md`
- `context/backend/matchmaking-flow.md`
- `context/backend/judge0-runbook.md`


