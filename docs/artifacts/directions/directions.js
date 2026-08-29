/* ------------------------------------------------------------------
   Figures come from packages/backend/src/demo-seed.ts — no invented data.
   Customers, credit limits, items, prices, treasuries and suppliers are
   the seeded ones, so every direction is judged on the same real content.
   ------------------------------------------------------------------ */
const DATA = {
  customer: { name:"شركة الأمل للتجارة", code:"C-0001", limit:50000, balance:18400, terms:30,
              aging:[{k:"جارٍ",v:11200},{k:"30–60 يوم",v:5300},{k:"أكثر من 60",v:1900}] },
  lines: [
    { name:"سكر أبيض ١ كجم",         code:"IT-0003", qty:40, unit:"كجم",  price:42,  total:1680 },
    { name:"زيت عباد الشمس ١ لتر",   code:"IT-0002", qty:24, unit:"لتر",  price:95,  total:2280 },
    { name:"شاي أسود ٥٠٠ جم",        code:"IT-0004", qty:12, unit:"عبوة", price:260, total:3120 },
    { name:"خليط شاي بالنعناع ١ كجم", code:"IT-0006", qty:8,  unit:"كجم",  price:170, total:1360 },
  ],
  work: [
    { n:7,  t1:"فواتير متأخرة التحصيل",        t2:"أقدمها 64 يوم · شركة الأمل، مجموعة الفجر", b:"تحصيل",       u:true },
    { n:3,  t1:"شيكات تستحق هذا الأسبوع",      t2:"البنك الأهلي — جاري",                      b:"فتح الشيكات", u:true },
    { n:12, t1:"مستندات غير مرحّلة",           t2:"9 فواتير بيع · 3 أذون استلام",             b:"مراجعة",      u:false },
    { n:5,  t1:"أصناف تحت حد إعادة الطلب",     t2:"شاي أسود ٥٠٠ جم، خليط شاي بالنعناع",       b:"أمر شراء",    u:false },
    { n:2,  t1:"موافقات منتظرة",               t2:"خصم فوق الحد · مؤسسة النور للمقاولات",     b:"مراجعة",      u:false },
    { n:1,  t1:"فترة محاسبية بانتظار الإقفال", t2:"يوليو 2026 — قيد واحد غير مرحّل",          b:"الإقفال",     u:false },
  ],
  invoices: [
    { no:"INV-2026-0342", cust:"شركة الأمل للتجارة",     date:"27 أغسطس 2026", due:"خلال 30 يومًا",   dk:"",     tot:9621.60,  st:"مسودة",  k:"mute" },
    { no:"INV-2026-0341", cust:"مؤسسة النور للمقاولات",  date:"26 أغسطس 2026", due:"خلال 44 يومًا",   dk:"",     tot:41250.00, st:"مؤكدة",  k:"ok"   },
    { no:"INV-2026-0339", cust:"مجموعة الفجر التجارية",  date:"22 أغسطس 2026", due:"متأخرة 21 يومًا", dk:"late", tot:7480.00,  st:"متأخرة", k:"bad"  },
    { no:"INV-2026-0337", cust:"شركة الأمل للتجارة",     date:"19 أغسطس 2026", due:"خلال 22 يومًا",   dk:"",     tot:15300.00, st:"مؤكدة",  k:"ok"   },
    { no:"INV-2026-0334", cust:"مؤسسة النور للمقاولات",  date:"14 أغسطس 2026", due:"خلال 32 يومًا",   dk:"",     tot:22940.00, st:"محصّلة", k:"ok"   },
    { no:"INV-2026-0330", cust:"مجموعة الفجر التجارية",  date:"9 أغسطس 2026",  due:"متأخرة 3 أيام",   dk:"late", tot:3120.00,  st:"متأخرة", k:"bad"  },
  ],
  trial: [
    { c:"1100", n:"النقدية بالخزينة",        d:312480.00, k:0, p:0.88 },
    { c:"1120", n:"البنك الأهلي — جاري",     d:186540.25, k:0, p:1.12 },
    { c:"1200", n:"العملاء (حساب مراقب)",    d:186220.00, k:0, p:0.74 },
    { c:"1300", n:"المخزون",                 d:421905.00, k:0, p:0.95 },
    { c:"2100", n:"الموردون (حساب مراقب)",   d:0, k:94750.00, p:1.08 },
    { c:"2300", n:"ضريبة القيمة المضافة",    d:0, k:41182.75, p:0.91 },
    { c:"3100", n:"رأس المال",               d:0, k:800800.00, p:1.00 },
    { c:"4100", n:"إيرادات المبيعات",        d:0, k:214812.50, p:0.82 },
    { c:"5100", n:"تكلفة البضاعة المباعة",   d:44400.00, k:0, p:0.86 },
  ],
  aging: [
    { n:"شركة الأمل للتجارة",     a:11200.00, b:5300.00,  c:1900.00, d:0 },
    { n:"مؤسسة النور للمقاولات",  a:41250.00, b:22940.00, c:0,       d:0 },
    { n:"مجموعة الفجر التجارية",  a:0,        b:3120.00,  c:4360.00, d:2150.00 },
  ],
  coa: [
    { l:1, c:"1000", n:"الأصول",                  v:1107145.25 },
    { l:2, c:"1100", n:"الأصول المتداولة",        v:1107145.25 },
    { l:3, c:"1110", n:"النقدية بالخزينة",        v:312480.00 },
    { l:3, c:"1120", n:"البنك الأهلي — جاري",     v:186540.25 },
    { l:3, c:"1200", n:"العملاء",                 v:186220.00 },
    { l:3, c:"1300", n:"المخزون",                 v:421905.00 },
    { l:1, c:"2000", n:"الخصوم",                  v:135932.75 },
    { l:2, c:"2100", n:"الموردون",                v:94750.00 },
    { l:2, c:"2300", n:"ضرائب مستحقة",            v:41182.75 },
  ],
  tiles: [
    { g:"🧾", n:"فاتورة مبيعات جديدة",         m:"البيع والتحصيل" },
    { g:"💵", n:"سند قبض من عميل",             m:"المالية والإقفال" },
    { g:"📥", n:"استلام بضاعة",                m:"الشراء والتوريد" },
    { g:"🧮", n:"كشف حساب عميل",               m:"البيع والتحصيل" },
    { g:"📦", n:"الرصيد المخزني — كل الفروع",  m:"المخزون والتصنيع" },
    { g:"⚖️", n:"ميزان المراجعة",              m:"المالية والإقفال" },
  ],
};

const n = (v, d=2) => v.toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
const N = (v,d=2) => `<span class="num">${n(v,d)}</span>`;
const I = v => `<span class="num">${v}</span>`;
const dg = s => s.replace(/\d[\d,\.]*/g, m => `<span class="num">${m}</span>`);
const dash = v => v ? N(v) : `<span style="opacity:.3">—</span>`;

/* ---------- shell ---------- */
const shell = (inner, gutter) => `
<div class="app">
  <div class="wsbar">
    <button class="ws" aria-current="true">البيع والتحصيل</button>
    <button class="ws">الشراء والتوريد</button>
    <button class="ws">المخزون والتصنيع</button>
    <button class="ws">المالية والإقفال</button>
    <button class="ws">الأشخاص والأصول</button>
    <button class="ws">الإعداد والصلاحيات</button>
    <div class="sp">
      <button class="cmdk">⌘K &nbsp;ابحث أو نفّذ أمرًا</button>
      <span>الفرع الرئيسي</span>
    </div>
  </div>
  <div class="body">
    <div class="spine">
      <button class="ic" aria-current="true" title="لوحة اليوم">◫</button>
      <button class="ic" title="اختصاراتي">✦</button>
      <button class="ic" title="كل الشاشات">☰</button>
      <button class="ic" title="الموافقات">✓</button>
      <button class="ic" title="التنبيهات">◔</button>
    </div>
    <div class="main">
      <div class="content">${inner}</div>
      ${gutter ? `<aside class="gutter">${gutter}</aside>` : ""}
    </div>
  </div>
</div>`;

