import { describe, expect, it } from "vitest";
import { ApiError } from "./hooks";
import { customerFilterFromUrl, customersQuery } from "./list-queries";
import { stubTransport } from "./test-support";

describe("customerFilterFromUrl", () => {
  it("defaults status to 'all' and leaves the rest undefined when the URL carries no filter", () => {
    const filter = customerFilterFromUrl(new URL("http://x/customers"));
    expect(filter).toEqual({ status: "all", q: undefined, priceListId: undefined, overLimit: undefined });
  });

  it("reads every recognised query param", () => {
    const filter = customerFilterFromUrl(
      new URL("http://x/customers?status=active&q=%20sara%20&priceList=PL-1&overLimit=1"),
    );
    expect(filter).toEqual({ status: "active", q: "sara", priceListId: "PL-1", overLimit: true });
  });

  it("trims a whitespace-only q to undefined", () => {
    const filter = customerFilterFromUrl(new URL("http://x/customers?q=%20%20"));
    expect(filter.q).toBeUndefined();
  });

  it("only treats overLimit=1 as true; any other value is dropped", () => {
    const filter = customerFilterFromUrl(new URL("http://x/customers?overLimit=true"));
    expect(filter.overLimit).toBeUndefined();
  });
});

describe("customersQuery", () => {
  it("builds the same query key useCustomers builds for the same filter, so the loader and the screen share one cache entry", () => {
    const filter = { status: "active" as const, q: "sara" };
    const query = customersQuery(filter);
    expect(query.queryKey).toEqual(["customers", filter]);
  });

  it("requests the customers list with the filter turned into a query string", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /customers": (_init, path) => {
        seenPath = path;
        return { body: [{ id: "CUST-1" }] };
      },
    });
    const request = (path: string, init?: RequestInit) => transport(path, init);
    const rows = await customersQuery({ status: "active", q: "sara" }).queryFn(request);

    expect(seenPath).toBe("/customers?status=active&q=sara");
    expect(rows).toEqual([{ id: "CUST-1" }]);
  });

  it("omits the query string entirely for an empty filter", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /customers": (_init, path) => {
        seenPath = path;
        return { body: [] };
      },
    });
    await customersQuery({}).queryFn((path, init) => transport(path, init));
    expect(seenPath).toBe("/customers");
  });

  it("throws an ApiError carrying the response status on failure", async () => {
    const transport = stubTransport({ "GET /customers": () => ({ status: 500, body: { error: "SERVER_ERROR" } }) });
    await expect(customersQuery({}).queryFn((path, init) => transport(path, init))).rejects.toMatchObject(
      new ApiError(500, "customers"),
    );
  });
});
