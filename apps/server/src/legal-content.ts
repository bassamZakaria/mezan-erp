export enum LegalLanguage {
  Arabic = "ar",
  English = "en",
}

export enum LegalPage {
  Privacy = "privacy",
  AccountDeletion = "account-deletion",
}

export enum TextDirection {
  RightToLeft = "rtl",
  LeftToRight = "ltr",
}

export const LEGAL_LAST_UPDATED = "2026-09-21";

export interface LegalSection {
  readonly heading: string;
  readonly paragraphs: readonly string[];
  readonly bullets?: readonly string[];
}

export interface LegalChrome {
  readonly dir: TextDirection;
  readonly draftNotice: string;
  readonly lastUpdated: string;
  readonly otherLanguage: string;
  readonly privacyLink: string;
  readonly deletionLink: string;
  readonly contactHeading: string;
  readonly contactBySupport: (email: string) => string;
  readonly contactNoSupport: string;
}

export interface DeletionFormText {
  readonly heading: string;
  readonly intro: string;
  readonly companyCode: string;
  readonly email: string;
  readonly note: string;
  readonly submit: string;
  readonly receivedTitle: string;
  readonly received: (reference: string) => string;
  readonly invalid: string;
  readonly failed: string;
  readonly tooMany: string;
  readonly back: string;
}

export interface LegalDocument {
  readonly title: string;
  readonly sections: readonly LegalSection[];
}

export const CHROME: Record<LegalLanguage, LegalChrome> = {
  [LegalLanguage.Arabic]: {
    dir: TextDirection.RightToLeft,
    draftNotice: "مسودة — تحتاج مراجعة قانونية. هذا النص لم يراجعه محامٍ بعد وليس نسخته النهائية.",
    lastUpdated: "آخر تحديث",
    otherLanguage: "English",
    privacyLink: "سياسة الخصوصية",
    deletionLink: "طلب حذف الحساب",
    contactHeading: "التواصل معنا",
    contactBySupport: (email) => `لأي سؤال عن هذه السياسة أو عن بياناتك راسلنا على ${email}.`,
    contactNoSupport: "لأي سؤال عن هذه السياسة أو عن بياناتك تواصل مع مسؤول النظام في شركتك، وهو من أنشأ حسابك.",
  },
  [LegalLanguage.English]: {
    dir: TextDirection.LeftToRight,
    draftNotice: "Draft — needs legal review. This text has not yet been reviewed by a lawyer and is not final.",
    lastUpdated: "Last updated",
    otherLanguage: "العربية",
    privacyLink: "Privacy policy",
    deletionLink: "Request account deletion",
    contactHeading: "Contact us",
    contactBySupport: (email) => `For any question about this policy or your data, write to ${email}.`,
    contactNoSupport: "For any question about this policy or your data, contact your company's administrator, who created your account.",
  },
};

