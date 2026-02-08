# ClubScore LAN

ClubScore LAN is a turborepo MVP for clubs that need tennis scoring over local network only.

It includes three user-facing apps plus a LAN core server:

- `@clubscore/setup-web`: browser setup/admin app (courts + match assignment)
- `@clubscore/scoring-android`: Android scorer app (point entry + undo)
- `@clubscore/scoreboard-windows`: native Windows scoreboard app (Tauri)
- `@clubscore/lan-core`: local source-of-truth API/WebSocket server with SQLite

## MVP Constraints

- Tennis only
- Up to 12 simultaneous courts
- Offline LAN operation (no internet required at runtime)
- Scoreboard viewport fixed to `384x256`, full bleed, no edge border
- Scoreboard panel placement supports `Y offset` only in v1
- Discovery path is `mDNS first`, manual `IP:port` fallback

## Monorepo Layout

- `apps/lan-core`
- `apps/setup-web`
- `apps/scoring-android`
- `apps/scoreboard-windows`
- `packages/scoring-core`
- `docs/plans/2026-02-08-clubscore-lan-design.md`

## Install

```bash
bun install
```

## Development

Run all app/package dev tasks:

```bash
bun run dev
```

Typical focused workflows:

```bash
# LAN core server
bun run dev --filter=@clubscore/lan-core

# Setup web app
bun run dev --filter=@clubscore/setup-web

# Android scorer app
bun run start --filter=@clubscore/scoring-android

# Scoreboard web shell (inside Tauri app workspace)
bun run dev --filter=@clubscore/scoreboard-windows
```

If `apps/setup-web/dist` exists, LAN core serves setup UI at `http://<lan-core-ip>:7310/setup`.

## Validation

```bash
bun run check-types
bun run test
bun run build
```

## Native Windows Build (Scoreboard)

From a Windows machine with Rust + Visual Studio Build Tools installed:

```bash
bun run build:native
```

## LAN Core API (v1)

- `GET /health`
- `GET /api/discovery`
- `GET /api/courts`
- `POST /api/courts`
- `POST /api/matches/start`
- `GET /api/matches/active`
- `GET /api/matches/:matchId`
- `POST /api/matches/:matchId/events`
- `POST /api/matches/:matchId/undo`
- `GET /api/scoreboard`
- `GET /ws`

## Deployment Notes

- LAN core should run on the dedicated mini PC.
- Scoreboard app runs on a Windows HDMI source machine feeding NovaStar controller.
- Each scoreboard instance can set different `Y offset` to map panel slices.
