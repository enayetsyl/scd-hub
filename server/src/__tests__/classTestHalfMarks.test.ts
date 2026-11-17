/**
 * Class-test marks may carry a half mark (25.5 — the entry input is Float). Every READ field
 * that returns a student's class-test marks must therefore be Float: an Int field fails the
 * whole request with "Int cannot represent non-integer value: 25.5" (owner report 2026-11-17,
 * the student profile's Class test tab). Checked on the built schema; no database needed.
 */
import { GraphQLObjectType, getNamedType } from "graphql";
import { builder } from "../schema";
import "../modules/trackers/resolvers/classTestSummary";
import "../modules/trackers/resolvers/classTestGuardian";
import "../modules/trackers/resolvers/classTestResult";

const schema = builder.toSchema();

function marksTypeOf(typeName: string): string {
  const t = schema.getType(typeName);
  if (!(t instanceof GraphQLObjectType)) throw new Error(`${typeName} is not an object type`);
  const f = t.getFields().marks;
  if (!f) throw new Error(`${typeName} has no marks field`);
  return getNamedType(f.type).name;
}

describe("class-test marks are Float on every read type", () => {
  it("has no Int marks field on any type that carries a class-test result", () => {
    const withMarks = Object.values(schema.getTypeMap()).filter(
      (t): t is GraphQLObjectType =>
        t instanceof GraphQLObjectType && /ClassTest/.test(t.name) && !!t.getFields().marks,
    );
    expect(withMarks.length).toBeGreaterThanOrEqual(3);
    for (const t of withMarks) expect([t.name, marksTypeOf(t.name)]).toEqual([t.name, "Float"]);
  });
});
