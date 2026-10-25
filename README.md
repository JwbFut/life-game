# life

A Conway's Game of Life field as an API. One generation per second, two palettes,
180 frames per GIF.

## Endpoints

| Endpoint | Returns |
| --- | --- |
| `GET /dark.gif` | 180 frames from the current second, `948 x 296`, dark palette. |
| `GET /light.gif` | Light palette. |

## Rules

- Frames are keyed by epoch second. The chain holds 180 future frames and never
  runs past `now + 360`; one request generates at most 180 new ones.
- The run is only ever restarted by the loop breaker below. On a clock jump, a
  long idle gap or a hole in the served window the field continues from the
  newest stored state (re-stamped at `now`); a fresh random field is seeded only
  for an empty database. The newest frame is kept even after it leaves the 60 s
  window so a jump still has a state to continue from.
- Generation takes a lease row in `life_locks`, so several nodes never seed the
  same second — losers wait for the winner. Anything older than 60 s is pruned.
- Every 10 frames the state is hashed; a repeat inserts a blank frame and
  re-seeds.
- `LIFE` is ink, not cells: its box is masked out of the simulation.
- The last frame freezes, clears the caption's own box and stamps
  `is continuing elsewhere`.
- GIF: 1000 ms per frame, no loop extension (plays once), 3 s on the last
  frame, about 0.6 MB.

## Cache

Encoded blocks are reused in-process, keyed by second and validated by frame
hash, so a sliding window only re-encodes the head, the tail and the caption.
The finished GIF is cached for one second per theme. ~2.5 s cold, ~0.1 s warm.

## Database

Prisma 7. SQLite locally (`prisma/schema.prisma`), Postgres in production
(`prisma/schema.postgres.prisma`); `LIFE_DATABASE_URL` picks both the schema and
the adapter. The client is generated per provider, so regenerate when the target
changes. Older databases: `npm run db:clean` drops the retired `life_blocks`.

## Run

```bash
npm install          # also generates the Prisma client
npm run db:push
npm run dev

export LIFE_DATABASE_URL="postgresql://user:password@host:5432/life"
npm install && npm run db:push && npm run build && npm start

npm test             # step vs the naive rule, LZW round-trip
npm run lint
```
