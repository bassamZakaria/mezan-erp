# Mezan — UX Enhancement Spec

**Status:** proposal (branch `enhancements`, worktree `enh/ui-design`)
**Author:** Bassam Zakaria
**Scope:** a distinctive, premium evolution of Mezan's visual identity. This does **not** change the parity app on `main`. It is a design direction plus a clickable mockup (`design/mezan-enhanced-mockups.html`).

---

## 1. Why evolve, and against what

The parity UI is competent and coherent: deep-teal (`#0E5049`) brand, gold (`#AE7C24`) accent, a soft green-grey ground (`#EDF1EE`), Noto Kufi Arabic for display, Noto Sans Arabic for body, a balance-beam logo, RTL-first with light + dark. It reads as a *good* Arabic ERP. It does not yet read as a *distinctive* one.

Three things keep it in the pack of typical Arabic ERPs:

1. **Cairo as the display face.** Cairo is the single most common heading font in Arabic web/SaaS. It signals "Arabic UI" but not "this product." It is a default, not a choice.
2. **A white sidebar on a pale ground.** The chrome and the content sit at nearly the same brightness, so the app has no spine — nothing anchors the eye, and it looks like every other light dashboard.
3. **The balance motif lives only in the logo.** *Mizan* (ميزان) means *balance* — the product's whole promise is that the books balance. That idea is present as a 38px glyph in the corner and nowhere else.

The enhancement keeps the teal-and-gold heritage and every accessibility/RTL guarantee, and pushes on exactly those three weak points. Evolution, not a rebrand: a `main` user would recognize this as the same product, dressed for a level up.

**The one aesthetic risk (stated up front):** the dashboard hero is no longer a line chart. It is a *live balance beam* that physically tips toward profit or loss. It is the most characteristic object in an accountant's world — a scale — rendered as the first thing you see. If it lands, nothing else on the market looks like it.

---

## 2. Palette evolution

Same two-color soul (teal + gold), deepened and given contrast structure. Every value below is a token; components read tokens only, so light/dark/OS-default all resolve as a set.

### Light

| Role | Parity | Enhanced | Why |
|---|---|---|---|
| Content ground | `#EDF1EE` cool green-grey | `#F2EFE9` warm ledger-porcelain | An accounting product should feel like paper. A faint warm bias reads as ledger stock, not a flat app canvas — and it is unmistakably not the parity ground. |
| Card surface | `#FFFFFF` | `#FFFFFF` | Kept. Pure white keeps dense figures crisp against the warm ground. |
| **Chrome (sidebar + topbar)** | white | **deep pine `#0B3A34 → #072B27`** | The headline move. A dark teal spine in *light* mode gives the app a center of gravity and a premium, considered feel — and instantly separates it from the sea of white-sidebar ERPs. |
| Brand | `#0E5049` | `#0C463E` (strong `#073029`) | Slightly deeper and bluer — more jewel than utility teal. |
| Accent | `#AE7C24` gold | `#B0862F` antique brass (strong `#8A6620`) | Warmer, leaf-like brass. Reads as gilt on a ledger rather than a highlighter. |
| Ink | `#12201B` | `#14231E` | Unchanged in spirit — deep ledger green-black. |

Semantic colors (success/warning/danger/info) and the four chart hues are carried across with minor refinements; they stay **separate from the brass accent** so state never competes with brand.

### Dark

Dark evolves from parity's `#0C1512` toward an **obsidian-teal** (`#0A1310` ground, `#101C18` surface) with the brand brightening to `#3FB39E` and brass to `#D8B25F`. The chrome rail stays darker than the content so the same spine reads in both themes. Contrast is checked so body text clears WCAG AA on every surface in both themes.

### Three-state theming (unchanged contract)

Bare `:root` = full light palette. `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])` redefines tokens only. `:root[data-theme="dark"]` redefines them again so the toggle wins both directions. `body` paints an explicit token background. No color is defined only inside a media/attribute block. This matches the parity contract exactly — the enhancement changes values, not the mechanism.

---

## 3. Typography

| Role | Parity | Enhanced | Rationale |
|---|---|---|---|
| Display / headings | Cairo | **Noto Kufi Arabic** 500/600/700 | Kufic geometry, wide apertures, no negative tracking. Distinctive at title sizes without costing legibility. |
| Signature (wordmark, eyebrows) | — | **Noto Kufi Arabic** 500/700, used with restraint | Kufic geometry is the calligraphy of measurement and inscription. Used only for the wordmark and the small uppercase eyebrow labels, it ties the type back to *mizan* without shouting. |
| Body | IBM Plex Sans Arabic | **Noto Sans Arabic** 400/500/600/700 | Wider counters and a larger effective x-height than Plex Arabic at UI sizes; body runs at 0.9375rem / 1.75 line-height because Arabic needs more leading than Latin. |
| Numerals / data | IBM Plex Mono | IBM Plex Mono 400/500/600, `tabular-nums`, LTR-isolated | Kept. Column alignment in financial tables is non-negotiable. |
| Latin | IBM Plex Sans | IBM Plex Sans | Kept, for product codes and English terms. |

**Type scale** (rem, 1rem = 16px): 0.6875 / 0.75 / 0.8125 / 0.875 / 1 / 1.125 / 1.375 / 1.75 / 2.25. Display sizes use Noto Kufi Arabic 600–700 with `text-wrap: balance` and no negative tracking (letter-spacing breaks Arabic letter joins); eyebrows use Noto Kufi Arabic with `+0.14em` tracking, uppercase, on Latin strings only. Running text stays near 65ch where it appears as prose.

