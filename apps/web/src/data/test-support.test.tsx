// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { useLocation } from "react-router";
import { useApi } from "./ApiContext";
import { renderWithProviders, stubTransport, testAdminSession } from "./test-support";

describe("stubTransport", () => {
  it("matches an exact path/method and returns its body with a default 200 status", async () => {
    const transport = stubTransport({ "GET /customers": () => ({ body: [{ id: "C1" }] }) });
    const res = await transport("/customers");
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    await expect(res.json()).resolves.toEqual([{ id: "C1" }]);
  });

  it("404s an unmatched path with a NOT_FOUND error body", async () => {
    const transport = stubTransport({ "GET /customers": () => ({ body: [] }) });
    const res = await transport("/suppliers");
    expect(res.status).toBe(404);
    expect(res.ok).toBe(false);
    await expect(res.json()).resolves.toEqual({ error: "NOT_FOUND" });
  });

  it("treats the HTTP method as part of the match key", async () => {
    const transport = stubTransport({ "GET /customers": () => ({ body: [] }) });
    const res = await transport("/customers", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("strips the query string before matching but still hands the raw path (with query string) to the handler", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /customers": (_init, path) => {
        seenPath = path;
        return { body: [] };
      },
    });
    await transport("/customers?status=active&q=sara");
    expect(seenPath).toBe("/customers?status=active&q=sara");
  });

  it("a `*` segment matches any single path segment of the same length, for a generated id", async () => {
    const transport = stubTransport({ "GET /customers/*": () => ({ body: { id: "matched" } }) });
    const res = await transport("/customers/CUST-123");
    await expect(res.json()).resolves.toEqual({ id: "matched" });
  });

  it("a `*` segment does NOT match when the segment counts differ", async () => {
    const transport = stubTransport({ "GET /customers/*": () => ({ body: {} }) });
    const res = await transport("/customers/CUST-1/detail");
    expect(res.status).toBe(404);
  });

  it("an exact handler takes precedence over a wildcard handler for the same request", async () => {
    const transport = stubTransport({
      "GET /customers/*": () => ({ body: { via: "wildcard" } }),
      "GET /customers/special": () => ({ body: { via: "exact" } }),
    });
    const res = await transport("/customers/special");
    await expect(res.json()).resolves.toEqual({ via: "exact" });
  });

  it("honors an explicit non-2xx status and marks `ok` false", async () => {
    const transport = stubTransport({ "GET /customers": () => ({ status: 422, body: { error: "VALIDATION_ERROR" } }) });
    const res = await transport("/customers");
    expect(res.status).toBe(422);
    expect(res.ok).toBe(false);
  });

  it("400-599 are all non-ok, and 200-399 are all ok", async () => {
    const okTransport = stubTransport({ "GET /x": () => ({ status: 302, body: {} }) });
    expect((await okTransport("/x")).ok).toBe(true);
    const errTransport = stubTransport({ "GET /x": () => ({ status: 400, body: {} }) });
    expect((await errTransport("/x")).ok).toBe(false);
  });

  it("text() returns the JSON-stringified body", async () => {
    const transport = stubTransport({ "GET /x": () => ({ body: { a: 1 } }) });
    const res = await transport("/x");
    await expect(res.text()).resolves.toBe(JSON.stringify({ a: 1 }));
  });
});

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="path">{location.pathname}</span>;
}

function SessionProbe() {
  const { session } = useApi();
  return <span data-testid="session">{session ? session.nameAr : "no-session"}</span>;
}

describe("renderWithProviders", () => {
  it("defaults to the '/' route when none is given", () => {
    renderWithProviders(<LocationProbe />);
    expect(screen.getByTestId("path")).toHaveTextContent("/");
  });

  it("honors an explicit starting route", () => {
    renderWithProviders(<LocationProbe />, { route: "/customers/CUST-1" });
    expect(screen.getByTestId("path")).toHaveTextContent("/customers/CUST-1");
  });

  it("makes an initialSession visible to a consumer via useApi()", () => {
    renderWithProviders(<SessionProbe />, { initialSession: testAdminSession });
    expect(screen.getByTestId("session")).toHaveTextContent(testAdminSession.nameAr);
  });

  it("starts signed out by default when no initialSession is given", () => {
    renderWithProviders(<SessionProbe />);
    expect(screen.getByTestId("session")).toHaveTextContent("no-session");
  });
});
