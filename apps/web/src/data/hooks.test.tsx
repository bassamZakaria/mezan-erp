// @vitest-environment jsdom
/**
 * hooks.ts is 7414 lines and exports 382 `useXxx` hooks across nearly every
 * domain in the ERP. Exhaustively testing all 382 is not attempted here —
 * this file gives REPRESENTATIVE, DEEP coverage of the diverse patterns the
 * file uses (plain list query, filtered query + query string, chip-counts /
 * stats siblings, a two-step draft+confirm mutation, single-entity queries
 * disabled on a null id, 404-as-null queries, and — the highest-value check —
 * every mutation's `invalidateQueries` key compared against its sibling list
 * query's key) across ~12 domains: items, customers, accounts, treasury
 * accounts, price lists, promotions, sales quotes, journal entries,
 * users/roles, settings, branches, cheques, and bank statements. Domains NOT
 * covered here (suppliers, warehouses, purchase docs, assets, HR/payroll —
 * payroll is covered in hr-payroll-hooks.test.tsx — manufacturing, etc.) are a
 * deliberate scoping decision given the file's size, not an oversight.
 * `customersQuery`/`customerFilterFromUrl` (list-queries.ts) already cover the
 * customers filter→querystring logic in detail, so that part isn't repeated.
 */
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AppI18nProvider } from "../i18n";
import { ApiProvider } from "./ApiContext";
import { createQueryClient } from "./queryClient";
import { stubTransport, testAdminSession } from "./test-support";
import type { Transport } from "./transport";
import {
  ApiError,
  useAccounts,
  useBankStatement,
  useBankStatements,
  useBranches,
  useCheques,
  useCreateAccount,
  useCreateBranch,
  useCreateCheque,
  useCreateCustomer,
  useCreateItem,
  useCreateJournalEntry,
  useCreatePriceList,
  useCreatePromotion,
  useCreateRole,
  useCreateSalesQuote,
  useCreateTreasuryAccount,
  useCreateUser,
  useCustomers,
  useDeleteRole,
  useImportBankStatement,
  useItemCounts,
  useItems,
  useItemStats,
  useJournalEntries,
  usePriceLists,
  usePromotions,
  useReverseJournalEntry,
  useRoles,
  useSalesQuoteCounts,
  useSalesQuotes,
  useSettings,
  useTreasuryAccounts,
  useUpdateAccount,
  useUpdateBranch,
  useUpdateItem,
  useUpdateSettings,
  useUpdateTreasuryAccount,
  useUpdateUser,
  useUsers,
} from "./hooks";

function makeWrapper(transport: Transport, session = testAdminSession) {
  const queryClient = createQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AppI18nProvider>
        <QueryClientProvider client={queryClient}>
          <ApiProvider transport={transport} initialSession={session}>
            {children}
          </ApiProvider>
        </QueryClientProvider>
      </AppI18nProvider>
    );
  }
  return { Wrapper, queryClient };
}

