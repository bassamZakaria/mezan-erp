import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const MOBILE = join(repoRoot, "apps", "mobile");
const MOBILE_SRC = join(MOBILE, "src");
const STORE_DOCS = join(repoRoot, "docs", "mobile", "store");
const STRICT = process.argv.includes("--strict");

const Status = Object.freeze({ Active: "active", Pending: "pending" });

const DEAD_API_HOSTS = ["demo.mezan.app"];

const REQUIRED_REASON_APIS = [
  ["NSPrivacyAccessedAPICategoryUserDefaults", "CA92.1"],
  ["NSPrivacyAccessedAPICategoryFileTimestamp", "C617.1"],
  ["NSPrivacyAccessedAPICategorySystemBootTime", "35F9.1"],
  ["NSPrivacyAccessedAPICategoryDiskSpace", "E174.1"],
];

const SDK_ONLY_REASONS = new Set(["0A2A.1", "C56D.1"]);

const USAGE_STRING_KEYS = ["NSCameraUsageDescription", "NSFaceIDUsageDescription"];

const BLOCKED_ANDROID_PERMISSIONS = [
  "android.permission.RECORD_AUDIO",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.READ_MEDIA_AUDIO",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_BACKGROUND_LOCATION",
  "android.permission.SYSTEM_ALERT_WINDOW",
];

const MIN_EXPO_SDK_FOR_PLAY_TARGET = 56;

const LEGAL_PATHS = ["/legal/privacy", "/legal/account-deletion"];

const PURCHASE_PATTERNS = [
  /\b[Cc]heckout\b/,
  /\b[Pp]ricing\b/,
  /\b[Ss]ubscri(be|ption)s?\b/,
  /\b[Uu]pgrade\b/,
  /\b[Bb]uy\b/,
  /\bpaymob\b/i,
  /\bin-app purchase\b/i,
  /\/signup\b/,
  /\/billing\b/,
  /\/pricing\b/,
  /اشترك|الاشتراك|اشتراكك|ترقية|الباقات|باقة|اشترِ|اشتري|الدفع الإلكتروني/,
];

const IPV4_LITERAL = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;

const STORE_LIMITS = {
  "app-store.ar.json": { name: 30, subtitle: 30, keywords: 100, promotionalText: 170, description: 4000 },
  "app-store.en.json": { name: 30, subtitle: 30, keywords: 100, promotionalText: 170, description: 4000 },
  "google-play.ar.json": { title: 30, shortDescription: 80, fullDescription: 4000 },
  "google-play.en.json": { title: 30, shortDescription: 80, fullDescription: 4000 },
};

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sourceFiles(dir, extensions) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      if (entry === "node_modules" || entry === ".expo") continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (extensions.has(extname(entry))) out.push(full);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

const STRING_LITERAL = /(["'`])(?:\\.|(?!\1)[^\\])*\1/g;

function grepFiles(files, pattern, { skipTests = false, literalsOnly = false } = {}) {
  const hits = [];
  for (const file of files) {
    if (skipTests && /\.test\.tsx?$/.test(file)) continue;
    const scanLiterals = literalsOnly && /\.tsx?$/.test(file);
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        const haystack = scanLiterals ? (line.match(STRING_LITERAL) ?? []).join(" ") : line;
        if (pattern.test(haystack)) hits.push(`${relative(repoRoot, file)}:${index + 1}: ${line.trim().slice(0, 120)}`);
      });
  }
  return hits;
}

const expo = () => readJson(join(MOBILE, "app.json")).expo;

function localeInfoPlist(config, locale) {
  const path = config.locales?.[locale];
  if (typeof path !== "string") return null;
  const full = join(MOBILE, path);
  return existsSync(full) ? readJson(full) : null;
}

function defaultApiHosts() {
  const hosts = [];
  const configured = expo().extra?.apiBaseUrl;
  if (typeof configured === "string") hosts.push(["app.json extra.apiBaseUrl", configured]);
  const provider = readFileSync(join(MOBILE_SRC, "session", "SessionProvider.tsx"), "utf8");
  for (const match of provider.matchAll(/"(https?:\/\/[^"]+)"/g)) hosts.push(["SessionProvider fallback", match[1]]);
  return hosts;
}

