/**
 * Test-only confirmation authority.
 *
 * This deliberately is not production authentication. Tokens are opaque,
 * scoped to one request/session/project tuple, and consumed once.
 */
export function createSimulatedConfirmationAuthority() {
  const issued = new Map();
  let sequence = 0;

  return Object.freeze({
    issue({
      requestId, sessionId, projectId,
      actorId = 'test-user',
      method = 'simulated_test_confirmation',
      confirmedAt = '2026-11-05T00:00:00.000Z',
    }) {
      sequence += 1;
      const token = 'test-confirmation-' + sequence;
      issued.set(token, Object.freeze({
        requestId, sessionId, projectId, actorId, method,
        authorityReference: 'test-authority-' + sequence,
        confirmedAt,
      }));
      return token;
    },

    async consume(token, expected) {
      const evidence = issued.get(token);
      if (!evidence) throw new Error('Unknown, forged or already-consumed confirmation token');
      issued.delete(token);
      if (evidence.requestId !== expected.requestId
        || evidence.sessionId !== expected.sessionId
        || evidence.projectId !== expected.projectId) {
        throw new Error('Confirmation token scope does not match pending activation request');
      }
      return evidence;
    },
  });
}
