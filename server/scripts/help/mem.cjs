#!/usr/bin/env node
/**
 * In-memory MongoDB for a LOCAL help-guide capture run (prd-help-centre §5).
 * Launch from PowerShell inside server/ (Git Bash breaks mongodb-memory-server's spawn):
 *   node scripts/help/mem.cjs 27901
 * Pick a free port (`netstat -ano | findstr :27901`); Windows lets a second mongod bind a
 * busy port silently, and the fixture would land in another run's database.
 */
const { MongoMemoryServer } = require("mongodb-memory-server");

const port = Number(process.argv[2] || 27901);
(async () => {
  const m = await MongoMemoryServer.create({ instance: { port, dbName: "hc" } });
  console.log("MEM READY", m.getUri());
  setInterval(() => {}, 1 << 30);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
