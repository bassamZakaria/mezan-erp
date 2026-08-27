import { describe, expect, it } from "vitest";
import path from "node:path";
import { resolveRendererFile } from "./renderer-paths.js";

/**
 * `resolveRendererFile` is the security boundary of the `app://` scheme: the
 * handler runs in the main process with the user's full filesystem rights, so
 * a path that escapes the renderer root is an arbitrary-file-read. These are
 * the cases that matter, kept headless — the surrounding module needs a real
 * Electron runtime, this function does not.
 */
const ROOT = path.resolve("/opt/mezan/resources/web");

describe("resolveRendererFile", () => {
  it("serves an asset inside the root", () => {
    expect(resolveRendererFile(ROOT, "/assets/index-abc123.js")).toBe(path.join(ROOT, "assets/index-abc123.js"));
  });

  it("serves the entry document for the bare root", () => {
    expect(resolveRendererFile(ROOT, "/")).toBe(path.join(ROOT, "index.html"));
  });

  it("rewrites an extensionless route to the entry document, so the client router can read the address", () => {
    expect(resolveRendererFile(ROOT, "/sell/quotes")).toBe(path.join(ROOT, "index.html"));
    expect(resolveRendererFile(ROOT, "/money/journals/JV-000001")).toBe(path.join(ROOT, "index.html"));
  });

  it("decodes a percent-encoded name rather than looking for the escaped bytes on disk", () => {
    expect(resolveRendererFile(ROOT, "/assets/%D9%85%D9%8A%D8%B2%D8%A7%D9%86.woff2")).toBe(
      path.join(ROOT, "assets/ميزان.woff2"),
    );
  });

  it("refuses a traversal out of the root", () => {
    expect(resolveRendererFile(ROOT, "/../../../etc/passwd")).toBeNull();
    expect(resolveRendererFile(ROOT, "/assets/../../../../etc/passwd")).toBeNull();
  });

  it("refuses a traversal that arrives percent-encoded", () => {
    // %2e%2e%2f is "../" — a normaliser that runs before decoding would pass this.
    expect(resolveRendererFile(ROOT, "/%2e%2e%2f%2e%2e%2fetc/passwd")).toBeNull();
  });

  it("refuses a sibling directory that merely shares the root's prefix", () => {
    // The reason the check compares against root + separator, not startsWith(root).
    expect(resolveRendererFile(ROOT, "/../web-backup/secret.env")).toBeNull();
  });

  it("refuses a malformed escape rather than throwing at the caller", () => {
    expect(resolveRendererFile(ROOT, "/assets/%E0%A4%A.js")).toBeNull();
  });
});
