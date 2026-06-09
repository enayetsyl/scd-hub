/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleNameMapper: {
    // Resolve @scd/shared to the TypeScript source for Jest (bypasses dist requirement)
    "^@scd/shared$": "<rootDir>/../shared/index.ts",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          // For Jest: include the shared source without rootDir restriction
          rootDir: "..",
          paths: {
            "@scd/shared": ["./shared/index.ts"],
          },
        },
      },
    ],
  },
  forceExit: true,
  testTimeout: 15000,
};
