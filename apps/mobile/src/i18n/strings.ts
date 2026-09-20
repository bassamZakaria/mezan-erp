export enum Locale {
  Ar = "ar",
  En = "en",
}

export interface Strings {
  readonly appName: string;
  readonly signIn: {
    readonly title: string;
    readonly subtitle: string;
    readonly serverLabel: string;
    readonly serverHint: string;
    readonly tenantLabel: string;
    readonly tenantHint: string;
    readonly emailLabel: string;
    readonly pinLabel: string;
    readonly submit: string;
    readonly submitting: string;
    readonly unlockWithBiometrics: string;
    readonly unlockPrompt: string;
    readonly signedOut: string;
  };
  readonly home: {
    readonly title: string;
    readonly cash: string;
    readonly bank: string;
    readonly receivables: string;
    readonly payables: string;
    readonly netProfit: string;
    readonly approvalsWaiting: string;
    readonly recentActivity: string;
    readonly asOf: string;
  };
  readonly customer: {
    readonly title: string;
    readonly creditLimit: string;
    readonly paymentTerms: string;
    readonly currency: string;
    readonly phone: string;
    readonly taxNumber: string;
  };
  readonly tabs: {
    readonly home: string;
    readonly customers: string;
    readonly sell: string;
    readonly stock: string;
    readonly more: string;
  };
  readonly picker: {
    readonly search: string;
    readonly empty: string;
    readonly searchHint: string;
  };
  readonly sell: {
    readonly title: string;
    readonly documentType: string;
    readonly kindQuote: string;
    readonly kindInvoice: string;
    readonly customer: string;
    readonly customerPlaceholder: string;
    readonly branch: string;
    readonly branchPlaceholder: string;
    readonly warehouse: string;
    readonly warehousePlaceholder: string;
    readonly date: string;
    readonly dueDate: string;
    readonly expiryDate: string;
    readonly lines: string;
    readonly addLine: string;
    readonly removeLine: string;
    readonly item: string;
    readonly itemPlaceholder: string;
    readonly qty: string;
    readonly unitPrice: string;
    readonly notes: string;
    readonly submitQuote: string;
    readonly submitInvoice: string;
    readonly submitting: string;
    readonly quoteCreated: string;
    readonly invoiceCreated: string;
    readonly noPermission: string;
    readonly customerRequired: string;
    readonly locationRequired: string;
    readonly lineIncomplete: string;
  };
  readonly collect: {
    readonly title: string;
    readonly customer: string;
    readonly customerPlaceholder: string;
    readonly invoice: string;
    readonly invoicePlaceholder: string;
    readonly invoiceEmpty: string;
    readonly amount: string;
    readonly paymentMethod: string;
    readonly cash: string;
    readonly cheque: string;
    readonly treasuryAccount: string;
    readonly treasuryAccountPlaceholder: string;
    readonly branch: string;
    readonly referenceNo: string;
    readonly submit: string;
    readonly submitting: string;
    readonly success: string;
    readonly noPermission: string;
    readonly missingGlAccount: string;
    readonly invoiceRequired: string;
    readonly detailsRequired: string;
  };
  readonly stock: {
    readonly title: string;
    readonly search: string;
    readonly scan: string;
    readonly closeScan: string;
    readonly cameraPermission: string;
    readonly grantPermission: string;
    readonly onHand: string;
    readonly reserved: string;
    readonly available: string;
    readonly warehouse: string;
    readonly noResults: string;
    readonly noPermission: string;
    readonly searchHint: string;
  };
  readonly clock: {
    readonly title: string;
    readonly clockIn: string;
    readonly clockOut: string;
    readonly dayComplete: string;
    readonly working: string;
    readonly notLinked: string;
    readonly needsSelfie: string;
    readonly needsBiometric: string;
    readonly takeSelfie: string;
    readonly retake: string;
    readonly biometricBlocked: string;
    readonly punchedIn: string;
    readonly punchedOut: string;
    readonly clockedInAt: string;
    readonly clockedOutAt: string;
    readonly noPermission: string;
    readonly serverTime: string;
    readonly cameraPermission: string;
  };
  readonly approvals: {
    readonly title: string;
    readonly approve: string;
    readonly reject: string;
    readonly reason: string;
    readonly reasonPlaceholder: string;
    readonly reasonRequired: string;
    readonly confirmReject: string;
    readonly empty: string;
    readonly step: string;
    readonly noPermission: string;
    readonly submittedBy: string;
  };
  readonly more: {
    readonly title: string;
    readonly collect: string;
    readonly collectSubtitle: string;
    readonly clock: string;
    readonly clockSubtitle: string;
    readonly approvals: string;
    readonly approvalsSubtitle: string;
  };
  readonly common: {
    readonly retry: string;
    readonly signOut: string;
    readonly empty: string;
    readonly loading: string;
    readonly offline: string;
    readonly offlineWrite: string;
    readonly search: string;
    readonly cancel: string;
    readonly save: string;
    readonly confirm: string;
  };
  readonly errors: {
    readonly network: string;
    readonly unauthorized: string;
    readonly forbidden: string;
    readonly server: string;
    readonly unexpectedShape: string;
  };
}

