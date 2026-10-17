import { lookup } from "node:dns/promises";
import { connect as netConnect, isIP, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
import type { TenantSettings } from "@mezan/domain";
import { SmtpStage, type TestEmailResultDTO } from "@mezan/contracts";
import { isBlockedWebhookAddress } from "./blocked-address.js";

/**
 * The eight fields this whole file actually touches — narrower than
 * `TenantSettings` on purpose, so a caller with no tenant yet (the platform
 * signup flow, which mails a verification link before any tenant exists) can
 * build one from plain server env vars instead of faking an entire tenant.
 * Every `TenantSettings` already satisfies this structurally.
 */
export type SmtpConfig = Pick<
  TenantSettings,
  "smtpEnabled" | "smtpHost" | "smtpPort" | "smtpSecurity" | "smtpUsername" | "smtpPassword" | "smtpFromName" | "smtpFromEmail"
>;

/**
 * A deliberately small SMTP client for the البريد الإلكتروني settings tab's
 * "send a test email" action. Mezan ships offline with no mail dependency, so
 * this speaks the protocol directly over a socket: greeting, EHLO, optional
 * STARTTLS upgrade, optional AUTH LOGIN, then a real MAIL FROM / RCPT TO /
 * DATA exchange. Nothing is simulated — a failure here is the mail server's
 * actual reply, which is the only thing that makes the button worth pressing.
 */

const TIMEOUT_MS = 10_000;

type Stage = TestEmailResultDTO["stage"];

class SmtpFailure extends Error {
  constructor(
    readonly stage: Stage,
    message: string,
  ) {
    super(message);
    this.name = "SmtpFailure";
  }
}

class SmtpSession {
  private buffer = "";
  private waiting: ((line: string) => void) | null = null;
  private failed: string | null = null;

  constructor(private socket: Socket) {
    this.attach(socket);
  }

  private attach(socket: Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on("error", (err: Error) => {
      this.failed = err.message;
      this.drain();
    });
  }

  /** Swaps the plain socket for the TLS one after a STARTTLS upgrade. */
  replaceSocket(socket: Socket) {
    this.socket.removeAllListeners("data");
    this.socket.removeAllListeners("error");
    this.socket = socket;
    this.buffer = "";
    this.attach(socket);
  }

  private drain() {
    if (!this.waiting) return;
    // A multiline SMTP reply repeats its code with a hyphen; only "NNN " ends it.
    const match = /^(?:\d{3}-[^\n]*\n)*\d{3} [^\n]*\n/.exec(this.buffer);
    if (match) {
      const reply = match[0];
      this.buffer = this.buffer.slice(reply.length);
      const resolve = this.waiting;
      this.waiting = null;
      resolve(reply.trim());
      return;
    }
    if (this.failed) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve(`000 ${this.failed}`);
    }
  }

  private readReply(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting = null;
        reject(new Error("SMTP server did not reply in time"));
      }, TIMEOUT_MS);
      this.waiting = (line) => {
        clearTimeout(timer);
        resolve(line);
      };
      this.drain();
    });
  }

  async expect(stage: Stage, codes: readonly string[], command?: string): Promise<string> {
    if (command !== undefined) this.socket.write(`${command}\r\n`);
    const reply = await this.readReply();
    if (!codes.some((code) => reply.startsWith(code))) {
      throw new SmtpFailure(stage, reply);
    }
    return reply;
  }

  write(text: string) {
    this.socket.write(text);
  }

  get raw(): Socket {
    return this.socket;
  }

  close() {
    this.socket.destroy();
  }
}

function openSocket(host: string, address: string, port: number, useTls: boolean): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const servername = isIP(host) === 0 ? host : undefined;
    const socket = useTls
      ? tlsConnect({ host: address, port, ...(servername ? { servername } : {}) }, () => resolve(socket))
      : netConnect({ host: address, port }, () => resolve(socket));
    socket.setTimeout(TIMEOUT_MS, () => {
      socket.destroy();
      reject(new Error(`تعذّر الاتصال بخادم البريد ${host}:${port} خلال المهلة المحددة`));
    });
    socket.once("error", (err: Error) => reject(err));
  });
}

