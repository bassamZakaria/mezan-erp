export enum IdempotencyRefusal {
  KeyReused = "IDEMPOTENCY_KEY_REUSED",
  NotRecorded = "IDEMPOTENCY_NOT_RECORDED",
}

export const IDEMPOTENT_REPLAY_HEADER = "idempotent-replay";