const head = (title, sub, acts) => `
  <div class="phead">
    <div><h1>${title}</h1><div class="sub">${sub}</div></div>
    <div class="acts">${acts}</div>
  </div>`;

/* ---------- THE SIGNATURE INSTRUMENT ----------
   Two kinds of truth, one geometry:
     "equal"   — these two must agree (cash close, trial balance, reconciliation)
     "ceiling" — this must not exceed that (credit limit, budget, reorder point)
   A ceiling not yet reached is GOOD news and must never read as a shortfall.  */
const balance = ({label, aName, aVal, bName, bVal, mode="equal", trace=true}) => {
  const diff = aVal - bVal;
  const tilt = Math.max(0, Math.min(100, Math.min(aVal,bVal)/Math.max(aVal,bVal)*100));
  const ok = mode === "ceiling" ? diff >= 0 : Math.abs(diff) < 0.005;
  const say = mode === "ceiling"
    ? (ok ? `ضمن الحد — متبقٍ ${N(diff)} ج.م` : `تجاوز الحد بمقدار ${N(-diff)} ج.م`)
    : (ok ? "متزن" : `ناقص بمقدار ${N(Math.abs(diff))} ج.م`);
  return `
  <div class="bal ${ok?"":"short"}">
    <span class="gt">${label}</span>
    <div class="side"><span>${aName}</span><span class="v">${N(aVal)}</span></div>
    <div class="beam"><i style="inline-size:${tilt}%"></i></div>
    <div class="side"><span>${bName}</span><span class="v">${N(bVal)}</span></div>
    <div class="verdict"><span class="sym">${ok?"⚖":"▲"}</span><span>${say}</span></div>
    ${(!ok && trace)?`<button class="btn sec sm block" style="margin-block-start:10px">أين الفرق؟</button>`:""}
  </div>`;
};

/* ================= 1 · worklist dashboard ================= */
const today = () => shell(
  head("لوحة اليوم", `الخميس ${I(27)} أغسطس ${I(2026)} · الفرع الرئيسي · ترتيب: الأهم أولًا`,
       `<button class="btn sec sm">تخصيص اللوحة</button>
        <button class="btn sec sm">استعادة الوضع الافتراضي</button>
        <button class="btn">فاتورة مبيعات جديدة</button>`) + `
  <div class="strip">
    <div class="f"><div class="k">النقدية اليوم</div><div class="v num">312,480.00</div></div>
    <div class="f"><div class="k">مستحق من العملاء</div><div class="v num">186,220.00</div></div>
    <div class="f"><div class="k">مستحق للموردين</div><div class="v num">94,750.00</div></div>
    <div class="f"><div class="k">قيمة المخزون</div><div class="v num">421,905.00</div></div>
  </div>
  <div class="secbar"><h2>ماذا أفعل الآن؟</h2>
    <span class="rst" style="font-size:11.5px;opacity:.7">اسحب أو استخدم مفاتيح الأسهم لإعادة الترتيب</span></div>
  <div class="wl">
    ${DATA.work.map(w=>`
      <div class="row ${w.u?"urgent":""}">
        <button class="drag" title="نقل">⠿</button>
        <span class="cnt num">${w.n}</span>
        <span class="txt"><div class="t1">${w.t1}</div><div class="t2">${dg(w.t2)}</div></span>
        <button class="btn sec sm">${w.b}</button>
      </div>`).join("")}
  </div>
`, `
  ${balance({label:"تقفيل الخزينة — اليوم", aName:"المتوقع بالدفاتر", aVal:312480, bName:"المعدود فعليًا", bVal:311930})}
  <div style="margin-block-start:24px">
    <span class="gt">الفروع</span>
    <div class="wl">
      <div class="row" style="min-height:44px"><span class="txt"><div class="t1">الفرع الرئيسي</div></span><span style="font-size:12.5px">متزن ✓</span></div>
      <div class="row urgent" style="min-height:44px"><span class="txt"><div class="t1">فرع طنطا</div></span><span style="font-size:12.5px">ناقص <span class="num">550.00</span></span></div>
      <div class="row" style="min-height:44px"><span class="txt"><div class="t1">فرع الجيزة</div></span><span style="font-size:12.5px">متزن ✓</span></div>
    </div>
  </div>
`);

/* ================= 2 · document list ================= */
const list = () => shell(
  head("فواتير المبيعات", `${I(342)} فاتورة · الفرع الرئيسي`,
       `<button class="btn sec">تصدير</button><button class="btn">فاتورة جديدة</button>`) + `
  <div class="moneybar" role="group" aria-label="الحالة بالمبلغ">
    <button class="seg bad" aria-pressed="true"><span class="k">متأخرة</span>
      <span class="v num">10,600.00</span><span class="c"><span class="num">2</span> فواتير</span></button>
    <button class="seg warn"><span class="k">مستحقة قريبًا</span>
      <span class="v num">56,550.00</span><span class="c"><span class="num">2</span> فواتير</span></button>
    <button class="seg mute"><span class="k">مسودات</span>
      <span class="v num">9,621.60</span><span class="c">فاتورة واحدة</span></button>
    <button class="seg ok"><span class="k">محصّلة هذا الشهر</span>
      <span class="v num">22,940.00</span><span class="c">فاتورة واحدة</span></button>
  </div>
  <div class="toolbar">
    <div class="views" role="group" aria-label="قوائم محفوظة">
      <button aria-pressed="true">اللي عليّ أحصّله<span class="n num">7</span></button>
      <button aria-pressed="false">مسودات<span class="n num">12</span></button>
      <button aria-pressed="false">هذا الشهر<span class="n num">48</span></button>
      <button aria-pressed="false">الكل</button>
    </div>
    <div class="search">🔍 ابحث برقم الفاتورة أو اسم العميل…</div>
    <button class="btn sec sm" style="margin-inline-start:auto" title="اختيار الأعمدة">⇄ الأعمدة</button>
  </div>
  <div class="tags">
    <span class="tag">الحالة: متأخرة <button class="x" aria-label="إزالة">✕</button></span>
    <span class="tag">العميل: شركة الأمل للتجارة <button class="x" aria-label="إزالة">✕</button></span>
    <button class="more">+ إضافة عامل تصفية</button>
  </div>
  <div class="bulk">
    <span>محدَّد: <span class="num">3</span> فواتير · الإجمالي <span class="num">28,021.60</span></span>
    <span class="sp"><button class="btn sec sm">طباعة</button><button class="btn sec sm">تحصيل دفعة</button></span>
  </div>
  <table>
    <thead><tr>
      <th style="width:34px"></th><th>الرقم</th><th>العميل</th><th>التاريخ</th>
      <th>الاستحقاق</th><th class="e">الإجمالي</th><th>الحالة</th><th style="width:44px"></th>
    </tr></thead>
    <tbody>
      ${DATA.invoices.map(v=>`<tr>
        <td><span class="cell">☐</span></td>
        <td><span class="cell num">${v.no}</span></td>
        <td><span class="cell">${v.cust}</span></td>
        <td><span class="cell">${dg(v.date)}</span></td>
        <td><span class="cell ${v.dk==='late'?'late':''}">${dg(v.due)}</span></td>
        <td class="e"><span class="cell num">${n(v.tot)}</span></td>
        <td><span class="cell"><span class="chip ${v.k}">${v.st}</span></span></td>
        <td><span class="cell"><button class="rowmenu" aria-label="إجراءات">⋯</button></span></td>
      </tr>`).join("")}
    </tbody>
    <tfoot><tr>
      <td colspan="5"><span class="cell">إجمالي الصفحة</span></td>
      <td class="e"><span class="cell num">${n(DATA.invoices.reduce((s,v)=>s+v.tot,0))}</span></td>
      <td colspan="2"></td>
    </tr></tfoot>
  </table>
  <div class="pager">
    <span>عرض <span class="num">1</span>–<span class="num">6</span> من <span class="num">342</span></span>
    <span class="sp"><button class="btn sec sm">السابق</button><button class="btn sec sm">التالي</button></span>
  </div>
`);

