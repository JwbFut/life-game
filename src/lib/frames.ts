import { BUDGET_FRAMES, CHAIN_FRAMES, FRAME_TTL_SECONDS, HASH_EVERY } from "./config";
import { prisma } from "./db";
import { emptyBits, hashBits, randomBits, step } from "./life";
import { acquire, dropExpiredLocks, release, waitForReady } from "./locks";

export function nowSeconds(): bigint {
    return BigInt(Math.floor(Date.now() / 1000));
}

const BUDGET = BigInt(BUDGET_FRAMES);
const CHAIN = BigInt(CHAIN_FRAMES);
const TTL = BigInt(FRAME_TTL_SECONDS);
const HASH_EVERY_BIG = BigInt(HASH_EVERY);

interface Frame {
    bits: Uint8Array<ArrayBuffer>;
    hash: string;
}

/** A frame written by the loop breaker: all dead, and the signal to re-seed. */
const BLANK_HASH = hashBits(emptyBits());

async function readFrame(t: bigint): Promise<Uint8Array<ArrayBuffer> | null> {
    const row = await prisma.lifeFrame.findUnique({ where: { t }, select: { bits: true } });
    return row ? new Uint8Array(row.bits) : null;
}

/**
 * Drop anything older than one minute, except the newest frame: if the wall
 * clock jumps, that state is what the next request continues from instead of
 * starting a new random field.
 */
export async function prune(now: bigint): Promise<void> {
    const newest = await prisma.lifeFrame.findFirst({
        orderBy: { t: "desc" },
        select: { t: true },
    });
    await prisma.lifeFrame.deleteMany({
        where: {
            t: { lt: now - TTL },
            ...(newest ? { NOT: { t: newest.t } } : {}),
        },
    });
}

/** Hashes of the frames in [since, until], used to detect repeats. */
async function recentHashes(since: bigint, until: bigint): Promise<Set<string>> {
    const rows = await prisma.lifeFrame.findMany({
        where: { t: { gte: since, lte: until } },
        select: { hash: true },
    });
    return new Set(rows.map((row) => row.hash));
}

/**
 * Generates `count` frames in memory. Every HASH_EVERY frames a repeated state
 * closes a loop: a blank frame is emitted and the field re-seeds, then continues.
 */
function generate(count: number, previous: Uint8Array<ArrayBuffer> | null, firstT: bigint, known: Set<string>): Frame[] {
    const frames: Frame[] = [];
    let bits: Uint8Array<ArrayBuffer>;
    let index = 0;

    if (previous) {
        bits = previous;
    } else {
        bits = randomBits();
        const hash = hashBits(bits);
        frames.push({ bits, hash });
        known.add(hash);
        index = 1;
    }
    let reseed = previous !== null && hashBits(previous) === BLANK_HASH;

    for (; index < count; index++) {
        const t = firstT + BigInt(index);
        const next = reseed ? randomBits() : step(bits);
        reseed = false;
        const hash = hashBits(next);
        if (t % HASH_EVERY_BIG === 0n && known.has(hash)) {
            frames.push({ bits: emptyBits(), hash: BLANK_HASH });
            known.add(BLANK_HASH);
            reseed = true;
            continue;
        }
        frames.push({ bits: next, hash });
        known.add(hash);
        bits = next;
    }
    return frames;
}

/**
 * A new run from a random field. Only an empty database needs this: a clock
 * jump, a long idle gap or a broken window continue the existing run instead.
 */
async function seed(now: bigint, count: number): Promise<void> {
    const known = await recentHashes(now - TTL, now - 1n);
    const frames = generate(count, null, now, known);
    const data = frames.map((frame, i) => ({ t: now + BigInt(i), bits: frame.bits, hash: frame.hash }));

    await prisma.$transaction([
        prisma.lifeFrame.deleteMany({ where: { t: { gte: now } } }),
        prisma.lifeFrame.createMany({ data }),
    ]);
}

/**
 * Continue the run at `now` from the newest stored state. The first generated
 * frame is the next generation, so a clock jump or a hole moves the field
 * forward instead of starting a random one. Returns false only for an empty db.
 *
 * The frame at `now - 1` is preferred for a hole in the served window: playing
 * the chain forward from there reproduces the missing second. When the clock
 * jumped, no frame reaches this moment and the newest frame is used instead.
 */
async function reanchor(now: bigint, count: number): Promise<boolean> {
    let row = await prisma.lifeFrame.findFirst({
        where: { t: { lt: now } },
        orderBy: { t: "desc" },
        select: { bits: true },
    });
    if (!row) {
        // A backwards clock step can leave only future frames: continue from
        // the newest one rather than seeding.
        row = await prisma.lifeFrame.findFirst({
            orderBy: { t: "desc" },
            select: { bits: true },
        });
    }
    if (!row) {
        return false;
    }
    const known = await recentHashes(now - TTL, now - 1n);
    const frames = generate(count, new Uint8Array(row.bits), now, known);
    const data = frames.map((frame, i) => ({ t: now + BigInt(i), bits: frame.bits, hash: frame.hash }));

    await prisma.$transaction([
        prisma.lifeFrame.deleteMany({ where: { t: { gte: now } } }),
        prisma.lifeFrame.createMany({ data }),
    ]);
    return true;
}

