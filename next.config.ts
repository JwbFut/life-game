import type { NextConfig } from "next";

const config: NextConfig = {
    // Database drivers and adapters are native/dynamic; keep them unbundled.
    serverExternalPackages: [
        "better-sqlite3",
        "@prisma/adapter-better-sqlite3",
        "pg",
        "@prisma/adapter-pg",
    ],
};

export default config;