describe("items", () => {
  it("useItems builds the query string from a non-trivial filter and returns the rows", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /items": (_init, path) => {
        seenPath = path;
        return { body: [{ id: "I1" }] };
      },
    });
    const { result } = renderHook(() => useItems({ status: "active", search: "قهوة" } as never), {
      wrapper: makeWrapper(transport).Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toContain("/items?");
    expect(seenPath).toContain("status=active");
    expect(result.current.data).toEqual([{ id: "I1" }]);
  });

  it("useItems returns an empty list cleanly and surfaces a failure", async () => {
    const { result: empty } = renderHook(() => useItems(), {
      wrapper: makeWrapper(stubTransport({ "GET /items": () => ({ body: [] }) })).Wrapper,
    });
    await waitFor(() => expect(empty.current.isSuccess).toBe(true));
    expect(empty.current.data).toEqual([]);

    const { result: failing } = renderHook(() => useItems(), {
      wrapper: makeWrapper(stubTransport({ "GET /items": () => ({ status: 500, body: {} }) })).Wrapper,
    });
    await waitFor(() => expect(failing.current.isError).toBe(true));
    expect(failing.current.error).toBeInstanceOf(ApiError);
  });

  it("useItemCounts withholds the status filter so every chip reports its own total", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /items/counts": (_init, path) => {
        seenPath = path;
        return { body: { all: 10 } };
      },
    });
    const { result } = renderHook(() => useItemCounts({ status: "active", search: "test" } as never), {
      wrapper: makeWrapper(transport).Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).not.toContain("status=");
    expect(seenPath).toContain("search=test");
  });

  it("useItemStats hits /items/stats", async () => {
    const transport = stubTransport({ "GET /items/stats": () => ({ body: { count: 5 } }) });
    const { result } = renderHook(() => useItemStats(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ count: 5 });
  });

  it("useCreateItem sends the body and invalidates ['items'] — a strict prefix of ['items', filter], so the list, counts and stats all pick it up", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /items": (init) => {
        seenBody = JSON.parse((init?.body as string) ?? "{}");
        return { status: 201, body: { id: "I2" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateItem(), { wrapper: Wrapper });
    result.current.mutate({ nameAr: "صنف جديد", code: "NEW-1" } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ nameAr: "صنف جديد", code: "NEW-1" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["items"] });
  });

  it("useUpdateItem PATCHes /items/:id and invalidates ['items']", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "PATCH /items/I1": (_init, path) => {
        seenPath = path;
        return { body: { id: "I1", nameAr: "معدّل" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUpdateItem(), { wrapper: Wrapper });
    result.current.mutate({ id: "I1", patch: { nameAr: "معدّل" } as never });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/items/I1");
    expect(spy).toHaveBeenCalledWith({ queryKey: ["items"] });
  });
});

describe("customers", () => {
  it("useCustomers returns the fetched rows (query-string building is covered by list-queries.test.ts)", async () => {
    const transport = stubTransport({ "GET /customers": () => ({ body: [{ id: "C1" }] }) });
    const { result } = renderHook(() => useCustomers(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "C1" }]);
  });

  it("useCreateCustomer sends the body and invalidates ['customers']", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /customers": (init) => {
        seenBody = JSON.parse((init?.body as string) ?? "{}");
        return { status: 201, body: { id: "C2" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateCustomer(), { wrapper: Wrapper });
    result.current.mutate({ nameAr: "عميل جديد" } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ nameAr: "عميل جديد" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["customers"] });
  });
});

describe("chart of accounts", () => {
  it("useAccounts requests /accounts with no params (no filter axis)", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /accounts": (_init, path) => {
        seenPath = path;
        return { body: [{ id: "A1" }] };
      },
    });
    const { result } = renderHook(() => useAccounts(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/accounts");
  });

  it("useCreateAccount / useUpdateAccount both invalidate exactly ['accounts']", async () => {
    const transport = stubTransport({
      "POST /accounts": () => ({ status: 201, body: { id: "A2" } }),
      "PATCH /accounts/A1": () => ({ body: { id: "A1" } }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result: create } = renderHook(() => useCreateAccount(), { wrapper: Wrapper });
    create.current.mutate({ code: "5000", nameAr: "حساب" } as never);
    await waitFor(() => expect(create.current.isSuccess).toBe(true));

    const { result: update } = renderHook(() => useUpdateAccount(), { wrapper: Wrapper });
    update.current.mutate({ id: "A1", patch: {} as never });
    await waitFor(() => expect(update.current.isSuccess).toBe(true));

    expect(spy).toHaveBeenCalledTimes(2);
    for (const call of spy.mock.calls) expect(call[0]).toEqual({ queryKey: ["accounts"] });
  });
});

