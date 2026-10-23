import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

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

test("a broken chain is re-seeded at the current second", async () => {
    const now = frames.nowSeconds();
    await prisma.lifeFrame.deleteMany({ where: { t: { gte: now - 2n } } });
    const start = await frames.ensureRun(now);
    assert.ok(start >= now - 2n, "new chain starts at the present");
    assert.equal((await frames.readRun(start, 180)).length, 180);
});
