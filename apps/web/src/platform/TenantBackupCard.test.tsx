// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TenantWireStatus, type TenantDTO } from "@mezan/contracts";
import type { Transport, TransportResponse } from "../data/transport";
import { TenantBackupCard } from "./TenantBackupCard";
import { TenantAuditAnchorCard } from "./TenantAuditAnchorCard";
import { TenantRetentionCard } from "./TenantRetentionCard";
import { renderWithPlatformProviders, stubPlatformTransport, testPlatformSession } from "./test-support";

const tenant: TenantDTO = {
  id: "tenant-1",
  code: "acme",
  nameAr: "شركة أكمي",
  nameEn: "Acme Co",
  ownerEmail: "owner@acme.test",
  status: TenantWireStatus.Active,
  ownerContactVerified: true,
  ownerNeeded: false,
  pendingOwner: null,
  dbFile: "tenants/acme.db",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const PASSPHRASE = "a long enough passphrase";

const offer = {
  downloadPath: "/tenants/tenant-1/export/TOKEN",
  fileName: "mezan-portable-2026.mezanbak.enc",
  bytes: 3 * 1024 * 1024,
  expiresAt: "2026-10-17T12:10:00.000Z",
  tableCount: 12,
  totalRows: 340,
};

const passing = { file: "b.sqlite", at: "2026-10-17T12:00:00.000Z", outcome: "pass", report: "ok", tableCount: 12, totalRows: 340, emptyTables: 2, largestTables: [{ name: "journal_line", rows: 200 }], ms: 5 };

interface Handlers {
  export?: () => { status?: number; body: unknown };
  download?: () => { status?: number; body: unknown };
  drill?: (body: unknown) => { status?: number; body: unknown };
}

function transportFor(handlers: Handlers, seen: string[]): Transport {
  return async (path, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    seen.push(`${method} ${path}${init?.body ? ` ${String(init.body)}` : ""}`);
    let result: { status?: number; body: unknown } = { status: 404, body: { error: "NOT_FOUND" } };
    if (method === "GET" && path === "/tenants/tenant-1/backups") {
      result = { body: { backups: [{ file: "a.sqlite", bytes: 1024, createdAt: "2026-10-16T00:00:00.000Z" }, { file: "b.sqlite", bytes: 2048, createdAt: "2026-10-17T00:00:00.000Z" }] } };
    } else if (method === "POST" && path === "/tenants/tenant-1/export") result = handlers.export?.() ?? result;
    else if (method === "GET" && path === offer.downloadPath) result = handlers.download?.() ?? { body: null };
    else if (method === "POST" && path === "/tenants/tenant-1/backups/drill") result = handlers.drill?.(JSON.parse(String(init?.body))) ?? result;
    const status = result.status ?? 200;
    const response: TransportResponse = {
      status,
      ok: status >= 200 && status < 400,
      json: <T,>() => Promise.resolve(result.body as T),
      text: () => Promise.resolve(JSON.stringify(result.body)),
      blob: () => Promise.resolve(new Blob(["abc"])),
    };
    return response;
  };
}

function renderCard(handlers: Handlers, options: { role?: "owner" | "support"; onError?: (err: unknown) => void; status?: TenantDTO["status"] } = {}) {
  const seen: string[] = [];
  const onError = options.onError ?? vi.fn();
  renderWithPlatformProviders(<TenantBackupCard tenant={{ ...tenant, status: options.status ?? tenant.status }} isOwner={options.role !== "support"} booksRefused={false} onError={onError} />, {
    transport: transportFor(handlers, seen),
    initialSession: { ...testPlatformSession, user: { ...testPlatformSession.user, role: options.role ?? "owner" } },
  });
  return { seen, onError };
}

async function fillExportDialog(reason: string, passphrase: string, again: string) {
  fireEvent.click(await screen.findByRole("button", { name: "تصدير نسخة" }));
  const dialog = await screen.findByRole("dialog", { name: "تصدير نسخة كاملة من بيانات هذه المنشأة؟" });
  fireEvent.change(within(dialog).getByLabelText("السبب"), { target: { value: reason } });
  fireEvent.change(within(dialog).getByLabelText("كلمة سر الملف"), { target: { value: passphrase } });
  fireEvent.change(within(dialog).getByLabelText("أعد كتابة كلمة السر"), { target: { value: again } });
  return dialog;
}

afterEach(() => vi.restoreAllMocks());

describe("TenantBackupCard", () => {
  it("is neither shown nor loaded for a support operator or a tenant that is not live", async () => {
    const support = renderCard({}, { role: "support" });
    await Promise.resolve();
    expect(screen.queryByText("النسخ الاحتياطي والتصدير")).not.toBeInTheDocument();
    expect(support.seen).toEqual([]);
  });

  it("will not export without a reason, a long enough passphrase, and the same passphrase twice", async () => {
    renderCard({});

    const none = await fillExportDialog("  ", PASSPHRASE, PASSPHRASE);
    expect(within(none).getByRole("button", { name: "تصدير وتشفير" })).toBeDisabled();
    fireEvent.change(within(none).getByLabelText("السبب"), { target: { value: "نقل إلى سطح المكتب" } });
    fireEvent.change(within(none).getByLabelText("كلمة سر الملف"), { target: { value: "short" } });
    expect(within(none).getByRole("button", { name: "تصدير وتشفير" })).toBeDisabled();
    fireEvent.change(within(none).getByLabelText("كلمة سر الملف"), { target: { value: PASSPHRASE } });
    fireEvent.change(within(none).getByLabelText("أعد كتابة كلمة السر"), { target: { value: `${PASSPHRASE}x` } });
    expect(within(none).getByRole("button", { name: "تصدير وتشفير" })).toBeDisabled();
    expect(within(none).getByText("كلمتا السر غير متطابقتين.")).toBeInTheDocument();
    fireEvent.change(within(none).getByLabelText("أعد كتابة كلمة السر"), { target: { value: PASSPHRASE } });
    expect(within(none).getByRole("button", { name: "تصدير وتشفير" })).toBeEnabled();
  });

  it("sends the reason and passphrase, offers the file, and downloads it once", async () => {
    const createObjectURL = vi.fn(() => "blob:x");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const { seen } = renderCard({ export: () => ({ body: offer }) });

    const dialog = await fillExportDialog(" نقل إلى سطح المكتب ", PASSPHRASE, PASSPHRASE);
    fireEvent.click(within(dialog).getByRole("button", { name: "تصدير وتشفير" }));

    expect(await screen.findByText("الملف جاهز للتنزيل")).toBeInTheDocument();
    expect(seen).toContain(`POST /tenants/tenant-1/export ${JSON.stringify({ reason: "نقل إلى سطح المكتب", passphrase: PASSPHRASE })}`);
    expect(screen.getByText(/الرابط يعمل مرة واحدة فقط/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "تنزيل الملف" }));

    await waitFor(() => expect(screen.queryByText("الملف جاهز للتنزيل")).not.toBeInTheDocument());
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(seen.filter((entry) => entry === `GET ${offer.downloadPath}`)).toHaveLength(1);
  });

  it("drops the offer and reports the server's sentence when the link is already spent", async () => {
    const { onError } = renderCard({
      export: () => ({ body: offer }),
      download: () => ({ status: 404, body: { error: "TENANT_EXPORT_GONE", message: "رابط التنزيل غير صالح أو استُخدم أو انتهت مدته. أنشئ تصديرًا جديدًا." } }),
    });
    const dialog = await fillExportDialog("نقل", PASSPHRASE, PASSPHRASE);
    fireEvent.click(within(dialog).getByRole("button", { name: "تصدير وتشفير" }));
    fireEvent.click(await screen.findByRole("button", { name: "تنزيل الملف" }));

    await waitFor(() => expect(screen.queryByText("الملف جاهز للتنزيل")).not.toBeInTheDocument());
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("استُخدم") }));
  });

  it("runs a restore drill on the latest backup and shows the pass with its counts", async () => {
    const asked: unknown[] = [];
    renderCard({ drill: (body) => (asked.push(body), { body: passing }) });

    await waitFor(() => expect(screen.getByRole("button", { name: "تجربة الاستعادة" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "تجربة الاستعادة" }));

    expect(await screen.findByText("نجحت الاستعادة")).toBeInTheDocument();
    expect(screen.getByText(/340/)).toBeInTheDocument();
    expect(screen.getByText(/journal_line/)).toBeInTheDocument();
    expect(asked).toEqual([{}]);
  });

  it("drills the backup that was chosen and shows a failure with its reason", async () => {
    const asked: unknown[] = [];
    renderCard({ drill: (body) => (asked.push(body), { body: { ...passing, file: "a.sqlite", outcome: "fail", report: "database disk image is malformed" } }) });

    await waitFor(() => expect(screen.getByRole("button", { name: "تجربة الاستعادة" })).toBeEnabled());
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "النسخة المراد تجربتها" }));
    await user.click((await screen.findAllByRole("option"))[1]!);
    await user.click(screen.getByRole("button", { name: "تجربة الاستعادة" }));

    expect(await screen.findByText("فشلت الاستعادة")).toBeInTheDocument();
    expect(screen.getByText("database disk image is malformed")).toBeInTheDocument();
    expect(asked).toEqual([{ file: "a.sqlite" }]);
  });
});

