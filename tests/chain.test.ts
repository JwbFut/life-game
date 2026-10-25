import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { emptyBits, hashBits, step } from "../src/lib/life";

const dir = mkdtempSync(path.join(tmpdir(), "life-chain-"));
const file = path.join(dir, "test.db");

process.env.LIFE_DB_PATH = file;
process.env.LIFE_DATABASE_URL = `file:${file}`;

let frames: typeof import("../src/lib/frames");
let prisma: typeof import("../src/lib/db").prisma;

before(async () => {
    execFileSync(path.join(import.meta.dirname, "..", "node_modules", ".bin", "prisma"), [
        "db",
        "push",
    ], {
        cwd: path.join(import.meta.dirname, ".."),
        env: { ...process.env, LIFE_DATABASE_URL: `file:${file}` },
        stdio: "ignore",
    } as never);
    frames = await import("../src/lib/frames");
    ({ prisma } = await import("../src/lib/db"));
});

after(async () => {
    await prisma.$disconnect();
    rmSync(dir, { recursive: true, force: true });
});

/** Start a brand new run: only an empty database gets a random field. */
async function freshRun(): Promise<bigint> {
    await prisma.lifeFrame.deleteMany();
    const now = frames.nowSeconds();
    const start = await frames.ensureRun(now);
    assert.equal(start, now);
    return now;
}

test("a cold chain is seeded with exactly one budget of frames", async () => {
    const now = frames.nowSeconds();
    const start = await frames.ensureRun(now);
    const rows = await frames.readRun(start, 180);
    assert.equal(rows.length, 180, "window must be complete");
    const count = await prisma.lifeFrame.count();
    assert.equal(count, 180, "one request generates at most 180 frames");
    const locks = await prisma.lifeLock.count();
    assert.equal(locks, 0, "lease must be released");
});

test("a second request continues the same chain from its tail", async () => {
    const now = frames.nowSeconds();
    const before = await prisma.lifeFrame.findFirst({ orderBy: { t: "desc" } });
    const start = await frames.ensureRun(now);
    const after = await prisma.lifeFrame.findFirst({ orderBy: { t: "desc" } });
    assert.ok(before && after && after.t > before.t, "tail must move forward");
    assert.equal((await frames.readRun(start, 180)).length, 180);
});

test("a hole in the served window is replayed, not re-seeded", async () => {
    const now = await freshRun();
    // One second later the seed's first frame is the state before the window,
    // so playing forward from it must reproduce the missing second exactly.
    const at = now + 1n;
    const before = await prisma.lifeFrame.findUnique({ where: { t: at + 100n } });
    assert.ok(before);

    await prisma.lifeFrame.delete({ where: { t: at + 100n } });
    const start = await frames.ensureRun(at);
    assert.equal(start, at, "the window still starts at the present");

    const after = await prisma.lifeFrame.findUnique({ where: { t: at + 100n } });
    assert.ok(after, "the missing second is back");
    assert.equal(after.hash, before.hash, "the step is replayed, not randomised");
});

test("a repeated state still inserts a blank frame and a fresh field", async () => {
    const now = await freshRun();
    const blinker = emptyBits();
    const rowBytes = Math.ceil(237 / 8); // GRID_W = 237, rows are byte aligned
    for (let x = 10; x < 13; x++) {
        blinker[10 * rowBytes + (x >> 3)] |= 1 << (x & 7);
    }
    await prisma.lifeFrame.update({
        where: { t: now },
        data: { bits: Buffer.from(blinker), hash: hashBits(blinker) },
    });
    await prisma.lifeFrame.deleteMany({ where: { t: { gt: now } } });

    await frames.ensureRun(now + 1n);
    const blankHash = hashBits(emptyBits());
    const blanks = await prisma.lifeFrame.findMany({
        where: { t: { gte: now + 1n }, hash: blankHash },
        orderBy: { t: "asc" },
    });
    assert.ok(blanks.length >= 1, "the loop breaker must write a blank frame");
    const next = await prisma.lifeFrame.findUnique({ where: { t: blanks[0].t + 1n } });
    assert.ok(next && next.hash !== blankHash, "and the next frame starts a fresh field");
});

test("a clock jump continues the run instead of seeding", async () => {
    const now = await freshRun();
    const later = now + 500n;
    // gifroute prunes before it ensures; the newest frame must survive.
    await frames.prune(later);
    const source = await prisma.lifeFrame.findFirst({
        where: { t: { lt: later } },
        orderBy: { t: "desc" },
    });
    assert.ok(source, "the old run must survive the prune");

    const start = await frames.ensureRun(later);
    assert.equal(start, later, "the window starts at the jumped-to second");
    const first = await prisma.lifeFrame.findUnique({ where: { t: later } });
    assert.ok(first);
    assert.equal(first.hash, hashBits(step(new Uint8Array(source.bits))), "the field keeps evolving");
    assert.notEqual(first.hash, hashBits(emptyBits()), "no blank marker was inserted");
    assert.equal((await frames.readRun(start, 180)).length, 180);
});
