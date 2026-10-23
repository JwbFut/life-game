import { mkdirSync } from "node:fs";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

type Client = InstanceType<typeof PrismaClient>;

const globalForPrisma = globalThis as unknown as { lifePrisma?: Client };

/** Postgres in production, a local SQLite file in development. */
export function databaseTarget(): { url: string; postgres: boolean } {
    const configured = process.env.LIFE_DATABASE_URL;
    if (configured && /^postgres(ql)?:\/\//.test(configured)) {
        return { url: configured, postgres: true };
    }
    // LIFE_DB_PATH wins, then a file: URL, then the default location.
    const file =
        process.env.LIFE_DB_PATH ??
        (configured?.startsWith("file:") ? configured.slice("file:".length) : undefined) ??
        path.join(process.cwd(), "data", "life.db");
    const absolute = path.resolve(file);
    mkdirSync(path.dirname(absolute), { recursive: true });
    return { url: `file:${absolute}`, postgres: false };
}

function createClient(): Client {
    const target = databaseTarget();
    const adapter = target.postgres
        ? new PrismaPg({ connectionString: target.url })
        : new PrismaBetterSqlite3({ url: target.url });
    return new PrismaClient({ adapter });
}

export const prisma: Client = globalForPrisma.lifePrisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
    globalForPrisma.lifePrisma = prisma;
}
