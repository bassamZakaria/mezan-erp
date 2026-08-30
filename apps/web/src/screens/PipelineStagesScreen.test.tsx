// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { PipelineStageDTO } from "@mezan/contracts";
import { PipelineStagesScreen } from "./PipelineStagesScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

/**
 * `Field` renders its `<label>` as a sibling of the control, not wrapping it,
 * and never wires `htmlFor`/`id` — so `getByLabelText` cannot resolve a
 * `TextField`. Locate the control by walking from the visible label text.
 */
function fieldInput(container: HTMLElement, label: string): HTMLElement {
  const labelEl = within(container).getByText(label);
  const control = labelEl.parentElement?.querySelector("input, textarea, select");
  if (!control) throw new Error(`no control found for label "${label}"`);
  return control as HTMLElement;
}

const sampleStages: PipelineStageDTO[] = [
  { id: "stage-1", name: "عميل محتمل", order: 1, defaultProbability: 10, color: "#3b82f6", isWinStage: false, isLossStage: false, active: true },
  { id: "stage-2", name: "تواصل أولي", order: 2, defaultProbability: 20, color: "#3b82f6", isWinStage: false, isLossStage: false, active: true },
  { id: "stage-3", name: "تم الإغلاق", order: 3, defaultProbability: 100, color: "#22c55e", isWinStage: true, isLossStage: false, active: true },
  { id: "stage-4", name: "خسارة", order: 4, defaultProbability: 0, color: "#ef4444", isWinStage: false, isLossStage: true, active: true },
];

function renderScreen(stages: PipelineStageDTO[] = sampleStages) {
  let current = [...stages];
  const transport = stubTransport({
    "GET /crm/pipeline-stages": () => ({ body: current }),
    "POST /crm/pipeline-stages": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      if (body.isWinStage && current.some((s) => s.isWinStage)) {
        return { status: 409, body: { error: "DUPLICATE_PIPELINE_STAGE_WIN", message: "توجد بالفعل مرحلة فوز واحدة." } };
      }
      const created: PipelineStageDTO = {
        id: body.id,
        name: body.name,
        order: current.length + 1,
        defaultProbability: body.defaultProbability ?? 50,
        color: body.color ?? "#3b82f6",
        isWinStage: body.isWinStage ?? false,
        isLossStage: body.isLossStage ?? false,
        active: true,
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "POST /crm/pipeline-stages/stage-2/move": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const idx = current.findIndex((s) => s.id === "stage-2");
      const targetIdx = body.direction === "up" ? idx - 1 : idx + 1;
      const reordered = [...current];
      const tmpOrder = reordered[idx]!.order;
      reordered[idx] = { ...reordered[idx]!, order: reordered[targetIdx]!.order };
      reordered[targetIdx] = { ...reordered[targetIdx]!, order: tmpOrder };
      current = reordered;
      return { body: reordered[idx] };
    },
  });
  return renderWithProviders(<PipelineStagesScreen />, { transport, initialSession: testAdminSession });
}

describe("PipelineStagesScreen", () => {
  it("lists pipeline stages ordered with their type derived from win/loss flags", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "مراحل خط المبيعات" })).toBeInTheDocument();
    expect(await screen.findByText("عميل محتمل")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("مرحلة فوز")).toBeInTheDocument();
    expect(within(table).getByText("مرحلة خسارة")).toBeInTheDocument();
  });

  it("adds a new stage through the side panel", async () => {
    renderScreen();
    await screen.findByText("عميل محتمل");
    fireEvent.click(screen.getByRole("button", { name: "إضافة مرحلة" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة مرحلة" });
    fireEvent.change(fieldInput(dialog, "الاسم *"), { target: { value: "مرحلة تجريبية" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await screen.findByText("مرحلة تجريبية")).toBeInTheDocument();
  });

  it("rejects a second win stage with an inline error", async () => {
    renderScreen();
    await screen.findByText("عميل محتمل");
    fireEvent.click(screen.getByRole("button", { name: "إضافة مرحلة" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة مرحلة" });
    fireEvent.change(fieldInput(dialog, "الاسم *"), { target: { value: "فوز آخر" } });
    fireEvent.click(within(dialog).getByRole("switch", { name: "مرحلة فوز" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("مرحلة فوز واحدة");
  });

  it("moves a stage up via the reorder action", async () => {
    renderScreen();
    await screen.findByText("تواصل أولي");
    fireEvent.click(screen.getByRole("button", { name: "نقل تواصل أولي للأعلى" }));

    await screen.findByText("تواصل أولي");
    const rows = screen.getAllByRole("row");
    // rows[0] is the header row; rows[1] should now be "تواصل أولي" after moving it above "عميل محتمل".
    expect(rows[1]).toHaveTextContent("تواصل أولي");
  });
});
