/**
 * Typed in-process EventBus.
 *
 * docs/archive/plan.md §2.6 + §5.6: the desktop edition has no message broker; it uses a
 * synchronous in-process bus directly. The cloud edition can adapt the same
 * publish surface onto a real transport. Handlers run synchronously in
 * subscription order; a throwing handler does not stop the others (its error is
 * reported to an optional onError hook), because one bad notification listener
 * must never swallow a domain event for the rest.
 */

import { isEventCode, type EventCode } from "./catalog.js";

export interface DomainEvent<T = unknown> {
  readonly code: EventCode;
  readonly occurredAt: string; // ISO-8601 UTC
  readonly payload: T;
}

export type EventHandler<T = unknown> = (event: DomainEvent<T>) => void;

export interface EventBusOptions {
  readonly onError?: (error: unknown, event: DomainEvent) => void;
}

export class EventBus {
  private readonly byCode = new Map<EventCode, Set<EventHandler>>();
  private readonly all = new Set<EventHandler>();

  constructor(private readonly options: EventBusOptions = {}) {}

  /** Subscribe to one event code. Returns an unsubscribe function. */
  subscribe<T = unknown>(code: EventCode, handler: EventHandler<T>): () => void {
    let set = this.byCode.get(code);
    if (!set) {
      set = new Set();
      this.byCode.set(code, set);
    }
    set.add(handler as EventHandler);
    return () => {
      this.byCode.get(code)?.delete(handler as EventHandler);
    };
  }

  /** Subscribe to every event (workflow/realtime fan-out). */
  subscribeAll(handler: EventHandler): () => void {
    this.all.add(handler);
    return () => {
      this.all.delete(handler);
    };
  }

  /**
   * Publish an event synchronously to all matching subscribers. `code` must be a
   * known catalog code — publishing an unknown event is a programming error.
   */
  publish<T = unknown>(
    code: EventCode,
    payload: T,
    occurredAt: string = new Date().toISOString(),
  ): void {
    if (!isEventCode(code)) {
      throw new RangeError(`Unknown event code: "${code}"`);
    }
    const event: DomainEvent<T> = { code, payload, occurredAt };
    const targeted = this.byCode.get(code);
    if (targeted) {
      for (const handler of [...targeted]) this.dispatch(handler, event);
    }
    for (const handler of [...this.all]) this.dispatch(handler, event);
  }

  private dispatch(handler: EventHandler, event: DomainEvent): void {
    try {
      handler(event);
    } catch (error) {
      if (this.options.onError) this.options.onError(error, event);
      else throw error;
    }
  }
}
