import { CLOUD_SITE_META, DEPLOYMENT_ENVIRONMENT_META, DeploymentEnvironment } from "@mezan/contracts";

const TITLE = "ميزان | برنامج محاسبة ومخزون ومبيعات بالعربية";
const DESCRIPTION =
  "حسابات ومخزون ومبيعات وخزينة وشيكات وأقساط في برنامج عربي واحد للشركات المصرية. جرّب كل المزايا بلا بطاقة ائتمان، ثم تابع على الباقة المجانية.";

const SITE_HEAD = [
  `<meta name="${CLOUD_SITE_META.name}" content="${CLOUD_SITE_META.content}">`,
  `<meta name="description" content="${DESCRIPTION}">`,
  `<meta property="og:type" content="website">`,
  `<meta property="og:locale" content="ar_EG">`,
  `<meta property="og:site_name" content="Mezan · ميزان">`,
  `<meta property="og:title" content="${TITLE}">`,
  `<meta property="og:description" content="${DESCRIPTION}">`,
  `<meta name="twitter:card" content="summary">`,
].join("");

export function withCloudSiteHead(html: string): string {
  return html.replace(/<title>[^<]*<\/title>/, () => `<title>${TITLE}</title>`).replace("</head>", () => `${SITE_HEAD}</head>`);
}

export function withDeploymentEnvironmentMeta(html: string, environment: DeploymentEnvironment | undefined): string {
  if (environment !== DeploymentEnvironment.Staging) return html;
  return html.replace("</head>", () => `<meta name="${DEPLOYMENT_ENVIRONMENT_META}" content="${environment}"></head>`);
}
