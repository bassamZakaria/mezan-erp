import { isEventCode } from "../events/catalog.js";
import { InvalidWebhookError, WebhookNotFoundError } from "./errors.js";
import type { Webhook, WebhookRepository } from "./webhook.js";

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export interface UpdateWebhookCommand {
  readonly name?: string;
  readonly targetUrl?: string;
  readonly events?: readonly string[];
  readonly active?: boolean;
}

/** Patches an existing webhook — name/target/subscribed events/enabled state. The secret never changes here. */
export async function updateWebhook(
  id: string,
  patch: UpdateWebhookCommand,
  repo: WebhookRepository,
): Promise<Webhook> {
  const current = await repo.findById(id);
  if (!current) throw new WebhookNotFoundError(id);

  const next: Webhook = {
    ...current,
    name: patch.name ?? current.name,
    targetUrl: patch.targetUrl ?? current.targetUrl,
    events: patch.events ? [...new Set(patch.events)] : current.events,
    active: patch.active ?? current.active,
  };

  const reasons: string[] = [];
  if (next.name.trim() === "") reasons.push("name is required");
  if (!isHttpUrl(next.targetUrl)) reasons.push("targetUrl must be a valid http(s) URL");
  if (next.events.length === 0) reasons.push("at least one event is required");
  for (const code of next.events) {
    if (!isEventCode(code)) reasons.push(`unknown event code "${code}"`);
  }
  if (reasons.length > 0) throw new InvalidWebhookError(reasons);

  await repo.save(next);
  return next;
}
