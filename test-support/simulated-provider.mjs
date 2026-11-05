const OUTCOMES = new Set(['acknowledged', 'failed', 'unknown']);

function requiredId(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} is required`);
  }
  return value.trim();
}

/**
 * Deterministic provider test double.
 *
 * "acknowledged" means only that the simulated provider accepted the
 * handover payload. It deliberately does not claim model comprehension.
 */
export function createSimulatedProvider({
  outcomes = ['acknowledged'],
  acknowledgementLevel = 'payload_accepted',
} = {}) {
  if (!Array.isArray(outcomes) || outcomes.length === 0
    || outcomes.some((outcome) => !OUTCOMES.has(outcome))) {
    throw new TypeError('outcomes must be a non-empty array of acknowledged, failed or unknown');
  }
  if (typeof acknowledgementLevel !== 'string' || acknowledgementLevel.trim().length === 0) {
    throw new TypeError('acknowledgementLevel must be a non-empty string');
  }

  const scriptedOutcomes = [...outcomes];
  let sequence = 0;

  return Object.freeze({
    capabilities: Object.freeze({
      contextDelivery: true,
      acknowledgementLevel: acknowledgementLevel.trim(),
      provesModelComprehension: false,
    }),

    async deliver({ deliveryId, handover, activationRequestId } = {}) {
      const persistentDeliveryId = requiredId(deliveryId, 'deliveryId');
      const handoverId = requiredId(handover?.id, 'handover with a non-empty id');
      const requestId = requiredId(activationRequestId, 'activationRequestId');
      if (scriptedOutcomes.length === 0) {
        throw new Error('No simulated outcome remains');
      }

      sequence += 1;
      const outcome = scriptedOutcomes.shift();

      return Object.freeze({
        attemptId: `sim-delivery-attempt-${sequence}`,
        deliveryId: persistentDeliveryId,
        activationRequestId: requestId,
        handoverId,
        outcome,
        acknowledgementLevel: outcome === 'acknowledged'
          ? acknowledgementLevel.trim()
          : null,
        providerReference: `sim-provider-reference-${sequence}`,
        sequence,
        provesModelComprehension: false,
      });
    },
  });
}