function upgradeToTls(socket: Socket, host: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const secure = tlsConnect({ socket, host, ...(isIP(host) === 0 ? { servername: host } : {}) }, () => resolve(secure));
    secure.once("error", (err: Error) => reject(err));
  });
}

/** RFC 2047 encoded-word, so an Arabic subject survives a 7-bit header. */
function encodeHeader(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export interface OutgoingMail {
  readonly subject: string;
  readonly body: string;
  readonly html?: string;
}

function base64Lines(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
}

function buildMessage(settings: SmtpConfig, to: string, message?: OutgoingMail): string {
  const from = settings.smtpFromName
    ? `${encodeHeader(settings.smtpFromName)} <${settings.smtpFromEmail}>`
    : settings.smtpFromEmail;
  const subject = encodeHeader(message?.subject ?? "رسالة اختبار من ميزان — Mezan test message");
  const body = message?.body ?? [
    "تم إرسال هذه الرسالة من شاشة إعدادات البريد الإلكتروني للتأكد من صحة الإعداد.",
    "This message was sent from the email settings screen to verify the configuration.",
    "",
    `SMTP: ${settings.smtpHost}:${settings.smtpPort} (${settings.smtpSecurity})`,
  ].join("\r\n");

  if (message?.html) {
    const boundary = `mezan-alt-${Buffer.from(`${to}${subject}`, "utf8").toString("hex").slice(0, 24)}`;
    return [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(body),
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(message.html),
      `--${boundary}--`,
      "",
    ].join("\r\n");
  }

  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(body),
    "",
  ].join("\r\n");
}

/**
 * A relay on this same machine, where an unencrypted AUTH has no wire to cross.
 *
 * This is the one case D133's refusal must not break: a local postfix or a
 * corporate relay bound to loopback is an ordinary small-shop setup, and there
 * is no network segment between the two ends to capture. Anything else — a
 * hostname, a LAN address, a public MX — is a real wire, and base64 over it is
 * plaintext.
 */
function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "::1" || /^127\.\d+\.\d+\.\d+$/.test(normalized);
}

export enum SmtpDestinationPolicy {
  AnyHost = "any_host",
  PublicOnly = "public_only",
}

export interface SmtpSendOptions {
  readonly destinations?: SmtpDestinationPolicy;
}

const PUBLIC_SMTP_PORTS: ReadonlySet<number> = new Set([25, 465, 587]);
const MAIL_HOST = /^[A-Za-z0-9.:[\]-]+$/;
const MAILBOX = /^[^\s<>()@",;:\\[\]]+@[^\s<>()@",;:\\[\]]+\.[^\s<>()@",;:\\[\]]+$/;

const REFUSED_DESTINATION =
  "لا يُسمح بالإرسال إلى خادم البريد هذا: يجب أن يكون عنوانًا عامًا على المنفذ 25 أو 465 أو 587. — This mail server is not allowed: it must be a public address on port 25, 465 or 587.";
const INVALID_ADDRESS = "عنوان البريد الإلكتروني للمرسل أو المستلم غير صالح. — The sender or recipient email address is not valid.";
const INVALID_HOST = "اسم خادم البريد غير صالح. — The mail server name is not valid.";

const GUARDED_FAILURE: Readonly<Record<SmtpStage, string>> = {
  [SmtpStage.Disabled]: "البريد الإلكتروني غير مُفعَّل في الإعدادات. — Email is not enabled in the settings.",
  [SmtpStage.Refused]: REFUSED_DESTINATION,
  [SmtpStage.Connect]: "تعذّر الاتصال بخادم البريد. — Could not connect to the mail server.",
  [SmtpStage.Greeting]: "رفض خادم البريد بدء الجلسة. — The mail server refused the session.",
  [SmtpStage.Ehlo]: "رفض خادم البريد بدء الجلسة. — The mail server refused the session.",
  [SmtpStage.StartTls]: "تعذّر تشفير الاتصال بخادم البريد. — The connection to the mail server could not be encrypted.",
  [SmtpStage.Auth]: "رفض خادم البريد اسم المستخدم أو كلمة المرور. — The mail server rejected the username or password.",
  [SmtpStage.Send]: "رفض خادم البريد المرسل أو المستلم أو الرسالة. — The mail server rejected the sender, recipient or message.",
  [SmtpStage.Done]: "تم إرسال الرسالة. — The message was sent.",
};

class SmtpDestinationRefused extends Error {}

function withLookupDeadline<T>(work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("SMTP host lookup timed out")), TIMEOUT_MS);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

