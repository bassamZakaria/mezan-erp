p = "packages/api/src/bank-reconciliation-routes.ts"
s = open(p).read()
o = """  app.post("/:id/finalize", gate("treasury.reconciliation.finalize"), async (c) => {
    try {
      const statement = await service.finalize(c.req.param("id"));"""
n = """  /**
   * Refused with 422 while any line is still unmatched. `{ "force": true,
   * "reason": "..." }` closes it anyway and records both on the statement —
   * a reconciliation locked over open differences must say so (D82).
   */
  app.post("/:id/finalize", gate("treasury.reconciliation.finalize"), async (c) => {
    let body: { force?: boolean; reason?: string } = {};
    try {
      body = ((await c.req.json()) ?? {}) as { force?: boolean; reason?: string };
    } catch {
      body = {};
    }
    try {
      const statement = await service.finalize(c.req.param("id"), {
        force: body.force === true,
        reason: body.reason,
        actor: callerUserId(c),
      });"""
assert o in s
s = s.replace(o, n, 1)
open(p, "w").write(s)
print("ok")
