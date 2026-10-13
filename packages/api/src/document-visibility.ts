import type { Context } from "hono";
import type { DocumentService, FrameworkDocument } from "@mezan/domain";
import { warehouseScopeOf } from "./permission-gate.js";

export const DOCUMENT_NOT_FOUND = { error: "NOT_FOUND", message: "المستند غير موجود.", messageEn: "The document was not found." } as const;

export enum MirrorAccess {
  Reachable = "reachable",
  Hidden = "hidden",
}

export type VisibleDocumentResolver<Line> = (c: Context, mirrors?: MirrorAccess) => Promise<FrameworkDocument<Line> | null>;

export function anyLineInWarehouseScope(c: Context, warehouseIds: readonly string[]): boolean {
  const scope = warehouseScopeOf(c);
  return !scope || warehouseIds.some((warehouseId) => scope.includes(warehouseId));
}

// SECURITY: the ONE answer to "may this caller act on the document named in
// the path". Every `/:id` route of a family asks here before it reads, guards
// or writes anything, so a document the caller's list does not show answers
// 404 on every sub-route alike — never a 200, and never a refusal that tells
// the caller it exists (`invoice-sub-route-visibility.test.ts` walks the
// mounted routes). The document that reversed another is reachable only where
// a route says so: it is a record of the reversal, not a document to act on.
export function createVisibleDocumentResolver<Line>(
  service: Pick<DocumentService<Line>, "findById">,
  visible: (c: Context, doc: FrameworkDocument<Line>) => boolean,
): VisibleDocumentResolver<Line> {
  return async (c, mirrors = MirrorAccess.Hidden) => {
    const doc = await service.findById(c.req.param("id") ?? "");
    if (!doc || !visible(c, doc)) return null;
    if (mirrors === MirrorAccess.Hidden && doc.reversesDocId) return null;
    return doc;
  };
}
