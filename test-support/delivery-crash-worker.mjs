import { writeFileSync } from 'node:fs';
import { openStore } from '../src/store.mjs';
import { openSessionLifecycle } from '../src/session-lifecycle.mjs';

const [databasePath, requestId, markerPath] = process.argv.slice(2);
const store = openStore(databasePath);
const lifecycle = openSessionLifecycle(databasePath, store, {
  // This worker consumes an already persisted confirmation; it never issues one.
  confirmationAuthority: { async consume() { throw new Error('Unexpected confirmation request'); } },
});
const providerAdapter = {
  capabilities: {
    contextDelivery: true,
    acknowledgementLevel: 'payload_accepted',
    provesModelComprehension: false,
  },
  async deliver({ deliveryId }) {
    // Simulate provider acceptance, then terminate before DevBridge can record it.
    writeFileSync(markerPath, JSON.stringify({
      deliveryId,
      providerAccepted: true,
    }));
    process.exit(73);
  },
};

await lifecycle.activateProject({ requestId, providerAdapter });
throw new Error('Crash worker unexpectedly returned from provider delivery');
