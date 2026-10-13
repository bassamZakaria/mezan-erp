/**
 * Master data for the multi-year trading history — see `./history.ts`.
 *
 * SEED PROFILE FOR TESTS AND LOCAL DEVELOPMENT ONLY.
 *
 * Everything here is NEW: the history never trades in `CUST-DEMO-*`,
 * `SUPP-DEMO-*` or `ITEM-DEMO-*`. Those carry hand-authored scenarios whose
 * balances and weighted-average costs are asserted to the piastre, and a
 * generator that touched them would restate every one of those figures.
 */

/** Money is authored in piastres so no seeded figure is ever built from a float. */
export interface HistoryItem {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly categoryId: string;
  readonly supplierIndex: number;
  readonly costPiastres: number;
  readonly pricePiastres: number;
  /** Typical purchase lot, in base units — quantities are rounded up to it. */
  readonly lotSize: number;
  /** How often this item shows up on a sales line, relative to its peers. */
  readonly weight: number;
  readonly cartonFactor?: number;
  readonly reorderPoint?: number;
}

export const HISTORY_ITEMS: readonly HistoryItem[] = [
  { id: "ITEM-H-01", code: "IT-1001", nameAr: "أرز مصري 1 كجم", nameEn: "Egyptian Rice 1kg", categoryId: "cat-food", supplierIndex: 0, costPiastres: 2400, pricePiastres: 3200, lotSize: 600, weight: 10, cartonFactor: 10, reorderPoint: 400 },
  { id: "ITEM-H-02", code: "IT-1002", nameAr: "مكرونة إسباجتي 400 جم", nameEn: "Spaghetti 400g", categoryId: "cat-food", supplierIndex: 5, costPiastres: 1100, pricePiastres: 1600, lotSize: 900, weight: 9, cartonFactor: 20, reorderPoint: 500 },
  { id: "ITEM-H-03", code: "IT-1003", nameAr: "دقيق فاخر 1 كجم", nameEn: "Fine Flour 1kg", categoryId: "cat-food", supplierIndex: 0, costPiastres: 1800, pricePiastres: 2500, lotSize: 600, weight: 7, cartonFactor: 10, reorderPoint: 350 },
  { id: "ITEM-H-04", code: "IT-1004", nameAr: "عدس أصفر 1 كجم", nameEn: "Yellow Lentils 1kg", categoryId: "cat-food", supplierIndex: 0, costPiastres: 4200, pricePiastres: 5500, lotSize: 300, weight: 5, reorderPoint: 180 },
  { id: "ITEM-H-05", code: "IT-1005", nameAr: "فول مدمس معلب 400 جم", nameEn: "Canned Fava Beans 400g", categoryId: "cat-food", supplierIndex: 3, costPiastres: 1500, pricePiastres: 2100, lotSize: 960, weight: 8, cartonFactor: 24, reorderPoint: 480 },
  { id: "ITEM-H-06", code: "IT-1006", nameAr: "حمص حب 1 كجم", nameEn: "Chickpeas 1kg", categoryId: "cat-food", supplierIndex: 0, costPiastres: 3800, pricePiastres: 5000, lotSize: 300, weight: 4, reorderPoint: 150 },
  { id: "ITEM-H-07", code: "IT-1007", nameAr: "زيت ذرة 1.5 لتر", nameEn: "Corn Oil 1.5L", categoryId: "cat-food", supplierIndex: 1, costPiastres: 8500, pricePiastres: 11000, lotSize: 480, weight: 9, cartonFactor: 12, reorderPoint: 240 },
  { id: "ITEM-H-08", code: "IT-1008", nameAr: "سمن نباتي 1 كجم", nameEn: "Vegetable Ghee 1kg", categoryId: "cat-food", supplierIndex: 1, costPiastres: 7200, pricePiastres: 9500, lotSize: 240, weight: 5, cartonFactor: 12, reorderPoint: 120 },
  { id: "ITEM-H-09", code: "IT-1009", nameAr: "زيت زيتون 500 مل", nameEn: "Olive Oil 500ml", categoryId: "cat-food", supplierIndex: 7, costPiastres: 18000, pricePiastres: 24000, lotSize: 120, weight: 3, cartonFactor: 12, reorderPoint: 60 },
  { id: "ITEM-H-10", code: "IT-1010", nameAr: "حليب مجفف 400 جم", nameEn: "Powdered Milk 400g", categoryId: "cat-food", supplierIndex: 6, costPiastres: 9500, pricePiastres: 12500, lotSize: 240, weight: 6, cartonFactor: 12, reorderPoint: 120 },
  { id: "ITEM-H-11", code: "IT-1011", nameAr: "جبنة مطبوخة معلبة 240 جم", nameEn: "Processed Cheese 240g", categoryId: "cat-food", supplierIndex: 6, costPiastres: 3500, pricePiastres: 4700, lotSize: 480, weight: 6, cartonFactor: 24, reorderPoint: 240 },
  { id: "ITEM-H-12", code: "IT-1012", nameAr: "شاي أسود ناعم 250 جم", nameEn: "Fine Black Tea 250g", categoryId: "cat-food", supplierIndex: 3, costPiastres: 9000, pricePiastres: 12000, lotSize: 300, weight: 8, cartonFactor: 12, reorderPoint: 150 },
  { id: "ITEM-H-13", code: "IT-1013", nameAr: "قهوة محوجة 200 جم", nameEn: "Spiced Coffee 200g", categoryId: "cat-food", supplierIndex: 3, costPiastres: 11000, pricePiastres: 14500, lotSize: 240, weight: 5, cartonFactor: 12, reorderPoint: 120 },
  { id: "ITEM-H-14", code: "IT-1014", nameAr: "قهوة سريعة الذوبان 100 جم", nameEn: "Instant Coffee 100g", categoryId: "cat-food", supplierIndex: 7, costPiastres: 13500, pricePiastres: 17500, lotSize: 144, weight: 4, cartonFactor: 12, reorderPoint: 72 },
  { id: "ITEM-H-15", code: "IT-1015", nameAr: "مشروب غازي 1 لتر", nameEn: "Soft Drink 1L", categoryId: "cat-food", supplierIndex: 8, costPiastres: 1200, pricePiastres: 1800, lotSize: 1200, weight: 10, cartonFactor: 12, reorderPoint: 600 },
  { id: "ITEM-H-16", code: "IT-1016", nameAr: "عصير مركز 1 لتر", nameEn: "Concentrated Juice 1L", categoryId: "cat-food", supplierIndex: 8, costPiastres: 2600, pricePiastres: 3600, lotSize: 600, weight: 6, cartonFactor: 12, reorderPoint: 300 },
  { id: "ITEM-H-17", code: "IT-1017", nameAr: "سكر أبيض معبأ 1 كجم", nameEn: "Packed White Sugar 1kg", categoryId: "cat-food", supplierIndex: 2, costPiastres: 2700, pricePiastres: 3400, lotSize: 1000, weight: 10, cartonFactor: 10, reorderPoint: 500 },
  { id: "ITEM-H-18", code: "IT-1018", nameAr: "بسكويت سادة 12 قطعة", nameEn: "Plain Biscuits x12", categoryId: "cat-food", supplierIndex: 3, costPiastres: 2200, pricePiastres: 3200, lotSize: 720, weight: 7, cartonFactor: 24, reorderPoint: 360 },
  { id: "ITEM-H-19", code: "IT-1019", nameAr: "شوكولاتة ألواح 80 جم", nameEn: "Chocolate Bar 80g", categoryId: "cat-food", supplierIndex: 3, costPiastres: 1900, pricePiastres: 2800, lotSize: 960, weight: 6, cartonFactor: 48, reorderPoint: 480 },
  { id: "ITEM-H-20", code: "IT-1020", nameAr: "حلاوة طحينية 500 جم", nameEn: "Halva 500g", categoryId: "cat-food", supplierIndex: 3, costPiastres: 5200, pricePiastres: 7000, lotSize: 240, weight: 4, cartonFactor: 12, reorderPoint: 120 },
  { id: "ITEM-H-21", code: "IT-1021", nameAr: "صلصة طماطم 800 جم", nameEn: "Tomato Paste 800g", categoryId: "cat-food", supplierIndex: 0, costPiastres: 2100, pricePiastres: 3000, lotSize: 720, weight: 8, cartonFactor: 24, reorderPoint: 360 },
  { id: "ITEM-H-22", code: "IT-1022", nameAr: "تونة معلبة 140 جم", nameEn: "Canned Tuna 140g", categoryId: "cat-food", supplierIndex: 7, costPiastres: 3300, pricePiastres: 4500, lotSize: 480, weight: 7, cartonFactor: 48, reorderPoint: 240 },
  { id: "ITEM-H-23", code: "IT-1023", nameAr: "مربى مشمش 340 جم", nameEn: "Apricot Jam 340g", categoryId: "cat-food", supplierIndex: 3, costPiastres: 2800, pricePiastres: 3900, lotSize: 288, weight: 3, cartonFactor: 12, reorderPoint: 144 },
  { id: "ITEM-H-24", code: "IT-1024", nameAr: "مسحوق غسيل 2 كجم", nameEn: "Laundry Powder 2kg", categoryId: "cat-food", supplierIndex: 4, costPiastres: 12500, pricePiastres: 16500, lotSize: 240, weight: 7, cartonFactor: 6, reorderPoint: 120 },
  { id: "ITEM-H-25", code: "IT-1025", nameAr: "سائل غسيل أطباق 1 لتر", nameEn: "Dishwashing Liquid 1L", categoryId: "cat-food", supplierIndex: 4, costPiastres: 3600, pricePiastres: 5000, lotSize: 360, weight: 6, cartonFactor: 12, reorderPoint: 180 },
  { id: "ITEM-H-26", code: "IT-1026", nameAr: "صابون معطر 125 جم", nameEn: "Perfumed Soap 125g", categoryId: "cat-food", supplierIndex: 4, costPiastres: 900, pricePiastres: 1400, lotSize: 1440, weight: 6, cartonFactor: 72, reorderPoint: 720 },
  { id: "ITEM-H-27", code: "IT-1027", nameAr: "منظف أرضيات 1 لتر", nameEn: "Floor Cleaner 1L", categoryId: "cat-food", supplierIndex: 4, costPiastres: 3100, pricePiastres: 4300, lotSize: 360, weight: 5, cartonFactor: 12, reorderPoint: 180 },
  { id: "ITEM-H-28", code: "IT-1028", nameAr: "مناديل ورقية 200 منديل", nameEn: "Facial Tissues x200", categoryId: "cat-food", supplierIndex: 9, costPiastres: 1700, pricePiastres: 2500, lotSize: 900, weight: 7, cartonFactor: 30, reorderPoint: 450 },
  { id: "ITEM-H-29", code: "IT-1029", nameAr: "ورق تصوير A4 رزمة", nameEn: "A4 Copy Paper Ream", categoryId: "cat-office", supplierIndex: 9, costPiastres: 14000, pricePiastres: 18500, lotSize: 200, weight: 4, cartonFactor: 5, reorderPoint: 100 },
  { id: "ITEM-H-30", code: "IT-1030", nameAr: "أقلام جاف علبة 50", nameEn: "Ballpoint Pens Box of 50", categoryId: "cat-office", supplierIndex: 9, costPiastres: 6500, pricePiastres: 9000, lotSize: 120, weight: 2, reorderPoint: 60 },
  { id: "ITEM-H-31", code: "IT-1031", nameAr: "بطارية جافة AA علبة 4", nameEn: "AA Batteries Pack of 4", categoryId: "cat-spares", supplierIndex: 10, costPiastres: 2400, pricePiastres: 3600, lotSize: 480, weight: 4, cartonFactor: 24, reorderPoint: 240 },
  { id: "ITEM-H-32", code: "IT-1032", nameAr: "لمبة ليد 12 وات", nameEn: "LED Bulb 12W", categoryId: "cat-spares", supplierIndex: 10, costPiastres: 3800, pricePiastres: 5500, lotSize: 240, weight: 3, cartonFactor: 12, reorderPoint: 120 },
];

