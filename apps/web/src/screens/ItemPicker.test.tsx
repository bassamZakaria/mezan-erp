// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppProviders } from "../data/AppProviders";
import { stubTransport, testAdminSession } from "../data/test-support";
import { useItemsByIds } from "../data/hooks";
import { ItemPicker } from "./ItemPicker";

afterEach(cleanup);

const tea = { id: "itm-tea", code: "TEA-1", nameAr: "شاي أسود", type: "stock", status: "active" };
const svc = { id: "itm-svc", code: "SVC-1", nameAr: "خدمة توصيل", type: "service", status: "active" };

describe("ItemPicker", () => {
  it("asks the server for the typed text, one small page, and hands back the real item", async () => {
    const searches: string[] = [];
    const transport = stubTransport({
      "GET /items": (_init, path) => {
        searches.push(path);
        return { body: [tea, svc] };
      },
    });
    const onChange = vi.fn();
    render(
      <AppProviders transport={transport} initialSession={testAdminSession}>
        <ItemPicker value={null} onChange={onChange} label="الصنف" filter={{ types: ["stock", "service"] }} accept={(i) => i.type === "stock"} />
      </AppProviders>,
    );
    const input = screen.getByRole("combobox", { name: "الصنف" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "شاي" } });

    await waitFor(() => expect(searches.some((p) => p.includes(`search=${encodeURIComponent("شاي")}`))).toBe(true));
    const last = new URLSearchParams(searches.at(-1)!.split("?")[1]);
    expect(last.get("page")).toBe("1");
    expect(last.get("pageSize")).toBe("20");
    expect(last.get("types")).toBe("stock,service");

    fireEvent.mouseDown(await screen.findByText("شاي أسود"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "itm-tea", code: "TEA-1" }));
    expect(screen.queryByText("خدمة توصيل")).toBeNull();
  });
});

function Names({ ids }: { ids: string[] }) {
  const { byId } = useItemsByIds(ids);
  return <div data-testid="names">{ids.map((id) => byId.get(id)?.nameAr ?? "?").join("|")}</div>;
}

describe("useItemsByIds", () => {
  it("fetches only the ids on screen, once each, and never walks the catalogue", async () => {
    const paths: string[] = [];
    const transport = stubTransport({
      "GET /items": (_init, path) => {
        paths.push(path);
        const ids = new URLSearchParams(path.split("?")[1]).get("ids")?.split(",") ?? [];
        return { body: [tea, svc].filter((i) => ids.includes(i.id)) };
      },
    });
    render(
      <AppProviders transport={transport} initialSession={testAdminSession}>
        <Names ids={["itm-tea", "itm-svc", "itm-tea"]} />
      </AppProviders>,
    );
    await waitFor(() => expect(screen.getByTestId("names")).toHaveTextContent("شاي أسود|خدمة توصيل|شاي أسود"));
    expect(paths).toHaveLength(1);
    expect(new URLSearchParams(paths[0]!.split("?")[1]).get("ids")).toBe("itm-svc,itm-tea");
  });
});
