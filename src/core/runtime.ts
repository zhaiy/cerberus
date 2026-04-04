import { loadConfig } from "./config.js";
import { isVaultInitialized, resolveAppPaths } from "./paths.js";
import type { AppContext } from "./types.js";

export interface AppContextOptions {
  homeDir?: string;
  appDir?: string;
}

export function buildAppContext(options?: AppContextOptions): AppContext {
  return {
    paths: resolveAppPaths(options),
    config: undefined,
  };
}

export async function buildAppContextWithConfig(
  options?: AppContextOptions,
): Promise<AppContext> {
  const paths = resolveAppPaths(options);
  const initialized = await isVaultInitialized(paths);

  if (!initialized) {
    return { paths, config: undefined };
  }

  const config = await loadConfig(paths);
  return { paths, config };
}