export interface HistoryCustomer {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly phone: string;
  readonly city: string;
  readonly address: string;
  readonly paymentTermsDays: number;
  readonly creditLimit: string;
  readonly category: string;
  /** Relative share of the month's invoices. */
  readonly weight: number;
  readonly taxNumber?: string;
}

export const HISTORY_CUSTOMERS: readonly HistoryCustomer[] = [
  { id: "CUST-H-01", code: "C-1001", nameAr: "سوبر ماركت الحرمين", nameEn: "Al Haramain Supermarket", phone: "01001100011", city: "القاهرة", address: "18 شارع مصطفى النحاس، مدينة نصر، القاهرة", paymentTermsDays: 30, creditLimit: "180000", category: "سوبر ماركت", weight: 10, taxNumber: "310112201" },
  { id: "CUST-H-02", code: "C-1002", nameAr: "بقالة الصفا", nameEn: "Al Safa Grocery", phone: "01001100012", city: "الجيزة", address: "5 شارع السودان، المهندسين، الجيزة", paymentTermsDays: 15, creditLimit: "40000", category: "بقالة", weight: 6 },
  { id: "CUST-H-03", code: "C-1003", nameAr: "ماركت المدينة المنورة", nameEn: "Al Madina Market", phone: "01001100013", city: "الإسكندرية", address: "62 شارع أبو قير، سبورتنج، الإسكندرية", paymentTermsDays: 30, creditLimit: "150000", category: "سوبر ماركت", weight: 9, taxNumber: "310112203" },
  { id: "CUST-H-04", code: "C-1004", nameAr: "سلسلة أسواق الرحمة", nameEn: "Al Rahma Markets Chain", phone: "01001100014", city: "القاهرة", address: "المنطقة الصناعية، العبور، القليوبية", paymentTermsDays: 45, creditLimit: "400000", category: "سلسلة تجزئة", weight: 12, taxNumber: "310112204" },
  { id: "CUST-H-05", code: "C-1005", nameAr: "مؤسسة البركة للتموين", nameEn: "Al Baraka Catering Supplies", phone: "01001100015", city: "الزقازيق", address: "22 شارع الجلاء، الزقازيق، الشرقية", paymentTermsDays: 30, creditLimit: "120000", category: "جملة", weight: 8, taxNumber: "310112205" },
  { id: "CUST-H-06", code: "C-1006", nameAr: "سوبر ماركت النخبة", nameEn: "Al Nokhba Supermarket", phone: "01001100016", city: "المنصورة", address: "9 شارع الجمهورية، المنصورة، الدقهلية", paymentTermsDays: 30, creditLimit: "90000", category: "سوبر ماركت", weight: 7 },
  { id: "CUST-H-07", code: "C-1007", nameAr: "ماركت الأسرة", nameEn: "Al Osra Market", phone: "01001100017", city: "طنطا", address: "31 شارع البحر، طنطا، الغربية", paymentTermsDays: 21, creditLimit: "70000", category: "سوبر ماركت", weight: 6 },
  { id: "CUST-H-08", code: "C-1008", nameAr: "أسواق الوفاء", nameEn: "Al Wafaa Markets", phone: "01001100018", city: "أسيوط", address: "14 شارع الجمهورية، أسيوط", paymentTermsDays: 30, creditLimit: "85000", category: "سوبر ماركت", weight: 5 },
  { id: "CUST-H-09", code: "C-1009", nameAr: "بقالة النيل", nameEn: "Al Nil Grocery", phone: "01001100019", city: "بني سويف", address: "7 شارع صلاح سالم، بني سويف", paymentTermsDays: 15, creditLimit: "30000", category: "بقالة", weight: 4 },
  { id: "CUST-H-10", code: "C-1010", nameAr: "مطاعم الشرق للتموين", nameEn: "Al Sharq Restaurants Supply", phone: "01001100020", city: "القاهرة", address: "40 شارع الطيران، مدينة نصر، القاهرة", paymentTermsDays: 45, creditLimit: "200000", category: "مطاعم", weight: 8, taxNumber: "310112210" },
  { id: "CUST-H-11", code: "C-1011", nameAr: "فندق الواحة", nameEn: "Al Waha Hotel", phone: "01001100021", city: "الغردقة", address: "طريق الكورنيش، الغردقة، البحر الأحمر", paymentTermsDays: 60, creditLimit: "250000", category: "فنادق", weight: 6, taxNumber: "310112211" },
  { id: "CUST-H-12", code: "C-1012", nameAr: "شركة الطيب للتموينات", nameEn: "Al Tayeb Provisions Co.", phone: "01001100022", city: "الجيزة", address: "3 شارع الملك فيصل، الهرم، الجيزة", paymentTermsDays: 30, creditLimit: "160000", category: "جملة", weight: 9, taxNumber: "310112212" },
  { id: "CUST-H-13", code: "C-1013", nameAr: "سوبر ماركت الأمانة", nameEn: "Al Amana Supermarket", phone: "01001100023", city: "المنيا", address: "11 شارع كورنيش النيل، المنيا", paymentTermsDays: 21, creditLimit: "60000", category: "سوبر ماركت", weight: 5 },
  { id: "CUST-H-14", code: "C-1014", nameAr: "ماركت زهرة المدائن", nameEn: "Zahrat Al Madain Market", phone: "01001100024", city: "الإسماعيلية", address: "26 شارع سعد زغلول، الإسماعيلية", paymentTermsDays: 30, creditLimit: "75000", category: "سوبر ماركت", weight: 5 },
  { id: "CUST-H-15", code: "C-1015", nameAr: "أسواق الهدى", nameEn: "Al Huda Markets", phone: "01001100025", city: "دمياط", address: "8 شارع النيل، دمياط", paymentTermsDays: 30, creditLimit: "65000", category: "سوبر ماركت", weight: 4 },
  { id: "CUST-H-16", code: "C-1016", nameAr: "مؤسسة النجاح التجارية", nameEn: "Al Nagah Trading", phone: "01001100026", city: "سوهاج", address: "19 شارع الجمهورية، سوهاج", paymentTermsDays: 45, creditLimit: "110000", category: "جملة", weight: 6, taxNumber: "310112216" },
  { id: "CUST-H-17", code: "C-1017", nameAr: "ماركت الفردوس", nameEn: "Al Ferdous Market", phone: "01001100027", city: "بورسعيد", address: "12 شارع الجمهورية، بورسعيد", paymentTermsDays: 30, creditLimit: "70000", category: "سوبر ماركت", weight: 4 },
  { id: "CUST-H-18", code: "C-1018", nameAr: "كافيتريا الجامعة", nameEn: "University Cafeteria", phone: "01001100028", city: "القاهرة", address: "شارع الجامعة، الجيزة", paymentTermsDays: 15, creditLimit: "25000", category: "مطاعم", weight: 3 },
  { id: "CUST-H-19", code: "C-1019", nameAr: "سوبر ماركت السلام", nameEn: "Al Salam Supermarket", phone: "01001100029", city: "حلوان", address: "44 شارع المنصورية، حلوان، القاهرة", paymentTermsDays: 30, creditLimit: "80000", category: "سوبر ماركت", weight: 5 },
  { id: "CUST-H-20", code: "C-1020", nameAr: "أسواق المستقبل", nameEn: "Al Mostaqbal Markets", phone: "01001100030", city: "6 أكتوبر", address: "الحي المتميز، مدينة 6 أكتوبر، الجيزة", paymentTermsDays: 45, creditLimit: "300000", category: "سلسلة تجزئة", weight: 9, taxNumber: "310112220" },
  { id: "CUST-H-21", code: "C-1021", nameAr: "بقالة الياسمين", nameEn: "Al Yasmin Grocery", phone: "01001100031", city: "الفيوم", address: "6 شارع الحرية، الفيوم", paymentTermsDays: 15, creditLimit: "22000", category: "بقالة", weight: 3 },
  { id: "CUST-H-22", code: "C-1022", nameAr: "شركة الرواد للتوزيع", nameEn: "Al Rowad Distribution", phone: "01001100032", city: "الإسكندرية", address: "المنطقة الحرة، العامرية، الإسكندرية", paymentTermsDays: 60, creditLimit: "350000", category: "جملة", weight: 10, taxNumber: "310112222" },
];

