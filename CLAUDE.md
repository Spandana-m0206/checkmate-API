# CLAUDE.md

## Read this first

**[PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md) is the source of truth for this
project.** Before implementing, changing, or reviewing anything in this repo, read it.
It defines the product scope, the data model, which store owns which state, and the
real-time protocol. Do not infer requirements from the code when the two disagree —
the document wins, or the disagreement is a bug worth raising.

Section 17 of that document lists the known open questions. If a task touches one of
them, ask rather than picking silently.

## What this is

Checkmate — the backend API for an online multiplayer chess game. Node.js (ESM),
Express 5, Socket.IO for real-time play, MongoDB via Mongoose for durable data, Redis
for active game state.

## Current state

The repo is a fresh scaffold: `package.json` with dependencies installed, no source
code yet. `main` is `index.js`, which does not exist. There is no test runner (`npm
test` is the default failing stub) and no lint config. If you add source layout,
schemas, or scripts, they are being established for the first time — follow the
document, and keep this file updated as real conventions emerge.

## Tech stack

| Concern | Choice |
| --- | --- |
| Runtime | Node.js, ES modules (`"type": "module"` — use `import`, not `require`) |
| HTTP | Express 5 |
| Real-time | Socket.IO |
| Durable store | MongoDB via Mongoose |
| Active game state | Redis (**client not yet installed** — see open items) |
| Auth | `jsonwebtoken` + `bcrypt` |
| Logging | `winston` |
| Security/middleware | `helmet`, `cors` |
| Config | `dotenv` |
| Dev | `nodemon` |

## Architecture rules

These are load-bearing. Violating them is a defect, not a style choice.

- **The backend validates every move.** The frontend may compute legal moves for
  instant UI feedback, but nothing the client sends is trusted. Turn order, piece
  ownership, legality, and self-check exposure are all checked server-side.
- **Redis holds only the active game state**, one key per game: `game:{gameId}`. One
  current board per game — never `board1`, `board2`, … per move.
- **MongoDB holds history.** Each validated move becomes its own `Move` document as it
  happens, not in a batch at game end. `Game` holds game-level data only; it never
  stores the board.
- **The frontend never talks to Redis.** All access goes through Node.js so
  credentials and infrastructure stay server-side.
- **Passwords are never stored.** Only the `bcrypt` hash, in `passwordHash`.
- **Moves must be idempotent** against network retries — use `lastMove` /
  `moveNumber`, and a client move ID if needed.

## Collections

`User`, `Game`, `Move` — schemas are specified in sections 3, 4, and 5 of the
requirements document. Use those field names and enum values exactly; the history
screen and the Redis state shape both depend on them.

## Conventions

- ES module imports throughout; no CommonJS.
- Secrets and connection strings come from the environment via `dotenv`. Never commit
  a `.env`, and never hardcode a Mongo or Redis URI.
- Log through `winston`, not `console.log`.
- Chess edge cases (castling, en passant, promotion, stalemate, reconnection,
  duplicate moves) are enumerated in section 15. Treat that list as the test checklist
  for the move validator.

## Open items

`package.json` has no Redis client yet, so the active-state layer cannot be built as
specified until one is added. The full list of unresolved decisions — matchmaking
queue design, colour-choice tiebreak, clocks, draw offers, abandonment policy — is in
section 17 of [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md).
