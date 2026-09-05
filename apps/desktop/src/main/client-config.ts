import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { z } from "zod";

/**
 * WHICH MACHINE THIS INSTALL IS.
 *
 * Mezan ships ONE executable and it plays one of two roles in a shop. The HOST
 * holds `mezan.db`, takes the backups, and opens the LAN socket. A CLIENT holds
 * no books at all: it renders the same UI and every request it makes is
 * forwarded to the host over the pinned TLS socket (main/lan-client.ts). That
 * is the whole of "multiple users, same data" — there is exactly one copy of
 * the database, on one machine, and no synchronisation anywhere, because two
 * copies of a ledger that have to be merged is not a feature, it is a class of
 * defect no amount of care recovers from.
 *
 * The presence of this file IS the role. No file, host; a file, client. It is
 * plain JSON next to the database, editable by the consultant doing the
 * rollout, and there is deliberately no way to be "both".
 *
 * THE FINGERPRINT IS NOT OPTIONAL. It is what makes the connection to the host
 * safe on a shop wifi: the host's certificate is self-signed (there is no CA a
 * shop LAN can reach and no DNS name to certify), so the only thing that
 * distinguishes the real host from anyone else who answers on that address is
 * this hash, compared by a human once at setup — docs/INSTALL.md §6.3. A client
 * config with an address and no fingerprint would be a client that trusts
 * whoever replies first, so the schema refuses one.
 */
export const clientConfigSchema = z.object({
  /** `https://192.168.1.7:4173` — exactly what the host's own screen shows. */
  hostUrl: z.string().url().startsWith("https://"),
  /** `AB:CD:…`, 32 uppercase hex pairs, as `getPeerCertificate().fingerprint256` spells it. */
  fingerprintSha256: z.string().regex(/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/),
  /**
   * Stable per-install id. It is what the seat is held against, so it must
   * survive a restart — a device that minted a new one on every launch would
   * consume a fresh seat each morning until the shop ran out.
   */
  deviceId: z.string().min(1),
  /** What the host's connected-devices screen calls this machine. */
  deviceLabel: z.string().min(1),
});

export type ClientConfig = z.infer<typeof clientConfigSchema>;

export function clientConfigPath(dbPath: string): string {
  return path.join(path.dirname(dbPath), "client.json");
}

export type ClientConfigResult =
  | { readonly role: "host" }
  | { readonly role: "client"; readonly config: ClientConfig }
  | { readonly role: "unusable"; readonly reason: string };

/**
 * Reads the role for this install.
 *
 * A MALFORMED FILE IS NOT TREATED AS "HOST". Falling back to host on an
 * unreadable client config is the one wrong answer available here: the machine
 * would open its own empty database, seed its own chart of accounts, and
 * present a working-looking Mezan holding none of the shop's data — and the
 * first person to use it would enter a day of invoices into a ledger nobody
 * else can see. `unusable` stops the app with a message instead.
 */
export async function readClientConfig(dbPath: string): Promise<ClientConfigResult> {
  const file = clientConfigPath(dbPath);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { role: "host" };
    return { role: "unusable", reason: `${file} could not be read: ${String(err)}` };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return { role: "unusable", reason: `${file} is not valid JSON.` };
  }

  const parsed = clientConfigSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return { role: "unusable", reason: `${file} is not a valid client configuration — ${problems.join("; ")}` };
  }

  return { role: "client", config: parsed.data };
}

export interface PairingRequest {
  readonly hostUrl: string;
  readonly fingerprintSha256: string;
  readonly deviceLabel?: string;
}

/**
 * `Mezan --pair-host=https://192.168.1.7:4173 --pair-fingerprint=AB:CD:… [--device-label="مكتب المحاسب"]`
 *
 * Both values are read off the host's own «الأجهزة المتصلة» screen, which shows
 * them side by side with copy buttons for exactly this. The fingerprint is not
 * a formality and must not be made optional "for convenience": it is the whole
 * of what distinguishes the real host from anyone else answering on that
 * address, and a pairing step that skipped it would leave a client that trusts
 * whoever replies first — see lan-client.ts.
 *
 * A flag rather than a screen, for now, because it is what a consultant can run
 * from a shortcut on twelve machines in an afternoon. The first-run wizard step
 * that wraps this is the obvious next piece.
 */
export function readPairingRequest(argv: readonly string[] = process.argv): PairingRequest | null {
  const read = (name: string): string | undefined => {
    const prefixed = argv.find((arg) => arg.startsWith(`--${name}=`));
    if (prefixed) return prefixed.slice(name.length + 3);
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const hostUrl = read("pair-host");
  const fingerprintSha256 = read("pair-fingerprint");
  if (!hostUrl && !fingerprintSha256) return null;
  // Half a pairing is not a pairing. Returning what was given and letting the
  // schema refuse it later would report "invalid fingerprint" for a flag the
  // operator simply forgot to type.
  if (!hostUrl || !fingerprintSha256) {
    throw new Error(
      "--pair-host and --pair-fingerprint go together. Both are shown on the host's connected-devices screen.",
    );
  }
  return { hostUrl, fingerprintSha256, deviceLabel: read("device-label") };
}

/** Writes the file that makes this install a client of `hostUrl`. */
export async function writeClientConfig(
  dbPath: string,
  input: { hostUrl: string; fingerprintSha256: string; deviceLabel?: string },
): Promise<ClientConfig> {
  const existing = await readClientConfig(dbPath);
  const config = clientConfigSchema.parse({
    hostUrl: input.hostUrl,
    fingerprintSha256: input.fingerprintSha256.toUpperCase(),
    // Reuse the id when there is one, so re-pointing a client at a re-installed
    // host does not burn a second seat for the same physical machine.
    deviceId: existing.role === "client" ? existing.config.deviceId : randomUUID(),
    deviceLabel: input.deviceLabel?.trim() || hostname(),
  });
  await writeFile(clientConfigPath(dbPath), `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return config;
}
