import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
import type { TenantSettings } from "@mezan/domain";
import type { TestEmailResultDTO } from "@mezan/contracts";

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

function openSocket(host: string, port: number, useTls: boolean): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = useTls
      ? tlsConnect({ host, port, servername: host }, () => resolve(socket))
      : netConnect({ host, port }, () => resolve(socket));
    socket.setTimeout(TIMEOUT_MS, () => {
      socket.destroy();
      reject(new Error(`تعذّر الاتصال بخادم البريد ${host}:${port} خلال المهلة المحددة`));
    });
    socket.once("error", (err: Error) => reject(err));
  });
}

function upgradeToTls(socket: Socket, host: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const secure = tlsConnect({ socket, servername: host }, () => resolve(secure));
    secure.once("error", (err: Error) => reject(err));
  });
}

/** RFC 2047 encoded-word, so an Arabic subject survives a 7-bit header. */
function encodeHeader(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function buildMessage(settings: TenantSettings, to: string): string {
  const from = settings.smtpFromName
    ? `${encodeHeader(settings.smtpFromName)} <${settings.smtpFromEmail}>`
    : settings.smtpFromEmail;
  const subject = encodeHeader("رسالة اختبار من ميزان — Mezan test message");
  const body = [
    "تم إرسال هذه الرسالة من شاشة إعدادات البريد الإلكتروني للتأكد من صحة الإعداد.",
    "This message was sent from the email settings screen to verify the configuration.",
    "",
    `SMTP: ${settings.smtpHost}:${settings.smtpPort} (${settings.smtpSecurity})`,
  ].join("\r\n");

  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
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

export async function sendTestEmail(settings: TenantSettings, to: string): Promise<TestEmailResultDTO> {
  if (!settings.smtpEnabled) {
    return { ok: false, stage: "disabled", message: "البريد الإلكتروني غير مُفعَّل في الإعدادات." };
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
  if (settings.smtpUsername && settings.smtpSecurity === "NONE" && !isLoopbackHost(settings.smtpHost)) {
    return {
      ok: false,
      stage: "auth",
      message:
        "لا يمكن إرسال كلمة المرور عبر اتصال غير مُشفَّر. اختر TLS أو STARTTLS، أو امسح اسم المستخدم للإرسال بدون مصادقة.",
    };
  }

  let session: SmtpSession | null = null;
  try {
    const socket = await openSocket(settings.smtpHost, settings.smtpPort, settings.smtpSecurity === "TLS");
    session = new SmtpSession(socket);

    await session.expect("greeting", ["220"]);
    await session.expect("ehlo", ["250"], `EHLO ${settings.smtpHost}`);

    if (settings.smtpSecurity === "STARTTLS") {
      await session.expect("starttls", ["220"], "STARTTLS");
      session.replaceSocket(await upgradeToTls(session.raw, settings.smtpHost));
      await session.expect("ehlo", ["250"], `EHLO ${settings.smtpHost}`);
    }

    if (settings.smtpUsername) {
      await session.expect("auth", ["334"], "AUTH LOGIN");
      await session.expect("auth", ["334"], Buffer.from(settings.smtpUsername, "utf8").toString("base64"));
      await session.expect("auth", ["235"], Buffer.from(settings.smtpPassword, "utf8").toString("base64"));
    }

    await session.expect("send", ["250"], `MAIL FROM:<${settings.smtpFromEmail}>`);
    await session.expect("send", ["250", "251"], `RCPT TO:<${to}>`);
    await session.expect("send", ["354"], "DATA");
    session.write(buildMessage(settings, to));
    const accepted = await session.expect("send", ["250"], ".");
    session.expect("done", ["221"], "QUIT").catch(() => undefined);

    return { ok: true, stage: "done", message: `تم إرسال رسالة الاختبار إلى ${to} — ${accepted}` };
  } catch (err) {
    if (err instanceof SmtpFailure) return { ok: false, stage: err.stage, message: err.message };
    return {
      ok: false,
      stage: "connect",
      message: err instanceof Error ? err.message : "تعذّر الاتصال بخادم البريد.",
    };
  } finally {
    session?.close();
  }
}
