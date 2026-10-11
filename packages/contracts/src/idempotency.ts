/** Why a create that carries a client-minted id was refused before it ran, or could not be kept. */
export enum IdempotencyRefusal {
  KeyReused = "IDEMPOTENCY_KEY_REUSED",
  NotRecorded = "IDEMPOTENCY_NOT_RECORDED",
}

/** Set on an answer that is the document a create ALREADY made, not a new one. */
export const IDEMPOTENT_REPLAY_HEADER = "idempotent-replay";
