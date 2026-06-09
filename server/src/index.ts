import "dotenv/config";
import express from "express";
import { createYoga } from "graphql-yoga";
import { connectDb } from "./db";
import { buildContext } from "./context";

// Import all resolvers (side-effects: register on builder)
import "./modules/foundation/resolvers/auth";
import "./modules/foundation/resolvers/users";
import "./modules/foundation/resolvers/classes";
import "./modules/foundation/resolvers/students";
import "./modules/foundation/resolvers/guardians";
import "./modules/foundation/resolvers/scopeGrants";
import "./modules/corpus/resolvers/analytics";

import { builder } from "./schema";

const app = express();

// Health endpoints (thin HTTP surface, ADR-003)
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/readyz", async (_req, res) => {
  const { mongoose } = await import("./db");
  const state = mongoose.connection.readyState;
  if (state === 1) res.json({ ok: true });
  else res.status(503).json({ ok: false, dbState: state });
});

const schema = builder.toSchema();

const yoga = createYoga({
  schema,
  context: ({ request }) => {
    // yoga wraps the raw express req — pull it back out
    const req = (request as unknown as { raw: express.Request }).raw ?? request;
    const res = {} as express.Response;
    return buildContext(req as express.Request, res);
  },
});

app.use(yoga.graphqlEndpoint, yoga as unknown as express.RequestHandler);

const PORT = Number(process.env.PORT ?? 4000);

async function start() {
  await connectDb();
  app.listen(PORT, () => {
    console.log(`SCD Hub server listening on http://localhost:${PORT}/graphql`);
  });
}

// Only start when run directly (not imported by tests)
if (require.main === module) {
  start().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}

export { app, schema };