describe("TenantAuditAnchorCard — accepting a legitimate restore", () => {
  const refused = {
    state: "refused",
    refusal: "ROLLED_BACK",
    latestAnchoredSeq: 6,
    latestAnchoredAt: "2026-10-17T10:00:00.000Z",
    liveHeadSeq: 3,
    lastRebase: null,
    canAcceptRestore: true,
  };

  function renderAnchorCard(status: unknown, accepted: unknown[]) {
    const transport: Transport = async (path, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      let result: { status: number; body: unknown } = { status: 404, body: { error: "NOT_FOUND" } };
      if (method === "GET" && path === "/tenants/tenant-1/audit-anchor") result = { status: 200, body: status };
      if (method === "POST" && path === "/tenants/tenant-1/audit-anchor/accept-restore") {
        accepted.push(JSON.parse(String(init?.body)));
        result = { status: 200, body: { seq: 3, headHash: "h3", supersededSeq: 6, supersededHeadHash: "h6", anchoredAt: "2026-10-18T08:00:00.000Z" } };
      }
      return {
        status: result.status,
        ok: result.status < 400,
        json: <T,>() => Promise.resolve(result.body as T),
        text: () => Promise.resolve(JSON.stringify(result.body)),
        blob: () => Promise.resolve(new Blob([])),
      };
    };
    renderWithPlatformProviders(<TenantAuditAnchorCard tenant={tenant} isOwner booksRefused={false} onError={vi.fn()} />, { transport, initialSession: testPlatformSession });
  }

  it("explains the refusal in Arabic and accepts the restore only with a reason of ten characters and the password", async () => {
    const accepted: unknown[] = [];
    renderAnchorCard(refused, accepted);

    expect(await screen.findByText("متوقف — احتمال عبث")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("أقصر من آخر ختم");
    fireEvent.click(screen.getByRole("button", { name: "اعتماد الاستعادة" }));
    const dialog = await screen.findByRole("dialog", { name: "اعتماد استعادة سجل التدقيق؟" });
    fireEvent.change(within(dialog).getByLabelText("سبب الاستعادة"), { target: { value: "قصير" } });
    fireEvent.change(within(dialog).getByLabelText("كلمة مرورك للتأكيد"), { target: { value: "correct horse battery" } });
    expect(within(dialog).getByRole("button", { name: "اعتماد وتوقيع" })).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("سبب الاستعادة"), { target: { value: "استعدنا نسخة الليلة الماضية بعد عطل القرص" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "اعتماد وتوقيع" }));

    await waitFor(() => expect(accepted).toEqual([{ reason: "استعدنا نسخة الليلة الماضية بعد عطل القرص", password: "correct horse battery" }]));
    expect(await screen.findByText(/يُستأنف ختم السجل/)).toBeInTheDocument();
  });

  it("offers no accept button for a forged anchor trail", async () => {
    renderAnchorCard({ ...refused, refusal: "NEWEST_ANCHOR_FORGED", canAcceptRestore: false }, []);
    expect(await screen.findByRole("alert")).toHaveTextContent("لا يحمل توقيعًا صحيحًا");
    expect(screen.queryByRole("button", { name: "اعتماد الاستعادة" })).not.toBeInTheDocument();
  });
});