export interface HistorySupplier {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly phone: string;
  readonly paymentTermsDays: number;
  readonly addressCity: string;
  readonly category: string;
}

export const HISTORY_SUPPLIERS: readonly HistorySupplier[] = [
  { id: "SUPP-H-01", code: "S-1001", nameAr: "شركة الدلتا للصناعات الغذائية", nameEn: "Delta Food Industries", phone: "01002200011", paymentTermsDays: 30, addressCity: "طنطا", category: "أغذية جافة" },
  { id: "SUPP-H-02", code: "S-1002", nameAr: "مصانع النيل للزيوت", nameEn: "Nile Oil Mills", phone: "01002200012", paymentTermsDays: 45, addressCity: "كفر الزيات", category: "زيوت ودهون" },
  { id: "SUPP-H-03", code: "S-1003", nameAr: "الشركة المصرية للسكر والتكرير", nameEn: "Egyptian Sugar & Refining", phone: "01002200013", paymentTermsDays: 30, addressCity: "الحوامدية", category: "سكر" },
  { id: "SUPP-H-04", code: "S-1004", nameAr: "مجموعة الأهرام للمواد الغذائية", nameEn: "Pyramids Foodstuff Group", phone: "01002200014", paymentTermsDays: 30, addressCity: "القاهرة", category: "أغذية متنوعة" },
  { id: "SUPP-H-05", code: "S-1005", nameAr: "شركة الفراعنة للمنظفات", nameEn: "Pharaohs Detergents", phone: "01002200015", paymentTermsDays: 45, addressCity: "العاشر من رمضان", category: "منظفات" },
  { id: "SUPP-H-06", code: "S-1006", nameAr: "مصنع الشروق للمكرونة", nameEn: "Al Shorouk Pasta Factory", phone: "01002200016", paymentTermsDays: 30, addressCity: "بنها", category: "مكرونة" },
  { id: "SUPP-H-07", code: "S-1007", nameAr: "الشركة العربية للألبان والأغذية", nameEn: "Arab Dairy & Food Co.", phone: "01002200017", paymentTermsDays: 30, addressCity: "القليوبية", category: "ألبان" },
  { id: "SUPP-H-08", code: "S-1008", nameAr: "مؤسسة الخليج للاستيراد", nameEn: "Gulf Import House", phone: "01002200018", paymentTermsDays: 60, addressCity: "الإسكندرية", category: "استيراد" },
  { id: "SUPP-H-09", code: "S-1009", nameAr: "شركة المصريين للمشروبات", nameEn: "Egyptians Beverages Co.", phone: "01002200019", paymentTermsDays: 21, addressCity: "السادس من أكتوبر", category: "مشروبات" },
  { id: "SUPP-H-10", code: "S-1010", nameAr: "مصنع الأمل للورق والكرتون", nameEn: "Al Amal Paper & Carton", phone: "01002200020", paymentTermsDays: 30, addressCity: "العاشر من رمضان", category: "ورقيات" },
  { id: "SUPP-H-11", code: "S-1011", nameAr: "شركة النور للإلكترونيات المنزلية", nameEn: "Al Nour Home Electronics", phone: "01002200021", paymentTermsDays: 45, addressCity: "القاهرة", category: "كهربائيات" },
];

