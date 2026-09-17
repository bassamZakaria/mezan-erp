import { describe, it, expect, afterEach, vi } from "vitest";
import { createServer, type Server, type Socket } from "node:net";
import { createDefaultSettings, type TenantSettings } from "@mezan/domain";
import { sendTestEmail } from "./smtp-client.js";

/**
 * The SMTP client is the one place in Mezan that takes a credential the tenant
 * typed and sends it somewhere. What these tests hold down is the part a mail
 * integration usually gets wrong: the password must never come back in an error
 * message, never reach the console, and never be sent after a requested TLS
 * upgrade has failed.
 *
 * The server below is a real socket speaking real SMTP — nothing is stubbed, so
 * a change in the protocol sequence shows up as a changed transcript.
 */

const PASSWORD = "S3cret-Shop-Pass";
const USERNAME = "shop@mezan.test";
const B64_PASSWORD = Buffer.from(PASSWORD, "utf8").toString("base64");

const servers: Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

interface FakeServer {
  readonly port: number;
  readonly transcript: string[];
  readonly connections: () => number;
  readonly stop: () => Promise<void>;
}

/**
 * A scripted SMTP server. `replies` maps a command verb (or a whole base64
 * line) to the reply sent back; the greeting is sent unprompted.
 */
function smtpServer(replies: Record<string, string>, greeting = "220 mail.test ESMTP\r\n"): Promise<FakeServer> {
  const transcript: string[] = [];
  let connections = 0;
  const server = createServer((socket: Socket) => {
    connections += 1;
    socket.setEncoding("utf8");
    socket.write(greeting);
    let inData = false;
    let buffer = "";
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf("\r\n");
      while (index !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        transcript.push(line);
        if (inData) {
          if (line === ".") {
            inData = false;
            socket.write(replies["."] ?? "250 2.0.0 Ok: queued\r\n");
          }
        } else {
          const verb = line.split(" ")[0] ?? "";
          const reply = replies[line] ?? replies[verb] ?? replies["*"] ?? "250 OK\r\n";
          if (verb === "DATA" && reply.startsWith("354")) inData = true;
          socket.write(reply);
          if (verb === "QUIT") socket.end();
        }
        index = buffer.indexOf("\r\n");
      }
    });
    socket.on("error", () => undefined);
  });
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      const stop = () => new Promise<void>((done) => server.close(() => done()));
      resolve({ port, transcript, connections: () => connections, stop });
    });
  });
}

function settingsFor(port: number, overrides: Partial<TenantSettings> = {}): TenantSettings {
  const base = createDefaultSettings();
  return {
    ...base,
    smtpEnabled: true,
    smtpHost: "127.0.0.1",
    smtpPort: port,
    smtpSecurity: "NONE",
    smtpUsername: "",
    smtpPassword: PASSWORD,
    smtpFromName: "متجر ميزان",
    smtpFromEmail: "shop@mezan.test",
    ...overrides,
  };
}

function noSecretIn(text: string) {
  expect(text).not.toContain(PASSWORD);
  expect(text).not.toContain(B64_PASSWORD);
}

