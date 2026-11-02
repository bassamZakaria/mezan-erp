export interface StatusWord {
  readonly ar: string;
  readonly en: string;
}

const STATUS_WORDS: Readonly<Record<string, StatusWord>> = {
  draft: { ar: "مسودة", en: "draft" },
  pending: { ar: "بانتظار الموافقة", en: "pending approval" },
  sent: { ar: "مُرسَل", en: "sent" },
  partially_received: { ar: "مستلَم جزئياً", en: "partially received" },
  fully_received: { ar: "مستلَم بالكامل", en: "fully received" },
  received: { ar: "مستلَم", en: "received" },
  confirmed: { ar: "مؤكد", en: "confirmed" },
  approved: { ar: "معتمد", en: "approved" },
  posted: { ar: "مُرحَّل", en: "posted" },
  released: { ar: "مُفرَج عنه", en: "released" },
  closed: { ar: "مغلق", en: "closed" },
  cancelled: { ar: "ملغي", en: "cancelled" },
  reversed: { ar: "معكوس", en: "reversed" },
};

export function statusWord(status: string): StatusWord {
  return STATUS_WORDS[status] ?? { ar: status, en: status };
}
