/**
 * D-#1655 — test-only default: nothing is paused. Many DB-free suites reach a scheduler family
 * that now asks the pause service; without a connection that query buffers until it times out.
 * Suites that test the pause behaviour stub it themselves (jest.mock wins over this default) or
 * opt back into the real service with `jest.unmock(".../AcademicPauseService")`.
 */
jest.mock("../modules/academic-pause/services/AcademicPauseService", () => {
  const actual = jest.requireActual("../modules/academic-pause/services/AcademicPauseService");
  return {
    ...actual,
    isPausedOn: async () => false,
    isPausedNow: async () => false,
    isPausedOnDate: async () => false,
    loadPausePredicate: async () => () => false,
    pausesInRange: async () => [],
  };
});