const AR: Strings = {
  appName: "ميزان",
  signIn: {
    title: "تسجيل الدخول",
    subtitle: "ادخل ببيانات المستخدم نفسها التي تستعملها على البرنامج",
    serverLabel: "عنوان الخادم",
    serverHint: "اتركه كما هو إن لم يطلب منك غير ذلك",
    tenantLabel: "كود المنشأة",
    tenantHint: "الكود الذي تفتح به المنشأة على النسخة السحابية",
    emailLabel: "البريد الإلكتروني",
    pinLabel: "الرقم السري (٦ أرقام)",
    submit: "دخول",
    submitting: "جارٍ الدخول…",
    unlockWithBiometrics: "الدخول ببصمة الجهاز",
    unlockPrompt: "أكّد هويتك لفتح ميزان",
    signedOut: "انتهت الجلسة. سجّل الدخول مرة أخرى.",
  },
  home: {
    title: "نظرة عامة",
    cash: "النقدية بالخزائن",
    bank: "أرصدة البنوك",
    receivables: "مديونية العملاء",
    payables: "مستحقات الموردين",
    netProfit: "صافي الربح",
    approvalsWaiting: "بانتظار اعتمادك",
    recentActivity: "آخر الحركات",
    asOf: "حتى",
  },
  customer: {
    title: "بيانات العميل",
    creditLimit: "الحد الائتماني",
    paymentTerms: "مدة السداد (يوم)",
    currency: "العملة",
    phone: "الهاتف",
    taxNumber: "الرقم الضريبي",
  },
  tabs: {
    home: "الرئيسية",
    customers: "العملاء",
    sell: "بيع",
    stock: "المخزون",
    more: "المزيد",
  },
  picker: {
    search: "بحث",
    empty: "لا توجد نتائج",
    searchHint: "اكتب حرفين على الأقل للبحث",
  },
  sell: {
    title: "بيع",
    documentType: "نوع المستند",
    kindQuote: "عرض سعر",
    kindInvoice: "فاتورة",
    customer: "العميل",
    customerPlaceholder: "اختر عميلًا",
    branch: "الفرع",
    branchPlaceholder: "اختر فرعًا",
    warehouse: "المستودع",
    warehousePlaceholder: "اختر مستودعًا",
    date: "التاريخ",
    dueDate: "تاريخ الاستحقاق",
    expiryDate: "تاريخ انتهاء العرض",
    lines: "الأصناف",
    addLine: "إضافة صنف",
    removeLine: "حذف",
    item: "الصنف",
    itemPlaceholder: "اختر صنفًا",
    qty: "الكمية",
    unitPrice: "السعر",
    notes: "ملاحظات",
    submitQuote: "إنشاء عرض السعر",
    submitInvoice: "إنشاء الفاتورة وتأكيدها",
    submitting: "جارٍ الحفظ…",
    quoteCreated: "تم إنشاء عرض السعر",
    invoiceCreated: "تم إنشاء الفاتورة وتأكيدها",
    noPermission: "لا تملك صلاحية إنشاء مستندات البيع.",
    customerRequired: "اختر عميلًا أولًا.",
    locationRequired: "اختر الفرع والمستودع أولًا.",
    lineIncomplete: "أكمل بيانات كل صنف: الصنف والكمية والسعر.",
  },
  collect: {
    title: "تحصيل",
    customer: "العميل",
    customerPlaceholder: "اختر عميلًا",
    invoice: "الفاتورة",
    invoicePlaceholder: "اختر فاتورة مفتوحة",
    invoiceEmpty: "لا توجد فواتير مفتوحة لهذا العميل",
    amount: "المبلغ",
    paymentMethod: "طريقة الدفع",
    cash: "نقدًا",
    cheque: "شيك",
    treasuryAccount: "حساب الخزينة",
    treasuryAccountPlaceholder: "اختر حساب خزينة",
    branch: "الفرع",
    referenceNo: "رقم مرجعي (رقم الشيك مثلًا)",
    submit: "تسجيل التحصيل",
    submitting: "جارٍ التسجيل…",
    success: "تم تسجيل التحصيل وتخصيصه على الفاتورة",
    noPermission: "لا تملك صلاحية تسجيل سندات التحصيل.",
    missingGlAccount: "حساب الخزينة المختار غير مربوط بحساب دفتر أستاذ؛ راجع الإعدادات على سطح المكتب.",
    invoiceRequired: "اختر عميلًا ثم فاتورة مفتوحة له.",
    detailsRequired: "أكمل الفرع وحساب الخزينة والمبلغ.",
  },
  stock: {
    title: "المخزون",
    search: "ابحث بالاسم أو الكود أو الباركود",
    scan: "مسح الباركود",
    closeScan: "إغلاق الماسح",
    cameraPermission: "تحتاج إذن الكاميرا لمسح الباركود.",
    grantPermission: "السماح باستخدام الكاميرا",
    onHand: "الرصيد",
    reserved: "محجوز",
    available: "المتاح",
    warehouse: "المستودع",
    noResults: "لا توجد أصناف مطابقة",
    noPermission: "لا تملك صلاحية عرض أرصدة المخزون.",
    searchHint: "اكتب حرفين على الأقل أو امسح الباركود",
  },
  clock: {
    title: "حضوري",
    clockIn: "تسجيل حضور",
    clockOut: "تسجيل انصراف",
    dayComplete: "اكتمل يوم اليوم",
    working: "جارٍ التسجيل…",
    notLinked: "حسابك غير مرتبط بسجل موظف.",
    needsSelfie: "يتطلب صورة",
    needsBiometric: "يتطلب بصمة معتمدة",
    takeSelfie: "التقاط صورة",
    retake: "إعادة الالتقاط",
    biometricBlocked:
      "سجلك يشترط بصمة مسجّلة من متصفح الويب (WebAuthn). لا يستطيع هذا التطبيق حاليًا إنتاج نفس الإثبات المشفّر — بصمة الهاتف تفتح الهاتف نفسه فقط ولا تصل إلى الخادم. سجّل حضورك من صفحة الحضور على الويب.",
    punchedIn: "تم تسجيل الحضور",
    punchedOut: "تم تسجيل الانصراف",
    clockedInAt: "الحضور",
    clockedOutAt: "الانصراف",
    noPermission: "لا تملك صلاحية تسجيل الحضور من هنا.",
    serverTime: "بتوقيت الخادم",
    cameraPermission: "تحتاج إذن الكاميرا لالتقاط صورة الحضور.",
  },
  approvals: {
    title: "الموافقات",
    approve: "موافقة",
    reject: "رفض",
    reason: "سبب الرفض",
    reasonPlaceholder: "اكتب سبب الرفض",
    reasonRequired: "سبب الرفض مطلوب.",
    confirmReject: "تأكيد الرفض",
    empty: "لا توجد طلبات بانتظارك",
    step: "الخطوة",
    noPermission: "لا تملك صلاحية عرض الموافقات.",
    submittedBy: "مُقدَّم من",
  },
  more: {
    title: "المزيد",
    collect: "تحصيل",
    collectSubtitle: "سند تحصيل من عميل مقابل فاتورة",
    clock: "حضوري",
    clockSubtitle: "تسجيل حضور أو انصراف",
    approvals: "الموافقات",
    approvalsSubtitle: "الطلبات بانتظار اعتمادك",
  },
  common: {
    retry: "إعادة المحاولة",
    signOut: "تسجيل الخروج",
    empty: "لا توجد بيانات",
    loading: "جارٍ التحميل…",
    offline: "لا يوجد اتصال — هذه آخر أرقام وصلت",
    offlineWrite: "لا يوجد اتصال. لا يمكن حفظ مستند بدون اتصال بالخادم.",
    search: "بحث",
    cancel: "إلغاء",
    save: "حفظ",
    confirm: "تأكيد",
  },
  errors: {
    network: "تعذّر الوصول إلى الخادم. تحقّق من الاتصال ومن عنوان الخادم.",
    unauthorized: "بيانات الدخول غير صحيحة.",
    forbidden: "لا تملك صلاحية هذا الإجراء.",
    server: "حدث خطأ في الخادم.",
    unexpectedShape: "رد الخادم بشكل غير متوقّع. حدّث التطبيق أو راجع إصدار الخادم.",
  },
};

