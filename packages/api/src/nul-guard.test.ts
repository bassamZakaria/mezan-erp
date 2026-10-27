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

  it("passes ordinary JSON, and a binary upload whose bytes include zero, to the handler whole", async () => {
    expect((await post(JSON.stringify({ name: "عادي" }), "application/json")).status).toBe(200);
    const upload = await post(new Uint8Array([0, 1, 0, 2]), "application/octet-stream");
    expect(upload.status).toBe(200);
    expect(await upload.json()).toMatchObject({ length: 4 });
  });
});
