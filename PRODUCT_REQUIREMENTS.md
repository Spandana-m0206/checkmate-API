# Checkmate — Product Requirements & Backend Architecture

Online multiplayer chess. This document is the source of truth for product scope,
data model, state ownership, and real-time behaviour of the backend.

---

## 1. Product Requirements

### User flow

```text
User
  |
  v
Login / Authentication
  |
  v
Find available opponent
  |
  v
Opponent found
  |
  +-----------------------------+
  |                             |
  v                             v
Choose White / Black       Random assignment
  |                             |
  +-------------+---------------+
                |
                v
             Game starts
                |
                v
          Real-time gameplay
                |
                v
             Game ends
                |
                v
        Persist final result
                |
                v
          Game History
```

### Requirements

1. User must authenticate before playing.
2. After authentication, the user can enter the online chess game.
3. The system checks for an available opponent.
4. When an opponent is found:
   - User can choose White.
   - User can choose Black.
   - Or the system can randomly assign the colors.
5. The game is played in real time.
6. Moves are exchanged through WebSocket / Socket.IO.
7. Active game state is maintained in Redis.
8. Move history is persisted in a separate MongoDB `Move` collection.
9. When the game ends, the final game result is persisted.
10. Users can open History and see:
    - Games they won.
    - Games they lost.
    - Drawn games, if applicable.
    - The opponent.
    - The complete sequence of their moves.
    - The complete sequence of the opponent's moves.
11. After the game ends, the frontend shows the game-end state for 30 seconds before
    navigating away / closing the game screen as required by the product flow.

---

## 2. ERD

Three main MongoDB collections.

```text
+--------------------+
|       USER         |
+--------------------+
| _id                |
| username           |
| email              |
| passwordHash       |
| createdAt          |
| updatedAt          |
+---------+----------+
          |
          | 1
          |
          | N
          v
+--------------------+
|       GAME         |
+--------------------+
| _id                |
| whitePlayerId      | ------> User
| blackPlayerId      | ------> User
| winnerId           | ------> User / null
| status             |
| result             |
| startedAt          |
| endedAt            |
| totalMoves         |
+---------+----------+
          |
          | 1
          |
          | N
          v
+--------------------+
|       MOVE         |
+--------------------+
| _id                |
| gameId             | ------> Game
| moveNumber         |
| playerId           | ------> User
| from               |
| to                 |
| piece              |
| capturedPiece      |
| promotion          |
| notation           |
| createdAt          |
+--------------------+
```

### Relationship

```text
User
  |
  +------ plays ------> Game
                           |
                           +------ contains ------> Move
```

A `Move` is a separate MongoDB document.
There is **not** a separate board document for every move.

---

## 3. User Schema

```js
const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true
    },

    email: {
      type: String,
      required: true,
      unique: true
    },

    passwordHash: {
      type: String,
      required: true
    }
  },
  {
    timestamps: true
  }
);
```

The password itself is never stored. The password is hashed using `bcrypt`.

---

## 4. Game Schema

```js
const gameSchema = new mongoose.Schema(
  {
    whitePlayerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    blackPlayerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    winnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },

    status: {
      type: String,
      enum: [
        "ACTIVE",
        "COMPLETED",
        "ABANDONED"
      ],
      default: "ACTIVE"
    },

    result: {
      type: String,
      enum: [
        "WHITE_WIN",
        "BLACK_WIN",
        "DRAW",
        "RESIGNATION",
        "CHECKMATE",
        "TIMEOUT",
        null
      ],
      default: null
    },

    startedAt: {
      type: Date,
      default: Date.now
    },

    endedAt: {
      type: Date,
      default: null
    },

    totalMoves: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);
```

The `Game` document contains game-level information.
It does **not** contain the complete board after every move.

---

## 5. Move Schema

Moves are stored separately.

```js
const moveSchema = new mongoose.Schema(
  {
    gameId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Game",
      required: true,
      index: true
    },

    moveNumber: {
      type: Number,
      required: true
    },

    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    from: {
      type: String,
      required: true
    },

    to: {
      type: String,
      required: true
    },

    piece: {
      type: String,
      required: true
    },

    capturedPiece: {
      type: String,
      default: null
    },

    promotion: {
      type: String,
      default: null
    },

    notation: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);
```

Example:

```json
{
  "gameId": "game123",
  "moveNumber": 1,
  "playerId": "whiteUser",
  "from": "e2",
  "to": "e4",
  "piece": "pawn",
  "capturedPiece": null,
  "promotion": null,
  "notation": "e4"
}
```

Next move:

```json
{
  "gameId": "game123",
  "moveNumber": 2,
  "playerId": "blackUser",
  "from": "e7",
  "to": "e5",
  "piece": "pawn",
  "capturedPiece": null,
  "promotion": null,
  "notation": "e5"
}
```

This allows the history screen to reconstruct:

