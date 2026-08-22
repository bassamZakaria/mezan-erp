import { useState } from "react";
import { ReportRunner } from "@mezan/ui";
import type { ReportColumn, ReportParamField } from "@mezan/domain";
import { useReport } from "../../data/reports-hooks";

/**
 * The generic operational-report screen (docs/catalog/08-reports.md): every
 * one of the 18 reports below is this SAME component, parameterized by a
 * `ReportDefinition`'s metadata (title/params/columns — shared with the
 * server so the two can never drift) and the API path that computes it. This
 * is the "real ReportRunner + data client" the reports engine was built for
 * (packages/ui/src/primitives/ReportRunner.tsx): rows come from `useReport`
 * hitting the live `/reports/*` API over the shared session transport, over
 * the SAME repositories the sales/purchases/inventory/customers/suppliers
 * screens read and write — no report-specific screen code, no sample data.
 */

/** The subset of `ReportDefinition` a screen needs — deliberately NOT the full type (which also carries `run`/`paramsSchema`/`Ctx`, all server-only concerns this component never touches). */
export interface ReportScreenDefinition<TParams, Row> {
  readonly id: string;
  readonly titleAr: string;
  readonly descriptionAr?: string;
  readonly paramFields: readonly ReportParamField[];
  readonly defaultParams: TParams;
  readonly onDemand?: boolean;
  readonly columns: readonly ReportColumn<Row>[];
  readonly rowKey: (row: Row) => string;
}

export interface ReportScreenProps<TParams, Row> {
  readonly definition: ReportScreenDefinition<TParams, Row>;
  readonly apiPath: string;
  readonly eyebrow: string;
}

function toStringParams(defaults: object): Record<string, string> {
  return Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [key, value === null || value === undefined ? "" : String(value)]),
  );
}

export function ReportScreen<TParams extends object, Row>({ definition, apiPath, eyebrow }: ReportScreenProps<TParams, Row>) {
  const [params, setParams] = useState<Record<string, string>>(() => toStringParams(definition.defaultParams));
  // On-demand reports (heavy ledger dumps) don't fetch until the user clicks عرض التقرير.
  const [hasRun, setHasRun] = useState<boolean>(!definition.onDemand);

  const query = useReport<Row>(definition.id, apiPath, params, { enabled: hasRun });

  const fieldErrors = query.error && "status" in query.error && query.error.status === 400 ? { _root: query.error.message } : undefined;
  const result = query.data ?? null;

  return (
    <ReportRunner
      eyebrow={eyebrow}
      title={definition.titleAr}
      description={definition.descriptionAr}
      paramFields={definition.paramFields}
      params={params}
      onParamsChange={setParams}
      fieldErrors={fieldErrors}
      onDemand={definition.onDemand}
      onRun={() => setHasRun(true)}
      loading={query.isFetching}
      result={result}
      columns={definition.columns}
      rowKey={definition.rowKey}
      exportBaseFilename={definition.id}
    />
  );
}