export const PRIVACY: Record<LegalLanguage, LegalDocument> = {
  [LegalLanguage.Arabic]: {
    title: "سياسة الخصوصية — ميزان",
    sections: [
      {
        heading: "من نحن",
        paragraphs: [
          "ميزان برنامج محاسبة وإدارة موارد للمنشآت (ERP) تشغّله سياج (Cyag). تطبيق ميزان على الهاتف يعمل مع حساب ميزان لشركتك، ويُباع للشركات لا للأفراد.",
          "لا يمكنك إنشاء حساب من داخل التطبيق: حسابك ينشئه مسؤول النظام في شركتك، ويحدد اسمك وبريدك ودورك وصلاحياتك.",
        ],
      },
      {
        heading: "دورنا ودور شركتك",
        paragraphs: [
          "شركتك هي التي تقرر ما يُسجَّل في ميزان من سجلات تجارية وبيانات موظفين ولأي غرض. نحن نخزّن هذه البيانات ونعالجها نيابةً عنها لتشغيل الخدمة فقط.",
        ],
      },
      {
        heading: "ما نجمعه عبر التطبيق ولماذا",
        paragraphs: ["هذه هي البيانات الوحيدة التي يتبادلها التطبيق مع خادم ميزان، وكلها لتشغيل الخدمة:"],
        bullets: [
          "بيانات الدخول: كود المنشأة وبريدك الإلكتروني والرقم السري المكوّن من ستة أرقام، لتسجيل دخولك. لا نخزّن الرقم السري نفسه، بل بصمة مشفّرة (hash) لا يمكن استرجاعه منها.",
          "ملفك في الحساب: اسمك وبريدك ودورك وصلاحياتك والفروع والمستودعات المسموح لك بها، كما يسجلها مسؤول النظام في شركتك. يعرضها التطبيق ليحدد ما يمكنك فعله.",
          "صورة تسجيل الحضور: إن كانت شركتك تشترط صورة عند تسجيل الحضور أو الانصراف، يلتقط التطبيق صورة بالكاميرا الأمامية حين تضغط زر الالتقاط فقط، ويرسلها مع وقت التسجيل. تُحفظ ضمن سجل الحضور لدى شركتك دليلاً على الحضور.",
          "أوقات الحضور والانصراف: تُسجَّل بتوقيت الخادم لا بتوقيت هاتفك.",
          "السجلات التجارية التي تدخلها: فواتير البيع (فاتورة مبيعات) وعروض الأسعار وسندات التحصيل (سند قبض) وقرارات الموافقة، وعمليات البحث عن العملاء والأصناف. وتشمل بيانات عملاء شركتك مثل أسمائهم وأرقام هواتفهم وفواتيرهم المفتوحة.",
          "سجلات الأمان: يسجل الخادم عمليات الدخول الناجحة والفاشلة والإجراءات الحساسة مع الحساب والوقت لحماية الحسابات. وتحتفظ خدمة الاستضافة بسجلات الطلبات، ومنها عنوان IP، لمدة أقصاها 14 يوماً.",
        ],
      },
      {
        heading: "ما لا يغادر هاتفك",
        paragraphs: [],
        bullets: [
          "قراءة الباركود: تقرأ الكاميرا الباركود على هاتفك نفسه، ولا تُحفظ صورة ولا تُرسل؛ يُستخدم رقم الباركود فقط للبحث عن الصنف.",
          "بصمة الوجه أو الإصبع (Face ID أو بصمة الإصبع): إن استخدمتها لفتح التطبيق، فالتحقق يقوم به نظام تشغيل هاتفك بالكامل. يتلقى التطبيق نتيجة نجاح أو فشل فقط، ولا تغادر بياناتك البيومترية هاتفك ولا نتلقاها أبداً.",
          "رمز الجلسة: يُحفظ في المخزن الآمن لهاتفك (Keychain على iOS وKeystore على Android).",
          "بيانات الاتصال والملف: عنوان الخادم وكود المنشأة وبريدك وملفك في الحساب تُحفظ في ذاكرة التطبيق حتى لا تعيد كتابتها.",
          "نسخة مؤقتة مما عرضته: يحتفظ التطبيق بنسخة من البيانات التي عرضتها مؤخراً (مثل أرقام لوحة المتابعة وقائمة العملاء) لمدة أقصاها سبعة أيام ليعرضها دون اتصال. تسجيل الخروج يمسح الجلسة وهذه النسخة.",
        ],
      },
      {
        heading: "ما لا نفعله",
        paragraphs: [],
        bullets: [
          "لا إعلانات، ولا تتبّع لك عبر تطبيقات أو مواقع أخرى، ولا بيع لبياناتك.",
          "لا يحتوي التطبيق على أي أداة تحليلات أو تقارير أعطال من طرف ثالث.",
          "لا يجمع التطبيق موقعك الجغرافي ولا جهات اتصالك ولا صورك المحفوظة.",
        ],
      },
      {
        heading: "من يطّلع على البيانات",
        paragraphs: [],
        bullets: [
          "المستخدمون المصرّح لهم في شركتك، في حدود الصلاحيات التي يحددها مسؤول النظام.",
          "مزوّد الاستضافة الذي يخزّن البيانات نيابةً عنا: أمازون ويب سيرفسز (AWS) في الاتحاد الأوروبي (فرانكفورت، ألمانيا).",
          "الجهات الرسمية حين يلزمنا القانون بذلك.",
        ],
      },
      {
        heading: "حماية البيانات",
        paragraphs: [
          "كل اتصال بين التطبيق والخادم مشفّر (HTTPS). أقراص التخزين والنسخ الاحتياطية مشفّرة. والوصول إلى البيانات داخل الشركة محكوم بالأدوار والصلاحيات.",
        ],
      },
      {
        heading: "مدة الاحتفاظ",
        paragraphs: [
          "نحتفظ بحسابك وبسجلات شركتك ما دامت شركتك تستخدم ميزان. صور الحضور وأوقاته جزء من سجلات الحضور لدى شركتك وتبقى حتى تحذفها شركتك أو تطلب حذفها.",
          "المستندات المحاسبية (الفواتير والسندات والقيود اليومية) سجلات شركتك، وقد يلزمها القانون بالاحتفاظ بها مدة محددة. البيانات المحذوفة قد تبقى في النسخ الاحتياطية المشفّرة حتى انتهاء صلاحيتها.",
        ],
      },
      {
        heading: "حقوقك واختياراتك",
        paragraphs: [
          "يمكنك أن تطلب الاطلاع على بياناتك أو تصحيحها من مسؤول النظام في شركتك. ويمكنك طلب حذف حسابك من صفحة «طلب حذف الحساب». ويمكنك سحب إذن الكاميرا أو بصمة الوجه في أي وقت من إعدادات هاتفك.",
          "نتعامل مع بياناتك وفق القانون المطبّق، ومنه قانون حماية البيانات الشخصية المصري رقم 151 لسنة 2020.",
        ],
      },
      {
        heading: "الأطفال",
        paragraphs: ["ميزان مخصص للمنشآت وموظفيها، وليس موجهاً لمن هم دون الثامنة عشرة."],
      },
      {
        heading: "التغييرات على هذه السياسة",
        paragraphs: ["إن غيّرنا هذه السياسة سننشر النسخة الجديدة على هذه الصفحة ونحدّث تاريخ آخر تحديث."],
      },
    ],
  },
  [LegalLanguage.English]: {
    title: "Privacy policy — Mezan",
    sections: [
      {
        heading: "Who we are",
        paragraphs: [
          "Mezan is accounting and business-management (ERP) software operated by Cyag. The Mezan phone app works with your company's Mezan account, and Mezan is sold to companies, not to individuals.",
          "You cannot create an account inside the app: your account is created by your company's administrator, who sets your name, email, role and permissions.",
        ],
      },
      {
        heading: "Our role and your company's",
        paragraphs: [
          "Your company decides which business records and staff details are kept in Mezan, and why. We store and process that data on its behalf, only to run the service.",
        ],
      },
      {
        heading: "What we collect through the app, and why",
        paragraphs: ["This is the only data the app exchanges with the Mezan server, all of it to run the service:"],
        bullets: [
          "Sign-in details: the company code, your email address and your six-digit PIN, to sign you in. We never store the PIN itself, only a one-way hash it cannot be recovered from.",
          "Your account profile: your name, email, role, permissions, and the branches and warehouses you may use, as your company's administrator records them. The app displays them and uses them to decide what you can do.",
          "Clock-in photo: if your company requires a photo when you clock in or out, the app takes one with the front camera only when you tap the capture button, and sends it with the time of the punch. It is kept in your company's attendance records as evidence of attendance.",
          "Clock-in and clock-out times: stamped with the server's clock, not your phone's.",
          "Business records you enter: sales invoices, quotations, collection vouchers, approval decisions, and customer and item look-ups. These include details of your company's customers, such as their names, phone numbers and open invoices.",
          "Security records: the server records successful and failed sign-ins and sensitive actions, with the account and the time, to protect accounts. Our hosting provider keeps request logs, including the IP address, for up to 14 days.",
        ],
      },
      {
        heading: "What never leaves your phone",
        paragraphs: [],
        bullets: [
          "Barcode scanning: the camera reads the barcode on the phone itself. No image is kept or sent; only the barcode's number is used to look the item up.",
          "Face ID or fingerprint: if you use it to unlock the app, the check is done entirely by your phone's operating system. The app receives only a yes or a no; your biometric data never leaves the phone and we never receive it.",
          "Session token: kept in the phone's secure store (the iOS Keychain or the Android Keystore).",
          "Connection details and profile: the server address, company code, your email and your account profile are kept in the app's storage so you need not retype them.",
          "A temporary copy of what you viewed: the app keeps a copy of recently viewed data (such as dashboard figures and the customer list) for up to seven days, so it can show it without a connection. Signing out erases the session and this copy.",
        ],
      },
      {
        heading: "What we do not do",
        paragraphs: [],
        bullets: [
          "No advertising, no tracking of you across other apps or websites, and no sale of your data.",
          "The app contains no third-party analytics or crash-reporting tool.",
          "The app does not collect your location, your contacts or your saved photos.",
        ],
      },
      {
        heading: "Who can see the data",
        paragraphs: [],
        bullets: [
          "Authorised users in your company, within the permissions your administrator sets.",
          "The hosting provider that stores the data on our behalf: Amazon Web Services (AWS), in the European Union (Frankfurt, Germany).",
          "Public authorities, where the law requires us to disclose it.",
        ],
      },
      {
        heading: "How the data is protected",
        paragraphs: [
          "Every connection between the app and the server is encrypted (HTTPS). Storage disks and backups are encrypted. Access inside your company is limited by roles and permissions.",
        ],
      },
      {
        heading: "How long we keep it",
        paragraphs: [
          "We keep your account and your company's records for as long as your company uses Mezan. Clock-in photos and times are part of your company's attendance records and stay until your company deletes them or asks us to.",
          "Accounting documents (invoices, vouchers and journal entries) are your company's records, and the law may require it to keep them for a set period. Deleted data can remain in encrypted backups until those backups expire.",
        ],
      },
      {
        heading: "Your rights and choices",
        paragraphs: [
          "You can ask your company's administrator to show you or correct your data. You can request deletion of your account on the \"Request account deletion\" page. You can withdraw the camera or Face ID permission at any time in your phone's settings.",
          "We handle your data under the applicable law, including Egypt's Personal Data Protection Law No. 151 of 2020.",
        ],
      },
      {
        heading: "Children",
        paragraphs: ["Mezan is for businesses and their staff and is not directed at anyone under 18."],
      },
      {
        heading: "Changes to this policy",
        paragraphs: ["If we change this policy we will publish the new version on this page and update the date it was last updated."],
      },
    ],
  },
};