/* ================= 3 · sales invoice (edit) ================= */
const inv = () => {
  const sub = DATA.lines.reduce((s,l)=>s+l.total,0), vat = sub*0.14, tot = sub+vat;
  const after = DATA.customer.balance + tot;
  return shell(
    head("فاتورة مبيعات — مسودة",
         `INV-2026-0342 · ${DATA.customer.name} · استحقاق بعد ${I(DATA.customer.terms)} يوم`,
         `<button class="btn sec">حفظ كمسودة</button><button class="btn">ترحيل الفاتورة</button>`) + `
  <span class="gt">البنود — Tab للتنقل بين الخانات، Enter لسطر جديد</span>
  <table>
    <thead><tr>
      <th style="width:32%">الصنف</th><th>الكود</th><th class="e">الكمية</th><th>الوحدة</th>
      <th class="e">السعر</th><th class="e">الخصم</th><th class="e">الإجمالي</th><th style="width:44px"></th>
    </tr></thead>
    <tbody>
      ${DATA.lines.map(l=>`<tr>
        <td><span class="cell">${l.name}</span></td>
        <td><span class="cell num">${l.code}</span></td>
        <td class="e"><span class="cell num">${n(l.qty,0)}</span></td>
        <td><span class="cell">${l.unit}</span></td>
        <td class="e"><span class="cell num">${n(l.price)}</span></td>
        <td class="e"><span class="cell num">0.00</span></td>
        <td class="e"><span class="cell num">${n(l.total)}</span></td>
        <td><span class="cell"><button class="rowmenu" aria-label="إجراءات السطر">⋯</button></span></td>
      </tr>`).join("")}
      <tr><td colspan="8"><span class="cell" style="opacity:.5">اكتب اسم الصنف أو امسح الباركود…</span></td></tr>
    </tbody>
  </table>
  <div class="strip" style="margin-block-start:18px">
    <div class="f"><div class="k">الإجمالي قبل الضريبة</div><div class="v num">${n(sub)}</div></div>
    <div class="f"><div class="k">ضريبة القيمة المضافة ${I(14)}٪</div><div class="v num">${n(vat)}</div></div>
    <div class="f"><div class="k">الإجمالي المستحق</div><div class="v num">${n(tot)}</div></div>
  </div>
`, `
  <span class="gt">${DATA.customer.name}</span>
  <div style="font-size:12px;opacity:.7;margin-block-end:12px">${DATA.customer.code} · سداد ${I(DATA.customer.terms)} يوم</div>
  ${balance({label:"حد الائتمان — بعد هذه الفاتورة", aName:"الحد المسموح", aVal:DATA.customer.limit,
             bName:"الرصيد بعد الترحيل", bVal:after, mode:"ceiling"})}
  <div style="margin-block-start:20px">
    <span class="gt">أعمار الدين</span>
    ${DATA.customer.aging.map(a=>`
      <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:12.5px">
        <span>${dg(a.k)}</span><span class="num">${n(a.v)}</span></div>`).join("")}
  </div>
  <div style="margin-block-start:16px;display:flex;flex-direction:column;gap:8px">
    <button class="btn sec sm">كشف حساب</button><button class="btn sec sm">سند قبض</button>
  </div>
`);
};

/* ================= 4 · document detail + lifecycle ================= */
const detail = () => shell(
  head("فاتورة مبيعات INV-2026-0341", `مؤسسة النور للمقاولات · ${I(26)} أغسطس ${I(2026)}`,
       `<span class="recpager"><button class="rp" aria-label="السابق">›</button>
          <span><span class="num">2</span> من <span class="num">10</span></span>
          <button class="rp" aria-label="التالي">‹</button></span>
        <button class="btn sec">طباعة</button><button class="btn sec">إشعار خصم</button>
        <button class="btn">تحصيل دفعة</button>`) + `
  <div class="related">
    <button class="rel"><span class="n num">3</span><span class="l">أذون صرف</span></button>
    <button class="rel"><span class="n num">2</span><span class="l">دفعات</span></button>
    <button class="rel"><span class="n num">1</span><span class="l">مرتجع</span></button>
    <button class="rel"><span class="n num">1</span><span class="l">قيد يومية</span></button>
  </div>
  <div class="stepper">
    <span class="st done"><span class="d">✓</span>مسودة</span><span class="sep"></span>
    <span class="st done"><span class="d">✓</span>مؤكدة</span><span class="sep"></span>
    <span class="st now"><span class="d">●</span>مرحّلة للدفاتر</span><span class="sep"></span>
    <span class="st next"><span class="d"></span>محصّلة جزئيًا</span><span class="sep"></span>
    <span class="st next"><span class="d"></span>محصّلة بالكامل</span>
  </div>
  <div class="banner">
    <span>▲</span>
    <div><b>الخطوة التالية: تحصيل دفعة</b>
    كل حالة في دورة حياة المستند لها زر ظاهر ينقلها للتالي. الحالة التي بلا زر طريق مسدود.</div>
  </div>
  <div class="creditbox">
    <div class="ch"><b>لهذا العميل رصيد دائن غير مُطبَّق</b>
      <span>يمكن خصمه من هذه الفاتورة دون مغادرة الشاشة.</span></div>
    ${[["CN-2026-0041","إشعار خصم","18 أغسطس 2026","4,120.00"],
       ["RCP-2026-0180","دفعة مقدمة","10 أغسطس 2026","2,500.00"]]
      .map(c=>`<div class="cr">
        <span class="num">${c[0]}</span><span>${c[1]}</span>
        <span style="color:var(--muted)">${dg(c[2])}</span>
        <span class="num" style="margin-inline-start:auto">${c[3]}</span>
        <button class="btn sec sm">طبّق</button></div>`).join("")}
  </div>

  <div class="secbar"><h2>البنود</h2></div>
  <table>
    <thead><tr><th>الصنف</th><th class="e">الكمية</th><th class="e">السعر</th><th class="e">الإجمالي</th></tr></thead>
    <tbody>
      <tr><td><span class="cell">أرز أبيض ٥ كجم</span></td><td class="e"><span class="cell num">120</span></td>
          <td class="e"><span class="cell num">185.00</span></td><td class="e"><span class="cell num">22,200.00</span></td></tr>
      <tr><td><span class="cell">شاي أسود ٥٠٠ جم</span></td><td class="e"><span class="cell num">50</span></td>
          <td class="e"><span class="cell num">260.00</span></td><td class="e"><span class="cell num">13,000.00</span></td></tr>
    </tbody>
    <tfoot>
      <tr><td colspan="3"><span class="cell">الإجمالي قبل الضريبة</span></td><td class="e"><span class="cell num">35,200.00</span></td></tr>
      <tr><td colspan="3"><span class="cell">ضريبة القيمة المضافة ${I(14)}٪</span></td><td class="e"><span class="cell num">4,928.00</span></td></tr>
      <tr><td colspan="3"><span class="cell">الإجمالي المستحق</span></td><td class="e"><span class="cell num">40,128.00</span></td></tr>
    </tfoot>
  </table>
`, `
  ${balance({label:"القيد المحاسبي لهذه الفاتورة", aName:"مدين", aVal:40128.00, bName:"دائن", bVal:40128.00})}
  <div style="margin-block-start:20px">
    <span class="gt">سجل الحركة</span>
    ${[["أُنشئت كمسودة","26 أغسطس 09:14","هالة منصور"],
       ["أُكِّدت ورُحِّلت","26 أغسطس 09:31","هالة منصور"],
       ["طُبعت","26 أغسطس 09:33","أحمد سيد"]].map(a=>`
      <div style="padding:7px 0;font-size:12px;border-block-end:1px solid var(--line)">
        <div>${a[0]}</div>
        <div style="color:var(--muted);font-size:11.5px">${dg(a[1])} · ${a[2]}</div>
      </div>`).join("")}
  </div>
  <div style="margin-block-start:16px">
    <span class="gt">مرفقات</span>
    <div style="font-size:12.5px;color:var(--muted)">لا مرفقات — <a href="#" style="color:var(--accent)">أضف ملفًا</a></div>
  </div>
`);