---

## 4. The signature: *mizan* as structure

The balance motif graduates from logo to layout system, in three graded doses:

1. **The fulcrum rule.** Every page title sits above a hairline divider carrying a single small brass triangle — a fulcrum. It is the quiet, everywhere dose: it says "balanced" on every screen without a single extra pixel of chrome.
2. **The balance beam (dashboard hero).** A real beam pivots on a fulcrum, one pan weighted by revenue, the other by expenses; it settles at a tilt proportional to the month's net result, with the net figure read out at the pivot. Profit tilts the revenue pan down; a loss tilts the other way. On load it swings once and settles (reduced-motion: it renders already settled). This replaces the parity "line chart first" dashboard as the thesis object.
3. **Variance beams in tables.** In reports, a period-over-period variance is drawn as a tiny two-state tilt indicator in the cell — a 12px beam nudged up or down — so a scanning eye reads direction before it reads the number.

Doses 1 and 3 are ambient and cheap; dose 2 is the one loud thing. Boldness is spent in exactly one place.

---

## 5. Componentry & data density

- **Sidebar rail.** Dark teal, grouped nav with Noto Kufi Arabic group labels, brass active bar on the inline-start edge, collapsible to icon-only. Branch/company switcher pinned to the top; user + theme toggle pinned to the bottom.
- **Topbar.** A persistent, wide **command bar** (`⌘K` / `Ctrl+K`) as the primary surface — not a hidden palette. Keyboard-first is the default posture, not a power-user afterthought.
- **KPI cards.** Tighter radius (8px on data surfaces vs the parity 13px), a label in muted ink, a large `tabular-nums` value, and a delta line with a directional micro-beam. Optional inline sparkline.
- **Data tables.** Denser row rhythm (36px), sticky header, subtle tinted zebra (not lines), right-aligned numeric columns in mono, inline status pills, and a hover row-action that appears only on the hovered row. Sortable headers show direction; column of figures gets a faint total footer.
- **Status pills & chips.** Filled-soft pills for document state; a chip row above lists carries live counts and drives filtering. Chips and pills use semantic tokens, never the brass.
- **Document detail.** Summary grid, then an **effects panel** (kept from parity — it is genuinely good: it tells the user what a document *did* to inventory and ledgers) restyled with the fulcrum motif, then tabbed sub-tables. A slide-in **side panel** for drill-downs (customer, journal entry) without leaving the screen.
- **Radii & shadows.** Data surfaces 8px, chrome/hero 14px, pills full. Two shadow tiers only; shadows are cool-tinted in light, black in dark.

---

## 6. Dashboard / BI upgrades

- **Balance-beam hero** (§4) replaces the generic first chart and states the month's result the instant the page loads.
- **KPI strip** with directional micro-beams so trend direction is pre-attentive.
- **"Needs attention" queue** promoted to a first-class column: overdue invoices, tax due, items below reorder — each with a one-tap primary action. Work, not just numbers.
- **Aging** as a small heat-tinted matrix rather than a plain table — older buckets tint warmer.
- **Expense split** as a labelled donut with a readout center; **top items** as a ranked list with mono figures.
- Every figure is `tabular-nums`, LTR-isolated, so Arabic RTL prose and Western digits never fight.

---

## 7. Keyboard-first flows

- **Command bar** always visible in the topbar; `⌘K`/`Ctrl+K` focuses it from anywhere. It routes to any screen and to primary create-actions ("new invoice", "receive goods").
- **Global create** `⌘N`, **save** `⌘S` (or `⌘Enter`) on document forms, **`/`** to focus the in-page search, **`g` then a letter** to jump between modules, **`j`/`k`** to move the table selection, **`Esc`** closes panels and modals.
- Every actionable element has a visible `:focus-visible` ring (2px brass, 2px offset — kept from parity). `kbd` hint chips appear next to primary actions and in the command bar so the shortcuts are discoverable, not folklore.

---

## 8. Motion

Deliberate and few, all gated by `prefers-reduced-motion`:

- **Page-load stagger.** Header, then KPI strip, then panels fade-rise ~6px in sequence (~40ms apart). One orchestrated moment, once.
- **Balance beam settle.** The hero beam swings once to its tilt on load with an ease-out. Reduced-motion: renders already settled.
- **Hover micro-interactions.** Cards lift 1–2px; table rows tint and reveal their row action; buttons darken.
- **Panel slide.** Side panels and the command results ease in from the inline edge.

No ambient/looping animation (the parity idle-sway is dropped) — perpetual motion is the tell of AI-generated design.

---

## 9. What is deliberately kept

Not everything should change. Kept from parity: the effects panel concept, the semantic color system and chart hues (refined only), IBM Plex Sans + IBM Plex Mono for Latin and figures, the three-state theming contract, logical-property RTL discipline, the balance-beam logo, and the overall information architecture. The enhancement is a re-skin and a sharpening of the two or three things that read as generic — not a teardown.

---

## 10. Deliverables & verification

- **This spec** — `docs/design/ux-enhancement-spec.md`.
- **Clickable mockup** — `design/mezan-enhanced-mockups.html`: shell, dashboard (balance-beam hero), a document list, a document detail, and a financial report, with Cyag / محمد الشهابي sample data, RTL, light + dark toggle. Verified rendering in a real browser (Playwright) in both themes, and published as an Artifact.