describe("TenantRetentionCard — deletion after the service ends", () => {
  const archived = { ...tenant, status: TenantWireStatus.Archived };
  const retention = { retentionDays: 90, retention: { terminatedAt: "2026-10-01T00:00:00.000Z", deleteAfter: "2026-12-30T00:00:00.000Z", lastExtension: null } };

  it("shows the deletion date and that off-server snapshots age out on their own, and deletes now only with the typed code, a reason and the password", async () => {
    const purged: unknown[] = [];
    const transport = stubPlatformTransport({
      "GET /tenants/tenant-1/retention": () => ({ body: retention }),
      "POST /tenants/tenant-1/retention/purge": (init) => (purged.push(JSON.parse(String(init?.body))), { body: { tenantId: "tenant-1", code: "acme", deletedAt: "2026-10-19T00:00:00.000Z", removed: [] } }),
    });
    renderWithPlatformProviders(<TenantRetentionCard tenant={archived} isOwner onError={vi.fn()} />, { transport, initialSession: testPlatformSession });

    expect(await screen.findByText(/مجدول للحذف في/)).toBeInTheDocument();
    expect(screen.getByText(/restic/)).toHaveTextContent("تنتهي وحدها");
    fireEvent.click(screen.getByRole("button", { name: "حذف البيانات الآن" }));
    const dialog = await screen.findByRole("dialog", { name: "حذف كل بيانات هذه المنشأة الآن؟" });
    fireEvent.change(within(dialog).getByLabelText("السبب"), { target: { value: "المالك صدّر بياناته وطلب الحذف" } });
    fireEvent.change(within(dialog).getByLabelText("كلمة مرورك للتأكيد"), { target: { value: "correct horse battery" } });
    fireEvent.change(within(dialog).getByLabelText("رمز المنشأة"), { target: { value: "acm" } });
    expect(within(dialog).getByRole("button", { name: "حذف نهائي" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("رمز المنشأة"), { target: { value: "acme" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حذف نهائي" }));

    await waitFor(() => expect(purged).toEqual([{ reason: "المالك صدّر بياناته وطلب الحذف", password: "correct horse battery", confirmCode: "acme" }]));
  });

  it("shows nothing for a live tenant — its data is never scheduled for deletion", async () => {
    const { container } = renderWithPlatformProviders(<TenantRetentionCard tenant={tenant} isOwner onError={vi.fn()} />, { transport: stubPlatformTransport({}), initialSession: testPlatformSession });
    expect(container.textContent).toBe("");
  });
});