const CHECKS = [
  {
    id: "privacy-manifest",
    title: "ios.privacyManifests declares every required-reason API the build uses, and no tracking",
    status: Status.Pending,
    run() {
      const manifest = expo().ios?.privacyManifests;
      if (!manifest) return ["app.json has no expo.ios.privacyManifests"];
      const failures = [];
      if (manifest.NSPrivacyTracking !== false) failures.push("NSPrivacyTracking must be false");
      const declared = manifest.NSPrivacyAccessedAPITypes ?? [];
      for (const [category, reason] of REQUIRED_REASON_APIS) {
        const entry = declared.find((d) => d.NSPrivacyAccessedAPIType === category);
        if (!entry) failures.push(`${category} is not declared`);
        else if (!entry.NSPrivacyAccessedAPITypeReasons?.includes(reason)) failures.push(`${category} lacks reason ${reason}`);
      }
      for (const entry of declared) {
        for (const reason of entry.NSPrivacyAccessedAPITypeReasons ?? []) {
          if (SDK_ONLY_REASONS.has(reason)) failures.push(`${entry.NSPrivacyAccessedAPIType} declares ${reason}, a reason only a third-party SDK may declare`);
        }
      }
      return failures;
    },
  },
  {
    id: "export-compliance",
    title: "ITSAppUsesNonExemptEncryption is false (HTTPS and the OS keychain only)",
    status: Status.Pending,
    run() {
      const ios = expo().ios ?? {};
      const viaConfig = ios.config?.usesNonExemptEncryption;
      const viaPlist = ios.infoPlist?.ITSAppUsesNonExemptEncryption;
      return viaConfig === false || viaPlist === false ? [] : ["set expo.ios.config.usesNonExemptEncryption to false"];
    },
  },
  {
    id: "usage-strings",
    title: "Camera and Face ID usage strings exist in Arabic and in English",
    status: Status.Pending,
    run() {
      const config = expo();
      const failures = [];
      for (const locale of ["ar", "en"]) {
        const plist = localeInfoPlist(config, locale);
        if (!plist) {
          failures.push(`expo.locales.${locale} is missing or points at no file`);
          continue;
        }
        for (const key of USAGE_STRING_KEYS) {
          if (typeof plist[key] !== "string" || plist[key].trim() === "") failures.push(`${locale}: ${key} is empty`);
        }
      }
      for (const key of USAGE_STRING_KEYS) {
        if (typeof config.ios?.infoPlist?.[key] !== "string") failures.push(`ios.infoPlist.${key} (the base string) is missing`);
      }
      return failures;
    },
  },
  {
    id: "android-permissions",
    title: "android.blockedPermissions removes every permission no screen uses",
    status: Status.Pending,
    run() {
      const blocked = new Set(expo().android?.blockedPermissions ?? []);
      return BLOCKED_ANDROID_PERMISSIONS.filter((p) => !blocked.has(p)).map((p) => `${p} is not blocked`);
    },
  },
  {
    id: "play-target-api",
    title: `Expo SDK >= ${MIN_EXPO_SDK_FOR_PLAY_TARGET}, whose default targetSdkVersion 36 meets Google Play's Aug-2026 minimum`,
    status: Status.Active,
    run() {
      const version = readJson(join(MOBILE, "package.json")).dependencies?.expo ?? "";
      const major = Number(/(\d+)\./.exec(version)?.[1]);
      const failures = major >= MIN_EXPO_SDK_FOR_PLAY_TARGET ? [] : [`expo is "${version}"`];
      const buildProps = (expo().plugins ?? []).find((p) => Array.isArray(p) && p[0] === "expo-build-properties");
      const target = buildProps?.[1]?.android?.targetSdkVersion;
      if (target !== undefined && target < 36) failures.push(`expo-build-properties pins targetSdkVersion ${target}`);
      return failures;
    },
  },
  {
    id: "no-purchase-path",
    title: "No purchase, pricing, checkout, upgrade or sign-up link or string in apps/mobile/src",
    status: Status.Active,
    run() {
      const files = sourceFiles(MOBILE_SRC, new Set([".ts", ".tsx", ".json"]));
      // Code identifiers are not what a reviewer reads: `const subscription = AppState.addEventListener(...)`
      // is an event subscription, not a sale. Only string literals (copy, URLs, route names) can be a purchase path.
      return PURCHASE_PATTERNS.flatMap((pattern) => grepFiles(files, pattern, { skipTests: true, literalsOnly: true }));
    },
  },
  {
    id: "no-cleartext-http",
    title: "No http:// literal in the app or its production config",
    status: Status.Active,
    run() {
      const files = sourceFiles(MOBILE_SRC, new Set([".ts", ".tsx", ".json"]));
      const hits = grepFiles(files, /http:\/\//, { skipTests: true });
      if (JSON.stringify(expo()).includes("http://")) hits.push("apps/mobile/app.json contains http://");
      const eas = readJson(join(MOBILE, "eas.json"));
      for (const [profile, body] of Object.entries(eas.build ?? {})) {
        if (profile !== "development" && JSON.stringify(body).includes("http://")) hits.push(`eas.json build.${profile} contains http://`);
      }
      return hits;
    },
  },
  {
    id: "no-ipv4-literal",
    title: "No raw IPv4 address in the app (App Review runs on an IPv6-only network)",
    status: Status.Active,
    run() {
      const files = sourceFiles(MOBILE_SRC, new Set([".ts", ".tsx", ".json"]));
      return grepFiles(files, IPV4_LITERAL, { skipTests: true });
    },
  },
  {
    id: "default-api-host",
    title: "The compiled default API host is the reviewer environment, not the dead demo.mezan.app, and ends in /api",
    status: Status.Pending,
    run() {
      const failures = [];
      for (const [where, url] of defaultApiHosts()) {
        let parsed;
        try {
          parsed = new URL(url);
        } catch {
          failures.push(`${where}: "${url}" is not a URL`);
          continue;
        }
        if (parsed.protocol !== "https:") failures.push(`${where}: ${url} is not https`);
        if (DEAD_API_HOSTS.includes(parsed.hostname)) failures.push(`${where}: ${url} is the dead host ${parsed.hostname}`);
        if (!parsed.pathname.replace(/\/+$/, "").endsWith("/api")) failures.push(`${where}: ${url} does not end in /api, where the server mounts the tenant routes`);
      }
      return failures;
    },
  },
  {
    id: "in-app-legal-links",
    title: "The privacy policy and the account-deletion page are linked from inside the app",
    status: Status.Pending,
    run() {
      const files = sourceFiles(MOBILE_SRC, new Set([".ts", ".tsx"]));
      const text = files.filter((f) => !/\.test\.tsx?$/.test(f)).map((f) => readFileSync(f, "utf8")).join("\n");
      return LEGAL_PATHS.filter((path) => !text.includes(path)).map((path) => `no link to ${path}`);
    },
  },
  {
    id: "eas-production",
    title: "eas.json carries production build and submit profiles",
    status: Status.Active,
    run() {
      const eas = readJson(join(MOBILE, "eas.json"));
      const failures = [];
      if (!eas.build?.production) failures.push("no build.production profile");
      if (eas.build?.production?.developmentClient) failures.push("build.production is a development client");
      if (!eas.submit?.production) failures.push("no submit.production profile");
      return failures;
    },
  },
  {
    id: "store-metadata",
    title: "Store listing text exists in Arabic and English and fits each store's limits",
    status: Status.Active,
    run() {
      const failures = [];
      for (const [file, limits] of Object.entries(STORE_LIMITS)) {
        const path = join(STORE_DOCS, file);
        if (!existsSync(path)) {
          failures.push(`docs/mobile/store/${file} is missing`);
          continue;
        }
        const listing = readJson(path);
        for (const [field, max] of Object.entries(limits)) {
          const value = listing[field];
          if (typeof value !== "string" || value.trim() === "") failures.push(`${file}: ${field} is empty`);
          else if ([...value].length > max) failures.push(`${file}: ${field} is ${[...value].length} characters, over ${max}`);
          else for (const pattern of PURCHASE_PATTERNS) if (pattern.test(value)) failures.push(`${file}: ${field} matches ${pattern}`);
        }
      }
      return failures;
    },
  },
  {
    id: "store-urls-resolved",
    title: "Every listing URL and contact names a real host, not an owner placeholder",
    status: Status.Pending,
    run() {
      const failures = [];
      for (const file of Object.keys(STORE_LIMITS)) {
        const path = join(STORE_DOCS, file);
        if (!existsSync(path)) continue;
        for (const match of readFileSync(path, "utf8").matchAll(/\{[A-Z_]+\}/g)) failures.push(`${file}: ${match[0]}`);
      }
      return failures;
    },
  },
];

let failed = 0;
const lines = [];
for (const check of CHECKS) {
  const failures = check.run();
  const enforced = check.status === Status.Active || STRICT;
  if (failures.length === 0) {
    lines.push(`  ok       ${check.id}${check.status === Status.Pending ? "  (pending, but passes now — switch it on)" : ""}`);
    continue;
  }
  if (enforced) {
    failed += 1;
    lines.push(`  FAIL     ${check.id} — ${check.title}`);
  } else {
    lines.push(`  pending  ${check.id} — ${failures.length} open`);
  }
  if (enforced || process.argv.includes("--verbose")) for (const f of failures) lines.push(`             ${f}`);
}

console.log(`check-store-readiness${STRICT ? " (strict)" : ""}:`);
console.log(lines.join("\n"));
if (failed > 0) {
  console.error(`\n${failed} store-readiness check(s) failed.`);
  process.exit(1);
}
