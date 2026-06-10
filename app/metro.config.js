// Metro config — Expo + npm-workspaces monorepo.
// The app lives in app/ while shared/ is a sibling workspace and most deps are
// hoisted to the repo-root node_modules. Metro must serve files from both, so we
// watch ONLY those two folders (watching the whole repo root makes Metro crawl
// .git/, server/, docs/ and is pathologically slow on Windows, which has no
// watchman).
//
// NativeWind's withNativeWind() wrapper is intentionally omitted — see
// babel.config.js for why (Windows/Metro transform perf). Re-enable with:
//   const { withNativeWind } = require("nativewind/metro");
//   module.exports = withNativeWind(config, { input: "./global.css" });
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [
  path.resolve(workspaceRoot, "node_modules"),
  path.resolve(workspaceRoot, "shared"),
];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
// Don't crawl build output.
config.resolver.blockList = [/[\\/]dist-web[\\/].*/];

module.exports = config;