/* ================= 5 · trial balance report ================= */
const report = () => {
  const td = DATA.trial.reduce((s,r)=>s+r.d,0), tk = DATA.trial.reduce((s,r)=>s+r.k,0);
  return shell(
    head("ميزان المراجعة", `الفترة: ${I(1)} يناير – ${I(27)} أغسطس ${I(2026)} · كل الفروع`,
         `<button class="btn sec sm" title="حفظ في تقاريري">☆ حفظ</button>
          <button class="btn sec">تصدير Excel</button><button class="btn sec">طباعة</button>
          <button class="btn">تشغيل التقرير</button>`) + `
  <div class="rptbar">
    <label>الفترة
      <span class="ctl">من بداية السنة حتى اليوم <span class="kbd">▾</span></span></label>
    <label>المقارنة
      <span class="ctl">بنفس الفترة من السنة الماضية <span class="kbd">▾</span></span></label>
    <label>الأساس المحاسبي
      <span class="seg2"><button aria-pressed="true">الاستحقاق</button><button>النقدي</button></span></label>
    <label>تقسيم الأعمدة
      <span class="ctl">بلا تقسيم <span class="kbd">▾</span></span></label>
    <span style="margin-inline-start:auto;display:flex;gap:8px">
      <button class="btn sec sm">طيّ الكل</button>
      <button class="btn sec sm">تخصيص التقرير</button>
    </span>
  </div>
  <div class="tags">
    <span class="tag">الفرع: الكل <button class="x" aria-label="إزالة">✕</button></span>
    <span class="tag">تضمين الأرصدة الصفرية: لا <button class="x" aria-label="إزالة">✕</button></span>
    <button class="more">+ إضافة عامل تصفية</button>
  </div>
  <p class="applied">عوامل التصفية المطبَّقة تُطبع مع التقرير: الفرع = الكل · الأرصدة الصفرية = مستبعدة ·
    الأساس = الاستحقاق · المقارنة = ${I(2025)}. من يقرأ الورقة يعرف كيف حُسبت.</p>
  <table>
    <thead><tr><th style="width:34px"></th><th>الحساب</th><th>الاسم</th>
      <th class="e">مدين</th><th class="e">دائن</th>
      <th class="e">${I(2025)} — نفس الفترة</th><th class="e">التغيّر</th></tr></thead>
    <tbody>
      ${DATA.trial.map(r=>{
        const cur = r.d || r.k, prev = cur * r.p, delta = prev ? (cur-prev)/prev*100 : 0;
        return `<tr>
        <td><span class="cell"><button class="tw" aria-label="طيّ">▾</button></span></td>
        <td><span class="cell num">${r.c}</span></td>
        <td><span class="cell">${r.n}</span></td>
        <td class="e"><span class="cell">${r.d?`<button class="drill num">${n(r.d)}</button>`:`<span style="opacity:.3">—</span>`}</span></td>
        <td class="e"><span class="cell">${r.k?`<button class="drill num">${n(r.k)}</button>`:`<span style="opacity:.3">—</span>`}</span></td>
        <td class="e"><span class="cell num" style="color:var(--muted)">${n(prev)}</span></td>
        <td class="e"><span class="cell ${delta>=0?"up":"down"}">${delta>=0?"▲":"▼"}&nbsp;<span class="num">${n(Math.abs(delta),1)}%</span></span></td>
      </tr>`;}).join("")}
    </tbody>
    <tfoot><tr>
      <td colspan="3"><span class="cell">الإجمالي</span></td>
      <td class="e"><span class="cell num">${n(td)}</span></td>
      <td class="e"><span class="cell num">${n(tk)}</span></td>
      <td colspan="2"></td>
    </tr></tfoot>
  </table>
`, `
  ${balance({label:"ميزان المراجعة", aName:"إجمالي المدين", aVal:td, bName:"إجمالي الدائن", bVal:tk})}
  <div style="margin-block-start:18px;font-size:12px;color:var(--muted);line-height:1.8">
    نفس الأداة المستخدمة في تقفيل الخزينة وحد الائتمان والمطابقة البنكية.
  </div>
  <div style="margin-block-start:20px">
    <span class="gt">النزول إلى المصدر</span>
    <p style="font-size:12px;color:var(--muted);line-height:1.8;margin:0 0 10px">
      كل رقم في التقرير زر: يفتح حركات الحساب، ومن الحركة تفتح المستند نفسه.
      لا يوجد رقم لا يمكن تتبّعه إلى مستند.</p>
    <div class="drillpath">
      <span>الرقم في التقرير</span><span class="ar">‹</span>
      <span>حركات الحساب</span><span class="ar">‹</span>
      <span>الفاتورة أو السند</span>
    </div>
  </div>
  <div style="margin-block-start:20px">
    <span class="gt">حزمة إقفال الشهر</span>
    <p style="font-size:12px;color:var(--muted);line-height:1.8;margin:0 0 10px">
      مجموعة تقارير محفوظة تُشغَّل وتُطبع دفعة واحدة.</p>
    <div style="font-size:12.5px">
      ${["ميزان المراجعة","قائمة الدخل","الميزانية","أعمار الديون","إقرار القيمة المضافة"]
        .map(x=>`<div style="padding:5px 0;border-block-end:1px solid var(--line)">${x}</div>`).join("")}
    </div>
    <button class="btn sec sm block" style="margin-block-start:10px">تشغيل الحزمة وطباعتها</button>
  </div>
`);
};

