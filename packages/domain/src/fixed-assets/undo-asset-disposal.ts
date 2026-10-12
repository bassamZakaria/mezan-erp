import { recordSensitiveEvent } from "../audit/index.js";
import { ReversalDateBeforeOriginalError, reverseJournalEntry, standingEntryGeneration, type JournalPostingDeps } from "../gl/index.js";
import type { Asset, AssetRepository } from "./asset.js";
import { depreciableBase } from "./depreciation.js";
import { AssetNotFoundError } from "./errors.js";

export const ASSET_DISPOSAL_DOC_TYPE = "ASSET_DISPOSAL";

export function assetDisposalEntryId(assetId: string): string {
  return `DISP-JE:${assetId}`;
}

export class AssetNotDisposedError extends Error {
  readonly code = "ASSET_NOT_DISPOSED";
  readonly messageEn: string;
  constructor(
    readonly assetId: string,
    readonly assetCode: string,
  ) {
    super(`الأصل ${assetCode} لم يُتخلَّص منه، فلا يوجد تخلّص يُلغى.`);
    this.messageEn = `Asset ${assetCode} is not disposed, so there is no disposal to undo.`;
    this.name = "AssetNotDisposedError";
  }
}

export interface UndoAssetDisposalDeps {
  readonly assets: AssetRepository;
  readonly gl: JournalPostingDeps;
}

export interface UndoAssetDisposalOptions {
  readonly reversalId: string;
  readonly date?: string;
  readonly memo?: string;
}

/**
 * إلغاء التخلص من أصل. The disposal entry is reversed and the asset returns to
 * service at the accumulated depreciation it was disposed with, so later runs
 * charge it again.
 */
export async function undoAssetDisposal(assetId: string, deps: UndoAssetDisposalDeps, opts: UndoAssetDisposalOptions): Promise<Asset> {
  const asset = await deps.assets.findById(assetId);
  if (!asset) throw new AssetNotFoundError(assetId);
  if (asset.status !== "disposed") throw new AssetNotDisposedError(asset.id, asset.code);
  const posting = await standingEntryGeneration(deps.gl.ledger, assetDisposalEntryId(asset.id));
  const date = opts.date ?? posting?.date.slice(0, 10);
  if (posting && date !== undefined && date < posting.date.slice(0, 10)) throw new ReversalDateBeforeOriginalError(posting.id, date, posting.date);

  return deps.gl.ledger.transaction(async () => {
    const reversal = posting
      ? (
          await reverseJournalEntry(posting.id, deps.gl, {
            reversalId: opts.reversalId,
            date,
            memo: opts.memo ?? `إلغاء التخلص من الأصل ${asset.code} — ${asset.nameAr}`,
          })
        ).reversal
      : null;
    const fullyDepreciated = asset.accumulatedDepreciation.scaled >= depreciableBase(asset).scaled;
    const restored: Asset = { ...asset, status: fullyDepreciated ? "fully_depreciated" : "active" };
    await deps.assets.update(restored);
    if (deps.gl.audit) {
      await recordSensitiveEvent(deps.gl.audit, {
        module: "assets",
        entityType: "ASSET",
        entityId: asset.id,
        action: "UNDO_DISPOSAL",
        actor: deps.gl.actor ?? "system",
        severity: "WARNING",
        details: { assetId: asset.id, code: asset.code, journalEntryId: posting?.id ?? null, reversalId: reversal?.id ?? null, reversalNo: reversal?.entryNo ?? null, date: reversal?.date ?? null, status: restored.status },
      });
    }
    return restored;
  });
}
