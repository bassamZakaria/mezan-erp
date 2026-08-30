// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Balance } from "./Balance";

describe("Balance — equal mode", () => {
  it("reports متزن when the two sides agree exactly", () => {
    render(
      <Balance
        label="تقفيل الخزينة"
        a={{ label: "المتوقع", value: "1250.00" }}
        b={{ label: "الفعلي", value: "1250.00" }}
      />,
    );
    expect(screen.getByText("متزن")).toBeInTheDocument();
    expect(screen.getByText("الطرفان متطابقان")).toBeInTheDocument();
  });

  it("agrees within tolerance without reporting a difference", () => {
    render(
      <Balance
        label="تقفيل الخزينة"
        a={{ label: "المتوقع", value: "1250.000" }}
        b={{ label: "الفعلي", value: "1250.003" }}
        tolerance="0.005"
      />,
    );
    expect(screen.getByText("متزن")).toBeInTheDocument();
  });

  it("reports غير متزن and names the heavier side once the difference exceeds tolerance", () => {
    render(
      <Balance
        label="تقفيل الخزينة"
        a={{ label: "المتوقع بالدفاتر", value: "1300.00" }}
        b={{ label: "الفعلي بالعد", value: "1250.00" }}
      />,
    );
    expect(screen.getByText("غير متزن")).toBeInTheDocument();
    expect(screen.getByText("المتوقع بالدفاتر أكبر بمقدار")).toBeInTheDocument();
    expect(screen.getByText("50.00")).toBeInTheDocument();
  });

  it("names side b as heavier when it exceeds side a", () => {
    render(
      <Balance
        label="تقفيل الخزينة"
        a={{ label: "المتوقع", value: "100.00" }}
        b={{ label: "الفعلي", value: "150.00" }}
      />,
    );
    expect(screen.getByText("الفعلي أكبر بمقدار")).toBeInTheDocument();
  });

  it("does not render the 'أين الفرق؟' trace action when the sides agree", () => {
    render(
      <Balance
        label="تقفيل الخزينة"
        a={{ label: "المتوقع", value: "10.00" }}
        b={{ label: "الفعلي", value: "10.00" }}
        onTrace={() => {}}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders and fires the trace action when the sides disagree and onTrace is given", () => {
    const onTrace = vi.fn();
    render(
      <Balance
        label="تقفيل الخزينة"
        a={{ label: "المتوقع", value: "10.00" }}
        b={{ label: "الفعلي", value: "5.00" }}
        onTrace={onTrace}
      />,
    );
    const button = screen.getByRole("button", { name: "أين الفرق؟ — تقفيل الخزينة" });
    fireEvent.click(button);
    expect(onTrace).toHaveBeenCalledOnce();
  });

  it("does not render the trace action when disagreeing but onTrace is not given", () => {
    render(
      <Balance
        label="تقفيل الخزينة"
        a={{ label: "المتوقع", value: "10.00" }}
        b={{ label: "الفعلي", value: "5.00" }}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("treats zero on both sides as agreement", () => {
    render(
      <Balance
        label="تقفيل الخزينة"
        a={{ label: "المتوقع", value: "0" }}
        b={{ label: "الفعلي", value: "0" }}
      />,
    );
    expect(screen.getByText("متزن")).toBeInTheDocument();
  });
});

describe("Balance — ceiling mode", () => {
  it("reports ضمن الحد with the remaining headroom when usage is below the limit", () => {
    render(
      <Balance
        mode="ceiling"
        label="حد الائتمان"
        limit={{ label: "الحد", value: "5000.00" }}
        used={{ label: "المستخدم", value: "3000.00" }}
      />,
    );
    expect(screen.getByText("ضمن الحد")).toBeInTheDocument();
    expect(screen.getByText("متبقٍ")).toBeInTheDocument();
    expect(screen.getByText("2,000.00")).toBeInTheDocument();
  });

  it("never renders ناقص for an unreached ceiling — headroom is good news, not a shortfall", () => {
    render(
      <Balance
        mode="ceiling"
        label="حد الائتمان"
        limit={{ label: "الحد", value: "5000.00" }}
        used={{ label: "المستخدم", value: "1.00" }}
      />,
    );
    expect(screen.queryByText(/ناقص/)).not.toBeInTheDocument();
  });

  it("reports بلغ الحد تمامًا when usage exactly equals the limit", () => {
    render(
      <Balance
        mode="ceiling"
        label="حد الائتمان"
        limit={{ label: "الحد", value: "5000.00" }}
        used={{ label: "المستخدم", value: "5000.00" }}
      />,
    );
    expect(screen.getByText("بلغ الحد تمامًا")).toBeInTheDocument();
    expect(screen.getByText("لم يتبقَّ شيء من الحد المسموح")).toBeInTheDocument();
  });

  it("reports تجاوز الحد with the overage and offers the trace action when the limit is exceeded", () => {
    const onTrace = vi.fn();
    render(
      <Balance
        mode="ceiling"
        label="حد الائتمان"
        limit={{ label: "الحد", value: "5000.00" }}
        used={{ label: "المستخدم", value: "5200.00" }}
        onTrace={onTrace}
      />,
    );
    expect(screen.getByText("تجاوز الحد")).toBeInTheDocument();
    expect(screen.getByText("بمقدار")).toBeInTheDocument();
    expect(screen.getByText("200.00")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "أين الفرق؟ — حد الائتمان" });
    fireEvent.click(button);
    expect(onTrace).toHaveBeenCalledOnce();
  });

  it("does not offer the trace action while within the limit even with onTrace given", () => {
    render(
      <Balance
        mode="ceiling"
        label="حد الائتمان"
        limit={{ label: "الحد", value: "5000.00" }}
        used={{ label: "المستخدم", value: "100.00" }}
        onTrace={() => {}}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("Balance — rendering", () => {
  it("groups thousands and renders the default currency label", () => {
    render(
      <Balance
        label="تقفيل الخزينة"
        a={{ label: "المتوقع", value: "1250480.50" }}
        b={{ label: "الفعلي", value: "1250480.50" }}
      />,
    );
    expect(screen.getAllByText("1,250,480.50").length).toBe(2);
    expect(screen.getAllByText("ج.م").length).toBeGreaterThan(0);
  });

  it("never renders a raw scaled figure like 0.000000", () => {
    render(
      <Balance
        label="تقفيل الخزينة"
        a={{ label: "المتوقع", value: "0" }}
        b={{ label: "الفعلي", value: "0" }}
      />,
    );
    expect(screen.queryByText("0.000000")).not.toBeInTheDocument();
    expect(screen.getAllByText("0.00").length).toBeGreaterThan(0);
  });

  it("labels the whole instrument via the group role for assistive tech", () => {
    render(
      <Balance
        label="تقفيل الخزينة — اليوم"
        a={{ label: "المتوقع", value: "10.00" }}
        b={{ label: "الفعلي", value: "10.00" }}
      />,
    );
    expect(screen.getByRole("group", { name: "تقفيل الخزينة — اليوم" })).toBeInTheDocument();
  });

  it("renders against a dark theme root without crashing", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(
      <Balance
        label="تقفيل الخزينة"
        a={{ label: "المتوقع", value: "10.00" }}
        b={{ label: "الفعلي", value: "10.00" }}
      />,
    );
    expect(screen.getByText("متزن")).toBeInTheDocument();
    document.documentElement.removeAttribute("data-theme");
  });
});
