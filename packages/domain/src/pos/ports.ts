import type { PosPaymentMethod } from "./payment-method.js";
import type { PosSettings } from "./settings.js";
import type { ShiftTemplate } from "./shift-template.js";
import type { PosTerminal } from "./terminal.js";

export interface PosTerminalRepository {
  list(): Promise<readonly PosTerminal[]>;
  findById(id: string): Promise<PosTerminal | null>;
  findByCode(code: string): Promise<PosTerminal | null>;
  /** Writes everything but the sealed secrets and the receipt counter; a new serial clears both secrets. */
  save(terminal: PosTerminal): Promise<void>;
  setEtaPosClientSecret(terminalId: string, secret: string): Promise<void>;
  setEtaPosPresharedKey(terminalId: string, key: string): Promise<void>;
  /** SECURITY: the only reader of the sealed secrets — for the ETA transmit leg, never for a response. */
  readEtaDeviceSecrets(terminalId: string): Promise<{ readonly clientSecret: string | null; readonly presharedKey: string | null }>;
  /** Advances and returns the terminal's receipt counter in one statement. */
  nextReceiptSeq(terminalId: string): Promise<number>;
}

export interface PosPaymentMethodRepository {
  list(): Promise<readonly PosPaymentMethod[]>;
  findById(id: string): Promise<PosPaymentMethod | null>;
  findByCode(code: string): Promise<PosPaymentMethod | null>;
  save(method: PosPaymentMethod): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface PosSettingsRepository {
  get(): Promise<PosSettings>;
  save(settings: PosSettings): Promise<void>;
}

export interface ShiftTemplateRepository {
  list(): Promise<readonly ShiftTemplate[]>;
  findById(id: string): Promise<ShiftTemplate | null>;
  save(template: ShiftTemplate): Promise<void>;
}