const EN: Strings = {
  appName: "Mezan",
  signIn: {
    title: "Sign in",
    subtitle: "Use the same account you use on the desktop",
    serverLabel: "Server address",
    serverHint: "Leave as it is unless you were told otherwise",
    tenantLabel: "Company code",
    tenantHint: "The code your company opens with on the cloud edition",
    emailLabel: "Email",
    pinLabel: "PIN (6 digits)",
    submit: "Sign in",
    submitting: "Signing in…",
    unlockWithBiometrics: "Unlock with the device",
    unlockPrompt: "Confirm it is you to open Mezan",
    signedOut: "The session ended. Sign in again.",
  },
  home: {
    title: "Overview",
    cash: "Cash on hand",
    bank: "Bank balances",
    receivables: "Receivables",
    payables: "Payables",
    netProfit: "Net profit",
    approvalsWaiting: "Waiting on you",
    recentActivity: "Recent activity",
    asOf: "as of",
  },
  customer: {
    title: "Customer",
    creditLimit: "Credit limit",
    paymentTerms: "Payment terms (days)",
    currency: "Currency",
    phone: "Phone",
    taxNumber: "Tax number",
  },
  tabs: {
    home: "Home",
    customers: "Customers",
    sell: "Sell",
    stock: "Stock",
    more: "More",
  },
  picker: {
    search: "Search",
    empty: "No results",
    searchHint: "Type at least two characters to search",
  },
  sell: {
    title: "Sell",
    documentType: "Document type",
    kindQuote: "Quote",
    kindInvoice: "Invoice",
    customer: "Customer",
    customerPlaceholder: "Choose a customer",
    branch: "Branch",
    branchPlaceholder: "Choose a branch",
    warehouse: "Warehouse",
    warehousePlaceholder: "Choose a warehouse",
    date: "Date",
    dueDate: "Due date",
    expiryDate: "Expiry date",
    lines: "Lines",
    addLine: "Add a line",
    removeLine: "Remove",
    item: "Item",
    itemPlaceholder: "Choose an item",
    qty: "Qty",
    unitPrice: "Price",
    notes: "Notes",
    submitQuote: "Create quote",
    submitInvoice: "Create and confirm invoice",
    submitting: "Saving…",
    quoteCreated: "Quote created",
    invoiceCreated: "Invoice created and confirmed",
    noPermission: "You do not hold the right to create sales documents.",
    customerRequired: "Choose a customer first.",
    locationRequired: "Choose the branch and warehouse first.",
    lineIncomplete: "Complete every line: item, quantity and price.",
  },
  collect: {
    title: "Collect",
    customer: "Customer",
    customerPlaceholder: "Choose a customer",
    invoice: "Invoice",
    invoicePlaceholder: "Choose an open invoice",
    invoiceEmpty: "No open invoices for this customer",
    amount: "Amount",
    paymentMethod: "Payment method",
    cash: "Cash",
    cheque: "Cheque",
    treasuryAccount: "Treasury account",
    treasuryAccountPlaceholder: "Choose a treasury account",
    branch: "Branch",
    referenceNo: "Reference (e.g. cheque number)",
    submit: "Record collection",
    submitting: "Recording…",
    success: "Collection recorded and allocated to the invoice",
    noPermission: "You do not hold the right to record collection vouchers.",
    missingGlAccount: "The chosen treasury account has no ledger account linked; check the desktop settings.",
    invoiceRequired: "Choose a customer, then one of their open invoices.",
    detailsRequired: "Complete the branch, the treasury account and the amount.",
  },
  stock: {
    title: "Stock",
    search: "Search by name, code or barcode",
    scan: "Scan barcode",
    closeScan: "Close scanner",
    cameraPermission: "Camera access is needed to scan a barcode.",
    grantPermission: "Allow camera access",
    onHand: "On hand",
    reserved: "Reserved",
    available: "Available",
    warehouse: "Warehouse",
    noResults: "No matching items",
    noPermission: "You do not hold the right to view stock balances.",
    searchHint: "Type at least two characters, or scan a barcode",
  },
  clock: {
    title: "Clock",
    clockIn: "Clock in",
    clockOut: "Clock out",
    dayComplete: "Today is complete",
    working: "Recording…",
    notLinked: "Your account is not linked to an employee record.",
    needsSelfie: "Needs a selfie",
    needsBiometric: "Needs a registered biometric",
    takeSelfie: "Take a selfie",
    retake: "Retake",
    biometricBlocked:
      "Your record requires a biometric credential registered through the web (WebAuthn). This app cannot currently produce that same cryptographic proof — the phone's own fingerprint/Face unlock only unlocks the phone itself and never reaches the server. Clock in from the web attendance page instead.",
    punchedIn: "Clocked in",
    punchedOut: "Clocked out",
    clockedInAt: "In",
    clockedOutAt: "Out",
    noPermission: "You do not hold the right to clock in from here.",
    serverTime: "server time",
    cameraPermission: "Camera access is needed to take the attendance photo.",
  },
  approvals: {
    title: "Approvals",
    approve: "Approve",
    reject: "Refuse",
    reason: "Reason for refusal",
    reasonPlaceholder: "Write the reason for refusing",
    reasonRequired: "A reason is required.",
    confirmReject: "Confirm refusal",
    empty: "Nothing is waiting on you",
    step: "Step",
    noPermission: "You do not hold the right to view approvals.",
    submittedBy: "Submitted by",
  },
  more: {
    title: "More",
    collect: "Collect",
    collectSubtitle: "A collection voucher against an invoice",
    clock: "Clock",
    clockSubtitle: "Clock in or out",
    approvals: "Approvals",
    approvalsSubtitle: "The requests waiting on you",
  },
  common: {
    retry: "Try again",
    signOut: "Sign out",
    empty: "Nothing here",
    loading: "Loading…",
    offline: "Offline — these are the last figures received",
    offlineWrite: "Offline. A document cannot be saved without a connection.",
    search: "Search",
    cancel: "Cancel",
    save: "Save",
    confirm: "Confirm",
  },
  errors: {
    network: "The server could not be reached. Check the connection and the server address.",
    unauthorized: "Those sign-in details are not right.",
    forbidden: "You do not hold the right for this action.",
    server: "The server failed.",
    unexpectedShape: "The server answered in an unexpected shape. Update the app or check the server version.",
  },
};

export const STRINGS: Record<Locale, Strings> = {
  [Locale.Ar]: AR,
  [Locale.En]: EN,
};
