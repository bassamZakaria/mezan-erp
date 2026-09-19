import type { Money } from "../money/index.js";

export interface CashForecastThresholdRecord {
  readonly amount: Money;
  readonly updatedAt: string;
  readonly updatedBy: string | null;
}

export interface CashForecastAlertRecord {
  readonly id: string;
  readonly crossingDate: string;
  readonly threshold: Money;
  readonly lowestDate: string;
  readonly lowestBalance: Money;
  readonly detectedAt: string;
  readonly clearedAt: string | null;
  readonly notifiedCount: number;
}

export interface CashForecastStore {
  getThreshold(): Promise<CashForecastThresholdRecord | null>;
  setThreshold(record: CashForecastThresholdRecord): Promise<void>;
  openAlert(): Promise<CashForecastAlertRecord | null>;
  openCrossing(alert: CashForecastAlertRecord): Promise<boolean>;
  markNotified(id: string, count: number): Promise<void>;
  clearOpen(clearedAt: string): Promise<void>;
  listAlerts(limit: number): Promise<readonly CashForecastAlertRecord[]>;
}