/* ================= 6 · aging matrix ================= */
const aging = () => {
  const col = i => DATA.aging.reduce((s,r)=>s+[r.a,r.b,r.c,r.d][i],0);
  return shell(
    head("أعمار ديون العملاء", `حتى ${I(27)} أغسطس ${I(2026)} · بالجنيه المصري`,
         `<button class="btn sec">تصدير Excel</button><button class="btn">إرسال كشوف الحساب</button>`) + `
  <div class="banner">
    <span>▲</span>
    <div><b>نظام ترقيم واحد فقط</b>
    رؤوس الأعمدة والخلايا تستخدم نفس الأرقام دائمًا. جرّب مفتاح «أرقام عربية» بالأعلى — يتغيّر الاثنان معًا.</div>
  </div>
  <table style="margin-block-start:14px">
    <thead><tr>
      <th>العميل</th><th class="e">جارٍ</th><th class="e">${I(1)}–${I(30)} يوم</th>
      <th class="e">${I(31)}–${I(60)} يوم</th><th class="e">أكثر من ${I(60)}</th><th class="e">الإجمالي</th>
    </tr></thead>
    <tbody>
      ${DATA.aging.map(r=>`<tr>
        <td><span class="cell">${r.n}</span></td>
        <td class="e"><span class="cell">${dash(r.a)}</span></td>
        <td class="e"><span class="cell">${dash(r.b)}</span></td>
        <td class="e"><span class="cell">${dash(r.c)}</span></td>
        <td class="e"><span class="cell" style="color:var(--bad)">${dash(r.d)}</span></td>
        <td class="e"><span class="cell num">${n(r.a+r.b+r.c+r.d)}</span></td>
      </tr>`).join("")}
    </tbody>
    <tfoot><tr>
      <td><span class="cell">الإجمالي</span></td>
      ${[0,1,2,3].map(i=>`<td class="e"><span class="cell num">${n(col(i))}</span></td>`).join("")}
      <td class="e"><span class="cell num">${n([0,1,2,3].reduce((s,i)=>s+col(i),0))}</span></td>
    </tr></tfoot>
  </table>
`, `
  ${balance({label:"مطابقة مع حساب المراقبة", aName:"دفتر العملاء المساعد", aVal:92220.00,
             bName:"حساب ١٢٠٠ بالأستاذ العام", bVal:86733.88})}
  <div style="margin-block-start:18px;font-size:12px;color:var(--muted);line-height:1.8">
    رقمان يجب أن يتطابقا. الفرق هنا حقيقي وله سبب — وهذا بالضبط ما تكشفه الأداة.
  </div>
`);
};

/* ================= 7 · chart of accounts (tree) ================= */
const coa = () => shell(
  head("دليل الحسابات", `${I(268)} حسابًا · ${I(4)} مستويات`,
       `<button class="btn sec">استيراد</button><button class="btn">حساب جديد</button>`) + `
  <div class="toolbar"><div class="search">🔍 ابحث بالكود أو الاسم…</div>
    <button class="btn sec sm">توسيع الكل</button><button class="btn sec sm">طي الكل</button></div>
  <div class="tree">
    ${DATA.coa.map(a=>`
      <div class="tr lvl${a.l}">
        ${a.l<3?`<button class="tw" aria-label="طي">▾</button>`:`<span class="tw"></span>`}
        <span class="code num">${a.c}</span>
        <span class="nm">${a.n}</span>
        <span class="amt num">${n(a.v)}</span>
        <button class="rowmenu" aria-label="إجراءات">⋯</button>
      </div>`).join("")}
  </div>
`, `
  <span class="gt">١٢٠٠ · العملاء</span>
  <div style="font-size:12.5px;color:var(--muted);line-height:1.9;margin-block-end:14px">
    نوع الحساب: أصل متداول<br>حساب مراقب: نعم<br>العملة: ج.م<br>القيد المباشر: ممنوع
  </div>
  ${balance({label:"الحساب المراقب ودفتره المساعد", aName:"رصيد الحساب", aVal:186220.00,
             bName:"مجموع أرصدة العملاء", bVal:186220.00})}
`);

/* ================= 8 · master-data form ================= */
const form = () => shell(
  head("عميل جديد", "بيانات أساسية — تُحفظ في درج قصير، لا في صفحة كاملة",
       `<button class="btn sec">إلغاء</button><button class="btn">حفظ العميل</button>`) + `
  <div class="form">
    <div class="field"><label>اسم العميل <span class="req">*</span></label>
      <div class="in">شركة الأمل للتجارة</div></div>
    <div class="field"><label>الكود</label>
      <div class="in num">C-0004</div><span class="hint">يُولَّد تلقائيًا من التسلسل</span></div>
    <div class="field err"><label>الرقم الضريبي <span class="req">*</span></label>
      <div class="in num">3001122</div>
      <span class="hint">الرقم الضريبي المصري ٩ أرقام. أدخلت ٧.</span></div>
    <div class="field"><label>نوع المشتري (فاتورة إلكترونية) <span class="req">*</span></label>
      <div class="in pick">شركة <span class="kbd">▾</span></div></div>
    <div class="field"><label>مندوب المبيعات</label>
      <div class="in pick ph">اختر مندوبًا… <span class="kbd">⌘K</span></div>
      <span class="hint">قائمة اختيار من الموظفين — لا كتابة حرة.</span></div>
    <div class="field"><label>مدة السداد</label>
      <div class="in"><span><span class="num">30</span>&nbsp;يوم</span></div></div>
    <div class="field"><label>حد الائتمان</label>
      <div class="in num">50,000.00</div>
      <span class="hint">يُفحص عند كل فاتورة قبل الترحيل.</span></div>
    <div class="field"><label>الفرع</label>
      <div class="in pick">الفرع الرئيسي <span class="kbd">▾</span></div></div>
    <div class="field wide"><label>العنوان</label>
      <div class="in">١٢ شارع طلعت حرب، وسط البلد، القاهرة</div></div>
  </div>
  <div class="banner" style="margin-block-start:20px">
    <span>▲</span>
    <div><b>كل حقل يسمّي كيانًا لا بد أن يكون قائمة اختيار</b>
    المندوب، الفرع، مركز التكلفة، الصنف — الكتابة الحرة مكانها يعني رقمًا مُختلقًا في قاعدة البيانات.</div>
  </div>
`);

/* ================= 9 · feedback and states ================= */
const states = () => shell(
  head("الحالات والرسائل", "نظام واحد يحل محل ٥٤ رسالة حالة مكتوبة يدويًا",
       `<button class="btn sec">دليل النظام</button>`) + `
  <div class="states">
    <div><span class="lbl">نجاح — مع تراجع حيث يمكن التراجع فعلًا</span>
      <div class="toast"><span>✓</span><span>رُحِّلت الفاتورة INV-2026-0342</span>
        <span class="sp"><button class="undo">تراجع</button></span></div></div>

    <div><span class="lbl">فشل — بالعربية، لا نص خطأ إنجليزي</span>
      <div class="toast bad"><span>▲</span><span>تعذّر الترحيل: الفترة المحاسبية يوليو ٢٠٢٦ مقفلة.</span></div></div>

    <div><span class="lbl">تأكيد — يذكر العاقبة في جملة واحدة</span>
      <div class="dialog"><h3>إلغاء الفاتورة INV-2026-0341؟</h3>
        <p>سيُنشئ النظام قيدًا عكسيًا بقيمة <span class="num">40,128.00</span> ج.م ويعيد
           <span class="num">170</span> وحدة إلى المخزن. القيد الأصلي يبقى في الدفاتر — لا يُحذف.</p>
        <div class="acts"><button class="btn danger">إلغاء الفاتورة</button>
          <button class="btn sec">رجوع</button></div></div></div>

    <div><span class="lbl">تحميل — هيكل عظمي، لا دوّامة</span>
      <div class="skel"><div class="ln" style="width:38%"></div><div class="ln"></div>
        <div class="ln" style="width:82%"></div><div class="ln" style="width:64%"></div></div></div>

    <div><span class="lbl">فارغ — يسمّي الناقص ويقدّم زر إنشائه</span>
      <div class="empty"><div class="g">◫</div><h3>لا فواتير في هذه القائمة</h3>
        <p>«اللي عليّ أحصّله» تعرض الفواتير المتأخرة فقط. لا يوجد متأخر اليوم.</p>
        <button class="btn">فاتورة مبيعات جديدة</button></div></div>

    <div><span class="lbl">صلاحية — يقول من يملكها</span>
      <div class="banner bad"><span>⌧</span>
        <div><b>لا تملك صلاحية ترحيل قيود اليومية</b>
        الصلاحية <span class="num">GL.POST</span> ممنوحة لدور «المحاسب». راجع مدير النظام.</div></div></div>
  </div>
`);

