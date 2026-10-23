import { randomUUID } from "node:crypto";
import { LOCK_POLL_MS, LOCK_TTL_MS, LOCK_WAIT_MS } from "./config";
import { prisma } from "./db";

function isUniqueViolation(error: unknown): boolean {
    return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

/**
 * A lease in the database, not in memory: the same route may run on several
 * nodes, and only one of them may generate a second.
 */
export async function acquire(key: string): Promise<string | null> {
    const owner = randomUUID();
    const expiresAt = new Date(Date.now() + LOCK_TTL_MS);
    try {
        await prisma.lifeLock.create({ data: { key, owner, expiresAt } });
        return owner;
    } catch (error) {
        if (!isUniqueViolation(error)) {
            throw error;
        }
    }
    // Someone holds it; take over only if the lease has expired (crashed node).
    const held = await prisma.lifeLock.findUnique({ where: { key }, select: { owner: true, expiresAt: true } });
    if (!held || held.expiresAt.getTime() > Date.now()) {
        return null;
    }
    const taken = await prisma.lifeLock.updateMany({
        where: { key, owner: held.owner, expiresAt: { lt: new Date() } },
        data: { owner, expiresAt },
    });
    return taken.count === 1 ? owner : null;
}

export async function release(key: string, owner: string): Promise<void> {
    await prisma.lifeLock.deleteMany({ where: { key, owner } });
}

export async function dropExpiredLocks(): Promise<void> {
    await prisma.lifeLock.deleteMany({
        where: { expiresAt: { lt: new Date(Date.now() - LOCK_TTL_MS) } },
    });
}

/** Wait for another node to finish; returns false if it did not happen in time. */
export async function waitForReady(ready: () => Promise<boolean>): Promise<boolean> {
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
        if (await ready()) {
            return true;
        }
        if (Date.now() > deadline) {
            return false;
        }
        await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
}
