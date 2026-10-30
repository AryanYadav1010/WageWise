// npm run db:migrate             apply pending migrations
// npm run db:migrate -- --status  list applied and pending migrations without changing anything
import { parseArgs } from "node:util";
import { loadMigrations, migrate, migrationStatus } from "../db/migrations.ts";
import { runCli, startCli } from "./shared.ts";

const { values } = parseArgs({ options: { status: { type: "boolean", default: false } } });
const context = startCli("wagewise-migrate");

await runCli(context, async () => {
  const migrations = loadMigrations();
  if (values.status) {
    const status = await migrationStatus(context.pool, migrations);
    context.logger.info({
      applied: status.applied.map(migration => `${migration.version}_${migration.name}`),
      pending: status.pending.map(migration => `${migration.version}_${migration.name}`)
    }, "migration status");
    return 0;
  }
  const applied = await migrate(context.pool, migrations);
  context.logger.info({ applied: applied.map(migration => `${migration.version}_${migration.name}`), total: migrations.length },
    applied.length === 0 ? "database already up to date" : "migrations applied");
  return 0;
});
