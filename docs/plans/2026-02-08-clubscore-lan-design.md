# ClubScore LAN MVP Design (2026-02-08)

## Problem

Clubs need match scoring that works on a private LAN without any external internet dependency, with separate setup, scoring, and scoreboard applications.

## Success Criteria

- Tennis match scoring works end-to-end on LAN only.
- System handles up to 12 simultaneous courts.
- Scoreboard renders full bleed at exactly 384x256.
- Scoreboard supports per-instance Y offset for stacked LED panel slicing.
- Discovery tries mDNS first and falls back to manual IP:port.

## Architecture Decision

Use a central LAN server with three clients.

- LAN core server on dedicated mini PC: Node.js, Fastify, WebSocket, SQLite.
- Setup app: browser-based admin app.
- Scoring app: Android app (Expo-based).
- Scoreboard app: native Windows app (Tauri).

This yields one source of truth for scoring state, deterministic recovery after reconnect, and simple panel routing.

## In Scope (v1)

- Tennis only.
- Up to 12 simultaneous courts.
- Setup app can create courts and start matches.
- Scoring app can award points and undo.
- Scoreboard app can show live court tiles in a virtual wall, cropped to 384x256 viewport with Y offset.

## Out of Scope (v1)

- Pickleball or other sports.
- Arbitrary X/Y wall geometry (Y only in v1).
- Cloud sync, external internet integrations, remote viewers.
- Advanced auth/roles.
- Advanced analytics/history dashboards.

## Data Model

- `courts`: metadata for each court.
- `matches`: active/completed matches and team names.
- `score_events`: append-only event log (`point_won` in v1).
- `match_snapshots`: current computed state for fast reads.

## Event Flow

1. Setup app creates/assigns courts and starts matches.
2. Scoring app posts scoring events with sequence assumptions.
3. Server validates and applies events to snapshots.
4. Server emits realtime updates over WebSocket.
5. Scoreboard app re-renders panels from current match snapshots.

## Reliability and Failure Handling

- Event log + snapshot dual-write gives auditability and quick reads.
- Sequence mismatch returns `409`; client refetches and retries.
- On reconnect, clients pull active snapshot and continue.
- Undo uses deterministic replay after removing latest event.
- If mDNS fails, clients use manually configured IP:port.
- Server startup is offline-safe: no external services required.

## Testing Strategy

- Unit tests for tennis scoring transitions and undo replay.
- Integration tests for API endpoints (court creation, match start, score event).
- WebSocket smoke test: scorer event triggers scoreboard update.
- Manual UAT on LAN:
  - Disconnect/reconnect scorer during live match.
  - Kill and restart server, ensure snapshot recovery.
  - Verify scoreboard viewport remains exact 384x256 with no border.
  - Verify Y offset maps panel slice correctly.
