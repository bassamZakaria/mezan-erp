# Crawler configuration

Every option, with the ones that actually change outcomes called out.

## Target

| Option | Default | Notes |
|---|---|---|
| `baseUrl` | — | Required. Crawl is locked to this origin. |
| `outputDir` | `./audit-output` | Artifacts root. |
| `seedRoutes` | `[]` | Routes unreachable by link-following. Essential for SPAs with dashboards behind conditional nav. |
| `includePatterns` | `[]` | Regexes; if non-empty, only matching paths are crawled. The cheapest way to scope a big target. |
| `excludePatterns` | logout, downloads | Regexes. Add anything that would end the session or start a download. |

## Scope and cost

| Option | Default | Notes |
|---|---|---|
| `maxRoutes` | 40 | **The main cost dial.** Start at 5–10 for a pilot. |
| `maxInteractionsPerRoute` | 60 | Controls clicked per route, in DOM order. |
| `interactionDepth` | 1 | 1 = click controls on the route. 2 = also click inside overlays that open. Depth 2 multiplies runtime by roughly the average overlay action count. |
| `concurrency` | 1 | Leave at 1 for third-party targets. |

Rough runtime: `maxRoutes × maxInteractionsPerRoute × (settleMs + politenessDelayMs + ~1.5s)`.
At defaults that is a multi-hour run. Pilot first.

## Timing

| Option | Default | Notes |
|---|---|---|
| `settleMs` | 700 | Wait after navigation and after each click. **Raise this first** if control counts come back near zero — it usually means you are snapshotting a loading skeleton. 1500–2500 is reasonable for heavy SPAs. |
| `politenessDelayMs` | 800 | Pause between requests to the target. |
| `navigationTimeoutMs` | 30000 | Per-navigation timeout. |

## Safety

| Option | Default | Notes |
|---|---|---|
| `readOnly` | `true` | Aborts all non-idempotent requests at the network layer and blocks form submits. Only disable on a staging environment the user owns. |
| `respectRobots` | `true` | Honours `Disallow` for `User-agent: *`. |
| `destructiveLabelPatterns` | long list | Controls whose accessible name matches are recorded but not clicked. Tune per target — a project-management app may use "Archive" destructively; a media app may use "Publish" harmlessly. Review this list against the target's vocabulary before a long run. |

Note that `readOnly` and the label list are complementary, not redundant. The
labels stop you from *trying*; the network guard stops anything from *landing*
when an icon-only button has no label to match.

## Auth

| Option | Default | Notes |
|---|---|---|
| `storageStatePath` | `null` | Path to a Playwright storage state file. |

Generate it by having the user log in themselves:

```bash
npx playwright open --save-storage=auth.json https://target.example.com
```

Sessions expire mid-run. If routes suddenly all resolve to a login page, that is
what happened — re-export and resume with a narrower `includePatterns`.

**Role coverage:** one storage state audits one role. For a product with
meaningful permission tiers, run once per role into separate output directories
and diff them during synthesis. Skipping this is the most common way an audit
produces a confidently incomplete spec.

## Output

| Option | Default | Notes |
|---|---|---|
| `screenshots` | `true` | Route shot plus one per state-changing interaction. |
| `fullPageScreenshots` | `false` | Full-page shots are large; enable only for layout-critical work. |
| `userAgentSuffix` | `""` | Appended to a standard Chrome UA. Set to something identifying with a contact address rather than using it to disguise the crawler. |

## Extending overlay detection

If a target uses custom overlay markup with no ARIA roles, add its selector to
`OVERLAY_SELECTOR` near the top of `crawl.mjs`. Check the DOM for a portal root
first — most component libraries append overlays to `body`, which is what makes
the before/after diff work.

## Non-English and RTL targets

`destructiveLabelPatterns` is matched against the control's accessible name. On a
non-English UI the shipped English list matches **nothing**, so every destructive
control passes the first filter silently. The crawler will not warn you about
this — the label simply never matches, which is indistinguishable from a safe
button.

Before auditing a localised product, translate the pattern list into the
interface language and keep both. Note that transliteration variants matter in
Arabic: hamza is written inconsistently across products, so include both `إلغاء`
and `الغاء`, `إرسال` and `ارسال`, and so on.

The network-layer `readOnly` guard still holds regardless of language, since it
inspects HTTP methods rather than text. The label list is what stops you from
*trying*; the network guard is what stops anything from *landing*. On a localised
target you are relying almost entirely on the second one until you translate the
first.

## Domain-specific danger vocabulary

Generic "delete/remove" lists miss the controls that actually matter in
line-of-business software, because the destructive action is often named after a
domain operation rather than a deletion:

| Domain | Controls to treat as destructive |
|---|---|
| Accounting / ERP | post, close period, reconcile, void, reverse, issue invoice — `ترحيل`, `إقفال`, `تسوية`, `إصدار` |
| Inventory | stocktake, adjust, transfer, write-off — `جرد`, `تسوية`, `تحويل` |
| Payroll | run payroll, approve, disburse |
| CRM | send campaign, merge records, bulk update |
| Healthcare | discharge, prescribe, finalise notes |

In a double-entry system especially, "post" is more consequential than "delete":
a posted entry usually cannot be removed, only reversed, so a stray write leaves
a permanent artifact in the data. Review the target's own vocabulary against this
before a long run — it takes ten minutes and it is the difference between a clean
audit and a corrupted staging dataset.

## Choosing the audit account

Use the **lowest-privilege account that can see the surface you need**, not an
admin account. This is counterintuitive — admin sees the most screens, so it
looks like the efficient choice — but an admin session combined with an automated
click sweep is the worst-case pairing: admin roles hold exactly the irreversible
powers (user deletion, period close, settings changes, permission edits) that you
least want a script near.

The better pattern is one pass per role, starting with a viewer or read-only
role, widening only once the destructive-label list has been verified against the
real UI. Multi-role coverage is something you want anyway; starting from the
bottom just makes the first pass safe as well as useful.
