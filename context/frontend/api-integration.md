# Frontend API & Actions Reference

Cheat sheet for how the frontend interacts with backend services via REST
endpoints, server actions, and environment variables.

## Environment Variables

- `NEXT_PUBLIC_API_BASE` – base URL for REST calls (falls back to Colyseus HTTP)
- `NEXT_PUBLIC_COLYSEUS_HTTP_URL` / `NEXT_PUBLIC_COLYSEUS_WS_URL` – real-time
  endpoints
- `MONGODB_URI`, `REDIS_HOST`, `REDIS_PORT` – used server-side for actions
- `NEXTAUTH_URL`, `NEXTAUTH_SECRET` – authentication callbacks

Refer to `context/backend/ENV_VAR_AUDIT.md` for full inventory.

## REST Endpoints

Defined in `src/constants/RestEndpoints.tsx` and wrapped by `RestHandler`.

| Endpoint | Purpose | Notes |
|----------|---------|-------|
| `/match/queue` | Queue join / poll | Called from `lib/actions.ts` |
| `/match/leave` | Cancel queue | Updates Redis + Colyseus |
| `/match/submit` | Submit code | Triggers Judge0 submission |
| `/match/history` | Fetch past matches | Used in history page |
| `/bot/deploy` | Admin bot controls | Guarded by internal auth |

REST calls use `RestHandler` which injects authentication headers and handles
JSON parsing + error normalization.

## Server Actions

Located in `src/lib`:

- `actions.ts` – authenticated actions (queue, submit, leave)
- `guest-actions.ts` – guest-specific flows (create guest session, claim match)
- `server-actions.ts` – admin or backend-only actions

All actions ensure environment variables are present and raise descriptive
errors if missing.

## Error Handling

- `RestHandler` throws typed errors with `status` and `context`
- UI components catch and display toasts via `ToastContainer`
- For retryable operations (queue polls), exponential backoff implemented in
  `MatchQueue`

## Debugging Checklist

- [ ] Verify `NEXT_PUBLIC_API_BASE` matches deployed domain
- [ ] Inspect server action logs (Next.js server console) for thrown errors
- [ ] Use browser devtools to confirm network requests hitting expected hosts
- [ ] For CORS issues, check backend `CORS_ORIGIN`
- [ ] Validate cookies for NextAuth; missing session = 401 responses

## Related Docs

- `context/frontend/app-architecture.md`
- `context/frontend/match-experience.md`
- `context/backend/matchmaking-flow.md`
- `context/backend/deployment-runbook.md`