/* ================= 10 · shortcut page ================= */
const short = () => shell(
  head("اختصاراتي", "تخطيط «أمين المخزن» · محفوظ لحسابك على الخادم — يتبعك على أي جهاز",
       `<button class="btn sec sm">استعادة الوضع الافتراضي</button>
        <button class="btn sec">إعادة الترتيب</button><button class="btn">إضافة بلاطة</button>`) + `
  <div class="secbar"><h2>ما أفعله كل يوم</h2></div>
  <div class="tiles">
    ${DATA.tiles.map(t=>`<button class="tile"><span class="g">${t.g}</span><span class="n">${t.n}</span><span class="m">${t.m}</span></button>`).join("")}
    <button class="tile add"><span class="g">＋</span><span class="n">إضافة اختصار</span></button>
  </div>
  <div class="secbar"><h2>قوائم محفوظة</h2></div>
  <div class="tiles">
    <button class="tile"><span class="g">◧</span><span class="n">اللي عليّ أحصّله</span><span class="m">فواتير · ${I(7)} صفوف</span></button>
    <button class="tile"><span class="g">◧</span><span class="n">شيكات هذا الأسبوع</span><span class="m">الخزينة · ${I(3)} صفوف</span></button>
    <button class="tile"><span class="g">◧</span><span class="n">تحت حد إعادة الطلب</span><span class="m">المخزون · ${I(5)} صفوف</span></button>
    <button class="tile add"><span class="g">＋</span><span class="n">حفظ القائمة الحالية</span></button>
  </div>
  <div class="secbar"><h2>آخر ما فتحته</h2></div>
  <div class="tiles">
    <button class="tile"><span class="g">↺</span><span class="n">فاتورة INV-2026-0342</span><span class="m">مسودة · منذ ${I(4)} دقائق</span></button>
    <button class="tile"><span class="g">↺</span><span class="n">${DATA.customer.name}</span><span class="m">عميل · اليوم</span></button>
    <button class="tile"><span class="g">↺</span><span class="n">ميزان المراجعة</span><span class="m">تقرير · أمس</span></button>
  </div>
`);

/* ================= 11 · login (first impression) ================= */
const login = () => `
<div class="app"><div class="login"><div class="card">
  <div class="mark">ميزان</div>
  <div class="tl">نظام إدارة الأعمال · نسخة سطح المكتب</div>
  <div class="form">
    <div class="field"><label>اسم المستخدم</label><div class="in">hala.mansour</div></div>
    <div class="field"><label>كلمة المرور</label><div class="in ph">••••••••</div></div>
    <div class="field"><label>الفرع</label><div class="in pick">الفرع الرئيسي <span class="kbd">▾</span></div></div>
  </div>
  <button class="btn block" style="margin-block-start:18px">دخول</button>
  <div class="foot"><span>الترخيص: سارٍ حتى ${I(31)} ديسمبر ${I(2026)}</span>
    <span style="margin-inline-start:auto">v<span class="num">1.0.0</span></span></div>
</div></div></div>`;

/* ================= 12 · create hub ================= */
const create = () => shell(
  head("إنشاء جديد", "كل ما يمكن إنشاؤه، مرتّبًا بما تفعله لا بما بُني منه البرنامج",
       `<button class="btn sec">كل الشاشات</button>`) + `
  <div class="secbar"><h2>الأكثر استخدامًا عندك</h2>
    <span class="rst" style="font-size:11.5px;opacity:.7">مرتّبة حسب استخدامك، لا حسب ترتيب ثابت</span></div>
  <div class="tiles">
    <button class="tile"><span class="g">🧾</span><span class="n">فاتورة مبيعات</span><span class="m">آخر مرة: منذ ساعة</span></button>
    <button class="tile"><span class="g">💵</span><span class="n">سند قبض</span><span class="m">آخر مرة: اليوم</span></button>
    <button class="tile"><span class="g">📥</span><span class="n">إذن استلام بضاعة</span><span class="m">آخر مرة: أمس</span></button>
    <button class="tile"><span class="g">🧍</span><span class="n">عميل</span><span class="m">آخر مرة: منذ ٣ أيام</span></button>
  </div>

  <div class="secbar"><h2>البيع والتحصيل</h2></div>
  <div class="tiles">
    <button class="tile"><span class="g">📄</span><span class="n">عرض سعر</span><span class="m">يتحوّل لفاتورة</span></button>
    <button class="tile"><span class="g">🧾</span><span class="n">فاتورة مبيعات</span><span class="m">تُرحَّل للدفاتر</span></button>
    <button class="tile"><span class="g">↩</span><span class="n">مرتجع مبيعات</span><span class="m">يعكس القيد والمخزون</span></button>
    <button class="tile"><span class="g">🧍</span><span class="n">عميل</span><span class="m">بيانات أساسية</span></button>
  </div>

  <div class="secbar"><h2>الشراء والتوريد</h2></div>
  <div class="tiles">
    <button class="tile"><span class="g">📋</span><span class="n">أمر شراء</span><span class="m">لا يُرحَّل — التزام فقط</span></button>
    <button class="tile"><span class="g">📥</span><span class="n">إذن استلام</span><span class="m">يزيد المخزون</span></button>
    <button class="tile"><span class="g">🧾</span><span class="n">فاتورة مشتريات</span><span class="m">من إذن استلام</span></button>
    <button class="tile"><span class="g">🏭</span><span class="n">مورد</span><span class="m">بيانات أساسية</span></button>
  </div>

  <div class="banner" style="margin-block-start:20px">
    <span>▲</span>
    <div><b>كل بلاطة تقول ماذا يحدث بعد الحفظ</b>
    «يُرحَّل للدفاتر» و«يزيد المخزون» و«لا يُرحَّل» — الفرق بين المستندات المالية وغيرها
    يجب أن يُقرأ قبل الضغط، لا بعده.</div>
  </div>
`);

