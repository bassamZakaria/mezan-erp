import type { App } from "@mezan/api";
import { CORE, step } from "./shared.js";

/**
 * المرفقات (R1.4) — a file on an entity and a file on a document, so the tab is
 * never proven against an empty list.
 *
 * SEED PROFILE FOR TESTS AND LOCAL DEVELOPMENT ONLY — see `../demo-seed.ts`.
 *
 * The bytes are generated here rather than read off disk: the seed must run
 * from a packaged build with no fixture directory beside it.
 */

interface SeedAttachment {
  readonly id: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly notes: string;
  readonly text: string;
}

const ATTACHMENTS: readonly SeedAttachment[] = [
  {
    id: "ATT-DEMO-1",
    entityType: "item",
    entityId: CORE.items[0]!,
    fileName: "بطاقة-الصنف.txt",
    mimeType: "text/plain; charset=utf-8",
    notes: "بطاقة بيانات المورد للصنف",
    text: [
      "بطاقة بيانات الصنف",
      "الصنف: أرز أبيض 5 كجم (IT-0001)",
      "المورد: مصنع الوادي الأخضر",
      "بلد المنشأ: مصر",
      "مدة الصلاحية: 12 شهراً من تاريخ التعبئة",
    ].join("\n"),
  },
  {
    id: "ATT-DEMO-2",
    entityType: "item",
    entityId: CORE.items[0]!,
    fileName: "شهادة-الجودة.csv",
    mimeType: "text/csv; charset=utf-8",
    notes: "نتائج فحص الدفعة الأخيرة",
    text: ["الفحص,النتيجة,الحد المسموح", "الرطوبة,12.4,14.0", "الكسر,3.1,5.0", "الشوائب,0.2,0.5"].join("\n"),
  },
  {
    id: "ATT-DEMO-3",
    entityType: "customer",
    entityId: CORE.customers[0]!,
    fileName: "البطاقة-الضريبية.txt",
    mimeType: "text/plain; charset=utf-8",
    notes: "صورة البطاقة الضريبية المسلَّمة عند فتح الحساب",
    text: ["شركة الأمل للتجارة", "الرقم الضريبي: 100-200-300", "مأمورية: القاهرة أول"].join("\n"),
  },
  {
    id: "ATT-DEMO-4",
    entityType: "supplier",
    entityId: CORE.suppliers[0]!,
    fileName: "عقد-التوريد.txt",
    mimeType: "text/plain; charset=utf-8",
    notes: "عقد التوريد السنوي",
    text: ["عقد توريد سنوي", "المورد: مصنع الوادي الأخضر", "مدة العقد: سنة من 2026/01/01", "شروط السداد: 30 يوماً"].join("\n"),
  },
  {
    id: "ATT-DEMO-5",
    entityType: "sales-invoice",
    entityId: CORE.salesInvoices[0]!,
    fileName: "اذن-التسليم.txt",
    mimeType: "text/plain; charset=utf-8",
    notes: "إذن التسليم الموقَّع من العميل",
    text: ["إذن تسليم", "الفاتورة: INV-DEMO-1", "استلم البضاعة: أحمد سالم", "التاريخ: 2026/08/04"].join("\n"),
  },
  {
    id: "ATT-DEMO-6",
    entityType: "sales-quote",
    entityId: "SQ-DEMO-1",
    fileName: "طلب-عرض-السعر.txt",
    mimeType: "text/plain; charset=utf-8",
    notes: "طلب العميل المكتوب الذي بُني عليه العرض",
    text: ["طلب عرض سعر", "العميل: مؤسسة النور", "الأصناف المطلوبة: أرز 5 كجم ×30، سكر ×100", "مدة الصلاحية المطلوبة: 30 يوماً"].join("\n"),
  },
  {
    id: "ATT-DEMO-7",
    entityType: "sales-return",
    entityId: "SRT-DEMO-1",
    fileName: "محضر-الفحص.txt",
    mimeType: "text/plain; charset=utf-8",
    notes: "محضر فحص البضاعة المرتجعة",
    text: ["محضر فحص مرتجع", "المرتجع: SRT-DEMO-1", "السبب: تلف التغليف", "الكمية المفحوصة: 20", "القرار: يُعاد للمخزن"].join("\n"),
  },
  {
    id: "ATT-DEMO-8",
    entityType: "purchase-order",
    entityId: "PO-DEMO-1",
    fileName: "تأكيد-المورد.txt",
    mimeType: "text/plain; charset=utf-8",
    notes: "تأكيد المورد على أمر الشراء",
    text: ["تأكيد أمر شراء", "أمر الشراء: PO-DEMO-1", "المورد: مصنع الوادي الأخضر", "موعد التسليم: خلال 10 أيام"].join("\n"),
  },
  {
    id: "ATT-DEMO-9",
    entityType: "goods-receipt",
    entityId: "GRN-DEMO-1",
    fileName: "بوليصة-الشحن.txt",
    mimeType: "text/plain; charset=utf-8",
    notes: "بوليصة الشحن المرفقة بالبضاعة",
    text: ["بوليصة شحن", "إذن الاستلام: GRN-DEMO-1", "الناقل: النقل السريع", "رقم السيارة: ط ن ر 452"].join("\n"),
  },
  {
    id: "ATT-DEMO-10",
    entityType: "stock-adjustment",
    entityId: "ADJ-DEMO-5",
    fileName: "اعتماد-التسوية.txt",
    mimeType: "text/plain; charset=utf-8",
    notes: "اعتماد مدير المخزن للتسوية",
    text: ["اعتماد تسوية مخزنية", "التسوية: ADJ-000001", "اعتمدها: أمين المخزن", "السبب المسجَّل مطابق للجرد"].join("\n"),
  },
  {
    id: "ATT-DEMO-11",
    entityType: "stock-transfer",
    entityId: "TRF-DEMO-3",
    fileName: "اذن-الصرف-للفرع.txt",
    mimeType: "text/plain; charset=utf-8",
    notes: "إذن صرف موقَّع من المخزن المستلم",
    text: ["إذن تحويل مخزني", "التحويل: TRF-DEMO-3", "من: المخزن الرئيسي", "استلمها: أمين مخزن الجيزة"].join("\n"),
  },
  {
    id: "ATT-DEMO-12",
    entityType: "employee",
    entityId: CORE.employees[0]!,
    fileName: "عقد-العمل.txt",
    mimeType: "text/plain; charset=utf-8",
    notes: "عقد العمل الموقَّع",
    text: ["عقد عمل", "الموظف: EMP-DEMO-1", "نوع التعاقد: دوام كامل", "بداية العمل: 2024/01/15"].join("\n"),
  },
  {
    id: "ATT-DEMO-13",
    entityType: "voucher",
    entityId: "VCH-DEMO-1",
    fileName: "ايصال-التحصيل.txt",
    mimeType: "text/plain; charset=utf-8",
    notes: "إيصال التحصيل الموقَّع من العميل",
    text: ["إيصال تحصيل", "السند: VCH-DEMO-1", "طريقة السداد: نقداً", "استلمه: أمين الخزنة"].join("\n"),
  },
];

export async function seedAttachments(app: App): Promise<void> {
  for (const attachment of ATTACHMENTS) {
    await step(app, "POST", "/attachments", {
      id: attachment.id,
      entityType: attachment.entityType,
      entityId: attachment.entityId,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      notes: attachment.notes,
      contentBase64: Buffer.from(attachment.text, "utf8").toString("base64"),
    });
  }
}