/** Operating-expense accounts a distributor actually files its costs under. */
export const EXPENSE_ACCOUNTS = [
  { id: "5300", code: "5300", nameAr: "إيجارات", nameEn: "Rent Expense" },
  { id: "5310", code: "5310", nameAr: "مرافق وكهرباء ومياه", nameEn: "Utilities Expense" },
  { id: "5320", code: "5320", nameAr: "دعاية وتسويق", nameEn: "Marketing Expense" },
  { id: "5330", code: "5330", nameAr: "صيانة وإصلاحات", nameEn: "Maintenance Expense" },
  { id: "5340", code: "5340", nameAr: "مصروفات إدارية وعمومية", nameEn: "General & Administrative" },
] as const;

/** The recurring monthly overheads, in piastres at the start of the window. */
export const MONTHLY_EXPENSES = [
  { accountId: "5300", memoAr: "إيجار المخزن والمكتب", basePiastres: 3500000, method: "bank" as const, costCenterId: "CC-DEMO-2" },
  { accountId: "5310", memoAr: "كهرباء ومياه ومرافق", basePiastres: 620000, method: "cash" as const, costCenterId: "CC-DEMO-2" },
  { accountId: "5200", memoAr: "نولون وتوصيل للعملاء", basePiastres: 1450000, method: "cash" as const, costCenterId: "CC-DEMO-1" },
  { accountId: "5320", memoAr: "دعاية ونشر وعروض", basePiastres: 480000, method: "bank" as const, costCenterId: "CC-DEMO-1" },
  { accountId: "5330", memoAr: "صيانة سيارات التوزيع", basePiastres: 390000, method: "cash" as const, costCenterId: "CC-DEMO-1" },
  { accountId: "5340", memoAr: "مصروفات إدارية وعمومية", basePiastres: 540000, method: "bank" as const, costCenterId: "CC-DEMO-2" },
] as const;
