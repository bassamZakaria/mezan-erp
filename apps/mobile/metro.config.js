const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

const upstream = config.resolver.resolveRequest;

/**
 * The workspace packages are TypeScript sources written for NodeNext, so they
 * import each other as "./paging.js" while the file on disk is "paging.ts".
 * Metro resolves the literal specifier and fails. Retry without the extension
 * before giving up — without this the app cannot import @mezan/contracts at all.
 */
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    try {
      return context.resolveRequest(context, moduleName.slice(0, -".js".length), platform);
    } catch {
      // Fall through to the real specifier, which may well be a real .js file.
    }
  }
  return upstream ? upstream(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
