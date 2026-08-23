import type { DomainEvent, EventBus } from "../events/event-bus.js";
import { evaluateRules, type NotificationDraft } from "./evaluate.js";
import type { Notification, NotificationDeliveryPort } from "./notification.js";
import { resolveRecipients, type NotificationDirectory } from "./recipients.js";
import {
  IMPLEMENTED_NOTIFICATION_CHANNELS,
  type NotificationChannel,
  type NotificationRuleRepository,
} from "./rule.js";

/**
 * The notification engine — the only piece that joins the pure rule evaluation
 * to the outside world. It listens on the in-process `EventBus`, evaluates every
 * enabled rule, resolves recipients through the directory port, and hands each
 * produced notification to the delivery adapter registered for its channel.
 *
 * Channels with no adapter (email, WhatsApp — modelled, not implemented in this
 * build) are counted in `skippedChannels` instead of being silently dropped.
 */

/** Fills in payload fields the raw event could not carry (e.g. a document's total). */
export interface NotificationPayloadEnricher {
  enrich(event: DomainEvent): Promise<Readonly<Record<string, unknown>>>;
}

export interface NotificationEngineDeps {
  readonly rules: NotificationRuleRepository;
  readonly directory: NotificationDirectory;
  /** One adapter per channel this build can actually deliver on. */
  readonly delivery: Readonly<Partial<Record<NotificationChannel, NotificationDeliveryPort>>>;
  readonly enricher?: NotificationPayloadEnricher;
  readonly idGen: () => string;
  readonly now?: () => string;
  readonly onError?: (error: unknown, event: DomainEvent) => void;
}

export interface NotificationDispatchResult {
  readonly matchedRules: number;
  readonly delivered: readonly Notification[];
  readonly skippedChannels: readonly NotificationChannel[];
}

const EMPTY_RESULT: NotificationDispatchResult = {
  matchedRules: 0,
  delivered: [],
  skippedChannels: [],
};

export class NotificationEngine {
  constructor(private readonly deps: NotificationEngineDeps) {}

  private now(): string {
    return this.deps.now ? this.deps.now() : new Date().toISOString();
  }

  /** Evaluates every rule against one event and delivers what fires. */
  async handleEvent(event: DomainEvent): Promise<NotificationDispatchResult> {
    const rules = await this.deps.rules.list();
    if (rules.length === 0) return EMPTY_RESULT;

    const enrichment = this.deps.enricher ? await this.deps.enricher.enrich(event) : undefined;
    const drafts = evaluateRules(rules, event, { now: this.now(), enrichment });
    if (drafts.length === 0) return EMPTY_RESULT;

    const delivered: Notification[] = [];
    const skipped = new Set<NotificationChannel>();

    for (const draft of drafts) {
      const recipients = await resolveRecipients(draft, this.deps.directory);
      for (const channel of draft.channels) {
        const adapter = this.deps.delivery[channel];
        if (!adapter) {
          skipped.add(channel);
          continue;
        }
        for (const userId of recipients) {
          const notification = this.materialize(draft, userId, channel);
          await adapter.deliver(notification);
          delivered.push(notification);
        }
      }
    }

    return { matchedRules: drafts.length, delivered, skippedChannels: [...skipped] };
  }

  private materialize(
    draft: NotificationDraft,
    userId: string,
    channel: NotificationChannel,
  ): Notification {
    return {
      id: this.deps.idGen(),
      userId,
      ruleId: draft.ruleId,
      eventCode: draft.eventCode,
      channel,
      priority: draft.priority,
      title: draft.title,
      body: draft.body,
      reference: draft.reference,
      createdAt: draft.createdAt,
      readAt: null,
    };
  }

  /**
   * Subscribes to every event on the bus. The bus is synchronous and its
   * handlers return void, so dispatch runs as a detached promise — a delivery
   * failure is reported through `onError` and can never abort the business
   * transaction that published the event.
   */
  subscribeTo(bus: EventBus): () => void {
    return bus.subscribeAll((event) => {
      void this.handleEvent(event).catch((error) => {
        this.deps.onError?.(error, event);
      });
    });
  }
}

/** Convenience for the composition root: build the engine and attach it to the bus. */
export function subscribeNotificationEngine(
  bus: EventBus,
  deps: NotificationEngineDeps,
): { readonly engine: NotificationEngine; readonly unsubscribe: () => void } {
  const engine = new NotificationEngine(deps);
  return { engine, unsubscribe: engine.subscribeTo(bus) };
}

/** The channels this build has a delivery adapter for, for the API/UI to report honestly. */
export function implementedChannels(
  delivery: Readonly<Partial<Record<NotificationChannel, NotificationDeliveryPort>>>,
): readonly NotificationChannel[] {
  return IMPLEMENTED_NOTIFICATION_CHANNELS.filter((channel) => delivery[channel] !== undefined);
}
