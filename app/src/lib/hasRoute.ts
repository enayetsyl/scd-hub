/**
 * D-#861: a report mounted both in its module stack and in the Reports stack opens its module
 * drill-downs (someone's board, a test's results, a cover form…) only where that screen is
 * registered. In the Reports copy the row stays read-only instead of firing a NAVIGATE no
 * navigator handles. The module's own home keeps the full drill-down for its users.
 */
export function hasRoute(navigation: { getState: () => { routeNames?: readonly string[] } | undefined }, route: string): boolean {
  return (navigation.getState()?.routeNames ?? []).includes(route);
}
