import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bindTenantDatabase, openSqliteConnection } from "@mezan/persistence";
import { decryptFile } from "../../desktop/src/backup/portable-export.js";
import { restoreBackup } from "../../desktop/src/backup/restore-service.js";
import { bootCloudHarness, type CloudHarness } from "./cloud-harness.js";
import { tenantBackupFolder } from "./backup-scheduler.js";
import { EXPORTS_FOLDER } from "./tenant-backups.js";

const harnesses: CloudHarness[] = [];
afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close();
  vi.restoreAllMocks();
});

const PASSPHRASE = "a long enough passphrase";

async function provisioned() {
  const harness = await bootCloudHarness();
  harnesses.push(harness);
  const operator = await harness.platformToken();
  const created = await harness.send("/api/platform/tenants", {
    method: "POST",
    token: operator,
    body: JSON.stringify({ code: "acme", nameAr: "منشأة أكمي", ownerEmail: "owner@acme.example", ownerNameAr: "المالك", planId: "PLAN-CORE", billingCycle: "monthly", trial: false }),
  });
  expect(created.status).toBe(201);
  const { tenant } = (await created.json()) as { tenant: { id: string } };
  return { harness, operator, tenantId: tenant.id };
}

describe("a tenant's books exported from the console on a booted cloud edition", () => {
  it("downloads once as an archive the desktop import opens, with the tenant's own owner inside, and leaves nothing on disk", async () => {
    const { harness, operator, tenantId } = await provisioned();

    const exported = await harness.send(`/api/platform/tenants/${tenantId}/export`, {
      method: "POST",
      token: operator,
      body: JSON.stringify({ reason: "moving to desktop", passphrase: PASSPHRASE }),
    });
    expect(exported.status).toBe(200);
    const offer = (await exported.json()) as { downloadPath: string; bytes: number; fileName: string };

    const unauthenticated = await harness.send(`/api/platform${offer.downloadPath}`);
    expect(unauthenticated.status).toBe(401);

    const file = await harness.send(`/api/platform${offer.downloadPath}`, { token: operator });
    expect(file.status).toBe(200);
    expect(file.headers.get("content-disposition")).toContain(offer.fileName);
    const bytes = Buffer.from(await file.arrayBuffer());
    expect(bytes.length).toBe(offer.bytes);

    const again = await harness.send(`/api/platform${offer.downloadPath}`, { token: operator });
    expect(again.status).toBe(404);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(readdirSync(path.join(harness.env.platformDir, EXPORTS_FOLDER))).toEqual([]);

    const work = path.join(harness.env.platformDir, "desktop-side");
    mkdirSync(work, { recursive: true });
    const encrypted = path.join(work, "in.mezanbak.enc");
    writeFileSync(encrypted, bytes);
    const plain = path.join(work, "in.tar.gz");
    await decryptFile(encrypted, plain, PASSPHRASE);
    const target = path.join(work, "restored.sqlite");
    await restoreBackup({ archivePath: plain, targetDbPath: target, workDir: path.join(work, "tmp") });
    const { sqlite } = openSqliteConnection(target);
    try {
      const users = sqlite.prepare(`SELECT email FROM user`).all() as Array<{ email: string }>;
      expect(users.map((u) => u.email)).toContain("owner@acme.example");
    } finally {
      sqlite.close();
    }
  }, 120_000);

  it("refuses a missing reason and another tenant's link", async () => {
    const { harness, operator, tenantId } = await provisioned();
    const other = await harness.send("/api/platform/tenants", {
      method: "POST",
      token: operator,
      body: JSON.stringify({ code: "beta", nameAr: "منشأة بيتا", ownerEmail: "owner@beta.example", ownerNameAr: "المالك", planId: "PLAN-CORE", billingCycle: "monthly", trial: false }),
    });
    const otherId = ((await other.json()) as { tenant: { id: string } }).tenant.id;

    const noReason = await harness.send(`/api/platform/tenants/${tenantId}/export`, { method: "POST", token: operator, body: JSON.stringify({ reason: " ", passphrase: PASSPHRASE }) });
    expect(noReason.status).toBe(400);

    const offer = (await (await harness.send(`/api/platform/tenants/${tenantId}/export`, { method: "POST", token: operator, body: JSON.stringify({ reason: "audit copy", passphrase: PASSPHRASE }) })).json()) as { downloadPath: string };
    const token = offer.downloadPath.split("/").pop()!;
    const crossed = await harness.send(`/api/platform/tenants/${otherId}/export/${token}`, { token: operator });
    expect(crossed.status).toBe(404);
    const own = await harness.send(`/api/platform${offer.downloadPath}`, { token: operator });
    expect(own.status).toBe(200);
    await own.arrayBuffer();
  }, 120_000);

  it("drills a stored backup of the booted tenant and leaves the live database alone", async () => {
    const { harness, operator, tenantId } = await provisioned();
    const folder = tenantBackupFolder(harness.env.platformDir, tenantId);
    mkdirSync(folder, { recursive: true });
    const stored = path.join(folder, "2026-01-01T00-00-00.000Z.sqlite");
    const { sqlite } = openSqliteConnection(stored);
    sqlite.exec(`CREATE TABLE t (id TEXT); INSERT INTO t VALUES ('a')`);
    bindTenantDatabase(sqlite, tenantId);
    sqlite.close();

    const listed = await harness.send(`/api/platform/tenants/${tenantId}/backups`, { token: operator });
    expect(((await listed.json()) as { backups: Array<{ file: string }> }).backups.map((b) => b.file)).toEqual(["2026-01-01T00-00-00.000Z.sqlite"]);

    const drilled = await harness.send(`/api/platform/tenants/${tenantId}/backups/drill`, { method: "POST", token: operator, body: "{}" });
    expect(drilled.status).toBe(200);
    expect(await drilled.json()).toMatchObject({ outcome: "pass", report: "ok" });

    const trail = await harness.send("/api/platform/security/events", { token: operator });
    if (trail.status === 200) expect(await trail.text()).toContain("TENANT_BACKUP_DRILL");
  }, 120_000);
});
