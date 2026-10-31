import { describe, expect, it } from "vitest";
import { contactHref, contactLinkProps } from "./site";

describe("contactHref", () => {
  it("prefers WhatsApp, then email, then phone", () => {
    expect(contactHref({ whatsapp: "201001234567", email: "hi@mezan.example", phone: "+20 100 123 4567" })).toBe("https://wa.me/201001234567");
    expect(contactHref({ whatsapp: null, email: "hi@mezan.example", phone: "+20 100 123 4567" })).toBe("mailto:hi@mezan.example");
    expect(contactHref({ whatsapp: null, email: null, phone: "+20 100 123 4567" })).toBe("tel:+201001234567");
  });

  it("offers no link when no channel is configured or none is known yet", () => {
    expect(contactHref({ whatsapp: null, email: null, phone: null })).toBeNull();
    expect(contactHref(null)).toBeNull();
  });
});

describe("contactLinkProps", () => {
  it("opens only a web link in a new tab", () => {
    expect(contactLinkProps("https://wa.me/1")).toEqual({ href: "https://wa.me/1", target: "_blank", rel: "noopener noreferrer" });
    expect(contactLinkProps("mailto:hi@mezan.example")).toEqual({ href: "mailto:hi@mezan.example" });
  });
});
