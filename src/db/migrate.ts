/** Aplica migrations do Drizzle e, em seguida, as políticas de RLS. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { db } from "./index";

async function main() {
  await migrate(db, { migrationsFolder: path.resolve("drizzle") });
  await db.execute(sql.raw(readFileSync(path.resolve("drizzle/rls.sql"), "utf8")));
  console.log("✔ Migrations + RLS aplicadas");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
