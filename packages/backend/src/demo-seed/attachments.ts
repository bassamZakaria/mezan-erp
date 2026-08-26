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
      "الصنف: أرز أبيض ٥ كجم (IT-0001)",
      "المورد: مصنع الوادي الأخضر",
      "بلد المنشأ: مصر",
      "مدة الصلاحية: ١٢ شهراً من تاريخ التعبئة",
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
    text: ["عقد توريد سنوي", "المورد: مصنع الوادي الأخضر", "مدة العقد: سنة من ٢٠٢٦/٠١/٠١", "شروط السداد: ٣٠ يوماً"].join("\n"),
  },
  {
    id: "ATT-DEMO-5",
    entityType: "sales-invoice",
    entityId: CORE.salesInvoices[0]!,
    fileName: "اذن-التسليم.txt",
    mimeType: "text/plain; charset=utf-8",
    notes: "إذن التسليم الموقَّع من العميل",
    text: ["إذن تسليم", "الفاتورة: INV-DEMO-1", "استلم البضاعة: أحمد سالم", "التاريخ: ٢٠٢٦/٠٨/٠٤"].join("\n"),
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
