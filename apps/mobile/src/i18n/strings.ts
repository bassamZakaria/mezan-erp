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
    readonly salesToday: string;
    readonly approvalsWaiting: string;
    readonly recentActivity: string;
    readonly asOf: string;
  };
  readonly tabs: {
    readonly home: string;
    readonly customers: string;
    readonly sell: string;
    readonly stock: string;
    readonly more: string;
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
    salesToday: "مبيعات اليوم",
    approvalsWaiting: "بانتظار اعتمادك",
    recentActivity: "آخر الحركات",
    asOf: "حتى",
  },
  tabs: {
    home: "الرئيسية",
    customers: "العملاء",
    sell: "بيع",
    stock: "المخزون",
    more: "المزيد",
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
    salesToday: "Sales today",
    approvalsWaiting: "Waiting on you",
    recentActivity: "Recent activity",
    asOf: "as of",
  },
  tabs: {
    home: "Home",
    customers: "Customers",
    sell: "Sell",
    stock: "Stock",
    more: "More",
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
