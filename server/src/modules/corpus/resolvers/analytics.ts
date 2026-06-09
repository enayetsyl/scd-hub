/**
 * Corpus/analytics plane resolvers (ADR-005).
 *
 * FIREWALL INVARIANT: This module has NO imports from the foundation module's
 * identity models (User, Student, Guardian, GuardianLink). It may never resolve
 * a type that carries student/guardian identity. The fail-closed firewall test
 * (J5.6, NFR-11) asserts this by attempting identity resolution from this path
 * and requiring it to fail.
 *
 * If you add a resolver here, do NOT reference or import:
 *   - modules/foundation/models/User
 *   - modules/foundation/models/Student
 *   - modules/foundation/models/Guardian
 *   - modules/foundation/models/GuardianLink
 * Adding such an import is a firewall breach (R-X8, R-AC4, ADR-005).
 */

import { builder } from "../../../schema";

interface CorpusEventShape {
  _id: { toString(): string };
  eventKind: string;
  pseudoActorId: string;
  occurredAt: Date;
}

const CorpusEventRef = builder.objectRef<CorpusEventShape>("CorpusEvent");
CorpusEventRef.implement({
  description: "De-identified behavioral event from the corpus plane (ADR-005)",
  fields: (t) => ({
    id: t.string({ resolve: (e) => e._id.toString() }),
    eventKind: t.exposeString("eventKind"),
    pseudoActorId: t.exposeString("pseudoActorId"),
    occurredAt: t.string({ resolve: (e) => e.occurredAt.toISOString() }),
  }),
});

// Placeholder query — no identity fields, no join back to students/guardians
builder.queryField("recentEvents", (t) =>
  t.field({
    type: [CorpusEventRef],
    authScopes: { hasPermission: "content:read" },
    description: "De-identified recent corpus events — corpus plane only (ADR-005)",
    resolve: async () => {
      // Corpus plane: returns de-identified events.
      // The `events` collection (ADR-007) is populated by Slice 1+; empty here.
      // FIREWALL: this resolver CANNOT and MUST NOT resolve student/guardian identity.
      return [];
    },
  }),
);
