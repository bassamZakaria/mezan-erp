import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLOUD_SITE_META } from "@mezan/contracts";
import { withCloudSiteHead } from "./site-head.js";

const WEB_INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/index.html");

describe("withCloudSiteHead", () => {
  it("stamps the marker the web app looks for into the real web index.html, once", () => {
    const html = withCloudSiteHead(readFileSync(WEB_INDEX, "utf8"));

    expect(html.split(`<meta name="${CLOUD_SITE_META.name}" content="${CLOUD_SITE_META.content}">`)).toHaveLength(2);
    expect(html.indexOf(CLOUD_SITE_META.name)).toBeLessThan(html.indexOf("</head>"));
    expect(html).toContain("<title>ميزان | برنامج محاسبة ومخزون ومبيعات بالعربية</title>");
  });
});
