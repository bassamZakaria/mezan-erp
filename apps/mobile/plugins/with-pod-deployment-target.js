const { withDangerousMod } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const MINIMUM_DEPLOYMENT_TARGET = "16.4";
const ANCHOR = "  post_install do |installer|\n";

/**
 * CocoaPods gives a pod's RESOURCE BUNDLE target the deployment target written
 * in that pod's podspec, ignoring the Podfile platform — ReachabilitySwift says
 * 12.0 and RNCAsyncStorage says 13.4, and Xcode 27 refuses anything below 15.0,
 * so the native build fails before it compiles a line. React Native's own
 * `updateOSDeploymentTarget` raises `native_target` only and never reaches
 * these. `ios/` is generated and gitignored, so the raise has to live here.
 */
const BLOCK = `  post_install do |installer|
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        current = config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if current.nil? || current.to_f < ${MINIMUM_DEPLOYMENT_TARGET}
          config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${MINIMUM_DEPLOYMENT_TARGET}'
        end
      end
    end
`;

module.exports = function withPodDeploymentTarget(config) {
  return withDangerousMod(config, [
    "ios",
    (modConfig) => {
      const podfile = path.join(modConfig.modRequest.platformProjectRoot, "Podfile");
      const contents = fs.readFileSync(podfile, "utf8");
      if (contents.includes("IPHONEOS_DEPLOYMENT_TARGET")) return modConfig;
      if (!contents.includes(ANCHOR)) {
        throw new Error("with-pod-deployment-target: the generated Podfile has no post_install block to extend.");
      }
      fs.writeFileSync(podfile, contents.replace(ANCHOR, BLOCK));
      return modConfig;
    },
  ]);
};
