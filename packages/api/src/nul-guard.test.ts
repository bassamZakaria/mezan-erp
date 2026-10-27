import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { NUL_CHARACTER_REFUSED, refuseNulCharacters } from "./nul-guard.js";

function app(): Hono {
  const hono = new Hono();
  hono.use("*", refuseNulCharacters());
  hono.all("*", async (c) => c.json({ ok: true, length: (await c.req.arrayBuffer()).byteLength }));
  return hono;
}

const post = (body: string | Uint8Array, type: string, path = "/x") => app().fetch(new Request(`http://t${path}`, { method: "POST", body, headers: { "content-type": type } }));

describe("refuseNulCharacters", () => {
  it("refuses a JSON body carrying an escaped NUL, before any handler reads it", async () => {
    const res = await post(JSON.stringify({ name: "A\u0000" }), "application/json");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: NUL_CHARACTER_REFUSED });
  });

  it("refuses a raw NUL byte in a form body and a NUL in the URL", async () => {
    expect((await post("a=b\u0000", "application/x-www-form-urlencoded")).status).toBe(400);
    expect((await app().fetch(new Request("http://t/items/a%00b"))).status).toBe(400);
  });

  it("passes text that only spells out a NUL escape, and refuses a raw NUL sent with no content type", async () => {
    expect((await post(JSON.stringify({ memo: "see \\u0000 in the docs" }), "application/json")).status).toBe(200);
    const bare = await app().fetch(new Request("http://t/x", { method: "POST", body: new TextEncoder().encode("a\u0000b") }));
    expect(bare.status).toBe(400);
  });

  it("refuses JSON sent under a binary content type, since handlers parse it as JSON anyway", async () => {
    expect((await post(JSON.stringify({ name: "A\u0000" }), "application/octet-stream")).status).toBe(400);
  });

  it("refuses an encoded NUL in the query even when another escape in the URL is malformed", async () => {
    expect((await app().fetch(new Request("http://t/x?q=a%00b&z=%E0%A4%A"))).status).toBe(400);
  });

  it("passes ordinary JSON, and a multipart upload whose file bytes include zero, to the handler whole", async () => {
    expect((await post(JSON.stringify({ name: "عادي" }), "application/json")).status).toBe(200);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array([0, 1, 0, 2])]), "a.bin");
    const upload = await app().fetch(new Request("http://t/x", { method: "POST", body: form }));
    expect(upload.status).toBe(200);
  });

  it("leaves a body of unknown or excessive length to the app below when capped", async () => {
    const capped = new Hono();
    capped.use("*", refuseNulCharacters({ maxBodyBytes: 4 }));
    capped.post("*", (c) => c.json({ ok: true }));
    const res = await capped.fetch(new Request("http://t/x", { method: "POST", body: JSON.stringify({ name: "A\u0000" }), headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(200);
  });
});
