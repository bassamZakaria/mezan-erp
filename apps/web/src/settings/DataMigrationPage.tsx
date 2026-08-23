import { useRef, useState, type RefObject } from "react";
import { Button, Card, StatusPill, buildDataMigrationTemplate, parseDataMigrationFile, downloadReportExport, type DataMigrationStepSpec } from "@mezan/ui";
import {
  useDataMigrationStatus,
  useDataMigrationPreview,
  useDataMigrationCommit,
  useHistoricalImportPreview,
  useHistoricalImportCommit,
  type DataMigrationMasterStep,
  type DataMigrationStatusDTO,
  type DataMigrationStepResultDTO,
  type HistoricalImportKind,
  type HistoricalImportDocType,
  type HistoricalImportRowDTO,
  type HistoricalImportResultDTO,
} from "../data/hooks";

/**
 * نقل البيانات (Data Migration wizard) — docs/catalog/09 §"نقل البيانات": the
 * one-time, dependency-ordered go-live import tool. 13 steps, each openable
 * independently ("الترتيب إرشاد مش قفل" — order is guidance, not a lock),
 * each with a downloadable Excel template, a dry-run preview, and an
 * all-or-nothing commit. Steps 1-9 (master data) hit `/data-migration/:step`;
 * steps 10-13 (historical documents) reuse `/sales/historical-import` and
 * `/purchases/historical-import` directly — same settled/partial-balance
 * archive rule, same "inventory untouched" guarantee.
 */

interface MasterStepDef {
  kind: "master";
  id: DataMigrationMasterStep;
  statusKey: keyof DataMigrationStatusDTO;
  title: string;
  help: string;
  spec: DataMigrationStepSpec;
}

interface HistoricalStepDef {
  kind: "historical";
  importKind: HistoricalImportKind;
  docType: HistoricalImportDocType;
  statusKey: keyof DataMigrationStatusDTO;
  title: string;
  help: string;
  spec: DataMigrationStepSpec;
}

type StepDef = MasterStepDef | HistoricalStepDef;

const HISTORICAL_COLUMNS: DataMigrationStepSpec["columns"] = [
  { key: "documentNumber", header: "رقم المستند", example: "INV-1001" },
  { key: "partyId", header: "معرف العميل/المورد", example: "cus-1" },
  { key: "date", header: "التاريخ", example: "2026-01-15" },
  { key: "dueDate", header: "تاريخ الاستحقاق" },
  { key: "itemId", header: "معرف الصنف" },
  { key: "description", header: "الوصف" },
  { key: "qty", header: "الكمية", example: "10" },
  { key: "unitCost", header: "سعر الوحدة", example: "85.00" },
  { key: "amountPaid", header: "المبلغ المسدد من المستند بالكامل", example: "500.00" },
];

