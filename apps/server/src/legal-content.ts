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

export const LEGAL_LAST_UPDATED = "2026-10-19";

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
        heading: "من نحن ونطاق هذه السياسة",
        paragraphs: [
          "ميزان برنامج محاسبة وإدارة موارد للمنشآت (ERP) تقدّمه شركة سياج (Cyag) [[TODO: الاسم القانوني لشركة سياج ورقم السجل التجاري والعنوان المسجّل]]. ويُباع ميزان للشركات لا للأفراد.",
          "تسري هذه السياسة على نسختين: النسخة السحابية (تطبيق الويب وتطبيق الهاتف)، وفيها تُحفظ بيانات شركتك على خوادمنا؛ ونسخة سطح المكتب، وفيها تبقى دفاتر شركتك على أجهزتها هي.",
          "لا يمكنك إنشاء حساب مستخدم بنفسك: ينشئه مسؤول النظام في شركتك، ويحدد اسمك وبريدك ودورك وصلاحياتك.",
        ],
      },
      {
        heading: "دورنا ودور شركتك",
        paragraphs: [
          "في النسخة السحابية، شركتك هي المتحكم في بياناتها التجارية وبيانات موظفيها وعملائها: هي التي تقرر ما يُسجَّل في ميزان ولأي غرض. ونحن المعالج لهذه البيانات، نخزّنها ونعالجها نيابةً عنها ووفق تعليماتها لتشغيل الخدمة فقط [[TODO: إحالة إلى اتفاقية معالجة البيانات (DPA) الموقّعة مع كل عميل]].",
          "ونحن المتحكم في بيانات الاشتراك والفوترة التي نحتاجها لإدارة علاقتنا بشركتك: بيانات الاشتراك والباقة، واسم مسؤول الفوترة وبريده، وفواتيرنا ومدفوعاتها، وسجلات الأمان على مستوى المنصة.",
          "في نسخة سطح المكتب، الدفاتر وبيانات الموظفين والعملاء محفوظة على جهاز شركتك أو شبكتها المحلية، ولا تصل إلينا. شركتك وحدها مسؤولة عنها وعن نسخها الاحتياطية.",
        ],
      },
      {
        heading: "ما يصلنا من نسخة سطح المكتب",
        paragraphs: ["لا يرسل البرنامج على سطح المكتب أي سجل تجاري إلينا. ما يتصل بنا هو التالي فقط:"],
        bullets: [
          "التحقق الدوري من الترخيص: رقم الترخيص وبصمة الجهاز، وهي قيمة مشتقة بدالة تجزئة (hash) من خصائص الجهاز لا تكشف هذه الخصائص نفسها. ويصلنا عنوان IP بحكم الاتصال.",
          "التحقق من التحديثات: يطلب البرنامج ملف وصف أحدث إصدار من خادم التحديثات [[TODO: اسم الجهة التي تستضيف خادم التحديثات ومكانها]]، فيصل إلى ذلك الخادم عنوان IP ونوع نظام التشغيل.",
          "تقارير الأعطال في نسخة سطح المكتب تُكتب في سجل البرنامج على الجهاز نفسه وتظهر في شاشة «حالة النظام» لديكم، ولا تُرسل إلينا.",
          "إن فعّلت شركتك الفاتورة الإلكترونية أو البريد الإلكتروني، يتصل البرنامج مباشرة بمصلحة الضرائب المصرية أو بمزوّد البريد الذي اختارته شركتك، لا عن طريقنا.",
        ],
      },
      {
        heading: "ما نجمعه في النسخة السحابية ولماذا",
        paragraphs: ["تُحفظ البيانات التالية في قاعدة بيانات شركتك على خوادمنا، لتشغيل الخدمة:"],
        bullets: [
          "بيانات الدخول: كود المنشأة وبريدك الإلكتروني والرقم السري المكوّن من ستة أرقام أو كلمة المرور. لا نخزّن الرقم السري ولا كلمة المرور نفسيهما، بل بصمة مشفّرة (hash) لا يمكن استرجاعهما منها.",
          "ملفك في الحساب: اسمك وبريدك ودورك وصلاحياتك والفروع والمستودعات المسموح لك بها، كما يسجلها مسؤول النظام في شركتك.",
          "بيانات الموارد البشرية التي تسجلها شركتك: اسم الموظف وبيانات الاتصال وتاريخ الميلاد والرقم القومي والعنوان وجهة الاتصال في الطوارئ والحساب البنكي للراتب.",
          "صورة تسجيل الحضور: إن كانت شركتك تشترط صورة عند تسجيل الحضور أو الانصراف، يلتقط التطبيق صورة بالكاميرا الأمامية حين تضغط زر الالتقاط فقط، ويرسلها مع وقت التسجيل. تُحفظ ضمن سجل الحضور لدى شركتك دليلاً على الحضور.",
          "أوقات الحضور والانصراف: تُسجَّل بتوقيت الخادم لا بتوقيت جهازك. وفي تطبيق الويب، إن اخترت أنت مشاركة موقعك عند التسجيل، تُحفظ إحداثيات الموقع مع التسجيل.",
          "مفتاح التحقق البيومتري في تطبيق الويب: إن اشترطت شركتك التحقق بالبصمة عند التسجيل، يحفظ الخادم مفتاحاً عاماً (WebAuthn) فقط. أما البصمة نفسها فيتحقق منها جهازك ولا تصلنا.",
          "السجلات التجارية: الفواتير وعروض الأسعار والسندات والقيود والمخزون وغيرها مما يدخله مستخدمو شركتك، وتشمل بيانات عملاء شركتك وموردّيها مثل أسمائهم وأرقام هواتفهم.",
          "بيانات الفوترة والدفع: اسم مسؤول الفوترة وبريده والباقة والمبلغ. يتم الدفع بالبطاقة على صفحة الدفع المستضافة لدى Paymob، ولا يرى ميزان رقم البطاقة كاملاً ولا يخزّنه.",
          "تقارير الأعطال: إن تعطّل تطبيق الويب أو تطبيق الهاتف، يرسل إلى خادم ميزان الخاص بشركتك نص الخطأ وجزءاً من مسار تتبّعه (stack) والشاشة ورقم إصدار التطبيق، ونوع المتصفح في تطبيق الويب، ورقم المستخدم إن كان مسجّلاً دخوله. لا يتضمن التقرير ما كُتب في النماذج ولا البيانات المحفوظة على الجهاز.",
          "سجلات الأمان والتدقيق: تسجيل الدخول الناجح والفاشل والإجراءات الحساسة مع الحساب والوقت، وسجل تدقيق لكل عملية كتابة.",
          "سجلات تشغيل الخادم: نوع الطلب ومساره ونتيجته ومدته ورقمه ورقم الشركة والمستخدم. لا تتضمن عنوان IP، وتُحجب فيها تلقائياً كلمات المرور والأرقام السرية ورموز الدخول وأرقام الحسابات البنكية (IBAN) وعناوين البريد الإلكتروني. ويُستخدم عنوان IP للحد من المحاولات المتكررة (مثل تسجيل الدخول وطلبات الحذف) ولا يُحتفظ به إلا مدة نافذة الحد.",
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
          "نسخة مؤقتة مما عرضته: يحتفظ التطبيق بنسخة من البيانات التي عرضتها مؤخراً لمدة أقصاها سبعة أيام ليعرضها دون اتصال. تسجيل الخروج يمسح الجلسة وهذه النسخة.",
        ],
      },
      {
        heading: "ما لا نفعله",
        paragraphs: [],
        bullets: [
          "لا إعلانات، ولا تتبّع لك عبر تطبيقات أو مواقع أخرى، ولا بيع لبياناتك.",
          "لا يحتوي تطبيق الهاتف على أي أداة تحليلات أو تقارير أعطال من طرف ثالث؛ تقارير الأعطال الوحيدة هي التي يرسلها إلى خادم ميزان الخاص بشركتك كما سبق.",
          "لا يجمع تطبيق الهاتف موقعك الجغرافي ولا جهات اتصالك ولا صورك المحفوظة.",
          "لا نستخدم بيانات شركتك التجارية لأي غرض غير تشغيل الخدمة لها.",
        ],
      },
      {
        heading: "أغراض المعالجة وأسسها القانونية",
        paragraphs: ["نعالج البيانات وفق قانون حماية البيانات الشخصية المصري رقم 151 لسنة 2020 ولائحته التنفيذية، على الأسس التالية:"],
        bullets: [
          "تنفيذ العقد مع شركتك: تشغيل الخدمة وحفظ الدفاتر وإدارة الحسابات والاشتراك والفوترة.",
          "تعليمات شركتك بصفتها المتحكم: بيانات الموظفين والحضور والعملاء تُعالج للأغراض التي تحددها شركتك وعلى الأساس القانوني الذي تعتمده هي.",
          "المصلحة المشروعة: حماية الحسابات ومنع الاحتيال وإصلاح الأعطال وتأمين الخدمة.",
          "الالتزام القانوني: الاحتفاظ بفواتيرنا وسجلاتنا المالية، والاستجابة لطلبات الجهات المختصة.",
          "الموافقة: مشاركة موقعك عند تسجيل الحضور على الويب، وإذن الكاميرا والبصمة على جهازك، ويمكنك سحبها في أي وقت.",
          "[[TODO: مراجعة قانونية لتطابق كل أساس مع المادة المقابلة في القانون 151 لسنة 2020 ولائحته التنفيذية]]",
        ],
      },
      {
        heading: "أين تُحفظ البيانات ونقلها خارج مصر",
        paragraphs: [
          "تُستضاف النسخة السحابية لدى شركة Contabo GmbH على خوادم في ألمانيا داخل الاتحاد الأوروبي (نورنبرغ أو ميونخ) [[TODO: تأكيد مركز البيانات الذي حُجز فيه الخادم]]، وتُحفظ النسخ الاحتياطية في خدمة التخزين Contabo Object Storage في الاتحاد الأوروبي.",
          "يعني ذلك نقل البيانات من مصر إلى ألمانيا. ونحمي هذا النقل بأن الدولة المستقبِلة تطبّق اللائحة الأوروبية العامة لحماية البيانات (GDPR)، وبعقد معالجة بيانات مع Contabo [[TODO: تأكيد توقيع اتفاقية معالجة البيانات مع Contabo]]، وبالتشفير وضوابط الوصول المذكورة أدناه.",
          "[[TODO: ترخيص النقل عبر الحدود من مركز حماية البيانات الشخصية وفق القانون 151 لسنة 2020 قيد الاستخراج — أدرج رقم الترخيص وتاريخه، أو صياغة يعتمدها المحامي، قبل النشر]]",
        ],
      },
      {
        heading: "من يطّلع على البيانات",
        paragraphs: [],
        bullets: [
          "المستخدمون المصرّح لهم في شركتك، في حدود الصلاحيات التي يحددها مسؤول النظام.",
          "عدد محدود من فريقنا عند الحاجة لتشغيل الخدمة أو الدعم الفني أو استعادة نسخة احتياطية.",
          "مقدّمو الخدمات (المعالجون الفرعيون) المذكورون في القسم التالي، كلٌّ في حدود دوره.",
          "مصلحة الضرائب المصرية، إن فعّلت شركتك الفاتورة أو الإيصال الإلكتروني، فتُرسل إليها الفواتير بتعليمات شركتك.",
          "الجهات الرسمية حين يلزمنا القانون بذلك.",
        ],
      },
      {
        heading: "المعالجون الفرعيون",
        paragraphs: [],
        bullets: [
          "Contabo GmbH (ألمانيا): استضافة الخوادم والتخزين الاحتياطي (Object Storage).",
          "Paymob (مصر): الدفع بالبطاقة عبر صفحة دفع مستضافة لديها. تتلقى اسم مسؤول الفوترة وبريده والمبلغ، وبيانات البطاقة التي تدخلها على صفحتها.",
          "مزوّد البريد الإلكتروني للمعاملات [[TODO: اسم المزوّد ودولته]]: إرسال رسائل التسجيل وروابط فتح الحساب والتنبيهات. يتلقى عنوان المستلم ونص الرسالة.",
          "خدمة مراقبة التشغيل [[TODO: UptimeRobot أو غيرها — الاسم والدولة]]: تتحقق من أن الخادم يعمل، ونرسل إليها إشارة بعد كل نسخة احتياطية ناجحة. لا تتلقى بيانات شخصية.",
          "Cloudflare Web Analytics: [[TODO: احذف هذا البند إن لم يُضبط MEZAN_ANALYTICS_TOKEN على الخادم]] إن كان مفعّلاً، تُحمِّل صفحة تطبيق الويب أداة قياس زيارات من Cloudflare تعدّ الزيارات ونوع المتصفح دون ملفات تعريف ارتباط (cookies). لا تُحمَّل في نسخة سطح المكتب.",
          "Render (فرانكفورت، ألمانيا): يستضيف نسخة العرض التجريبي العامة فقط، وهي ببيانات تجريبية تُمحى عند كل إعادة تشغيل، ولا تُحفظ فيها بيانات العملاء.",
        ],
      },
      {
        heading: "حماية البيانات",
        paragraphs: [],
        bullets: [
          "كل اتصال بالخادم مشفّر (HTTPS عبر TLS)، ويُلزم الخادم المتصفحات باستخدام HTTPS دائماً (HSTS).",
          "لكل شركة قاعدة بيانات مستقلة عن غيرها من الشركات.",
          "الأسرار التي تحفظها شركتك في ميزان — مفاتيح توقيع الـ webhook، وكلمات مرور البريد (SMTP)، وبيانات الربط مع مصلحة الضرائب ونقاط البيع — مشفّرة داخل قاعدة البيانات (AES-256-GCM).",
          "النسخ الاحتياطية خارج الخادم تُشفَّر على الخادم قبل رفعها (restic)، ثم تُحفظ في Contabo Object Storage في الاتحاد الأوروبي.",
          "قرص الخادم نفسه غير مشفّر حالياً، وهو في مركز بيانات تديره Contabo. [[TODO: إن فُعّل تشفير القرص (LUKS) فاستبدل هذه الجملة بـ «قرص الخادم مشفّر»]]",
          "الوصول داخل شركتك محكوم بالأدوار والصلاحيات، ولكل عملية كتابة سجل تدقيق يمكن التحقق من سلامته.",
          "سجلات التشغيل تحجب تلقائياً كلمات المرور والأرقام السرية ورموز الدخول وأرقام الحسابات البنكية وعناوين البريد.",
        ],
      },
      {
        heading: "مدة الاحتفاظ",
        paragraphs: [],
        bullets: [
          "بيانات شركتك: نحتفظ بها ما دام اشتراكها قائماً. بعد انتهاء الاشتراك نحتفظ بها [[TODO: عدد الأيام]] يوماً تستطيع شركتك خلالها طلب نسخة كاملة من دفاترها، ثم نحذفها [[TODO: الحذف بعد انتهاء الاشتراك غير مؤتمت بعد — تأكيد الإجراء]].",
          "الالتزامات القانونية بالاحتفاظ بالدفاتر والمستندات، ومنها ما يفرضه قانون الضرائب والقانون التجاري في مصر، تقع على شركتك. لذلك احرص على تنزيل نسختك قبل نهاية المهلة.",
          "حذف مستخدم: عند محو بيانات مستخدم تُزال بياناته الشخصية (الاسم والبريد والهاتف والرقم السري والصورة والرقم القومي والعنوان والحساب البنكي وصور الحضور ومواقعه ومفاتيح البصمة)، ويبقى حسابه باسم «مستخدم محذوف» لأن المستندات المحاسبية التي أنشأها لا تُعدَّل.",
          "سجلات التشغيل: تُدوَّر حسب الحجم (خمسة ملفات بحد أقصى 20 ميجابايت لكل منها)، فيُكتب الجديد فوق الأقدم. [[TODO: قِس المدة الفعلية التي تغطيها السجلات على الخادم واذكرها بالأيام]]",
          "تقارير الأعطال: يُحتفظ بأحدث 500 تقرير لكل شركة، ويُحذف الأقدم تلقائياً.",
          "النسخ الاحتياطية: على الخادم آخر 12 نسخة لكل شركة. وخارج الخادم نحتفظ بنسخ كل ساعة لمدة 48 ساعة، ويومية لمدة 30 يوماً، وأسبوعية لمدة 12 أسبوعاً، وشهرية لمدة 12 شهراً. لذلك قد تبقى البيانات المحذوفة في النسخ الاحتياطية حتى 12 شهراً، ثم تُحذف.",
        ],
      },
      {
        heading: "حقوقك",
        paragraphs: [
          "يحق لك وفق القانون رقم 151 لسنة 2020: الاطلاع على بياناتك، وتصحيحها، وحذفها، والاعتراض على معالجتها أو طلب تقييدها، وسحب موافقتك. ويمكن لشركتك الحصول على بياناتها في صورة قابلة للنقل: بتصدير التقارير، أو بطلب نسخة كاملة مشفّرة من دفاترها.",
          "إن كانت البيانات تخص شركتك التي تعمل بها (مثل بيانات الموظفين والحضور)، فقدّم طلبك إلى مسؤول النظام في شركتك، ونحن نساعدها على الرد. ويمكنك طلب حذف حسابك من صفحة «طلب حذف الحساب». ويمكنك سحب إذن الكاميرا أو البصمة أو الموقع في أي وقت من إعدادات جهازك.",
          "ولك أن تتقدم بشكوى إلى مركز حماية البيانات الشخصية.",
        ],
      },
      {
        heading: "خرق البيانات",
        paragraphs: [
          "إن وقع خرق يمس البيانات الشخصية، نُخطر الشركات المتأثرة ومركز حماية البيانات الشخصية خلال 72 ساعة من علمنا به، ونبيّن ما حدث والبيانات المتأثرة وما اتخذناه من إجراءات. [[TODO: مراجعة قانونية لمدة الإخطار وتوزيع المسؤولية بين المتحكم والمعالج]]",
        ],
      },
      {
        heading: "مسؤول حماية البيانات",
        paragraphs: ["لأي سؤال أو طلب يخص الخصوصية راسل مسؤول حماية البيانات على [[TODO: privacy@<domain>]]."],
      },
      {
        heading: "الأطفال",
        paragraphs: ["ميزان مخصص للمنشآت وموظفيها، وليس موجهاً لمن هم دون الثامنة عشرة."],
      },
      {
        heading: "تاريخ السريان والتغييرات",
        paragraphs: [
          "تسري هذه السياسة من [[TODO: تاريخ السريان عند النشر]].",
          "إن غيّرنا هذه السياسة تغييراً جوهرياً نُبلغ مسؤولي النظام في الشركات بالبريد الإلكتروني قبل سريانه بـ [[TODO: عدد الأيام]] يوماً، وننشر النسخة الجديدة على هذه الصفحة مع تحديث تاريخ آخر تحديث.",
        ],
      },
    ],
  },
  [LegalLanguage.English]: {
    title: "Privacy policy — Mezan",
    sections: [
      {
        heading: "Who we are and what this policy covers",
        paragraphs: [
          "Mezan is accounting and business-management (ERP) software provided by Cyag [[TODO: Cyag's legal name, commercial-register number and registered address]]. Mezan is sold to companies, not to individuals.",
          "This policy covers two editions: the cloud edition (the web app and the phone app), where your company's data is kept on our servers; and the desktop edition, where your company's books stay on its own machines.",
          "You cannot create a user account yourself: your company's administrator creates it and sets your name, email, role and permissions.",
        ],
      },
      {
        heading: "Our role and your company's",
        paragraphs: [
          "In the cloud edition, your company is the controller of its business records and of its staff and customer data: it decides what is kept in Mezan, and why. We are the processor: we store and process that data on its behalf, on its instructions, only to run the service [[TODO: reference the data processing agreement (DPA) signed with each customer]].",
          "We are the controller of the subscription and billing data we need to manage our relationship with your company: the plan and subscription, the billing contact's name and email, our invoices and their payments, and platform-level security records.",
          "In the desktop edition, the books and the staff and customer data are kept on your company's computer or local network and never reach us. Your company alone is responsible for them and for their backups.",
        ],
      },
      {
        heading: "What reaches us from the desktop edition",
        paragraphs: ["The desktop software never sends us a business record. Only the following contacts us:"],
        bullets: [
          "Regular licence check-in: the licence number and a machine fingerprint, which is a one-way hash of the machine's properties and does not reveal those properties. The connection itself shows us the IP address.",
          "Update checks: the software asks the update server [[TODO: who hosts the update server, and where]] for the latest release's description, so that server sees the IP address and the operating system.",
          "Error reports in the desktop edition are written to the software's log on the machine itself and shown on your own System health screen. They are not sent to us.",
          "If your company turns on e-invoicing or email, the software connects directly to the Egyptian Tax Authority or to the mail provider your company chose, not through us.",
        ],
      },
      {
        heading: "What we collect in the cloud edition, and why",
        paragraphs: ["The following data is kept in your company's database on our servers, to run the service:"],
        bullets: [
          "Sign-in details: the company code, your email address and your six-digit PIN or password. We never store the PIN or the password itself, only a one-way hash it cannot be recovered from.",
          "Your account profile: your name, email, role, permissions, and the branches and warehouses you may use, as your company's administrator records them.",
          "HR data your company records: the employee's name, contact details, date of birth, national ID number, address, emergency contact and salary bank account.",
          "Clock-in photo: if your company requires a photo when you clock in or out, the app takes one with the front camera only when you tap the capture button, and sends it with the time of the punch. It is kept in your company's attendance records as evidence of attendance.",
          "Clock-in and clock-out times: stamped with the server's clock, not your device's. In the web app, if you choose to share your location when you clock in, its coordinates are saved with the punch.",
          "Biometric check key in the web app: if your company requires a fingerprint or face check at clock-in, the server keeps only a public key (WebAuthn). Your device checks the fingerprint or face itself; it never reaches us.",
          "Business records: invoices, quotations, vouchers, journal entries, stock and everything else your company's users enter. These include details of your company's customers and suppliers, such as their names and phone numbers.",
          "Billing and payment data: the billing contact's name and email, the plan and the amount. Card payments are made on Paymob's hosted checkout page; Mezan never sees or stores the full card number.",
          "Error reports: if the web app or the phone app crashes, it sends your company's own Mezan server the error message, part of its stack trace, the screen, the app version, the browser type (web app only), and your user number if you are signed in. A report never includes what was typed into forms or data stored on the device.",
          "Security and audit records: successful and failed sign-ins and sensitive actions, with the account and the time, and an audit record of every change.",
          "Server logs: each request's type, path, result, duration and number, and the company and user number. They do not include the IP address, and the logger itself masks passwords, PINs, sign-in tokens, bank account numbers (IBANs) and email addresses. The IP address is used to limit repeated attempts (such as sign-ins and deletion requests) and is kept only for the length of that limit.",
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
          "A temporary copy of what you viewed: the app keeps a copy of recently viewed data for up to seven days, so it can show it without a connection. Signing out erases the session and this copy.",
        ],
      },
      {
        heading: "What we do not do",
        paragraphs: [],
        bullets: [
          "No advertising, no tracking of you across other apps or websites, and no sale of your data.",
          "The phone app contains no third-party analytics or crash-reporting tool. Its only error reports go to your company's own Mezan server, as described above.",
          "The phone app does not collect your location, your contacts or your saved photos.",
          "We never use your company's business records for anything other than running the service for it.",
        ],
      },
      {
        heading: "Why we process data, and on what legal basis",
        paragraphs: ["We process data under Egypt's Personal Data Protection Law No. 151 of 2020 and its executive regulations, on these bases:"],
        bullets: [
          "Performing the contract with your company: running the service, keeping the books, and managing accounts, the subscription and billing.",
          "Your company's instructions, as controller: staff, attendance and customer data are processed for the purposes your company sets, on the legal basis your company relies on.",
          "Legitimate interest: protecting accounts, preventing fraud, fixing faults and keeping the service secure.",
          "Legal obligation: keeping our own invoices and financial records, and answering lawful requests from the authorities.",
          "Consent: sharing your location at web clock-in, and the camera and biometric permissions on your device. You can withdraw these at any time.",
          "[[TODO: legal review to match each basis to the corresponding article of Law 151/2020 and its executive regulations]]",
        ],
      },
      {
        heading: "Where the data is kept, and transfer outside Egypt",
        paragraphs: [
          "The cloud edition is hosted by Contabo GmbH on servers in Germany, in the European Union (Nuremberg or Munich) [[TODO: confirm the data centre the server was ordered in]]. Backups are kept in Contabo Object Storage, also in the European Union.",
          "This means data is transferred from Egypt to Germany. We protect that transfer because the receiving country applies the EU General Data Protection Regulation (GDPR), through a data processing agreement with Contabo [[TODO: confirm the data processing agreement with Contabo is signed]], and through the encryption and access controls described below.",
          "[[TODO: the cross-border transfer licence from the Personal Data Protection Center under Law 151/2020 is being obtained — insert the licence number and date, or wording approved by the lawyer, before publication]]",
        ],
      },
      {
        heading: "Who can see the data",
        paragraphs: [],
        bullets: [
          "Authorised users in your company, within the permissions your administrator sets.",
          "A small number of our staff, when needed to run the service, give technical support or restore a backup.",
          "The service providers (sub-processors) in the next section, each within its own role.",
          "The Egyptian Tax Authority, if your company turns on e-invoicing or e-receipts: invoices are sent to it on your company's instructions.",
          "Public authorities, where the law requires us to disclose it.",
        ],
      },
      {
        heading: "Sub-processors",
        paragraphs: [],
        bullets: [
          "Contabo GmbH (Germany): server hosting and backup storage (Object Storage).",
          "Paymob (Egypt): card payments, on a checkout page Paymob hosts. It receives the billing contact's name and email, the amount, and the card details you enter on its page.",
          "Transactional email provider [[TODO: provider name and country]]: sends sign-up messages, account unlock links and alerts. It receives the recipient's address and the message.",
          "Uptime monitor [[TODO: UptimeRobot or another — name and country]]: checks that the server is up, and receives a signal after each successful backup. It receives no personal data.",
          "Cloudflare Web Analytics: [[TODO: delete this item if MEZAN_ANALYTICS_TOKEN is not set on the server]] when it is turned on, the web app's page loads a Cloudflare visit counter that counts visits and browser types without cookies. It is never loaded in the desktop edition.",
          "Render (Frankfurt, Germany): hosts only the public demo, which runs on sample data wiped at every restart. No customer data is kept there.",
        ],
      },
      {
        heading: "How the data is protected",
        paragraphs: [],
        bullets: [
          "Every connection to the server is encrypted (HTTPS over TLS), and the server tells browsers to always use HTTPS (HSTS).",
          "Each company has its own database, separate from every other company's.",
          "The secrets your company stores in Mezan (webhook signing keys, email (SMTP) passwords, and the Tax Authority and point-of-sale connection keys) are encrypted inside the database (AES-256-GCM).",
          "Backups that leave the server are encrypted on the server before upload (restic), then kept in Contabo Object Storage in the European Union.",
          "The server's own disk is not encrypted at present; it sits in a data centre run by Contabo. [[TODO: if disk encryption (LUKS) is turned on, replace this sentence with \"The server's disk is encrypted.\"]]",
          "Access inside your company is limited by roles and permissions, and every change has an audit record whose integrity can be checked.",
          "Server logs mask passwords, PINs, sign-in tokens, bank account numbers and email addresses automatically.",
        ],
      },
      {
        heading: "How long we keep it",
        paragraphs: [],
        bullets: [
          "Your company's data: kept for as long as its subscription runs. After the subscription ends we keep it for [[TODO: number of days]] days, during which your company can ask for a full copy of its books; then we delete it [[TODO: deletion after termination is not automated yet — confirm the process]].",
          "Any legal duty to keep books and documents, including under Egyptian tax and commercial law, is your company's. Download your copy before that period ends.",
          "Erasing a user: their personal data is removed (name, email, phone, PIN, photo, national ID number, address, bank account, clock-in photos and locations, and biometric check keys). The account stays, named \"Deleted user\", because the accounting documents it created cannot be changed.",
          "Server logs: rotated by size (five files of at most 20 MB each), so the newest entries overwrite the oldest. [[TODO: measure how many days the logs actually cover on the server and state it]]",
          "Error reports: the newest 500 per company are kept; older ones are deleted automatically.",
          "Backups: the server keeps the last 12 copies of each company's data. Off the server we keep hourly copies for 48 hours, daily copies for 30 days, weekly copies for 12 weeks and monthly copies for 12 months. Deleted data can therefore remain in backups for up to 12 months before it is gone.",
        ],
      },
      {
        heading: "Your rights",
        paragraphs: [
          "Under Law No. 151 of 2020 you have the right to see your data, correct it, delete it, object to or restrict its processing, and withdraw your consent. Your company can take its data with it: by exporting reports, or by asking for a full, encrypted copy of its books.",
          "Where the data belongs to the company you work for (such as staff and attendance data), send your request to your company's administrator; we help the company answer. You can request deletion of your account on the \"Request account deletion\" page. You can withdraw the camera, biometric or location permission at any time in your device's settings.",
          "You can also complain to the Personal Data Protection Center.",
        ],
      },
      {
        heading: "Data breaches",
        paragraphs: [
          "If a breach affects personal data, we notify the affected companies and the Personal Data Protection Center within 72 hours of becoming aware of it, saying what happened, which data is affected and what we have done. [[TODO: legal review of the notice period and of how duties split between controller and processor]]",
        ],
      },
      {
        heading: "Data protection officer",
        paragraphs: ["For any privacy question or request, write to our data protection officer at [[TODO: privacy@<domain>]]."],
      },
      {
        heading: "Children",
        paragraphs: ["Mezan is for businesses and their staff and is not directed at anyone under 18."],
      },
      {
        heading: "Effective date and changes",
        paragraphs: [
          "This policy takes effect on [[TODO: effective date on publication]].",
          "If we make a material change, we email company administrators [[TODO: number of days]] days before it takes effect, and publish the new version on this page with an updated date.",
        ],
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
          "اسمك وبريدك الإلكتروني ورقم هاتفك والرقم السري وصورة الملف الشخصي، وبياناتك كموظف مثل الرقم القومي والعنوان والحساب البنكي.",
          "صور تسجيل الحضور ومواقعه ومفاتيح التحقق البيومتري المرتبطة بحسابك.",
        ],
      },
      {
        heading: "ما يبقى ولماذا",
        paragraphs: [
          "المستندات التجارية والمحاسبية التي أنشأتها أو اعتمدتها (الفواتير والسندات والقيود اليومية) وأوقات الحضور سجلات تخص شركتك، وقد يلزمها القانون بالاحتفاظ بها. تبقى هذه السجلات مرتبطة برقم حساب لا يدل على شخصك. وقد تبقى نسخ من البيانات المحذوفة في النسخ الاحتياطية حتى 12 شهراً، ثم تُحذف.",
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
          "Your name, email address, phone number, PIN and profile photo, and your employee details such as national ID number, address and bank account.",
          "The clock-in photos, clock-in locations and biometric check keys linked to your account.",
        ],
      },
      {
        heading: "What is kept, and why",
        paragraphs: [
          "The business and accounting documents you created or approved (invoices, vouchers and journal entries) and your attendance times are your company's records, which the law may require it to keep. They stay linked to an account number that does not identify you. Copies of deleted data can remain in backups for up to 12 months before they are gone.",
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
