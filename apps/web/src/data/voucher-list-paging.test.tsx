// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { AppProviders } from "./AppProviders";
import { stubTransport, testAdminSession } from "./test-support";
import { useVouchers } from "./hooks";

function Page() {
  useVouchers({ supplierId: "sup-1", page: 3, pageSize: 25 });
  return null;
}

describe("useVouchers", () => {
  it("asks the server for the page the screen is on, not always the first", async () => {
    const paths: string[] = [];
    const transport = stubTransport({ "GET /vouchers": (_init, path) => (paths.push(path), { body: [] }) });
    render(
      <AppProviders transport={transport} initialSession={testAdminSession}>
        <Page />
      </AppProviders>,
    );
    await waitFor(() => expect(paths).toHaveLength(1));
    const qs = new URLSearchParams(paths[0]!.split("?")[1]);
    expect([qs.get("page"), qs.get("pageSize"), qs.get("supplierId")]).toEqual(["3", "25", "sup-1"]);
  });
});
