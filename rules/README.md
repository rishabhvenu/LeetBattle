# Development Guidelines

- Clarify the goal before coding: confirm requirements, upstream/downstream dependencies, and constraints so the change stays scoped and intentional.
- Mirror established structure: reuse existing patterns, naming, and architectural boundaries; place new modules alongside their peers and update supporting docs/configs when layout shifts.
- Prefer smaller modules: split large features across cohesive files or directories instead of letting any single file grow unwieldy; extract shared helpers into reusable utilities.
- Keep functions focused: ensure functions have a single responsibility, keep control flow linear, enforce type or interface contracts, and comment only when intent isn’t immediately obvious.
- Manage data deliberately: minimize shared mutable state, validate inputs early, and surface errors with actionable context rather than swallowing them silently.
- Handle concurrency carefully: follow existing async/locking patterns, guard against race conditions, and highlight fragile sections so future maintainers can spot them quickly.
- Optimize only after clarity: ship the readable solution first, profile before tuning, and document why any optimization or trade-off exists.
- Back changes with tests: expand unit/integration coverage for new logic or regressions, keep tests deterministic and fast, and record manual verification steps if automation is missing.
- Organize the repo continuously: clean up dead assets, keep dependency manifests accurate, and ensure feature directories remain coherent as the project evolves.
- Communicate cleanly: keep diffs scoped, summarize intent and impact when handing off work, and flag follow-up items such as migrations, config tweaks, or deployment steps.
- Always review the `context/` folder: scan it for design notes, shared constants, and prior art before coding so new work aligns with project-wide decisions.
- Update the `context/` folder when necessary: when making architectural changes, design decisions, or modifications to shared constants, update the relevant context documentation to keep it current and accurate.
