import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/**
 * WHERE ONLINE BACKUPS GO, AND WHAT THEY DO NOT PROTECT.
 *
 * A `.mezanbak` archive is already encrypted, with the key sealed to THIS
 * machine's OS keychain (main/encrypted-database.ts). Uploading it therefore
 * gives the storage provider — and us — nothing readable, which is the point.
 *
 * It also means an uploaded archive CANNOT BE RESTORED ANYWHERE ELSE. There is
 * deliberately no key escrow: nothing off this machine can open these files.
 * So online backup here protects against
 *
 *   - ransomware or a wiped disk,
 *   - a deleted or corrupted local backups folder,
 *   - fire, flood, theft of the premises,
 *
 * and does NOT protect against losing the MACHINE. For that, the owner still
 * has to have taken `database-key.txt` off the machine and kept it
 * (docs/INSTALL.md §4.1). Anyone who tells a client "it is backed up online, so
 * you are safe if the PC dies" is wrong, and this comment exists so nobody says
 * it by accident.
 *
 * S3-compatible on purpose: one implementation reaches Backblaze B2, Wasabi,
 * MinIO, a NAS or AWS itself, and the shop's own bucket stays the shop's.
 */
/**
 * THE PREFERRED SHAPE: this machine holds no bucket credential at all.
 *
 * `presignEndpoint` is asked, over HTTPS, for a short-lived URL to PUT one
 * archive to; the vendor signs it with a secret that never leaves their side.
 * The alternative below (`accessKeyId`/`secretAccessKey`) puts a long-lived
 * credential in a plaintext file on a shop counter, where one stolen laptop is
 * the whole bucket — every shop in it, if the bucket is shared. Prefer this.
 *
 * `token` is whatever the endpoint uses to recognise the shop. It is a bearer
 * secret, so it is still worth protecting — but it buys an attacker a URL to
 * upload with, not the ability to read every other shop's archives.
 */
export const presignedBackupConfigSchema = z.object({
  mode: z.literal("presigned"),
  presignEndpoint: z.string().url().startsWith("https://"),
  token: z.string().min(1),
});

export type PresignedBackupConfig = z.infer<typeof presignedBackupConfigSchema>;

export const remoteBackupConfigSchema = z.object({
  /**
   * Full endpoint origin, e.g. `https://s3.eu-central-003.backblazeb2.com`.
   * HTTPS only: these are the shop's books crossing the public internet, and a
   * plaintext endpoint would put the bucket credentials on the wire too.
   */
  endpoint: z.string().url().startsWith("https://"),
  region: z.string().min(1),
  bucket: z.string().min(1),
  /** Key prefix inside the bucket, so one bucket can hold several shops. */
  prefix: z.string().default(""),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  /** How many archives to keep remotely. Older ones are deleted after a successful upload. */
  keep: z.number().int().positive().default(14),
});

export type RemoteBackupConfig = z.infer<typeof remoteBackupConfigSchema>;

export function remoteBackupConfigPath(dbPath: string): string {
  return path.join(path.dirname(dbPath), "backup-remote.json");
}

export type RemoteBackupSetup =
  | { readonly configured: false }
  | { readonly configured: true; readonly config: RemoteBackupConfig }
  | { readonly configured: true; readonly presigned: PresignedBackupConfig }
  | { readonly configured: false; readonly error: string };

/**
 * Reads the online-backup destination, or reports that there is none.
 *
 * ABSENT IS NOT AN ERROR — most installs never configure this, and a shop with
 * no bucket must still take its local backups exactly as before. A malformed
 * file IS reported, because "I configured online backup" and "my backups are
 * going nowhere" must never look the same from the outside.
 */
export async function readRemoteBackupConfig(dbPath: string): Promise<RemoteBackupSetup> {
  const file = remoteBackupConfigPath(dbPath);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { configured: false };
    return { configured: false, error: `${file} could not be read: ${String(err)}` };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return { configured: false, error: `${file} is not valid JSON.` };
  }

  // `mode: "presigned"` selects the credential-free path; anything else is read
  // as the legacy shape that carries bucket keys. Checked first so a file that
  // means to be presigned is never silently parsed as the weaker one.
  if ((parsedJson as { mode?: unknown } | null)?.mode === "presigned") {
    const asPresigned = presignedBackupConfigSchema.safeParse(parsedJson);
    if (!asPresigned.success) {
      const problems = asPresigned.error.issues.map(
        (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
      );
      return { configured: false, error: `${file} is not a valid presigned destination — ${problems.join("; ")}` };
    }
    return { configured: true, presigned: asPresigned.data };
  }

  const parsed = remoteBackupConfigSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
    );
    return { configured: false, error: `${file} is not a valid destination — ${problems.join("; ")}` };
  }

  return { configured: true, config: parsed.data };
}