/* ================= 13 · new document (blank) ================= */
const newdoc = () => shell(
  head("فاتورة مبيعات جديدة", "لم تُحفظ بعد · سيُخصَّص الرقم عند أول حفظ",
       `<button class="btn sec">إلغاء</button><button class="btn" disabled>ترحيل الفاتورة</button>`) + `
  <div class="banner" style="margin-block-end:18px">
    <span>◷</span>
    <div><b>أول مرة تعمل فاتورة؟</b>
    يمكن للنظام أن يسألك سؤالًا واحدًا في كل مرة بدل النموذج الكامل.
    <button class="btn sec sm" style="margin-inline-start:10px">ابدأ بالخطوات الموجّهة</button></div>
  </div>

  <div class="form" style="max-width:none">
    <div class="field"><label>العميل <span class="req">*</span></label>
      <div class="in pick ph">ابحث بالاسم أو الكود… <span class="kbd">⌘K</span></div>
      <span class="hint">غير موجود؟ اكتب الاسم واضغط «+ عميل جديد» — لن تفقد المسودة.</span></div>
    <div class="field"><label>التاريخ <span class="req">*</span></label>
      <div class="in"><span><span class="num">27</span>&nbsp;أغسطس&nbsp;<span class="num">2026</span></span></div></div>
    <div class="field"><label>المخزن <span class="req">*</span></label>
      <div class="in pick">المخزن الرئيسي <span class="kbd">▾</span></div>
      <span class="hint">آخر مخزن استخدمته — يُحفظ لك.</span></div>
  </div>

  <div class="secbar"><h2>البنود</h2></div>
  <table>
    <thead><tr><th style="width:34%">الصنف</th><th class="e">الكمية</th><th>الوحدة</th>
      <th class="e">السعر</th><th class="e">الإجمالي</th></tr></thead>
    <tbody>
      <tr><td colspan="5" style="height:auto">
        <div class="empty" style="border:0;background:none;padding:26px 14px">
          <div class="g">◫</div><h3>لا بنود بعد</h3>
          <p>اكتب اسم الصنف أو امسح الباركود لبدء أول سطر. Enter يفتح السطر التالي.</p>
          <button class="btn">أضف أول بند</button>
        </div></td></tr>
    </tbody>
  </table>

  <div class="strip" style="margin-block-start:18px">
    <div class="f"><div class="k">الإجمالي قبل الضريبة</div><div class="v num">0.00</div></div>
    <div class="f"><div class="k">ضريبة القيمة المضافة</div><div class="v num">0.00</div></div>
    <div class="f"><div class="k">الإجمالي المستحق</div><div class="v num">0.00</div></div>
  </div>
`, `
  <span class="gt">العميل</span>
  <div class="empty" style="padding:22px 14px">
    <div class="g">◷</div><h3>لم تختر عميلًا بعد</h3>
    <p>بمجرد اختياره يظهر هنا حد الائتمان والرصيد وأعمار الدين — قبل الترحيل لا بعده.</p>
  </div>
`);

/* ================= 14 · guided flow ================= */
const guided = () => shell(
  head("تحصيل فلوس من عميل", "خطوة ٢ من ٤ · يمكنك التحويل للنموذج الكامل في أي وقت",
       `<button class="btn sec">النموذج الكامل</button>`) + `
  <div class="stepper">
    <span class="st done"><span class="d">✓</span>من أي عميل؟</span><span class="sep"></span>
    <span class="st now"><span class="d">●</span>كم المبلغ؟</span><span class="sep"></span>
    <span class="st next"><span class="d"></span>نقدًا أم شيك؟</span><span class="sep"></span>
    <span class="st next"><span class="d"></span>مراجعة وحفظ</span>
  </div>

  <div style="max-width:560px">
    <h2 style="font-family:var(--font-disp);font-weight:var(--fw-disp);font-size:20px;margin:0 0 6px">
      كم المبلغ الذي استلمته من شركة الأمل للتجارة؟</h2>
    <p style="color:var(--muted);font-size:13px;margin:0 0 20px">
      المستحق عليه الآن <span class="num">18,400.00</span> ج.م.</p>

    <div class="field" style="margin-block-end:18px">
      <label>المبلغ بالجنيه <span class="req">*</span></label>
      <div class="in num" style="font-size:22px;min-height:60px">5,000.00</div>
    </div>

    <span class="gt">أو اختر مبلغًا جاهزًا</span>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-block-end:24px">
      <button class="btn sec sm">كامل المستحق <span class="num">18,400.00</span></button>
      <button class="btn sec sm">أقدم فاتورة <span class="num">7,480.00</span></button>
      <button class="btn sec sm">نصف المستحق <span class="num">9,200.00</span></button>
    </div>

    <div style="display:flex;gap:8px">
      <button class="btn">التالي: طريقة الدفع</button>
      <button class="btn sec">رجوع</button>
    </div>

    <p style="color:var(--faint);font-size:12px;margin-block-start:22px;line-height:1.8">
      المصطلح الرسمي لهذه العملية: <b style="color:var(--muted)">سند قبض</b>.
      يُعرَض هنا لكي تتعلّمه، لا لكي يُفترض أنك تعرفه.</p>
  </div>
`, `
  ${balance({label:"رصيد العميل بعد هذا التحصيل", aName:"الرصيد الحالي", aVal:18400.00,
             bName:"بعد التحصيل", bVal:13400.00, mode:"ceiling", trace:false})}
  <div style="margin-block-start:18px;font-size:12px;color:var(--muted);line-height:1.8">
    نفس الأداة تظهر أثر ما تفعله قبل أن تفعله — لا بعد الحفظ.
  </div>
`);

/* ================= 15 · in-context quick create ================= */
const quick = () => shell(
  head("فاتورة مبيعات — مسودة", "إنشاء عميل من داخل الفاتورة، بلا فقدان المسودة",
       `<button class="btn sec">حفظ كمسودة</button><button class="btn">ترحيل الفاتورة</button>`) + `
  <div class="form" style="max-width:none;opacity:.45">
    <div class="field"><label>العميل <span class="req">*</span></label>
      <div class="in">شركة البركة للتوزيع</div></div>
    <div class="field"><label>التاريخ</label>
      <div class="in"><span><span class="num">27</span>&nbsp;أغسطس&nbsp;<span class="num">2026</span></span></div></div>
    <div class="field"><label>المخزن</label><div class="in">المخزن الرئيسي</div></div>
  </div>

  <div style="margin-block-start:20px;max-width:560px">
    <div class="dialog">
      <h3>عميل جديد: شركة البركة للتوزيع</h3>
      <p>الاسم مأخوذ مما كتبته في الفاتورة. أكمل ما هو مطلوب فقط — الباقي يمكن استكماله لاحقًا
         من شاشة العملاء. مسودة الفاتورة محفوظة ولن تُفقد.</p>
      <div class="form" style="max-width:none">
        <div class="field"><label>الاسم <span class="req">*</span></label>
          <div class="in">شركة البركة للتوزيع</div></div>
        <div class="field"><label>الهاتف</label><div class="in ph">اختياري</div></div>
        <div class="field"><label>مدة السداد</label>
          <div class="in"><span><span class="num">30</span>&nbsp;يوم</span></div></div>
        <div class="field"><label>حد الائتمان</label>
          <div class="in ph">اتركه فارغًا = بلا حد</div></div>
      </div>
      <div class="acts" style="margin-block-start:18px">
        <button class="btn">احفظ وأكمل الفاتورة</button>
        <button class="btn sec">رجوع</button>
      </div>
    </div>
  </div>

  <div class="banner" style="margin-block-start:20px">
    <span>▲</span>
    <div><b>لماذا هذه الشاشة موجودة</b>
    بدونها يترك المُدخِل الفاتورة، يفتح شاشة العملاء، يضيف العميل، يرجع، ويعيد إدخال البنود من أولها.
    هذا أكثر ما يبطّئ الإدخال اليومي.</div>
  </div>
`);

/* ================= 16 - bank review and reconciliation =================
   Borrowed: QuickBooks' three-button bank review (Add / Match / Exclude) and
   its "the difference must reach zero" reconciliation. Neither says debit or
   credit; the journal is derived behind the screen. Our balance instrument is
   already exactly the second one, so it does the reconciliation verdict. */