/** Continues the chain from `last` up to `end` (exclusive). */
async function extend(now: bigint, last: bigint, end: bigint): Promise<void> {
    const previous = await readFrame(last);
    if (!previous) {
        return;
    }
    const known = await recentHashes(now - TTL, last);
    const frames = generate(Number(end - last - 1n), previous, last + 1n, known);
    if (frames.length === 0) {
        return;
    }
    await prisma.lifeFrame.createMany({
        data: frames.map((frame, i) => ({ t: last + 1n + BigInt(i), bits: frame.bits, hash: frame.hash })),
    });
}

/**
 * Start of the servable window, or null if the 180 future frames are not there.
 * One query: 180 consecutive timestamps prove the window is dense.
 */
async function readyStart(now: bigint): Promise<bigint | null> {
    const rows = await prisma.$queryRaw<{ t: bigint }[]>`
        SELECT t FROM life_frames WHERE t >= ${now} ORDER BY t ASC LIMIT ${BUDGET_FRAMES}
    `;
    if (rows.length < BUDGET_FRAMES) {
        return null;
    }
    const first = BigInt(rows[0].t);
    return BigInt(rows[BUDGET_FRAMES - 1].t) === first + BUDGET - 1n ? first : null;
}

/**
 * The last frame of the live chain. It may sit at `now - 1`, which still counts:
 * that frame is what proves the chain reached this moment.
 */
async function tail(now: bigint): Promise<bigint | null> {
    const row = await prisma.lifeFrame.findFirst({
        where: { t: { gte: now - 1n } },
        orderBy: { t: "desc" },
        select: { t: true },
    });
    return row?.t ?? null;
}

const LOCK_KEY = "run";

/**
 * One request does one unit of work, at most BUDGET_FRAMES new frames:
 * - the chain must cover [now, now + 180), otherwise it is completed under lease;
 * - when it does, the tail is pushed towards now + CHAIN_FRAMES, same lease.
 * The window is always re-read under the lease, never trusted from before it:
 * another node may have re-seeded it in between.
 */
async function ensure(now: bigint): Promise<bigint> {
    const target = now + CHAIN;
    const ready = await readyStart(now);
    if (ready !== null) {
        const last = await tail(now);
        if (last !== null && last + 1n >= target) {
            return ready;
        }
    }

    for (let attempt = 0; attempt < 3; attempt++) {
        const owner = await acquire(LOCK_KEY);
        if (owner) {
            try {
                let start = await readyStart(now);
                const last = await tail(now);
                if (start === null || last === null || last + 1n < target) {
                    // `tail` means "a frame at now - 1 or later": when it is null
                    // the clock jumped, the chain idled out, or the db is empty.
                    // Keep the run going from the newest state; only an empty db
                    // gets a fresh random field. A detected loop is handled inside
                    // generation (blank + fresh).
                    if (last === null) {
                        if (!(await reanchor(now, BUDGET_FRAMES))) {
                            await seed(now, BUDGET_FRAMES);
                        }
                    } else {
                        const stop =
                            target < last + 1n + BUDGET ? target : last + 1n + BUDGET;
                        if (stop > last + 1n) {
                            await extend(now, last, stop);
                        }
                    }
                    start = await readyStart(now);
                    if (start === null) {
                        // A hole the tail cannot fill: continue from the newest
                        // state at `now` instead of rebuilding a random chain.
                        if (!(await reanchor(now, BUDGET_FRAMES))) {
                            await seed(now, BUDGET_FRAMES);
                        }
                        start = await readyStart(now);
                    }
                }
                if (start === null) {
                    throw new Error("chain is not servable after generation");
                }
                return start;
            } finally {
                await release(LOCK_KEY, owner);
                void dropExpiredLocks().catch(() => undefined);
            }
        }
        const box: { start: bigint | null } = { start: null };
        const ok = await waitForReady(async () => {
            box.start = await readyStart(now);
            return box.start !== null;
        });
        if (!ok || box.start === null) {
            continue;
        }
        // The winner only guarantees the window; try the lease once more for the
        // tail top-up, then fall back to what is already servable.
        if (attempt === 1) {
            return box.start;
        }
    }
    throw new Error("chain is locked by another node");
}

export function ensureRun(now: bigint): Promise<bigint> {
    return ensure(now);
}

export interface StoredFrame {
    bits: Uint8Array<ArrayBuffer>;
    hash: string;
}

/** The window plus each frame's hash, so the encoder can validate its cache. */
export async function readRun(start: bigint, count: number): Promise<StoredFrame[]> {
    const rows = await prisma.$queryRaw<{ bits: Uint8Array; hash: string }[]>`
        SELECT bits, hash FROM life_frames
        WHERE t >= ${start} AND t < ${start + BigInt(count)}
        ORDER BY t ASC
    `;
    return rows.map((row) => ({ bits: new Uint8Array(row.bits), hash: row.hash }));
}