const STEPS: StepDef[] = [
  {
    kind: "master",
    id: "departments",
    statusKey: "departments",
    title: "١. الأقسام",
    help: "الموظف لازم يكون له قسم — والقسم محتاج كود، والنظام مش بيخترعه من الاسم.",
    spec: {
      id: "departments",
      sheetName: "الأقسام",
      columns: [
        { key: "code", header: "الكود", example: "SALES" },
        { key: "nameAr", header: "الاسم", example: "المبيعات" },
        { key: "nameEn", header: "الاسم (إنجليزي)" },
      ],
    },
  },
  {
    kind: "master",
    id: "employees",
    statusKey: "employees",
    title: "٢. الموظفين",
    help: "المرتبات مش في الملف — بتتسجّل على عقد العمل بعدين.",
    spec: {
      id: "employees",
      sheetName: "الموظفين",
      columns: [
        { key: "code", header: "الكود", example: "EMP-0001" },
        { key: "nameAr", header: "الاسم" , example: "أحمد محمود" },
        { key: "departmentCode", header: "كود القسم", example: "SALES" },
        { key: "hireDate", header: "تاريخ التعيين", example: "2026-01-01" },
        { key: "branchCode", header: "كود الفرع" },
        { key: "phone", header: "الهاتف" },
        { key: "email", header: "البريد الإلكتروني" },
      ],
    },
  },
  {
    kind: "master",
    id: "treasury-accounts",
    statusKey: "treasuryAccounts",
    title: "٣. حسابات الخزينة",
    help: "الرصيد الافتتاحي هنا بيرحّل قيد محاسبي فعلي — راجع الإجمالي في شاشة المراجعة قبل ما تأكّد.",
    spec: {
      id: "treasury-accounts",
      sheetName: "حسابات الخزينة",
      columns: [
        { key: "code", header: "الكود", example: "CASH-001" },
        { key: "name", header: "الاسم", example: "صندوق نقدي" },
        { key: "type", header: "النوع (cash/bank)", example: "cash" },
        { key: "branchCode", header: "كود الفرع" },
        { key: "openingBalance", header: "الرصيد الافتتاحي", example: "0.00" },
        { key: "glAccountId", header: "حساب دفتر الأستاذ" },
      ],
    },
  },
  {
    kind: "master",
    id: "suppliers",
    statusKey: "suppliers",
    title: "٤. الموردون",
    help: "قبل الأصناف، لأن الصنف ممكن يرتبط بمورد مفضّل. الأرصدة المستحقة مش في الملف — بتتسجّل بعدين.",
    spec: {
      id: "suppliers",
      sheetName: "الموردون",
      columns: [
        { key: "code", header: "الكود", example: "SUP-1" },
        { key: "nameAr", header: "الاسم", example: "شركة التوريد" },
        { key: "phone", header: "الهاتف" },
        { key: "email", header: "البريد الإلكتروني" },
        { key: "taxNumber", header: "الرقم الضريبي" },
        { key: "paymentTermsDays", header: "مدة السداد (يوم)", example: "30" },
      ],
    },
  },
  {
    kind: "master",
    id: "customers",
    statusKey: "customers",
    title: "٥. العملاء",
    help: "مستقل عن باقي الخطوات — أرصدة العملاء مش بتتسجل هنا، بتُشتق لاحقًا من فواتير المبيعات السابقة المستوردة.",
    spec: {
      id: "customers",
      sheetName: "العملاء",
      columns: [
        { key: "code", header: "الكود", example: "CUS-1" },
        { key: "nameAr", header: "الاسم", example: "عميل تجاري" },
        { key: "phone", header: "الهاتف" },
        { key: "email", header: "البريد الإلكتروني" },
        { key: "taxNumber", header: "الرقم الضريبي" },
        { key: "creditLimit", header: "حد الائتمان" },
        { key: "paymentTermsDays", header: "مدة السداد (يوم)", example: "30" },
      ],
    },
  },
  {
    kind: "master",
    id: "items",
    statusKey: "items",
    title: "٦. الأصناف",
    help: "بعد الموردين، لأن الصنف يرتبط بمورد مفضّل. التصنيفات والعلامات التجارية بتتعمل تلقائي لو مش موجودة.",
    spec: {
      id: "items",
      sheetName: "الأصناف",
      columns: [
        { key: "code", header: "الكود", example: "ITM-1" },
        { key: "nameAr", header: "الاسم", example: "صنف تجريبي" },
        { key: "type", header: "النوع (stock/service)", example: "stock" },
        { key: "baseUnitCode", header: "وحدة القياس الأساسية", example: "PCS" },
        { key: "salePrice", header: "سعر البيع" },
        { key: "costPrice", header: "سعر التكلفة" },
        { key: "taxRatePercent", header: "نسبة الضريبة" },
      ],
    },
  },
  {
    kind: "master",
    id: "item-units",
    statusKey: "itemUnits",
    title: "٧. وحدات الأصناف",
    help: "بعد الأصناف، لأن كل صف بيرجع لصنف بالكود — يغطي الوحدات الثانوية (كرتونة، دستة) بمعامل تحويل لكل واحدة.",
    spec: {
      id: "item-units",
      sheetName: "وحدات الأصناف",
      columns: [
        { key: "itemCode", header: "كود الصنف", example: "ITM-1" },
        { key: "unitCode", header: "كود الوحدة", example: "BOX" },
        { key: "unitName", header: "اسم الوحدة", example: "كرتونة" },
        { key: "factor", header: "معامل التحويل", example: "12" },
      ],
    },
  },
  {
    kind: "master",
    id: "asset-categories",
    statusKey: "assetCategories",
    title: "٨. تصنيفات الأصول",
    help: "قبل الأصول الثابتة، لأن التصنيف بيحدد حسابات الأصل/الإهلاك الافتراضية.",
    spec: {
      id: "asset-categories",
      sheetName: "تصنيفات الأصول",
      columns: [
        { key: "code", header: "الكود", example: "CAT-1" },
        { key: "nameAr", header: "الاسم", example: "أثاث ومعدات" },
        { key: "defaultUsefulLifeMonths", header: "العمر الإنتاجي (شهر)", example: "60" },
        { key: "defaultSalvagePercent", header: "نسبة القيمة التخريدية %", example: "10" },
      ],
    },
  },
  {
    kind: "master",
    id: "assets",
    statusKey: "assets",
    title: "٩. الأصول الثابتة",
    help: "بعد تصنيفات الأصول — تُسجَّل كـ«رصيد افتتاحي» بدون قيد محاسبي جديد.",
    spec: {
      id: "assets",
      sheetName: "الأصول الثابتة",
      columns: [
        { key: "code", header: "الكود", example: "AST-1" },
        { key: "nameAr", header: "الاسم", example: "مكتب" },
        { key: "categoryCode", header: "كود التصنيف", example: "CAT-1" },
        { key: "acquisitionDate", header: "تاريخ الاقتناء", example: "2026-01-01" },
        { key: "acquisitionCost", header: "تكلفة الاقتناء", example: "5000.00" },
      ],
    },
  },
  {
    kind: "historical",
    importKind: "sales",
    docType: "SALES_INVOICE",
    statusKey: "salesInvoices",
    title: "١٠. فواتير المبيعات السابقة",
    help: "آخر الخطوات ترتيبًا لأن كل فاتورة ترجع لعميل وأصناف لازم تكون موجودة مسبقًا. فاتورة مسدَّدة بالكامل تُؤرشف بدون قيد محاسبي، والمتبقي يُسجَّل كمديونية عميل فقط — المخزون لا يتأثر إطلاقًا.",
    spec: { id: "historical-sales-invoices", sheetName: "فواتير مبيعات سابقة", columns: HISTORICAL_COLUMNS },
  },
  {
    kind: "historical",
    importKind: "sales",
    docType: "SALES_RETURN",
    statusKey: "salesReturns",
    title: "١١. مرتجعات المبيعات السابقة",
    help: "استورد الفواتير أولاً — المرتجع لازم يتربط بفاتورة مستوردة. المخزون لا يتأثر.",
    spec: { id: "historical-sales-returns", sheetName: "مرتجعات مبيعات سابقة", columns: HISTORICAL_COLUMNS },
  },
  {
    kind: "historical",
    importKind: "purchases",
    docType: "PURCHASE_INVOICE",
    statusKey: "purchaseInvoices",
    title: "١٢. فواتير المشتريات السابقة",
    help: "يماثل فواتير المبيعات السابقة على جانب المشتريات — يرجع لموردين وأصناف. المخزون لا يتأثر.",
    spec: { id: "historical-purchase-invoices", sheetName: "فواتير مشتريات سابقة", columns: HISTORICAL_COLUMNS },
  },
  {
    kind: "historical",
    importKind: "purchases",
    docType: "PURCHASE_RETURN",
    statusKey: "purchaseReturns",
    title: "١٣. مرتجعات المشتريات السابقة",
    help: "يماثل مرتجعات المبيعات السابقة — استورد الفواتير أولاً. المخزون لا يتأثر.",
    spec: { id: "historical-purchase-returns", sheetName: "مرتجعات مشتريات سابقة", columns: HISTORICAL_COLUMNS },
  },
];

