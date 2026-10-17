// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ForeignResidueKind } from "@mezan/domain";
import { FxResidueCard } from "./FxResidueCard";
import type { ForeignResidueDTO, FxResidueSweepResultDTO } from "../data/fx-residue-hooks";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { Session } from "../data/session";

const ROUNDING: ForeignResidueDTO = { kind: ForeignResidueKind.Account, ref: "1310", currency: "USD", base: "0.004000" };
const REAL: ForeignResidueDTO = { kind: ForeignResidueKind.Account, ref: "2105", currency: "EUR", base: "-125.500000" };

const ACCOUNTS = [
  { id: "1310", code: "1310", nameAr: "بنك مصر بالدولار", nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" },
  { id: "2105", code: "2105", nameAr: "موردون باليورو", nameEn: null, type: "liability", naturalBalance: "credit", parentId: null, isHeader: false, status: "active" },
];

function transportWith(rows: ForeignResidueDTO[], swept: unknown[] = [], result?: { status?: number; body: unknown }) {
  return stubTransport({
    "GET /revaluation/residue": () => ({ body: { rows: [...rows] } }),
    "GET /accounts": () => ({ body: ACCOUNTS }),
    "GET /entitlements": () => ({ body: { plan: "pro", activeModules: ["accounting", "treasury"], features: {}, seats: 5, expiresAt: null } }),
    "POST /revaluation/residue/sweep": (init) => {
      swept.push(JSON.parse(String(init?.body)));
      if (result) return result;
      const gone = rows.splice(0, 1);
      const body: FxResidueSweepResultDTO = {
        swept: gone,
        sweptCount: gone.length,
        refused: rows.map((row) => ({ ...row, message: "الرصيد المتبقي ليس فرق تقريب؛ يُعالج من مصدره ولا يُرحَّل إلى فروق العملة." })),
        entryId: "je-1",
      };
      return { status: 201, body };
    },
  });
}

const restricted = (permissions: string[]): Session => ({ ...testAdminSession, userId: "USER-R", isCompanyAdmin: false, permissions, roleCode: "R" });

describe("FxResidueCard — base left behind on a foreign balance that reached zero", () => {
  it("lists each residue and says which are rounding remainders and which must be corrected at their source", async () => {
    renderWithProviders(<FxResidueCard date="2026-08-31" />, { transport: transportWith([ROUNDING, REAL]), initialSession: testAdminSession });
    const rounding = await screen.findByRole("row", { name: /1310/ });
    expect(within(rounding).getByText("USD")).toBeInTheDocument();
    expect(within(rounding).getByText("فرق تقريب")).toBeInTheDocument();
    expect(await within(rounding).findByText(/بنك مصر بالدولار/)).toBeInTheDocument();
    const real = screen.getByRole("row", { name: /2105/ });
    expect(within(real).getByText("يُعالَج من مصدره")).toBeInTheDocument();
    expect(within(real).getByText("125.50")).toBeInTheDocument();
  });

  it("says what the sweep posts and on which date, sweeps on that date, and reports what it refused", async () => {
    const swept: unknown[] = [];
    renderWithProviders(<FxResidueCard date="2026-08-31" />, { transport: transportWith([{ ...ROUNDING }, { ...REAL }], swept), initialSession: testAdminSession });

    fireEvent.click(await screen.findByRole("button", { name: "ترحيل فروق التقريب" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/2026-08-31/)).toBeInTheDocument();
    expect(within(dialog).getByText(/فروق العملة المحقَّقة/)).toBeInTheDocument();
    expect(swept).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "ترحيل القيد" }));

    await waitFor(() => expect(swept).toEqual([{ date: "2026-08-31" }]));
    expect(await screen.findByText(/رُحِّل 1 فرق تقريب/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("row", { name: /1310/ })).not.toBeInTheDocument());
    expect(screen.getByRole("row", { name: /2105/ })).toBeInTheDocument();
  });

  it("does not offer the sweep when no residue is a rounding remainder", async () => {
    renderWithProviders(<FxResidueCard date="2026-08-31" />, { transport: transportWith([REAL]), initialSession: testAdminSession });
    await screen.findByRole("row", { name: /2105/ });
    expect(screen.getByRole("button", { name: "ترحيل فروق التقريب" })).toBeDisabled();
  });

  it("shows the server's Arabic refusal when the sweep is refused", async () => {
    renderWithProviders(<FxResidueCard date="2026-08-31" />, {
      transport: transportWith([{ ...ROUNDING }], [], { status: 422, body: { error: "PERIOD_NOT_OPEN", message: "الفترة المحاسبية مغلقة." } }),
      initialSession: testAdminSession,
    });
    fireEvent.click(await screen.findByRole("button", { name: "ترحيل فروق التقريب" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "ترحيل القيد" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("الفترة المحاسبية مغلقة.");
  });

  it("lists the residues but offers no sweep to a session that cannot post to the journal", async () => {
    renderWithProviders(<FxResidueCard date="2026-08-31" />, { transport: transportWith([ROUNDING]), initialSession: restricted(["accounting.journal.view"]) });
    await screen.findByRole("row", { name: /1310/ });
    expect(screen.queryByRole("button", { name: "ترحيل فروق التقريب" })).not.toBeInTheDocument();
  });

  it("renders nothing when there is no residue, and asks nothing for a session that cannot read the journal", async () => {
    const clean = renderWithProviders(<FxResidueCard date="2026-08-31" />, { transport: transportWith([]), initialSession: testAdminSession });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(clean.container.querySelector("table")).toBeNull();
    clean.unmount();

    const asked: string[] = [];
    const base = transportWith([ROUNDING]);
    renderWithProviders(<FxResidueCard date="2026-08-31" />, {
      transport: (path, init) => {
        asked.push(path);
        return base(path, init);
      },
      initialSession: restricted(["sales.invoice.view"]),
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(asked).not.toContain("/revaluation/residue");
  });
});
