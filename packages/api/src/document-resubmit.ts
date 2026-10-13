import type { Context, Hono, MiddlewareHandler } from "hono";
import {
  DocumentResubmitRefusedError,
  type DocumentApprovalView,
  type DocumentService,
  type FrameworkDocument,
} from "@mezan/domain";
import type { DocumentApprovalDTO } from "@mezan/contracts";

export function serializeApproval(view: DocumentApprovalView | null | undefined): DocumentApprovalDTO | null {
  if (!view) return null;
  return { status: view.status, rejectionReason: view.rejectionReason, rejectedBy: view.rejectedBy };
}

export async function approvalOf<Line>(service: DocumentService<Line>, doc: FrameworkDocument<Line>): Promise<DocumentApprovalDTO | null> {
  return serializeApproval((await service.approvalsOf([doc])).get(doc.id));
}

export async function approvalReader<Line>(
  service: DocumentService<Line>,
  docs: readonly FrameworkDocument<Line>[],
): Promise<(doc: FrameworkDocument<Line>) => DocumentApprovalDTO | null> {
  const views = await service.approvalsOf(docs);
  return (doc) => serializeApproval(views.get(doc.id));
}

export interface ResubmitRouteOptions<Doc> {
  /** SECURITY: the family's own confirm gate — a resubmit puts the document where a confirm would. */
  readonly permission: MiddlewareHandler;
  /** SECURITY: the scope and type refusals the family's confirm route applies to the stored document. */
  readonly refuse?: (c: Context, id: string) => Promise<Response | null | undefined>;
  readonly resubmit: (c: Context, id: string) => Promise<Doc>;
  readonly serialize: (c: Context, doc: Doc) => Promise<unknown>;
  readonly onError: (c: Context, err: unknown) => Response;
}

export function mountResubmitRoute<Doc>(app: Hono, options: ResubmitRouteOptions<Doc>): void {
  app.post("/:id/resubmit", options.permission, async (c) => {
    const id = c.req.param("id");
    const refusal = await options.refuse?.(c, id);
    if (refusal) return refusal;
    try {
      const doc = await options.resubmit(c, id);
      return c.json({ document: await options.serialize(c, doc), held: true });
    } catch (err) {
      if (err instanceof DocumentResubmitRefusedError) {
        return c.json({ error: err.code, message: err.message, messageEn: err.messageEn, approvalStatus: err.approvalStatus }, 409);
      }
      return options.onError(c, err);
    }
  });
}
