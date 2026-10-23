import { defineConfig } from "prisma/config";

// Prisma 7 no longer loads .env on its own, and the file is optional.
try {
    process.loadEnvFile?.(".env");
} catch {
    // no .env: the datasource below falls back to ./data/life.db
}

const url = process.env.LIFE_DATABASE_URL ?? "file:./data/life.db";
const isPostgres = /^postgres(ql)?:\/\//.test(url);

export default defineConfig({
    // The provider is baked into the generated client, so production generates
    // from the Postgres schema and local development from the SQLite one.
    schema: isPostgres ? "prisma/schema.postgres.prisma" : "prisma/schema.prisma",
    datasource: { url },
});
