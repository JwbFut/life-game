// Drops the table from the retired database-side block cache. `prisma db push`
// never removes tables, so existing databases keep carrying it otherwise.
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const file = process.env.LIFE_DB_PATH ?? path.join(process.cwd(), "data", "life.db");
const db = new DatabaseSync(file);
db.exec("DROP TABLE IF EXISTS life_blocks");
db.close();
console.log(`life_blocks dropped (if it existed): ${file}`);
