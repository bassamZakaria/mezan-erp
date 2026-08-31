// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NumeralsProvider } from "../hooks/useFormat";
import { Balance } from "./Balance";

function beamPercent(container: HTMLElement): string {
  const track = container.querySelector('[aria-hidden] > div[style*="inline-size"]') as HTMLElement | null;
  return track?.style.getPropertyValue("inline-size") ?? "";
}

describe("Balance — reading a figure the API sent as an exact decimal string", () => {
  it("reads a value with no whole part, and one with no fraction at all", () => {
    render(
      <Balance
        label="مطابقة"
        a={{ label: "الدفاتر", value: ".5" }}
        b={{ label: "الفعلي", value: "0" }}
        tolerance="0.0001"
      />,
    );
    expect(screen.getAllByText("0.50")).toHaveLength(2);
    expect(screen.getByText("0.00")).toBeInTheDocument();
  });

  it("reads a negative figure, and the thousands separators the API never sends", () => {
    render(
      <Balance
        label="مطابقة"
        a={{ label: "الدفاتر", value: "-1,250.75" }}
        b={{ label: "الفعلي", value: "0" }}
      />,
    );
    expect(screen.getByText("-1,250.75")).toBeInTheDocument();
  });

  it("treats a figure it cannot parse as zero rather than rendering NaN", () => {
    render(
      <Balance
        label="مطابقة"
        a={{ label: "الدفاتر", value: "غير معروف" }}
        b={{ label: "الفعلي", value: "0" }}
      />,
    );
    expect(screen.getAllByText("0.00")).toHaveLength(2);
    expect(screen.getByText("متزن")).toBeInTheDocument();
  });

  it("keeps only six decimals, the scale money is carried at", () => {
    render(
      <Balance
        label="مطابقة"
        a={{ label: "الدفاتر", value: "1.0000009" }}
        b={{ label: "الفعلي", value: "1.000000" }}
        tolerance="0.0000001"
      />,
    );
    expect(screen.getAllByText("1.00")).toHaveLength(2);
    expect(screen.getByText("متزن")).toBeInTheDocument();
  });
});

describe("Balance — a difference too small to show still reads as zero, never as minus zero", () => {
  it("renders a sub-piastre shortfall as 0.00 with no minus sign", () => {
    render(
      <Balance
        label="تقفيل الخزينة"
        a={{ label: "الدفاتر", value: "100.00" }}
        b={{ label: "الفعلي", value: "100.001" }}
        tolerance="0.0001"
      />,
    );
    expect(screen.getByText("غير متزن")).toBeInTheDocument();
    expect(screen.getByText("0.00")).toBeInTheDocument();
    expect(screen.queryByText("-0.00")).not.toBeInTheDocument();
  });
});

describe("Balance — the reader's own numerals", () => {
  it("renders every figure in Arabic-Indic digits for a tenant set to them", () => {
    render(
      <NumeralsProvider numerals="arabic">
        <Balance
          label="تقفيل الخزينة"
          a={{ label: "الدفاتر", value: "1250.75" }}
          b={{ label: "الفعلي", value: "1250.75" }}
        />
      </NumeralsProvider>,
    );
    expect(screen.getAllByText("١,٢٥٠.٧٥")).toHaveLength(2);
  });
});

describe("Balance — the beam's fill", () => {
  it("fills to the share of the limit that has been used", () => {
    const { container } = render(
      <Balance
        mode="ceiling"
        label="حد الائتمان"
        limit={{ label: "الحد", value: "1000.00" }}
        used={{ label: "المستخدم", value: "333.00" }}
      />,
    );
    expect(beamPercent(container)).toBe("33.3%");
  });

  it("clamps the fill at full rather than overflowing when the limit is exceeded", () => {
    const { container } = render(
      <Balance
        mode="ceiling"
        label="حد الائتمان"
        limit={{ label: "الحد", value: "1000.00" }}
        used={{ label: "المستخدم", value: "4000.00" }}
      />,
    );
    expect(beamPercent(container)).toBe("100%");
    expect(screen.getByText("تجاوز الحد")).toBeInTheDocument();
  });

  it("fills completely against a zero limit — any usage at all has already passed it", () => {
    const { container } = render(
      <Balance
        mode="ceiling"
        label="حد الائتمان"
        limit={{ label: "الحد", value: "0" }}
        used={{ label: "المستخدم", value: "500.00" }}
      />,
    );
    expect(beamPercent(container)).toBe("100%");
  });

  it("fills completely against a zero limit that has not been touched either", () => {
    const { container } = render(
      <Balance
        mode="ceiling"
        label="حد الائتمان"
        limit={{ label: "الحد", value: "0" }}
        used={{ label: "المستخدم", value: "0" }}
      />,
    );
    expect(beamPercent(container)).toBe("100%");
    expect(screen.getByText("بلغ الحد تمامًا")).toBeInTheDocument();
  });
});
