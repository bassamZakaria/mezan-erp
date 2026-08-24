import type { DataMigrationStepSpec } from "@mezan/ui";
import type {
  DataMigrationMasterStep,
  DataMigrationStatusDTO,
  HistoricalImportDocType,
  HistoricalImportKind,
} from "../data/hooks";

/**
 * The go-live wizard's per-step column contract (docs/catalog/09 «نقل البيانات»).
 *
 * Lifted out of the page so the test-fixture generator builds its workbooks
 * from the SAME spec the app parses. A hand-copied fixture would drift the
 * first time a column changed, and the import would fail for a reason that
 * looked like a product bug.
 */

export interface MasterStepDef {
  kind: "master";
  id: DataMigrationMasterStep;
  statusKey: keyof DataMigrationStatusDTO;
  title: string;
  help: string;
  spec: DataMigrationStepSpec;
}

export interface HistoricalStepDef {
  kind: "historical";
  importKind: HistoricalImportKind;
  docType: HistoricalImportDocType;
  statusKey: keyof DataMigrationStatusDTO;
  title: string;
  help: string;
  spec: DataMigrationStepSpec;
}

export type StepDef = MasterStepDef | HistoricalStepDef;

export const HISTORICAL_COLUMNS: DataMigrationStepSpec["columns"] = [
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

export const STEPS: StepDef[] = [
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
