import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { FxItemEventKind, fxItemOpenOn, fxItemTimeline, walkRunShare, type FxItemEvent } from "./revaluation-share-timeline.js";

const m = (major: string) => Money.fromMajor(major);
const relief = (ref: string, day: string, amount: string, at = `${day}T10:00:00.000Z`): FxItemEvent => ({ kind: FxItemEventKind.Relief, ref, day, at, amount: m(amount) });
const reopening = (ref: string, day: string, amount: string, at = `${day}T11:00:00.000Z`): FxItemEvent => ({ kind: FxItemEventKind.Reopening, ref, day, at, amount: m(amount) });
const close = (day: string): FxItemEvent => ({ kind: FxItemEventKind.Close, ref: "close", day, at: `${day}T12:00:00.000Z`, amount: Money.zero() });
const steps = (walk: ReturnType<typeof walkRunShare>) => walk.steps.map((step) => `${step.kind} ${step.ref} ${step.day} ${step.amount.toString()}`);

describe("what one run's share of one item gives up, and gets back, after the run's day", () => {
  it("a relief after the run releases the share pro rata to the balance then open", () => {
    const walk = walkRunShare(fxItemTimeline(m("48000"), [relief("a1", "2026-09-10", "19200")]), { day: "2026-08-31", share: m("450") });

    expect(steps(walk)).toEqual(["relief a1 2026-09-10 180.000000"]);
    expect(walk.remaining.toString()).toBe("270.000000");
    expect(walk.takenBy("a1").toString()).toBe("180.000000");
  });

  it("a relief dated on or before the run's day is part of what the run restated: it releases nothing and the balance open after it is smaller", () => {
    const timeline = fxItemTimeline(m("48000"), [relief("a1", "2026-09-10", "19200"), relief("a2", "2026-09-30", "4800"), relief("a3", "2026-10-02", "12000")]);

    const walk = walkRunShare(timeline, { day: "2026-09-30", share: m("480") });

    expect(fxItemOpenOn(timeline, "2026-09-30").toString()).toBe("24000.000000");
    expect(steps(walk)).toEqual(["relief a3 2026-10-02 240.000000"]);
    expect(walk.remaining.toString()).toBe("240.000000");
  });

  it("R1 — a relief after the run that is later undone gives back exactly what it released, on the day of the undo", () => {
    const timeline = fxItemTimeline(m("48000"), [relief("a1", "2026-09-10", "19200"), reopening("a1", "2026-10-13", "19200")]);

    const august = walkRunShare(timeline, { day: "2026-08-31", share: m("450") });
    expect(steps(august)).toEqual(["relief a1 2026-09-10 180.000000", "reopening a1 2026-10-13 180.000000"]);
    expect(august.remaining.toString()).toBe("450.000000");
    expect(august.takenBy("a1").toString()).toBe("0.000000");
    expect(walkRunShare(timeline, { day: "2026-08-31", share: m("450") }, "2026-09-30").remaining.toString()).toBe("270.000000");

    const september = walkRunShare(timeline, { day: "2026-09-30", share: m("300") });
    expect(steps(september)).toEqual([]);
    expect(september.remaining.toString()).toBe("300.000000");
  });

  it("R2 — the undo of a relief the run already saw re-opens the balance and gives nothing back; a relief made again is measured against the re-opened balance", () => {
    const timeline = fxItemTimeline(m("48000"), [relief("a1", "2026-09-10", "19200"), reopening("a1", "2026-10-13", "19200"), relief("a2", "2026-10-13", "19200", "2026-10-13T11:00:01.000Z")]);

    const walk = walkRunShare(timeline, { day: "2026-09-30", share: m("570") });

    expect(steps(walk)).toEqual(["relief a2 2026-10-13 228.000000"]);
    expect(walk.remaining.toString()).toBe("342.000000");
  });

  it("R3 — a bounce after a run dated between the cheque's allocation and the bounce re-opens the balance for that run and returns the earlier run's share", () => {
    const timeline = fxItemTimeline(m("48000"), [relief("chq", "2026-09-10", "19200"), reopening("chq", "2026-09-20", "19200")]);

    const august = walkRunShare(timeline, { day: "2026-08-31", share: m("450") });
    const mid = walkRunShare(timeline, { day: "2026-09-15", share: m("150") });

    expect(walkRunShare(timeline, { day: "2026-08-31", share: m("450") }, "2026-09-15").remaining.toString()).toBe("270.000000");
    expect(august.remaining.toString()).toBe("450.000000");
    expect(steps(mid)).toEqual([]);
    expect(mid.remaining.toString()).toBe("150.000000");
  });

  it("a relief undone and made again after the run releases, returns and releases again against the balance open each time", () => {
    const timeline = fxItemTimeline(m("48000"), [
      relief("a1", "2026-09-10", "19200"),
      reopening("a1", "2026-09-20", "19200"),
      relief("a2", "2026-09-20", "24000", "2026-09-20T11:00:01.000Z"),
    ]);

    const walk = walkRunShare(timeline, { day: "2026-08-31", share: m("450") });

    expect(steps(walk)).toEqual(["relief a1 2026-09-10 180.000000", "reopening a1 2026-09-20 180.000000", "relief a2 2026-09-20 225.000000"]);
    expect(walk.remaining.toString()).toBe("225.000000");
  });

  it("the document closing — a void, a reversal — releases everything the run still has on it", () => {
    const walk = walkRunShare(fxItemTimeline(m("48000"), [relief("a1", "2026-09-10", "19200"), close("2026-09-20")]), { day: "2026-08-31", share: m("450") });

    expect(steps(walk)).toEqual(["relief a1 2026-09-10 180.000000", "close close 2026-09-20 270.000000"]);
    expect(walk.remaining.toString()).toBe("0.000000");
  });

  it("a relief of everything still open, or of more than is open, takes all that is left", () => {
    const walk = walkRunShare(fxItemTimeline(m("48000"), [relief("pay", "2026-09-10", "24000"), relief("ret", "2026-09-10", "28800", "2026-09-10T10:00:01.000Z")]), { day: "2026-08-31", share: m("450") });

    expect(steps(walk)).toEqual(["relief pay 2026-09-10 225.000000", "relief ret 2026-09-10 225.000000"]);
    expect(walk.remaining.toString()).toBe("0.000000");
  });

  it("a negative share — a payable restated upward, a loss on a receivable — is released and returned with its own sign", () => {
    const walk = walkRunShare(fxItemTimeline(m("48000"), [relief("a1", "2026-09-10", "19200"), reopening("a1", "2026-10-13", "19200")]), { day: "2026-08-31", share: m("-450") });

    expect(steps(walk)).toEqual(["relief a1 2026-09-10 -180.000000", "reopening a1 2026-10-13 -180.000000"]);
    expect(walk.remaining.toString()).toBe("-450.000000");
  });

  it("events of one day are taken in the order they happened, and events of one instant in the order given", () => {
    const sameInstant = "2026-10-13T09:00:00.000Z";
    const timeline = fxItemTimeline(m("48000"), [
      relief("a2", "2026-10-13", "19200", "2026-10-13T09:00:05.000Z"),
      relief("a1", "2026-09-10", "19200"),
      reopening("a1", "2026-10-13", "19200", sameInstant),
      relief("a3", "2026-10-13", "4800", sameInstant),
    ]);

    expect(timeline.events.map((event) => `${event.kind} ${event.ref}`)).toEqual(["relief a1", "reopening a1", "relief a3", "relief a2"]);
  });

  it("every sequence of partial reliefs that ends with the balance closed releases the share to the last micro-unit, with no largest piece left over", () => {
    let state = 20260913;
    const next = () => {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      return state;
    };
    for (let trial = 0; trial < 200; trial++) {
      const opened = BigInt(1_000_000 + (next() % 900_000_000));
      const share = BigInt((next() % 2_000_001) - 1_000_000) * 7n + 1n;
      let open = opened;
      const events: FxItemEvent[] = [];
      for (let index = 0; open > 0n && index < 6; index++) {
        const part = index === 5 ? open : 1n + (BigInt(next()) % open);
        events.push({ kind: FxItemEventKind.Relief, ref: `r${index}`, day: `2026-09-${String(10 + index).padStart(2, "0")}`, at: `2026-09-${String(10 + index).padStart(2, "0")}T10:00:00.000Z`, amount: Money.fromScaled(part) });
        open -= part;
      }

      const walk = walkRunShare(fxItemTimeline(Money.fromScaled(opened), events), { day: "2026-08-31", share: Money.fromScaled(share) });

      expect(walk.remaining.scaled, `trial ${trial}`).toBe(0n);
      expect(walk.steps.reduce((sum, step) => sum + step.amount.scaled, 0n), `trial ${trial}`).toBe(share);
    }
  });
});
