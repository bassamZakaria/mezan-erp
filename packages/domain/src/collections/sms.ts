import type { DispatchOutcome } from "../notifications/dispatcher.js";

export interface SmsProvider {
  readonly id: string;
  send(to: string, text: string): Promise<DispatchOutcome>;
}
