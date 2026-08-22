// Pulls in @testing-library/jest-dom's Vitest `expect` matcher augmentation
// (toBeInTheDocument, toBeDisabled, ...) for this package's TS program — the
// runtime side of the setup already runs via vitest.config.ts's
// `setupFiles: ["packages/ui/src/test/setup.ts"]`, but that file lives
// outside apps/web's own tsconfig `include`, so the type augmentation needs
// a copy reachable from here too (see packages/ui/src/test/setup.ts).
import "@testing-library/jest-dom/vitest";
