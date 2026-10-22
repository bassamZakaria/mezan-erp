export const SITE_META_NAME = "mezan-site";
export const CLOUD_SITE = "cloud";

const TITLE = "ميزان | برنامج محاسبة ومخزون ومبيعات بالعربية";
const DESCRIPTION =
  "حسابات ومخزون ومبيعات وخزينة وشيكات وأقساط في برنامج عربي واحد للشركات المصرية. جرّب كل المزايا بلا بطاقة ائتمان، ثم تابع على الباقة المجانية.";

// INVARIANT: the web app shows the public landing page at `/` only when this marker is present. Only the
// cloud mount adds it; the desktop and LAN mounts serve the same bundle and must keep opening the login.
const SITE_HEAD = [
  `<meta name="${SITE_META_NAME}" content="${CLOUD_SITE}">`,
  `<meta name="description" content="${DESCRIPTION}">`,
  `<meta property="og:type" content="website">`,
  `<meta property="og:locale" content="ar_EG">`,
  `<meta property="og:site_name" content="Mezan · ميزان">`,
  `<meta property="og:title" content="${TITLE}">`,
  `<meta property="og:description" content="${DESCRIPTION}">`,
  `<meta name="twitter:card" content="summary">`,
].join("");

export function withCloudSiteHead(html: string): string {
  return html.replace(/<title>[^<]*<\/title>/, `<title>${TITLE}</title>`).replace("</head>", `${SITE_HEAD}</head>`);
}