export const ACCOUNT_DELETION: Record<LegalLanguage, LegalDocument> = {
  [LegalLanguage.Arabic]: {
    title: "طلب حذف حساب ميزان",
    sections: [
      {
        heading: "كيف تُنشأ الحسابات",
        paragraphs: [
          "حسابات ميزان لا يُنشئها المستخدم بنفسه؛ ينشئها مسؤول النظام في الشركة التي تعمل بها. لذلك يمر حذف الحساب بشركتك وبنا معاً.",
        ],
      },
      {
        heading: "كيف تطلب الحذف",
        paragraphs: [],
        bullets: [
          "اطلب من مسؤول النظام في شركتك: يستطيع إيقاف حسابك فوراً من شاشة «المستخدمون» في ميزان، فتنتهي كل جلساتك ولا يمكن الدخول به بعدها.",
        ],
      },
      {
        heading: "ما يُحذف",
        paragraphs: [],
        bullets: [
          "اسمك وبريدك الإلكتروني ورقم هاتفك والرقم السري وصورة الملف الشخصي.",
          "صور تسجيل الحضور المرتبطة بحسابك.",
        ],
      },
      {
        heading: "ما يبقى ولماذا",
        paragraphs: [
          "المستندات التجارية والمحاسبية التي أنشأتها أو اعتمدتها (الفواتير والسندات والقيود اليومية) وأوقات الحضور سجلات تخص شركتك، وقد يلزمها القانون بالاحتفاظ بها. تبقى هذه السجلات مرتبطة برقم حساب لا يدل على شخصك. وقد تبقى نسخ من البيانات المحذوفة في النسخ الاحتياطية المشفّرة حتى انتهاء صلاحيتها.",
        ],
      },
    ],
  },
  [LegalLanguage.English]: {
    title: "Request deletion of your Mezan account",
    sections: [
      {
        heading: "How accounts are created",
        paragraphs: [
          "Mezan accounts are not created by their users: each one is created by the administrator of the company you work for. Deleting one therefore goes through your company and through us.",
        ],
      },
      {
        heading: "How to ask",
        paragraphs: [],
        bullets: [
          "Ask your company's administrator: they can deactivate your account at once from the Users screen in Mezan, which ends every session and stops it from signing in.",
        ],
      },
      {
        heading: "What is deleted",
        paragraphs: [],
        bullets: [
          "Your name, email address, phone number, PIN and profile photo.",
          "The clock-in photos linked to your account.",
        ],
      },
      {
        heading: "What is kept, and why",
        paragraphs: [
          "The business and accounting documents you created or approved (invoices, vouchers and journal entries) and your attendance times are your company's records, which the law may require it to keep. They stay linked to an account number that does not identify you. Copies of deleted data can remain in encrypted backups until those backups expire.",
        ],
      },
    ],
  },
};

