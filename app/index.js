// Local entry point. In an npm-workspaces monorepo the Expo package is hoisted
// to the repo-root node_modules, so expo/AppEntry.js's relative "../../App"
// would resolve to the wrong place. Registering the root component here keeps
// the entry resolution local to app/.
import { registerRootComponent } from "expo";
import App from "./App";

registerRootComponent(App);