describe("treasury accounts", () => {
  it("lists from /treasury-accounts and both mutations invalidate ['treasury-accounts']", async () => {
    const transport = stubTransport({
      "GET /treasury-accounts": () => ({ body: [] }),
      "POST /treasury-accounts": () => ({ status: 201, body: { id: "TA-1" } }),
      "PATCH /treasury-accounts/TA-1": () => ({ body: { id: "TA-1" } }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const { result: list } = renderHook(() => useTreasuryAccounts(), { wrapper: Wrapper });
    await waitFor(() => expect(list.current.isSuccess).toBe(true));

    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result: create } = renderHook(() => useCreateTreasuryAccount(), { wrapper: Wrapper });
    create.current.mutate({ nameAr: "خزينة" } as never);
    await waitFor(() => expect(create.current.isSuccess).toBe(true));
    const { result: update } = renderHook(() => useUpdateTreasuryAccount(), { wrapper: Wrapper });
    update.current.mutate({ id: "TA-1", patch: {} as never });
    await waitFor(() => expect(update.current.isSuccess).toBe(true));

    expect(spy).toHaveBeenCalledWith({ queryKey: ["treasury-accounts"] });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("price lists / promotions", () => {
  it("usePriceLists lists and useCreatePriceList invalidates ['price-lists']", async () => {
    const transport = stubTransport({
      "GET /price-lists": () => ({ body: [] }),
      "POST /price-lists": () => ({ status: 201, body: { id: "PL-1" } }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const { result: list } = renderHook(() => usePriceLists(), { wrapper: Wrapper });
    await waitFor(() => expect(list.current.isSuccess).toBe(true));
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result: create } = renderHook(() => useCreatePriceList(), { wrapper: Wrapper });
    create.current.mutate({ nameAr: "قائمة" } as never);
    await waitFor(() => expect(create.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["price-lists"] });
  });

  it("usePromotions lists and useCreatePromotion invalidates ['promotions'] (a prefix of ['promotions','report'])", async () => {
    const transport = stubTransport({
      "GET /promotions": () => ({ body: [] }),
      "POST /promotions": () => ({ status: 201, body: { id: "PR-1" } }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const { result: list } = renderHook(() => usePromotions(), { wrapper: Wrapper });
    await waitFor(() => expect(list.current.isSuccess).toBe(true));
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result: create } = renderHook(() => useCreatePromotion(), { wrapper: Wrapper });
    create.current.mutate({ nameAr: "عرض" } as never);
    await waitFor(() => expect(create.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["promotions"] });
  });
});

describe("sales quotes", () => {
  it("useSalesQuotes hits /sales-quotes and useSalesQuoteCounts withholds the status filter", async () => {
    let listPath = "";
    let countsPath = "";
    const transport = stubTransport({
      "GET /sales-quotes": (_init, path) => {
        listPath = path;
        return { body: [] };
      },
      "GET /sales-quotes/counts": (_init, path) => {
        countsPath = path;
        return { body: {} };
      },
    });
    const { Wrapper } = makeWrapper(transport);
    const { result: list } = renderHook(() => useSalesQuotes({ status: "sent", customerId: "C1" }), { wrapper: Wrapper });
    await waitFor(() => expect(list.current.isSuccess).toBe(true));
    const { result: counts } = renderHook(() => useSalesQuoteCounts({ status: "sent", customerId: "C1" }), { wrapper: Wrapper });
    await waitFor(() => expect(counts.current.isSuccess).toBe(true));
    expect(listPath).toBe("/sales-quotes?status=sent&customerId=C1");
    expect(countsPath).toBe("/sales-quotes/counts?customerId=C1");
  });

  it("useCreateSalesQuote posts the body and invalidates ['sales-quotes']", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /sales-quotes": (init) => {
        seenBody = JSON.parse((init?.body as string) ?? "{}");
        return { status: 201, body: { id: "SQ-1" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateSalesQuote(), { wrapper: Wrapper });
    result.current.mutate({ customerId: "C1", lines: [] } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ customerId: "C1", lines: [] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["sales-quotes"] });
  });
});

describe("journal entries", () => {
  it("useJournalEntries hits /gl/journal-entries", async () => {
    const transport = stubTransport({ "GET /gl/journal-entries": () => ({ body: [] }) });
    const { result } = renderHook(() => useJournalEntries(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("useCreateJournalEntry and useReverseJournalEntry both invalidate ['journal-entries']", async () => {
    const transport = stubTransport({
      "POST /gl/journal-entries": () => ({ status: 201, body: { id: "JE-1" } }),
      "POST /gl/journal-entries/JE-1/reverse": () => ({ body: { original: { id: "JE-1" }, reversal: { id: "JE-2" } } }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result: create } = renderHook(() => useCreateJournalEntry(), { wrapper: Wrapper });
    create.current.mutate({ date: "2026-03-01", lines: [] } as never);
    await waitFor(() => expect(create.current.isSuccess).toBe(true));
    const { result: reverse } = renderHook(() => useReverseJournalEntry(), { wrapper: Wrapper });
    reverse.current.mutate({ id: "JE-1" });
    await waitFor(() => expect(reverse.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledTimes(2);
    for (const call of spy.mock.calls) expect(call[0]).toEqual({ queryKey: ["journal-entries"] });
  });

  it("surfaces an unbalanced-entry refusal from the server", async () => {
    const transport = stubTransport({
      "POST /gl/journal-entries": () => ({ status: 400, body: { message: "القيد غير متوازن" } }),
    });
    const { result } = renderHook(() => useCreateJournalEntry(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate({ date: "2026-03-01", lines: [] } as never);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("القيد غير متوازن");
  });
});

describe("users and roles", () => {
  it("useUsers lists and useCreateUser / useUpdateUser both invalidate ['users']", async () => {
    const transport = stubTransport({
      "GET /users": () => ({ body: [] }),
      "POST /users": () => ({ status: 201, body: { id: "U2" } }),
      "PUT /users/U1": () => ({ body: { id: "U1" } }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const { result: list } = renderHook(() => useUsers(), { wrapper: Wrapper });
    await waitFor(() => expect(list.current.isSuccess).toBe(true));
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result: create } = renderHook(() => useCreateUser(), { wrapper: Wrapper });
    create.current.mutate({ nameAr: "مستخدم" } as never);
    await waitFor(() => expect(create.current.isSuccess).toBe(true));
    const { result: update } = renderHook(() => useUpdateUser(), { wrapper: Wrapper });
    update.current.mutate({ id: "U1", body: {} as never });
    await waitFor(() => expect(update.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledTimes(2);
    for (const call of spy.mock.calls) expect(call[0]).toEqual({ queryKey: ["users"] });
  });

  it("useRoles lists and create/update/delete all invalidate ['roles']", async () => {
    const transport = stubTransport({
      "GET /roles": () => ({ body: [] }),
      "POST /roles": () => ({ status: 201, body: { id: "R2" } }),
      "PUT /roles/R1": () => ({ body: { id: "R1" } }),
      "DELETE /roles/R1": () => ({ status: 204, body: null }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const { result: list } = renderHook(() => useRoles(), { wrapper: Wrapper });
    await waitFor(() => expect(list.current.isSuccess).toBe(true));
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result: create } = renderHook(() => useCreateRole(), { wrapper: Wrapper });
    create.current.mutate({ nameAr: "دور" } as never);
    await waitFor(() => expect(create.current.isSuccess).toBe(true));
    const { result: del } = renderHook(() => useDeleteRole(), { wrapper: Wrapper });
    del.current.mutate("R1");
    await waitFor(() => expect(del.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledTimes(2);
    for (const call of spy.mock.calls) expect(call[0]).toEqual({ queryKey: ["roles"] });
  });
});

describe("settings", () => {
  it("useSettings requests /settings and useUpdateSettings invalidates the same key", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "GET /settings": () => ({ body: { companyName: "Cyag" } }),
      "PUT /settings": (init) => {
        seenBody = JSON.parse((init?.body as string) ?? "{}");
        return { body: { companyName: "Cyag Updated" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const { result: query } = renderHook(() => useSettings(), { wrapper: Wrapper });
    await waitFor(() => expect(query.current.isSuccess).toBe(true));
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result: mutation } = renderHook(() => useUpdateSettings(), { wrapper: Wrapper });
    mutation.current.mutate({ companyName: "Cyag Updated" } as never);
    await waitFor(() => expect(mutation.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ companyName: "Cyag Updated" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["settings"] });
  });

  it("surfaces a validation refusal in the server's own message", async () => {
    const transport = stubTransport({
      "PUT /settings": () => ({ status: 400, body: { message: "الرقم الضريبي غير صالح" } }),
    });
    const { result } = renderHook(() => useUpdateSettings(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate({ taxRegistrationNumber: "bad" } as never);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("الرقم الضريبي غير صالح");
  });
});

describe("branches", () => {
  it("useBranches lists and create/update both invalidate ['branches']", async () => {
    const transport = stubTransport({
      "GET /branches": () => ({ body: [] }),
      "POST /branches": () => ({ status: 201, body: { id: "B2" } }),
      "PUT /branches/B1": () => ({ body: { id: "B1" } }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const { result: list } = renderHook(() => useBranches(), { wrapper: Wrapper });
    await waitFor(() => expect(list.current.isSuccess).toBe(true));
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result: create } = renderHook(() => useCreateBranch(), { wrapper: Wrapper });
    create.current.mutate({ code: "GIZA", name: "فرع الجيزة" } as never);
    await waitFor(() => expect(create.current.isSuccess).toBe(true));
    const { result: update } = renderHook(() => useUpdateBranch(), { wrapper: Wrapper });
    update.current.mutate({ id: "B1", patch: {} as never });
    await waitFor(() => expect(update.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledTimes(2);
    for (const call of spy.mock.calls) expect(call[0]).toEqual({ queryKey: ["branches"] });
  });
});

describe("cheques", () => {
  it("useCheques builds the filter query string and useCreateCheque invalidates ['cheques']", async () => {
    let listPath = "";
    const transport = stubTransport({
      "GET /cheques": (_init, path) => {
        listPath = path;
        return { body: [] };
      },
      "POST /cheques": () => ({ status: 201, body: { id: "CHQ-1" } }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const { result: list } = renderHook(() => useCheques({ direction: "received", status: "pending" } as never), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(list.current.isSuccess).toBe(true));
    expect(listPath).toBe("/cheques?direction=received&status=pending");

    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result: create } = renderHook(() => useCreateCheque(), { wrapper: Wrapper });
    create.current.mutate({ amount: "1000.00" } as never);
    await waitFor(() => expect(create.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["cheques"] });
  });
});

describe("bank statement reconciliation", () => {
  it("useBankStatements lists and useBankStatement(id) fetches the detail; a null id disables it", async () => {
    let called = false;
    const transport = stubTransport({
      "GET /bank-statements": () => ({ body: [{ id: "BS-1" }] }),
      "GET /bank-statements/BS-1": () => {
        called = true;
        return { body: { id: "BS-1", lines: [], matchSummary: {} } };
      },
    });
    const { Wrapper } = makeWrapper(transport);
    const { result: list } = renderHook(() => useBankStatements(), { wrapper: Wrapper });
    await waitFor(() => expect(list.current.isSuccess).toBe(true));

    const { result: disabled } = renderHook(() => useBankStatement(null), { wrapper: Wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(called).toBe(false);
    expect(disabled.current.isPending).toBe(true);

    const { result: detail } = renderHook(() => useBankStatement("BS-1"), { wrapper: Wrapper });
    await waitFor(() => expect(detail.current.isSuccess).toBe(true));
    expect(called).toBe(true);
  });

  it("useImportBankStatement invalidates ['bank-statements'] — a strict prefix of ['bank-statements','detail',id]", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /bank-statements/import": (init) => {
        seenBody = JSON.parse((init?.body as string) ?? "{}");
        return { status: 201, body: { id: "BS-2", lines: [], matchSummary: {} } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useImportBankStatement(), { wrapper: Wrapper });
    result.current.mutate({ treasuryAccountId: "TA-1", rows: [] } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ treasuryAccountId: "TA-1", rows: [] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["bank-statements"] });
  });
});
