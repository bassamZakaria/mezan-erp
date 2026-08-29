# المقاولات — the research behind the module

Read in order. Nothing here is a design; the design decisions are listed as decisions
and left open on purpose.

| File | What it holds |
|---|---|
| `00-baseline.md` | What a project is today, and the dimension audit — the finding everything else depends on |
| `01-stakeholder-review.md` | What 24 reviewers agreed on, what they contested, and the ten questions for the owner |
| `02-terminology.md` | The Arabic glossary, fixed before code |
| `03-adjacent-findings.md` | Defects in shipped code that this pass surfaced — each needs a reproduction |
| `04-market.md` | QuickBooks, Odoo, the dedicated tools, and the Arabic market |
| `05-egypt.md` | The Egyptian certificate, and an equally long list of what could not be sourced |

The one question that settles the most downstream work: **is `projectId` a first-class
dimension on every purchase, stock and treasury document, and is it one dimension or
two — project and cost category?** Posted entries are immutable, so this cannot be
retrofitted.
