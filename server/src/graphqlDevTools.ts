/**
 * D-#765: the GraphiQL page and schema introspection are a developer's tools. On a live
 * server they handed anyone the full list of operations — every staff, salary and student
 * query — to aim at. They are on ONLY where NODE_ENV is explicitly "development" (a
 * developer's own machine); an unset NODE_ENV counts as live, so a misconfigured server
 * fails closed. The app never introspects — it ships its operations as written.
 */
import type { Plugin } from "graphql-yoga";
import { NoSchemaIntrospectionCustomRule } from "graphql";

const disableIntrospection: Plugin = {
  onValidate: ({ addValidationRule }) => addValidationRule(NoSchemaIntrospectionCustomRule),
};

export function graphqlDevToolsOptions(nodeEnv: string | undefined): { graphiql: boolean; plugins: Plugin[] } {
  const on = nodeEnv === "development";
  return { graphiql: on, plugins: on ? [] : [disableIntrospection] };
}
