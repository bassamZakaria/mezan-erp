/**
 * كود النشاط — the taxpayer's activity code as registered with the Egyptian Tax
 * Authority. The authority publishes the full ISIC rev.4 tree; this is the
 * subset an SMB in this product's market actually registers under, searchable
 * the way the reference product's lookup is.
 */

export interface EtaActivityCode {
  readonly code: string;
  readonly labelAr: string;
  readonly labelEn: string;
}

export const ETA_ACTIVITY_CODES: readonly EtaActivityCode[] = [
  { code: "0111", labelAr: "زراعة الحبوب والمحاصيل", labelEn: "Growing of cereals and crops" },
  { code: "1010", labelAr: "تجهيز وحفظ اللحوم", labelEn: "Processing and preserving of meat" },
  { code: "1071", labelAr: "صناعة المخبوزات", labelEn: "Manufacture of bakery products" },
  { code: "1392", labelAr: "صناعة المنسوجات الجاهزة عدا الملابس", labelEn: "Manufacture of made-up textile articles" },
  { code: "1410", labelAr: "صناعة الملابس عدا الفراء", labelEn: "Manufacture of wearing apparel" },
  { code: "1622", labelAr: "صناعة منتجات النجارة للبناء", labelEn: "Manufacture of builders' carpentry and joinery" },
  { code: "2011", labelAr: "صناعة الكيماويات الأساسية", labelEn: "Manufacture of basic chemicals" },
  { code: "2100", labelAr: "صناعة المستحضرات الصيدلانية", labelEn: "Manufacture of pharmaceuticals" },
  { code: "2220", labelAr: "صناعة منتجات اللدائن", labelEn: "Manufacture of plastics products" },
  { code: "2511", labelAr: "صناعة المنتجات المعدنية الإنشائية", labelEn: "Manufacture of structural metal products" },
  { code: "3100", labelAr: "صناعة الأثاث", labelEn: "Manufacture of furniture" },
  { code: "4100", labelAr: "تشييد المباني", labelEn: "Construction of buildings" },
  { code: "4290", labelAr: "تشييد مشروعات هندسة مدنية أخرى", labelEn: "Construction of other civil engineering projects" },
  { code: "4321", labelAr: "التركيبات الكهربائية", labelEn: "Electrical installation" },
  { code: "4520", labelAr: "صيانة وإصلاح المركبات ذات المحركات", labelEn: "Maintenance and repair of motor vehicles" },
  { code: "4610", labelAr: "البيع بالجملة بمقابل أو على أساس عقد", labelEn: "Wholesale on a fee or contract basis" },
  { code: "4630", labelAr: "تجارة الجملة في الأغذية والمشروبات", labelEn: "Wholesale of food and beverages" },
  { code: "4649", labelAr: "تجارة الجملة في السلع المنزلية الأخرى", labelEn: "Wholesale of other household goods" },
  { code: "4659", labelAr: "تجارة الجملة في الآلات والمعدات", labelEn: "Wholesale of machinery and equipment" },
  { code: "4711", labelAr: "البيع بالتجزئة في المتاجر غير المتخصصة", labelEn: "Retail sale in non-specialised stores" },
  { code: "4719", labelAr: "البيع بالتجزئة الأخرى في المتاجر غير المتخصصة", labelEn: "Other retail sale in non-specialised stores" },
  { code: "4752", labelAr: "بيع أدوات ومعدات البناء بالتجزئة", labelEn: "Retail sale of hardware and building materials" },
  { code: "4772", labelAr: "بيع المستحضرات الطبية بالتجزئة (صيدليات)", labelEn: "Retail sale of pharmaceutical goods" },
  { code: "4923", labelAr: "نقل البضائع بالطرق البرية", labelEn: "Freight transport by road" },
  { code: "5610", labelAr: "المطاعم وخدمات الأطعمة المتنقلة", labelEn: "Restaurants and mobile food service" },
  { code: "6201", labelAr: "أنشطة برمجة الحاسب", labelEn: "Computer programming activities" },
  { code: "6202", labelAr: "الاستشارات في مجال الحاسب", labelEn: "Computer consultancy activities" },
  { code: "6810", labelAr: "الأنشطة العقارية في الممتلكات المملوكة", labelEn: "Real estate activities with own property" },
  { code: "6920", labelAr: "أنشطة المحاسبة ومراجعة الحسابات", labelEn: "Accounting and auditing activities" },
  { code: "7110", labelAr: "الأنشطة الهندسية والاستشارات الفنية", labelEn: "Engineering activities and technical consultancy" },
  { code: "7310", labelAr: "الإعلان", labelEn: "Advertising" },
  { code: "8610", labelAr: "أنشطة المستشفيات", labelEn: "Hospital activities" },
  { code: "8560", labelAr: "الأنشطة المساندة للتعليم", labelEn: "Educational support activities" },
  { code: "9511", labelAr: "إصلاح الحاسبات والأجهزة الملحقة", labelEn: "Repair of computers and peripheral equipment" },
] as const;

export function findEtaActivityCode(code: string): EtaActivityCode | null {
  return ETA_ACTIVITY_CODES.find((a) => a.code === code) ?? null;
}

/** Search by code prefix or by either label; an empty query returns the whole list. */
export function searchEtaActivityCodes(query: string, limit = 20): EtaActivityCode[] {
  const q = query.trim().toLowerCase();
  const matches = q === ""
    ? [...ETA_ACTIVITY_CODES]
    : ETA_ACTIVITY_CODES.filter(
        (a) => a.code.startsWith(q) || a.labelAr.includes(query.trim()) || a.labelEn.toLowerCase().includes(q),
      );
  return matches.slice(0, limit);
}