const bank = () => shell(
  head("مراجعة حركة البنك", `البنك الأهلي — جاري · ${I(14)} حركة بانتظار المراجعة`,
       `<button class="btn sec">استيراد كشف</button><button class="btn">مطابقة الشهر</button>`) + `
  <div class="banner" style="margin-block-end:16px">
    <span>◷</span>
    <div><b>ثلاثة أزرار فقط، ولا كلمة «مدين» أو «دائن»</b>
    لكل حركة نازلة من البنك: هل هي <b>جديدة</b> على الدفاتر، أم <b>تطابق</b> مستندًا سجّلته بالفعل،
    أم <b>ليست</b> حركة تخصّنا؟ القيد يُبنى خلف الستار.</div>
  </div>

  <table>
    <thead><tr><th>التاريخ</th><th>البيان من البنك</th><th class="e">المبلغ</th>
      <th>اقتراح النظام</th><th style="width:250px"></th></tr></thead>
    <tbody>
      ${[["25 أغسطس","TRF ALAMAL TRADING","15,300.00","يطابق INV-2026-0337","ok","طابِق"],
         ["24 أغسطس","POS SETTLEMENT 8842","3,480.00","لا يوجد اقتراح","mute","جديدة"],
         ["23 أغسطس","CHQ 004512 GREEN VALLEY","−9,750.00","يطابق شيك ٤٥١٢","ok","طابِق"],
         ["22 أغسطس","BANK CHARGES","−120.00","مصروف بنكي؟","warn","جديدة"]]
        .map(r=>`<tr>
          <td><span class="cell">${dg(r[0])}</span></td>
          <td><span class="cell mz-lat">${r[1]}</span></td>
          <td class="e"><span class="cell num">${r[2]}</span></td>
          <td><span class="cell"><span class="chip ${r[4]}">${r[3]}</span></span></td>
          <td><span class="cell" style="gap:6px">
            <button class="btn sm">${r[5]}</button>
            <button class="btn sec sm">${r[5]==="طابِق"?"جديدة":"طابِق"}</button>
            <button class="btn sec sm">استبعد</button></span></td></tr>`).join("")}
    </tbody>
  </table>
`, `
  ${balance({label:"مطابقة كشف البنك", aName:"رصيد الكشف", aVal:186540.25,
             bName:"رصيد الدفاتر", bVal:183060.25})}
  <div style="margin-block-start:16px;font-size:12px;color:var(--muted);line-height:1.8">
    الهدف رقم واحد: أن يصير الفرق <span class="num">0.00</span>.
    كل «طابِق» يقرّبه، و«أين الفرق؟» يفتح ما لم يُطابَق بعد.
  </div>
  <div style="margin-block-start:18px">
    <span class="gt">تقدّم المراجعة</span>
    <div style="display:flex;justify-content:space-between;font-size:12.5px;padding:6px 0;border-block-end:1px solid var(--line)">
      <span>روجعت</span><span class="num">10</span></div>
    <div style="display:flex;justify-content:space-between;font-size:12.5px;padding:6px 0">
      <span>باقية</span><span class="num">4</span></div>
  </div>
`);

const SCREENS = { today, create, newdoc, guided, quick, list, inv, detail, bank, report, aging, coa, form, states, short, login };

const SCREEN_CAPS = {
  create: ["شاشة الإنشاء", "كل ما يمكن إنشاؤه، مرتّب بالعمل لا بالوحدات البرمجية.", "كل بلاطة تقول ماذا يحدث بعد الحفظ"],
  newdoc: ["مستند جديد — فارغ", "الحالة الصفرية: ماذا ترى قبل أن تكتب أي شيء.", "الفراغ حالة حقيقية لا شاشة بيضاء"],
  guided: ["تدفق موجّه", "سؤال واحد في كل خطوة، بلغة العمل، مع المصطلح الرسمي بجانبه.", "المهام اليومية الخمس"],
  quick:  ["إنشاء سريع داخل السياق", "عميل جديد من داخل الفاتورة بلا فقدان المسودة.", "أكثر ما يبطّئ الإدخال"],
  today:  ["لوحة اليوم", "قائمة عمل، لا لوحة مؤشرات — كل صف وحدة عمل ومعها زرها.", "الشريط الجانبي: تقفيل الخزينة + الفروع"],
  list:   ["قائمة المستندات", "قوائم مسمّاة بدل شرائح الحالة، وعوامل تصفية مكتوبة على الشاشة.", "أكثر بدائية استخدامًا — ٦٢ شاشة"],
  inv:    ["فاتورة مبيعات — تحرير", "جدول كثيف بدل كروت البنود، والعمود الحيّ عند نهاية القراءة.", "الرهان الأساسي"],
  detail: ["تفاصيل مستند", "دورة الحياة كاملة، ولكل حالة زر ظاهر ينقلها.", "القيد المحاسبي بجانب الحالة"],
  bank:   ["مراجعة البنك والمطابقة", "طابِق / جديدة / استبعد — بلا كلمة مدين أو دائن.", "الفرق يجب أن يصل إلى صفر"],
  report: ["ميزان المراجعة", "أرقام كثيفة، نزول للحساب، والأداة نفسها تحكم على التوازن.", "٣٣ تقريرًا ترث هذا الشكل"],
  aging:  ["أعمار الديون", "المصفوفة — واختبار نظام الترقيم الموحّد.", "مطابقة الدفتر المساعد بالمراقب"],
  coa:    ["دليل الحسابات", "شجرة بأربعة مستويات وأرصدة محاذاة.", "الحساب المراقب مقابل دفتره"],
  form:   ["نموذج بيانات أساسية", "الحقول، المطلوب منها، الخطأ، وقوائم اختيار الكيانات.", "الكتابة الحرة = رقم مُختلق"],
  states: ["الحالات والرسائل", "نجاح، فشل، تأكيد، تحميل، فارغ، ممنوع.", "يحل محل ٥٤ رسالة يدوية"],
  short:  ["صفحة الاختصارات", "بلاطات يبنيها المستخدم: إجراءات، قوائم محفوظة، آخر ما فُتح.", "محفوظة على الخادم"],
  login:  ["تسجيل الدخول", "أول عشر ثوانٍ — الانطباع الذي يقرر «هل هذا نفس البرنامج الآخر؟».", "الهوية بلا بيانات"],
};

/* ---------- mount ---------- */
function mount(dirKey){
  const order = Object.keys(SCREENS);
  document.getElementById("jump").innerHTML =
    `<span>الشاشات:</span>` + order.map(s=>`<a href="#s-${s}">${SCREEN_CAPS[s][0]}</a>`).join("");
  document.getElementById("stage").innerHTML =
    `<div data-dir="${dirKey}">` + order.map(s=>`
      <section class="slab" id="s-${s}">
        <div class="cap"><b>${SCREEN_CAPS[s][0]}</b><span>${SCREEN_CAPS[s][1]}</span><i>${SCREEN_CAPS[s][2]}</i></div>
        ${SCREENS[s]()}
      </section>`).join("") + `</div>`;
  applyNumerals();
}

/* Ground rule §2.3 — one numeral system per user, never mixed on a screen. */
const EAST = "٠١٢٣٤٥٦٧٨٩";
let numeral = "west";
function applyNumerals(){
  document.querySelectorAll(".num").forEach(el=>{
    const src = el.dataset.raw ?? (el.dataset.raw = el.textContent);
    el.textContent = numeral === "east" ? src.replace(/[0-9]/g, c => EAST[+c]) : src;
  });
}
document.getElementById("nums").addEventListener("click", e=>{
  const b = e.target.closest("button"); if(!b) return;
  numeral = b.dataset.n;
  [...e.currentTarget.children].forEach(x=>x.setAttribute("aria-pressed", String(x===b)));
  applyNumerals();
});

mount(document.body.dataset.dir);
