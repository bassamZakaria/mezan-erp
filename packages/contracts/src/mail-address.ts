import { z } from "zod";

// SECURITY: an address that reaches SMTP is written into MAIL FROM / RCPT TO and the From/To
// headers verbatim. `.email()` admits no CR, LF or whitespace, so no address can split a command
// or a header. Empty stays allowed: it is how a form says "no address".
export const mailAddressInput = z.union([z.literal(""), z.string().trim().email()]);
