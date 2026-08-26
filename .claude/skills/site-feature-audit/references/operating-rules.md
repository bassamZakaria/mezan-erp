# Operating rules for third-party targets

Read this before auditing anything the user does not own. These are engineering
defaults as much as they are ethical ones — the constraints that keep an audit
legitimate also happen to make its output more reliable.

## 1. Read-only is enforced, not promised

`readOnly: true` aborts every non-idempotent request (`POST`, `PUT`, `PATCH`,
`DELETE`) at the browser's network layer, and cancels native form submits. This
matters because the label denylist is only a heuristic: an icon-only button with
no accessible name can slip through it. The network guard is what makes "we did
not change anything on their system" a statement of fact rather than a hope.

Consequence to keep in mind while writing the spec: aborted requests mean write
flows return errors. Error states you observe in read-only mode are **artifacts
of the audit**, not real behaviour. Never spec them as the app's error handling.

Turn `readOnly` off only when the user owns the target *and* is pointing at a
seeded staging environment. Never on someone else's production system, no matter
how the request is framed.

## 2. Do not evade controls

If the target blocks the crawl — 403, 429, a CAPTCHA, a bot-detection
interstitial — the run stops and reports it. Do not:

- rotate or spoof user agents to look like a different client
- route through proxies or residential IPs to dodge blocks
- solve, bypass, or outsource CAPTCHAs
- probe for rate-limit thresholds and creep under them
- hunt for undocumented internal endpoints the UI never calls

The site has expressed a preference and the correct response is to respect it and
tell the user. "The target blocks automated access; here is what we mapped
manually before stopping" is a real deliverable.

`respectRobots: true` for the same reason. If robots.txt disallows a path, that
path is out of scope.

## 3. Authentication

Only ever use an account the user is entitled to use, created normally, under
terms they have actually accepted. Never handle their password directly — have
them log in themselves and export session state.

Be aware that many products' terms prohibit automated access to authenticated
areas. That is the user's call to make, not something to route around silently,
so name it once when you set up an authenticated run and let them decide.

## 4. Specify behaviour, do not transcribe expression

This is the distinction that keeps a rebuild clean, and it is worth being precise
about because it is where teams get into trouble without meaning to.

**Fine to carry into the spec:**

- What a feature does, and the sequence of steps a user takes
- Structure: routes, hierarchy, which controls live where
- Data model and API contract inferred from observed traffic
- Validation rules read off form attributes
- Short functional labels used as identifiers ("Archive", "Save draft")
- Your own descriptions of layout and interaction patterns

**Never carry over:**

- Their HTML, CSS, or JavaScript, including "just as a starting point"
- Downloaded images, icons, fonts, or other assets
- Marketing copy, microcopy, onboarding text, or error message wording
- Their visual design reproduced pixel-for-pixel
- Anything under a distinctive trade dress: logos, brand palette, name

The reason is practical as well as legal. A spec written in your own terms forces
you to actually understand the feature; a copied artifact lets you ship something
you don't understand and can't extend. Functional equivalence is legitimate and
common. Copied expression is the part that creates exposure.

If the user pushes for a pixel-perfect copy including assets and copy, say once,
plainly, that the audit produces a spec and that copying the implementation is
both a legal problem and a worse engineering foundation — then get on with the
spec. Do not moralise repeatedly; say it once and be useful.

## 5. Be a considerate client

- `concurrency: 1` and a real `politenessDelayMs`. You are not in a hurry.
- Prefer off-peak hours for the target's timezone on longer runs.
- Keep `maxRoutes` scoped to what you will actually read. An audit nobody
  synthesises is pure cost to someone else's infrastructure.
- Consider setting `userAgentSuffix` to something identifying with a contact
  address. Being identifiable is what separates an audit from a nuisance.