```text
1. e4       e5
2. Nf3      Nc6
3. Bb5      a6
...
```

---

## 6. Redis — Active Game State

Redis is used only for the **currently active game state**.

Redis key:

```text
game:{gameId}
```

Example:

```text
game:game123
```

Value:

```json
{
  "gameId": "game123",

  "whitePlayerId": "userA",
  "blackPlayerId": "userB",

  "currentTurn": "white",

  "board": [
    ["BR","BN","BB","BQ","BK","BB","BN","BR"],
    ["BP","BP","BP","BP","BP","BP","BP","BP"],
    [null,null,null,null,null,null,null,null],
    [null,null,null,null,null,null,null,null],
    [null,null,null,null,null,null,null,null],
    [null,null,null,null,null,null,null,null],
    ["WP","WP","WP","WP","WP","WP","WP","WP"],
    ["WR","WN","WB","WQ","WK","WB","WN","WR"]
  ],

  "castlingRights": {
    "whiteKingSide": true,
    "whiteQueenSide": true,
    "blackKingSide": true,
    "blackQueenSide": true
  },

  "enPassantTarget": null,

  "moveNumber": 1,

  "status": "ACTIVE",

  "lastMove": null
}
```

The board is stored as part of the active game state.

We do **not** create:

```text
board1
board2
board3
...
```

for every move. There is one current board in Redis.
The moves themselves are stored separately in MongoDB.

---

## 7. Why Redis Is Used

Without Redis:

```text
Every move
    |
    v
MongoDB
    |
    v
Read current game state
    |
    v
Validate move
    |
    v
Write state
```

This unnecessarily uses MongoDB for the constantly changing active state.

With Redis:

```text
Game starts
    |
    v
Initial state -> Redis

Every move
    |
    v
Redis GET
    |
    v
Validate
    |
    v
Redis SET
```

MongoDB is used for the durable move record and final game information.

---

## 8. Node.js Must Be Between Frontend and Redis

The frontend does not directly connect to Redis.

Correct:

```text
React / React Native
        |
        | WebSocket
        v
     Node.js
        |
        | Redis client
        v
      Redis
```

Incorrect:

```text
React / React Native
        |
        v
      Redis
```

Redis credentials and infrastructure access remain server-side.

---

## 9. WebSocket / Socket.IO Flow

Socket.IO is used for the active game.

### Game connection

```text
Player A
    |
    | connect + authentication
    v
Node.js
    |
    v
Game room: game123
```

Player B joins the same room:

```text
Player A ----\
              \
               > Socket.IO room: game123
              /
Player B ----/
```

---

## 10. Starting a Game

```text
User authenticates
        |
        v
Find available user
        |
        v
Opponent found
        |
        +-------------------------+
        |                         |
        v                         v
User chooses color          Random assignment
        |                         |
        +------------+------------+
                     |
                     v
                Create Game
                     |
                     v
             Initialize Redis
                     |
                     v
             Join Socket.IO room
                     |
                     v
                 Game starts
```

The `Game` document is created in MongoDB.
The initial active state is placed in Redis.
Both players join the corresponding Socket.IO room.

---

## 11. Move Flow

Example:

```text
White moves e2 -> e4
```

Frontend sends:

```json
{
  "gameId": "game123",
  "from": "e2",
  "to": "e4"
}
```

Backend:

```text
Socket.IO
    |
    v
Node.js
    |
    v
Redis GET game:game123
    |
    v
Validate:
    - Is game active?
    - Is it this player's turn?
    - Does the piece belong to the player?
    - Is e2 -> e4 legal?
    - Does the move expose the king?
    |
    v
If valid
    |
    +------> Update Redis current board
    |
    +------> Create Move document in MongoDB
    |
    +------> Update Game.totalMoves
    |
    +------> Broadcast move through Socket.IO
```

---

## 12. Move Persistence

For every successfully validated move:

```text
                 MOVE
                   |
          +--------+--------+
          |                 |
          v                 v
       Redis             MongoDB
   current state       Move document
          |                 |
          v                 v
      current board      history
```

Redis tells us what is happening now.
MongoDB remembers what happened.

Do not wait until the end of the game to create all move records if the move
history is important.

---

## 13. Game End

A game can end through:

- Checkmate
- Resignation
- Timeout
- Draw
- Stalemate

When the game ends:

```text
Current Redis state
        |
        v
Determine final result
        |
        v
MongoDB Game document
        |
        +-- status = COMPLETED
        +-- winnerId
        +-- result
        +-- endedAt
        +-- totalMoves
        |
        v
Remove/expire active Redis key
```

Example:

```text
game:game123
```

is no longer required once the game is completed and persisted.

---

## 14. History Requirement

The user should have a History section.

Example:

```text
MY GAMES

Game 1
You vs Rahul
Result: WIN

Game 2
Priya vs You
Result: LOSS

Game 3
You vs Amit
Result: DRAW
```

When the user selects a game:

```text
GET /games/:gameId
```

