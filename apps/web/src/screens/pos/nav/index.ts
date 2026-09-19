import type { WebFragment } from "../../../fragments";
import * as master from "./master";
import * as sessions from "./sessions";
import * as sales from "./sales";
import * as print from "./print";
import * as sell from "./sell";
import * as refunds from "./refunds";
import * as approvals from "./approvals";
import * as offline from "./offline";
import * as reports from "./reports";
import * as restaurant from "./restaurant";
import * as kitchen from "./kitchen";
import * as deliveries from "./deliveries";

export const POS_WEB_FRAGMENTS: readonly WebFragment[] = [master, sessions, sales, print, sell, refunds, approvals, offline, reports, restaurant, kitchen, deliveries];

export const posAr = {
  ...master.ar,
  ...sessions.ar,
  ...sales.ar,
  ...print.ar,
  ...sell.ar,
  ...refunds.ar,
  ...approvals.ar,
  ...offline.ar,
  ...reports.ar,
  ...restaurant.ar,
  ...kitchen.ar,
  ...deliveries.ar,
} as const;

export const posEn = {
  ...master.en,
  ...sessions.en,
  ...sales.en,
  ...print.en,
  ...sell.en,
  ...refunds.en,
  ...approvals.en,
  ...offline.en,
  ...reports.en,
  ...restaurant.en,
  ...kitchen.en,
  ...deliveries.en,
};

export const posScreens = {
  ...master.screens,
  ...sessions.screens,
  ...sales.screens,
  ...print.screens,
  ...sell.screens,
  ...refunds.screens,
  ...approvals.screens,
  ...offline.screens,
  ...reports.screens,
  ...restaurant.screens,
  ...kitchen.screens,
  ...deliveries.screens,
};