function StepShell({
  title,
  help,
  registeredCount,
  open,
  onToggle,
  onDownloadTemplate,
  fileInputRef,
  onFileChosen,
  isPreviewing,
  isCommitting,
  previewSummary,
  errors,
  canCommit,
  onCommit,
}: {
  title: string;
  help: string;
  registeredCount: number | undefined;
  open: boolean;
  onToggle: () => void;
  onDownloadTemplate: () => void;
  fileInputRef: RefObject<HTMLInputElement>;
  onFileChosen: (file: File) => void;
  isPreviewing: boolean;
  isCommitting: boolean;
  previewSummary: string | null;
  errors: readonly { rowNumber: number; reasons: readonly string[] }[];
  canCommit: boolean;
  onCommit: () => void;
}) {
  const done = (registeredCount ?? 0) > 0;
  return (
    <Card className="p-[16px_18px]">
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-[12px] text-start">
        <div className="flex items-center gap-[10px]">
          {done ? <span aria-label="مكتمل" className="text-success-ink">✓</span> : null}
          <h3 className="font-display text-[14.5px] font-bold text-ink">{title}</h3>
        </div>
        <div className="flex items-center gap-[10px]">
          <StatusPill label={`مسجّل: ${registeredCount ?? 0}`} tone={done ? "success" : "neutral"} />
          <span aria-hidden className="text-ink-faint">{open ? "▲" : "▼"}</span>
        </div>
      </button>
      {open ? (
        <div className="mt-[14px] flex flex-col gap-[12px] border-t border-border pt-[14px]">
          <p className="max-w-[70ch] text-[12px] text-ink-muted">{help}</p>
          <div className="flex flex-wrap items-center gap-[9px]">
            <Button variant="default" onClick={onDownloadTemplate}>
              تنزيل النموذج
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFileChosen(file);
                e.target.value = "";
              }}
            />
            <Button variant="default" disabled={isPreviewing} onClick={() => fileInputRef.current?.click()}>
              {isPreviewing ? "جارِ التحقق…" : "استيراد"}
            </Button>
            <Button variant="primary" disabled={!canCommit || isCommitting} onClick={onCommit}>
              {isCommitting ? "جارِ التأكيد…" : "تأكيد الاستيراد"}
            </Button>
          </div>
          {previewSummary ? <p className="text-[12.5px] font-semibold text-ink">{previewSummary}</p> : null}
          {errors.length > 0 ? (
            <div className="overflow-auto rounded-md border border-border">
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-start">
                    <th className="p-[6px_8px] text-start font-semibold">الصف</th>
                    <th className="p-[6px_8px] text-start font-semibold">السبب</th>
                  </tr>
                </thead>
                <tbody>
                  {errors.map((err, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="mz-num p-[6px_8px]">{err.rowNumber}</td>
                      <td className="p-[6px_8px]">{err.reasons.join("، ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function MasterStepCard({ def, open, onToggle, registeredCount }: { def: MasterStepDef; open: boolean; onToggle: () => void; registeredCount: number | undefined }) {
  const preview = useDataMigrationPreview(def.id);
  const commit = useDataMigrationCommit(def.id);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [result, setResult] = useState<DataMigrationStepResultDTO | null>(null);

  async function handleFile(file: File) {
    setResult(null);
    const buffer = await file.arrayBuffer();
    const parsed = await parseDataMigrationFile(buffer, def.spec);
    setRows([...parsed.rows]);
    const previewResult = await preview.mutateAsync(parsed.rows);
    setResult(previewResult);
  }

  async function handleCommit() {
    if (!rows) return;
    const commitResult = await commit.mutateAsync(rows);
    setResult(commitResult);
  }

  return (
    <StepShell
      title={def.title}
      help={def.help}
      registeredCount={registeredCount}
      open={open}
      onToggle={onToggle}
      onDownloadTemplate={async () => downloadReportExport(await buildDataMigrationTemplate(def.spec))}
      fileInputRef={fileInputRef}
      onFileChosen={handleFile}
      isPreviewing={preview.isPending}
      isCommitting={commit.isPending}
      previewSummary={
        result
          ? result.createdIds
            ? `تم استيراد ${result.createdIds.length} سجل بنجاح.`
            : `${result.validCount} صف صالح من إجمالي ${result.validCount + result.errors.length}.`
          : null
      }
      errors={result?.errors ?? []}
      canCommit={!!result && result.errors.length === 0 && !result.createdIds}
      onCommit={handleCommit}
    />
  );
}

function HistoricalStepCard({ def, open, onToggle, registeredCount }: { def: HistoricalStepDef; open: boolean; onToggle: () => void; registeredCount: number | undefined }) {
  const preview = useHistoricalImportPreview(def.importKind);
  const commit = useHistoricalImportCommit(def.importKind);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<HistoricalImportRowDTO[] | null>(null);
  const [result, setResult] = useState<HistoricalImportResultDTO | null>(null);

  function toRows(parsedRows: readonly Record<string, string>[]): HistoricalImportRowDTO[] {
    return parsedRows.map((r) => ({
      rowNumber: Number(r.rowNumber),
      docType: def.docType,
      documentNumber: r.documentNumber ?? "",
      partyId: r.partyId ?? "",
      date: r.date ?? "",
      dueDate: r.dueDate || null,
      itemId: r.itemId || null,
      description: r.description || null,
      qty: r.qty ?? "0",
      unitCost: r.unitCost ?? "0",
      amountPaid: r.amountPaid ?? "0",
    }));
  }

  async function handleFile(file: File) {
    setResult(null);
    const buffer = await file.arrayBuffer();
    const parsed = await parseDataMigrationFile(buffer, def.spec);
    const built = toRows(parsed.rows);
    setRows(built);
    const previewResult = await preview.mutateAsync(built);
    setResult(previewResult);
  }

  async function handleCommit() {
    if (!rows) return;
    const commitResult = await commit.mutateAsync(rows);
    setResult(commitResult);
  }

  return (
    <StepShell
      title={def.title}
      help={def.help}
      registeredCount={registeredCount}
      open={open}
      onToggle={onToggle}
      onDownloadTemplate={async () => downloadReportExport(await buildDataMigrationTemplate(def.spec))}
      fileInputRef={fileInputRef}
      onFileChosen={handleFile}
      isPreviewing={preview.isPending}
      isCommitting={commit.isPending}
      previewSummary={
        result
          ? result.archivedIds
            ? `تم أرشفة ${result.archivedIds.length} مستند بنجاح.`
            : `${result.groups.length} مستند صالح — ${result.errors.length} صف به أخطاء.`
          : null
      }
      errors={result?.errors ?? []}
      canCommit={!!result && result.errors.length === 0 && !result.archivedIds}
      onCommit={handleCommit}
    />
  );
}

export function DataMigrationPage() {
  const status = useDataMigrationStatus();
  const [openStep, setOpenStep] = useState<string | null>(STEPS[0]?.title ?? null);

  return (
    <div className="flex flex-col gap-[16px]">
      <div>
        <h1 className="font-display text-[21px] font-bold text-ink">نقل البيانات</h1>
        <p className="mt-[6px] max-w-[80ch] text-[13px] text-ink-muted">
          دي الخطوات اللي بتنقل بيها بيانات شركتك على النظام. رتّبناها بالترتيب اللي لازم تمشي بيه، لأن كل خطوة بتعتمد
          على اللي قبلها. تقدر تفتح أي خطوة في أي وقت — الترتيب إرشاد مش قفل.
        </p>
      </div>

      <div className="flex flex-col gap-[10px]">
        {STEPS.map((def) =>
          def.kind === "master" ? (
            <MasterStepCard
              key={def.id}
              def={def}
              open={openStep === def.title}
              onToggle={() => setOpenStep((cur) => (cur === def.title ? null : def.title))}
              registeredCount={status.data?.[def.statusKey]}
            />
          ) : (
            <HistoricalStepCard
              key={def.title}
              def={def}
              open={openStep === def.title}
              onToggle={() => setOpenStep((cur) => (cur === def.title ? null : def.title))}
              registeredCount={status.data?.[def.statusKey]}
            />
          ),
        )}
      </div>

      <p className="text-[11.5px] text-ink-faint">
        استيراد الجرد وتحويل المخزون مش هنا — دول أدوات تشغيل يومي، بتلاقيهم جوه ورقة الجرد نفسها وشاشة التحويل.
      </p>
    </div>
  );
}