Backend gets:

```text
Game document
+
Move documents where gameId = selected game
```

Moves are sorted by:

```text
moveNumber ASC
```

Then the frontend displays:

```text
1. e4       e5
2. Nf3      Nc6
3. Bb5      a6
4. Ba4      Nf6
...
```

The user can see both:

```text
My moves
Opponent moves
```

for that specific game.

---

## 15. Chess Playing Edge Cases

The backend must account for these while a game is active.

### 15.1 Wrong turn

White tries to move while it is Black's turn.

```text
Reject move
```

### 15.2 Invalid move

Example:

```text
Pawn e2 -> e5
```

when it is not a valid pawn move.

```text
Reject move
```

### 15.3 Moving opponent's piece

White attempts to move a black piece.

```text
Reject move
```

### 15.4 Move exposes own king

A piece appears to be able to move, but moving it exposes the player's king.

```text
Reject move
```

### 15.5 Check

After a move:

```text
Opponent king is attacked
```

Game remains active, but state becomes check.

### 15.6 Checkmate

After a move:

```text
Opponent king is in check
+
Opponent has no legal moves
```

Game ends.

### 15.7 Stalemate

```text
Opponent is not in check
+
Opponent has no legal moves
```

Game ends as a draw.

### 15.8 Castling

Need to validate:

- King has not moved
- Relevant rook has not moved
- Squares between them are empty
- King is not currently in check
- King does not pass through an attacked square
- King does not end on an attacked square

### 15.9 En passant

Requires knowledge of the previous pawn move.
This is why `enPassantTarget` belongs in the Redis game state.

### 15.10 Promotion

When a pawn reaches the final rank:

```text
Queen
Rook
Bishop
Knight
```

must be selected. The backend validates the promotion request.

### 15.11 Resignation

Player can resign:

```text
Player A resigns
       |
       v
Player B wins
       |
       v
Game completed
```

### 15.12 Timeout

If chess clocks are part of the game:

```text
Player's clock reaches zero
       |
       v
Game ends
```

The exact timer implementation can be maintained in the active game state.

### 15.13 Player disconnects

If a player disconnects:

```text
Socket disconnected
       |
       v
Keep active game state in Redis
       |
       v
Allow reconnection
```

The game should not immediately lose its state just because the socket
disconnected. The product can define whether a prolonged disconnect becomes an
abandonment/forfeit.

### 15.14 Reconnection

When the player reconnects:

```text
Player reconnects
       |
       v
Authenticate
       |
       v
Rejoin game room
       |
       v
Read current state from Redis
       |
       v
Send current board/state
       |
       v
Frontend synchronizes
```

### 15.15 Duplicate move request

The same move could potentially be sent twice due to network/retry behaviour.
The backend should ensure a move is not processed twice.

Useful state:

```text
lastMove
moveNumber
```

and/or a client-generated move/request ID if required.

---

## 16. Final Backend Architecture

```text
                         React / React Native
                                  |
                           Socket.IO / HTTP
                                  |
                                  v
                         +------------------+
                         |     Node.js      |
                         |                  |
                         | Auth             |
                         | Game Service     |
                         | Chess Validation |
                         | Socket.IO        |
                         +--------+---------+
                                  |
                     +------------+------------+
                     |                         |
                     v                         v
                +---------+               +---------+
                |  Redis  |               | MongoDB |
                |         |               |         |
                | Active  |               | User    |
                | Game    |               | Game    |
                | State   |               | Move    |
                +---------+               +---------+
```

### State separation

```text
Redis
=
Current active board
Current turn
Castling rights
En-passant target
Game status
Last move
```

```text
MongoDB
=
User
Game
Move
Result
Game history
```

### Core rule

```text
Frontend:
Calculate moves for immediate UI feedback.

Backend:
Validate every move.

Redis:
Store the active game state.

MongoDB:
Store durable game/move history.

Socket.IO:
Deliver real-time game events.
```

---

## 17. Open Items

Tracked gaps between this document and the current repository state:

- **Redis client is not yet a dependency.** `package.json` installs Mongoose and
  Socket.IO but no `redis` / `ioredis`. Add one before implementing active game
  state.
- **Matchmaking mechanics are unspecified.** "Find available opponent" needs a
  concrete queue design (Redis list/set vs. in-memory), including how a waiting
  player is removed on disconnect.
- **Colour choice conflict.** If both players ask for White, the tiebreak rule is
  undefined. Decide: first-to-request wins, or fall back to random assignment.
- **Clocks are optional.** Section 15.12 assumes chess clocks may exist. Decide
  whether the first version ships with timers; if yes, the per-player remaining
  time belongs in the Redis game state.
- **Draw offers.** Section 13 lists Draw as an end condition, but no offer/accept
  flow is specified.
- **Abandonment policy.** `status: ABANDONED` exists in the Game schema, but the
  disconnect duration that triggers it is undefined.
