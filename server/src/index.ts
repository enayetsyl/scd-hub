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
import "./modules/foundation/resolvers/staff";
import "./modules/foundation/resolvers/guardians";
import "./modules/foundation/resolvers/provisioning";
import "./modules/foundation/resolvers/scopeGrants";
import "./modules/corpus/resolvers/analytics";
import "./modules/content/resolvers/content";
import "./modules/content/resolvers/review";
import "./modules/questions/resolvers/questions";
import "./modules/assessment/resolvers/assessment";
import "./modules/trackers/resolvers/trackers";
import "./modules/trackers/resolvers/homework";
import "./modules/trackers/resolvers/homeworkFiles";
import "./modules/trackers/resolvers/assignment";
import "./modules/trackers/resolvers/classTest";
import "./modules/trackers/resolvers/classTestResult";
import "./modules/routine/resolvers/routine";
import "./modules/routine/resolvers/routineSlots";
import "./modules/routine/resolvers/routineTriggers";
import "./modules/attendance/resolvers/teacherAttendance";
import "./modules/attendance/resolvers/studentAttendance";
import "./modules/attendance/resolvers/push";
import "./modules/hr/resolvers/staffLeave";
import "./modules/hr/resolvers/payroll";
import "./modules/hr/resolvers/performance";
import "./modules/hr/resolvers/offboarding";
import "./modules/guardian/resolvers/guardianPortal";
import "./modules/notifications/resolvers/notifications";
import "./modules/library/resolvers/library";
import "./modules/library/resolvers/circulation";
import "./modules/library/resolvers/chase";
import "./modules/library/resolvers/libraryGuardian";
import "./modules/chat/resolvers/chat";
import "./modules/vocab/resolvers/vocabWord";
import "./modules/vocab/resolvers/vocabTest";
import "./modules/vocab/resolvers/vocabResult";
import "./modules/templates/resolvers/messageTemplates";

import { builder } from "./schema";
import { pdfRouter } from "./routes/pdf";
import { setPdfRouter } from "./modules/assessment/routes/setPdf";
import { filesRouter } from "./routes/files";
import { triggersRouter } from "./routes/triggers";
import { registerExpoPushChannel } from "./modules/notifications/services/pushChannel";
import { startNotificationTicker } from "./modules/notifications/services/SchedulerService";

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
    // Yoga delivers a WHATWG Request whose headers are a Fetch `Headers` object
    // (read via .get); the raw Node req is not reliably exposed as `.raw`, so
    // `req.headers.authorization` was always undefined and every authenticated
    // query failed. Normalise the auth header into what buildContext expects.
    const headers = request.headers as { get?: (k: string) => string | null; authorization?: string };
    const authorization =
      typeof headers.get === "function"
        ? headers.get("authorization") ?? ""
        : headers.authorization ?? "";
    const req = { headers: { authorization } } as unknown as express.Request;
    return buildContext(req, {} as express.Response);
  },
});

app.use(yoga.graphqlEndpoint, yoga as unknown as express.RequestHandler);

// CORS for the thin REST surface. The GraphQL endpoint gets CORS from Yoga, but
// the web app fetches PDFs cross-origin (e.g. :8081 -> :4000) with an Authorization
// header — that triggers a preflight the Express routes must answer, reflecting the
// origin. Scoped to /pdf so it never double-sets headers on the Yoga endpoint.
const corsForRest: express.RequestHandler = (req, res, next) => {
  const origin = req.headers.origin;
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
};
app.use("/pdf", corsForRest);
app.use("/files", corsForRest);

// Thin HTTP surface — PDF export (ADR-003, ADR-009)
app.use("/pdf", pdfRouter);
app.use("/pdf/set", setPdfRouter);

// Thin HTTP surface — homework files (GP-A, D-#70): server-in-the-middle
// upload/download; Drive is never exposed to a client.
app.use("/files", filesRouter);

// Trigger endpoints (AT-4, D-#65): external scheduler → idempotent reminder
// dispatch (shared-secret auth, not a browser surface → no CORS).
app.use("/triggers", triggersRouter);

const PORT = Number(process.env.PORT ?? 4000);

async function start() {
  await connectDb();
  // N-4 (D-#75): Expo push fans out behind emit(). Registered here — not at
  // import time — so jest suites never touch a live transport.
  registerExpoPushChannel();
  // N-2 (D-#73): the 60s in-process trigger ticker (single-instance).
  startNotificationTicker();
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