describe("sendTestEmail — the credential never comes back out", () => {
  it("returns the server refusal on a failed AUTH, carrying neither the password nor its base64", async () => {
    const server = await smtpServer({
      EHLO: "250-mail.test\r\n250 AUTH LOGIN\r\n",
      AUTH: "334 VXNlcm5hbWU6\r\n",
      "*": "334 UGFzc3dvcmQ6\r\n",
      [B64_PASSWORD]: "535 5.7.8 Authentication credentials invalid\r\n",
    });

    const result = await sendTestEmail(settingsFor(server.port, { smtpUsername: USERNAME }), "owner@mezan.test");

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("auth");
    expect(result.message).toContain("535");
    noSecretIn(result.message);
    // The wire did carry it — which is the subject of the NONE test below.
    expect(server.transcript).toContain(B64_PASSWORD);
  });

  it("writes nothing to the console, so no debug line can turn the settings object into a credential dump", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const server = await smtpServer({
      EHLO: "250 mail.test\r\n",
      "*": "334 UGFzc3dvcmQ6\r\n",
      [B64_PASSWORD]: "535 nope\r\n",
    });
    await sendTestEmail(settingsFor(server.port, { smtpUsername: USERNAME }), "owner@mezan.test");

    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("reports a connection failure without the credential in the message", async () => {
    const server = await smtpServer({});
    const deadPort = server.port;
    await server.stop();
    servers.length = 0;

    const result = await sendTestEmail(settingsFor(deadPort, { smtpUsername: USERNAME }), "owner@mezan.test");
    expect(result.ok).toBe(false);
    expect(result.stage).toBe("connect");
    noSecretIn(result.message);
  });

  it("returns the disabled refusal without opening a socket at all", async () => {
    const server = await smtpServer({});
    const result = await sendTestEmail(settingsFor(server.port, { smtpEnabled: false }), "owner@mezan.test");
    expect(result).toEqual({
      ok: false,
      stage: "disabled",
      message: "البريد الإلكتروني غير مُفعَّل في الإعدادات.",
    });
    expect(server.connections()).toBe(0);
  });
});

describe("sendTestEmail — TLS is what it claims to be", () => {
  it("refuses to fall back to plaintext when TLS is configured and the server speaks none", async () => {
    // A plain SMTP server answering a TLS connect must fail, never silently
    // continue in the clear. If this ever passes, every credential configured
    // as TLS is crossing the shop wifi readable.
    const server = await smtpServer({ EHLO: "250 mail.test\r\n" });
    const result = await sendTestEmail(
      settingsFor(server.port, { smtpSecurity: "TLS", smtpUsername: USERNAME }),
      "owner@mezan.test",
    );

    expect(result.ok).toBe(false);
    noSecretIn(result.message);
    expect(server.transcript).not.toContain(B64_PASSWORD);
  });

  it("sends no credential when the requested STARTTLS upgrade is refused", async () => {
    const server = await smtpServer({
      EHLO: "250-mail.test\r\n250 STARTTLS\r\n",
      STARTTLS: "454 4.7.0 TLS not available due to temporary reason\r\n",
    });
    const result = await sendTestEmail(
      settingsFor(server.port, { smtpSecurity: "STARTTLS", smtpUsername: USERNAME }),
      "owner@mezan.test",
    );

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("starttls");
    noSecretIn(result.message);
    expect(server.transcript).toContain("STARTTLS");
    expect(server.transcript.some((line) => line.startsWith("AUTH"))).toBe(false);
    expect(server.transcript).not.toContain(B64_PASSWORD);
  });

  it("refuses to send the password unencrypted to a remote host, rather than downgrading quietly (D133)", async () => {
    // AUTH LOGIN is base64 — an encoding, not encryption — so on a plain
    // connection anyone with a packet capture reverses it in one step. The
    // settings screen offers NONE, so the refusal lives here, where every
    // caller passes, and not on the screen.
    const server = await smtpServer({
      EHLO: "250-mail.test\r\n250 AUTH LOGIN\r\n",
      AUTH: "334 VXNlcm5hbWU6\r\n",
      "*": "334 UGFzc3dvcmQ6\r\n",
      [B64_PASSWORD]: "235 2.7.0 Authentication successful\r\n",
    });

    const result = await sendTestEmail(
      settingsFor(server.port, { smtpUsername: USERNAME, smtpHost: "mail.example.com" }),
      "owner@mezan.test",
    );

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("auth");
    expect(result.message).toContain("غير مُشفَّر");
    noSecretIn(result.message);
    // And nothing resembling the password reached the wire.
    expect(server.transcript).not.toContain(B64_PASSWORD);
  });

  it("still allows an unencrypted AUTH to a loopback relay, where there is no wire to capture", async () => {
    // A local postfix or a relay bound to 127.0.0.1 is an ordinary small-shop
    // setup and has no network segment between the two ends.
    const server = await smtpServer({
      EHLO: "250-mail.test\r\n250 AUTH LOGIN\r\n",
      AUTH: "334 VXNlcm5hbWU6\r\n",
      "*": "334 UGFzc3dvcmQ6\r\n",
      [B64_PASSWORD]: "235 2.7.0 Authentication successful\r\n",
      MAIL: "250 OK\r\n",
      RCPT: "250 OK\r\n",
      DATA: "354 End data with .\r\n",
      ".": "250 2.0.0 Ok: queued\r\n",
      QUIT: "221 Bye\r\n",
    });

    const result = await sendTestEmail(settingsFor(server.port, { smtpUsername: USERNAME }), "owner@mezan.test");
    expect(result.ok).toBe(true);
    expect(server.transcript).toContain(B64_PASSWORD);
  });

  it("sends with no AUTH at all over a plain connection, so a passwordless relay still works", async () => {
    const server = await smtpServer({
      EHLO: "250 mail.test\r\n",
      MAIL: "250 OK\r\n",
      RCPT: "250 OK\r\n",
      DATA: "354 End data with .\r\n",
      ".": "250 2.0.0 Ok: queued\r\n",
      QUIT: "221 Bye\r\n",
    });

    const result = await sendTestEmail(settingsFor(server.port, { smtpUsername: "" }), "owner@mezan.test");
    expect(result.ok).toBe(true);
  });
});

describe("sendTestEmail — the message it actually builds", () => {
  it("runs a real MAIL FROM / RCPT TO / DATA exchange with an RFC 2047 encoded Arabic subject", async () => {
    const server = await smtpServer({
      EHLO: "250 mail.test\r\n",
      MAIL: "250 OK\r\n",
      RCPT: "250 OK\r\n",
      DATA: "354 End data with .\r\n",
      ".": "250 2.0.0 Ok: queued as XYZ789\r\n",
      QUIT: "221 Bye\r\n",
    });

    const result = await sendTestEmail(settingsFor(server.port), "owner@mezan.test");

    expect(result.ok).toBe(true);
    expect(result.stage).toBe("done");
    expect(result.message).toContain("owner@mezan.test");
    expect(result.message).toContain("XYZ789");
    expect(server.transcript).toContain("MAIL FROM:<shop@mezan.test>");
    expect(server.transcript).toContain("RCPT TO:<owner@mezan.test>");

    const subject = server.transcript.find((line) => line.startsWith("Subject:"));
    expect(subject).toBeDefined();
    const encoded = subject!.replace("Subject: =?UTF-8?B?", "").replace("?=", "");
    expect(Buffer.from(encoded, "base64").toString("utf8")).toContain("رسالة اختبار من ميزان");

    const from = server.transcript.find((line) => line.startsWith("From:"));
    expect(from).toContain("<shop@mezan.test>");
    // The display name is encoded, never sent as raw UTF-8 in a 7-bit header.
    expect(from).not.toContain("متجر ميزان");
  });

  it("stops at the greeting when the server opens with a rejection, and never announces itself", async () => {
    const server = await smtpServer({}, "554 5.7.1 Service unavailable\r\n");
    const result = await sendTestEmail(settingsFor(server.port), "owner@mezan.test");

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("greeting");
    expect(result.message).toContain("554");
    expect(server.transcript).toEqual([]);
  });
});