export enum DeletionChannel {
  AdministratorOnly = "administrator-only",
  SupportEmail = "support-email",
  FormAndEmail = "form-and-email",
}

export const ASK_US: Record<LegalLanguage, Record<Exclude<DeletionChannel, DeletionChannel.AdministratorOnly>, string>> = {
  [LegalLanguage.Arabic]: {
    [DeletionChannel.SupportEmail]:
      "اطلب منا مباشرة: راسلنا على البريد الإلكتروني المذكور في آخر الصفحة من البريد الذي تدخل به، مع كود المنشأة. نتحقق من الطلب مع شركتك ثم نحذف بياناتك الشخصية ونرد عليك خلال 30 يوماً.",
    [DeletionChannel.FormAndEmail]:
      "اطلب منا مباشرة: عبر النموذج أدناه أو البريد الإلكتروني المذكور في آخر الصفحة. نتحقق من الطلب مع شركتك ثم نحذف بياناتك الشخصية ونرد عليك خلال 30 يوماً.",
  },
  [LegalLanguage.English]: {
    [DeletionChannel.SupportEmail]:
      "Ask us directly: write to the email address at the end of this page from the address you sign in with, giving your company code. We confirm the request with your company, then delete your personal data and reply to you within 30 days.",
    [DeletionChannel.FormAndEmail]:
      "Ask us directly: use the form below or the email address at the end of this page. We confirm the request with your company, then delete your personal data and reply to you within 30 days.",
  },
};