// SECURITY: returns the ADDRESS the socket must dial. Every answer is vetted and only a vetted
// answer is dialled — checking one resolution and connecting by name would be DNS rebinding.
async function publicDialAddress(host: string): Promise<string> {
  const bare = host.replace(/^\[|\]$/g, "");
  if (isIP(bare) !== 0) {
    if (isBlockedWebhookAddress(bare)) throw new SmtpDestinationRefused();
    return bare;
  }
  const answers = await withLookupDeadline(lookup(bare, { all: true, verbatim: true }));
  if (answers.length === 0) throw new Error("SMTP host did not resolve");
  for (const { address } of answers) {
    if (isBlockedWebhookAddress(address)) throw new SmtpDestinationRefused();
  }
  return answers[0]!.address;
}

export async function sendTestEmail(
  settings: SmtpConfig,
  to: string,
  message?: OutgoingMail,
  options: SmtpSendOptions = {},
): Promise<TestEmailResultDTO> {
  if (!settings.smtpEnabled) {
    return { ok: false, stage: SmtpStage.Disabled, message: "البريد الإلكتروني غير مُفعَّل في الإعدادات." };
  }

  // SECURITY: the last line before CR/LF reaches MAIL FROM, RCPT TO, EHLO or a header. Addresses
  // arrive from stored settings and customer and user rows, not only from a validated request.
  if (!MAILBOX.test(to) || !MAILBOX.test(settings.smtpFromEmail)) {
    return { ok: false, stage: SmtpStage.Send, message: INVALID_ADDRESS };
  }
  if (!MAIL_HOST.test(settings.smtpHost)) {
    return { ok: false, stage: SmtpStage.Refused, message: INVALID_HOST };
  }

  const guarded = options.destinations === SmtpDestinationPolicy.PublicOnly;
  if (guarded && !PUBLIC_SMTP_PORTS.has(settings.smtpPort)) {
    return { ok: false, stage: SmtpStage.Refused, message: REFUSED_DESTINATION };
  }

  /*
   * AUTH LOGIN is base64, which is an encoding and not encryption: on a plain
   * connection the password goes over the wire in a form anyone watching reads
   * back in one step. It used to be attempted whenever a username was set,
   * whatever the transport (D133).
   *
   * Checked BEFORE the socket is opened — there is no reason to connect to a
   * server we are about to refuse — and checked HERE rather than at the
   * settings screen, because the screen is not the only way these settings
   * arrive. A relay with no TLS still works; it just cannot be handed a
   * password to leak.
   */
  if (settings.smtpUsername && settings.smtpSecurity === "NONE" && (guarded || !isLoopbackHost(settings.smtpHost))) {
    return {
      ok: false,
      stage: SmtpStage.Auth,
      message:
        "لا يمكن إرسال كلمة المرور عبر اتصال غير مُشفَّر. اختر TLS أو STARTTLS، أو امسح اسم المستخدم للإرسال بدون مصادقة.",
    };
  }

  let session: SmtpSession | null = null;
  try {
    const address = guarded ? await publicDialAddress(settings.smtpHost) : settings.smtpHost;
    const socket = await openSocket(settings.smtpHost, address, settings.smtpPort, settings.smtpSecurity === "TLS");
    session = new SmtpSession(socket);

    await session.expect(SmtpStage.Greeting, ["220"]);
    await session.expect(SmtpStage.Ehlo, ["250"], `EHLO ${settings.smtpHost}`);

    if (settings.smtpSecurity === "STARTTLS") {
      await session.expect(SmtpStage.StartTls, ["220"], "STARTTLS");
      session.replaceSocket(await upgradeToTls(session.raw, settings.smtpHost));
      await session.expect(SmtpStage.Ehlo, ["250"], `EHLO ${settings.smtpHost}`);
    }

    if (settings.smtpUsername) {
      await session.expect(SmtpStage.Auth, ["334"], "AUTH LOGIN");
      await session.expect(SmtpStage.Auth, ["334"], Buffer.from(settings.smtpUsername, "utf8").toString("base64"));
      await session.expect(SmtpStage.Auth, ["235"], Buffer.from(settings.smtpPassword, "utf8").toString("base64"));
    }

    await session.expect(SmtpStage.Send, ["250"], `MAIL FROM:<${settings.smtpFromEmail}>`);
    await session.expect(SmtpStage.Send, ["250", "251"], `RCPT TO:<${to}>`);
    await session.expect(SmtpStage.Send, ["354"], "DATA");
    session.write(buildMessage(settings, to, message));
    const accepted = await session.expect(SmtpStage.Send, ["250"], ".");
    session.expect(SmtpStage.Done, ["221"], "QUIT").catch(() => undefined);

    return { ok: true, stage: SmtpStage.Done, message: guarded ? `تم إرسال رسالة الاختبار إلى ${to}` : `تم إرسال رسالة الاختبار إلى ${to} — ${accepted}` };
  } catch (err) {
    // SECURITY: on the cloud a reply line or socket error is another host's banner or an internal
    // address; the tenant is told the stage, never what the far end said.
    if (err instanceof SmtpDestinationRefused) return { ok: false, stage: SmtpStage.Refused, message: REFUSED_DESTINATION };
    if (err instanceof SmtpFailure) return { ok: false, stage: err.stage, message: guarded ? GUARDED_FAILURE[err.stage] : err.message };
    return {
      ok: false,
      stage: SmtpStage.Connect,
      message: guarded ? GUARDED_FAILURE[SmtpStage.Connect] : err instanceof Error ? err.message : "تعذّر الاتصال بخادم البريد.",
    };
  } finally {
    session?.close();
  }
}


/**
 * Sends one real notification email, reusing `sendTestEmail`'s whole session —
 * the same TLS handling, the same refusal to put a password on a plain wire
 * (D133), the same Arabic failure text.
 *
 * The RESULT SHAPE is what matters to the dispatcher, and it is deliberately
 * three-valued rather than a boolean. A shop with no internet is this product's
 * normal state, so "could not connect" must be distinguishable from "the server
 * said no": the first is retried unchanged, the second is terminal. Collapsing
 * them is how a queue either never drains or silently discards mail.
 */
export async function sendNotificationEmail(
  settings: SmtpConfig,
  to: string,
  message: OutgoingMail,
  options: SmtpSendOptions = {},
): Promise<{ outcome: "sent" | "offline" | "rejected"; detail: string }> {
  const result = await sendTestEmail(settings, to, message, options);
  if (result.ok) return { outcome: "sent", detail: result.message };
  // `connect` is the only stage that means "no path to the server". Everything
  // else — a refused auth, a rejected recipient, a disabled configuration, a
  // destination the cloud will not dial — is the server or the tenant saying
  // no, and retrying it changes nothing.
  const offline = result.stage === SmtpStage.Connect;
  return { outcome: offline ? "offline" : "rejected", detail: result.message };
}
