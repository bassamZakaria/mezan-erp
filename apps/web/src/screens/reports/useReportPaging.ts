import { useState } from "react";
import type { ReportPageDTO } from "@mezan/contracts";
import type { ReportRunnerProps } from "@mezan/ui";
import { REPORT_PAGE_SIZE, useReportAllRows } from "../../data/reports-hooks";

type ReportPagingOptions = {
  readonly reportId: string;
  readonly apiPath: string;
  readonly apiRoot?: string;
  readonly paged: boolean;
};

type ReportPagingRunnerProps<Row> = Pick<ReportRunnerProps<Row>, "pager" | "loadAllRows" | "showAllRowsForPrint">;

export function useReportPaging<Row>(initialParams: () => Record<string, string>, { reportId, apiPath, apiRoot, paged }: ReportPagingOptions) {
  const [params, setParamsState] = useState<Record<string, string>>(initialParams);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(REPORT_PAGE_SIZE);
  const [everyRow, setEveryRow] = useState(false);
  const loadAllRows = useReportAllRows<Row>(reportId, apiPath, apiRoot);

  const setParams = (next: Record<string, string>) => {
    setParamsState(next);
    setPage(1);
  };
  const requestParams = paged && !everyRow ? { ...params, page: String(page), pageSize: String(pageSize) } : params;

  const runnerProps = (served: ReportPageDTO | undefined, readable: (rows: readonly Row[]) => readonly Row[] = (rows) => rows): ReportPagingRunnerProps<Row> =>
    served
      ? {
          pager: {
            page: served.page,
            pageSize: served.pageSize,
            totalRows: served.totalRows,
            onPageChange: setPage,
            onPageSizeChange: (size) => {
              setPageSize(size);
              setPage(1);
            },
          },
          loadAllRows: async () => readable(await loadAllRows(params)),
          showAllRowsForPrint: async () => {
            await loadAllRows(params);
            setEveryRow(true);
            return () => setEveryRow(false);
          },
        }
      : {};

  return { params, setParams, requestParams, runnerProps };
}