export const DELETION_FORM: Record<LegalLanguage, DeletionFormText> = {
  [LegalLanguage.Arabic]: {
    heading: "نموذج طلب الحذف",
    intro: "أدخل كود المنشأة والبريد الذي تدخل به إلى ميزان. سنراسلك على هذا البريد لتأكيد الطلب.",
    companyCode: "كود المنشأة",
    email: "البريد الإلكتروني للحساب",
    note: "ملاحظة (اختياري)",
    submit: "إرسال الطلب",
    receivedTitle: "وصلنا طلبك",
    received: (reference) => `رقم الطلب: ${reference}. سنتحقق منه مع شركتك ونرد عليك على بريدك خلال 30 يوماً.`,
    invalid: "أدخل كود المنشأة وبريداً إلكترونياً صحيحاً.",
    failed: "تعذّر إرسال الطلب الآن. أعد المحاولة لاحقاً أو راسلنا على البريد المذكور في آخر الصفحة.",
    tooMany: "أرسلت طلبات كثيرة في وقت قصير. أعد المحاولة بعد ساعة.",
    back: "رجوع",
  },
  [LegalLanguage.English]: {
    heading: "Deletion request form",
    intro: "Enter the company code and the email you sign in to Mezan with. We will write to that address to confirm the request.",
    companyCode: "Company code",
    email: "Account email",
    note: "Note (optional)",
    submit: "Send request",
    receivedTitle: "We have your request",
    received: (reference) => `Request number: ${reference}. We will confirm it with your company and reply to your email within 30 days.`,
    invalid: "Enter the company code and a valid email address.",
    failed: "The request could not be sent right now. Try again later, or write to the address at the end of this page.",
    tooMany: "Too many requests in a short time. Try again in an hour.",
    back: "Back",
  },
};
