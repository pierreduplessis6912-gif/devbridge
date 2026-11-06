# DevBridge V1 — Synchronisation Protocol and Component Design

**Document ID:** SYNC-DESIGN-001  
**Version:** 0.2  
**Status:** Proposed technical design; architecture direction accepted, implementation not yet started  
**Parent:** ADR-SYNC-001  
**Branch:** build/v1-scope

## 1. Purpose

This document translates ADR-SYNC-001 into a concrete protocol, component boundary, local data model, server responsibilities, and staged implementation plan.

It deliberately separates three systems:

1. **Local Project continuity:** durable Project records, relationships, provenance, and event history.
2. **Synchronisation:** transport, encrypted contribution bundles, delivery, receipt, dependency resolution, and remote acceptance.
3. **AI session lifecycle:** provider sessions, Project activation, handover delivery, and session contribution attribution.

These systems exchange data, but none inherits the authority or responsibilities of another. A provider session is not a sync identity. A Project handover is not a backup. A server receipt is not a device acceptance.

## 2. Accepted architecture decisions

The following decisions have been accepted for the V1 direction:

1. Dependency details remain encrypted. Receiving devices resolve dependencies locally.
2. Local contribution creation and durable sync scheduling are one atomic local database operation.
3. The server is a durable encrypted archive and delivery coordinator, not an authority on Project meaning.
4. Cryptography uses established, reviewed standards and libraries; no custom cryptographic scheme.
5. Contribution IDs are globally unique. Ordering is represented by a monotonically increasing sequence per originating device and Project. Timestamps are descriptive only.
6. Concurrent contributions are preserved independently. DevBridge does not perform semantic arbitration or overwrite one contribution with another.
7. Delivery is at-least-once. Application is idempotent. Repeated delivery cannot create duplicate accepted history.
8. Device enrolment is explicit. A new device is authorised by a trusted device or by the user's recovery mechanism. A new device generates its own signing identity.
9. Revocation blocks future server-authorised operations. Contributions uploaded after revocation are quarantined for explicit review. Previously accepted contributions remain valid. A device timestamp cannot override the server's revocation record.
10. Deletion is explicit, scoped, propagated, and protected against resurrection. It does not silently cascade to dependent contributions.
11. Project export is a first-class portable archive, independently restorable without the original DevBridge service.

## 3. System boundaries and components

### 3.1 Device/client components

| Component | Responsibility | Must not own |
|---|---|---|
| Local Continuity Store | Projects, records, links, local events, local transactional persistence | Account authentication or remote delivery |
| Local Sync Repository | Durable local sync metadata, sequence allocation, outbox, inbox, applied ledger, dependency state | Provider session lifecycle |
| Contribution Builder | Creates immutable contribution snapshots from local committed changes | Semantic interpretation |
| Cryptographic Service | Device signing, Project encryption/decryption, verification | Account/Project permission decisions |
| Device Credential Store | Keeps private signing and recovery-related secrets in platform-protected storage | Server-side private-key custody |
| Sync Coordinator | Schedules upload/download, retries, cursors, and acknowledgements | Changing contribution content |
| Acceptance Engine | Validates and atomically applies received contributions | Semantic conflict resolution |
| Account/Project Authority Client | Obtains and refreshes account, Project, and device permissions | Local content truth |
| Archive/Restore Service | Creates and verifies portable archives and restores them | Silent overwrite of an existing Project |

### 3.2 Server components

| Component | Responsibility |
|---|---|
| Account Authority | Authenticates accounts and maintains account status |
| Project Authority | Enforces Project ownership and explicit membership/access |
| Device Registry | Registers device public identities, enrolment state, and revocation |
| Encrypted Contribution Archive | Durably stores opaque encrypted contribution envelopes |
| Delivery Coordinator | Makes eligible envelopes available to authorised devices and records delivery state |
| Recovery/Enrolment Service | Coordinates trusted-device or recovery-based enrolment without learning user recovery secrets |

The server may see the minimum routing metadata needed to authenticate, store, and deliver ciphertext. It must not receive Project plaintext or dependency relationships. Metadata minimisation remains a security requirement.

## 4. Identity model

These identities are separate and must never be substituted for one another:

- **Account ID:** identifies an authenticated DevBridge account.
- **Project ID:** stable identity of a Project.
- **Device ID:** identifies one enrolled installation. It is not proof of authority.
- **Contribution ID:** globally unique identity of one immutable contribution.
- **Device Project Sequence:** monotonically increasing integer for one (Project ID, Device ID) pair.
- **Session ID / Activation ID / Handover Snapshot ID:** optional attribution to an AI session workflow only.

The existing project_events.event_sequence is a local Project event order. It must not be reinterpreted as a device sequence. A new device-local sequence is required for sync.

## 5. Contribution envelope and payload

### 5.1 Logical envelope

A versioned envelope contains:

- protocol version;
- contribution ID;
- Project routing identity or opaque Project routing handle;
- originating device ID;
- device-local Project sequence;
- creation timestamp;
- schema version;
- encryption/key version identifier;
- ciphertext;
- ciphertext integrity digest;
- device signature over a canonical representation of the envelope and ciphertext digest.

The exact canonical encoding and cryptographic algorithms remain subject to the cryptographic design gate. The signature must bind all identity and ordering fields as well as the ciphertext digest. A receiver must reject any alteration.

### 5.2 Encrypted payload

The encrypted payload contains the atomic contribution:

- contribution ID and Project identity;
- one or more continuity records;
- related record links;
- corresponding Project event evidence;
- provenance and attribution;
- dependency contribution IDs;
- schema/version information required to validate the contribution.

Dependency IDs remain inside the encrypted payload. The server cannot inspect or route by dependency relationships. A receiving device may need to download all eligible contribution envelopes for a Project, or use a separately reviewed minimal metadata mechanism later. The first implementation should prefer privacy over optimisation.

### 5.3 Immutable identity

A contribution ID is never reused. The same ID with a different digest is an integrity incident. A retry must resend the exact same immutable envelope, not rebuild a new contribution.

## 6. Local commit and outbox atomicity

The local store is the source of truth for a device's accepted local Project history.

When a Project contribution is created, one SQLite transaction must:

1. Validate the target Project and local operation.
2. Allocate the next sequence for the (Project ID, Device ID) pair.
3. Persist the local record(s), relationships, and Project event(s).
4. Persist an immutable contribution snapshot/source sufficient to construct the sync payload.
5. Persist the sync contribution identity and durable outbox work item.
6. Commit all of the above together.

If the transaction fails, none of these changes may remain.

**Cryptographic sealing is a resumable step after this transaction.** Access to platform-protected signing/encryption keys may not be safely available inside a synchronous SQLite transaction. Therefore the atomic transaction creates a durable pending_seal outbox item and immutable source snapshot. A worker seals and signs it, then persists the exact immutable envelope and changes the outbox state to ready. If the process stops between these steps, the worker resumes from the persisted snapshot. It must never allocate a new contribution ID or sequence for the same local contribution.

This refinement preserves the important guarantee: no local contribution can be committed without a durable sync work item when sync is enabled. It avoids holding a database transaction open while calling a keystore or performing potentially asynchronous cryptographic work.

## 7. Proposed local sync data model

Names below are logical design names, not final SQL. Physical schema, indexes, constraints, and migration numbering will be settled in the schema specification.

| Logical table | Key fields / purpose |
|---|---|
| sync_local_device | Local Device ID and public identity reference; private key remains outside SQLite |
| sync_project_device_sequences | Project ID, Device ID, next sequence; unique pair |
| sync_contributions | Contribution ID, Project ID, origin Device ID, device sequence, timestamp, versions, digest, immutable envelope/source reference |
| sync_outbox | Contribution ID, state, attempt count, retry metadata, last error code, server receipt |
| sync_inbox | Contribution ID, envelope, received time, validation state, quarantine reason |
| sync_applied_contributions | Contribution ID, Project ID, origin Device ID, sequence, digest, local application result/time |
| sync_dependencies | Locally decrypted dependency edges and resolution state; never uploaded as plaintext routing metadata |
| sync_device_acknowledgements | Contribution ID, receiving Device ID, acknowledgement type and time |
| sync_deletion_state | Minimal deletion/tombstone state needed to prevent resurrection; content and key hierarchy remain separately protected |

Important constraints:

- Unique (Project ID, Device ID, device sequence).
- Unique contribution ID.
- Applied ledger unique by contribution ID.
- Same contribution ID with a different digest is rejected and recorded as an integrity incident.
- Inbox states distinguish received, pending, quarantined, applied, and rejected.
- Outbox state distinguishes pending seal, ready, uploading, server-received, retryable failure, and quarantined/revoked.
- Sequence allocation and local contribution/outbox creation share the same transaction.
- Local Project event sequence remains independent.

## 8. Receiving-side acceptance pipeline

A receiving device must not insert remote records directly from untrusted network input.

The pipeline is:

1. Persist the received envelope in the inbox.
2. Verify envelope structure and supported protocol version.
3. Verify the originating device signature against the registered public identity and signed metadata.
4. Verify ciphertext digest and envelope identity.
5. Confirm the local account and Project are authorised to receive the contribution.
6. Decrypt locally using the appropriate Project key.
7. Validate payload schema, Project identity, contribution identity, provenance, and internal references.
8. Resolve dependencies against already applied contributions and the current accepted local history.
9. If dependencies are missing but potentially satisfiable, retain the bundle as pending; do not add its records to accepted Project history.
10. If a dependency is invalid, deleted, inaccessible, or permanently unavailable, quarantine/reject with an explicit reason; never fabricate or silently discard it.
11. In one local SQLite transaction, insert all records, links, Project event evidence, applied-ledger entry, and state transition to applied.
12. Only after commit, issue device acceptance acknowledgement.

If the process stops before step 11 commits, no partial contribution is accepted. If it stops after commit but before acknowledgement, a retry finds the applied-ledger entry and returns the existing result without duplicating records.

## 9. Server upload, archive, and delivery

The server performs transport and archive authority checks:

1. Authenticate the uploading account/device session.
2. Check device enrolment and current revocation state.
3. Check account and Project permission for the upload.
4. Verify the registered device's signature over the envelope and ciphertext digest.
5. Enforce contribution ID uniqueness and immutable digest equality.
6. Durably store the opaque encrypted envelope.
7. Record server receipt and make the envelope available to authorised receiving devices.

The server does not decrypt the payload, inspect dependency relationships, decide semantic validity, or claim that another device has accepted the contribution.

If a revoked device uploads after revocation, the envelope is quarantined. A device-provided timestamp is not sufficient evidence to bypass revocation. Previously accepted contributions are not invalidated by later revocation.

## 10. Three acknowledgement levels

These are separate durable facts:

1. **Server receipt:** ciphertext durably stored by the archive.
2. **Device receipt:** a receiving device durably downloaded the envelope into its inbox.
3. **Device acceptance:** the receiving device verified and committed the contribution locally.

An acknowledgement is bound to the contribution ID, digest, device identity, and acknowledgement type. A server receipt must never be displayed as device acceptance.

## 11. Delivery, retries, and concurrency

- Delivery is at-least-once.
- Retries reuse the same contribution ID and exact envelope.
- Unknown network outcomes are not interpreted as success or failure; the coordinator queries or safely retries using idempotent server operations.
- Acknowledgements are durable and independently recorded.
- Independent concurrent contributions are both retained.
- No global total order is claimed.
- Device-local sequences allow gap detection within one origin stream.
- A missing sequence does not justify discarding later valid contributions; it may indicate an interrupted or delayed delivery and must be represented as an unresolved stream gap.
- Semantic interpretation is left to the user and their chosen AI tools.

## 12. Device identity, enrolment, revocation, and recovery

Each device creates its own signing key pair. Private signing keys remain in platform-protected storage. The server stores or obtains the public key and device authority state.

A new device is enrolled through either:

- explicit approval by an existing trusted device; or
- the user's recovery mechanism.

Account sign-in alone does not grant Project access or decrypt Project history.

Revocation blocks future server-authorised operations. Previously accepted contributions remain valid. Contributions uploaded after revocation are quarantined for explicit user review. A signed creation timestamp does not prove that an offline contribution was created before revocation; stronger evidence or a user review policy is required.

Recovery secrets are generated securely and remain under user control. The server must not receive a readable recovery secret. Key hierarchy, recovery material format, rotation, and loss-of-all-devices consequences must be finalised before cryptographic implementation.

## 13. Project boundaries and cross-Project references

A cross-Project reference is not a Project membership grant.

Synchronising a reference must not automatically synchronise the target Project or disclose its content. If the target Project is unavailable, not shared, or deleted, the source Project may retain an opaque reference with an explicit unavailable/unresolved state. Access to each Project is checked independently.

## 14. Export, restore, deletion, and anti-resurrection

### 14.1 Portable archive

A full Project archive must preserve Project identity, accepted contributions, records, links, provenance, origin identities, device-local sequences, schema versions, integrity information, and deletion state. It must be independently verifiable and restorable without the original DevBridge service.

A handover remains a bounded AI context view, not an archive.

### 14.2 Deletion

Deletion is an explicit user-authorised operation with a defined scope. Deleting one contribution does not automatically delete dependent contributions. Remaining contributions must represent missing/deleted dependencies honestly.

Deletion state must propagate to online devices and archives. An offline device must process relevant deletion state before pending uploads can reintroduce deleted content. The server must reject or quarantine reintroduction of deleted contribution identities.

Cryptographic erasure is the preferred candidate for content removal from encrypted archives, but it depends on a carefully designed key hierarchy and backup-expiry process. It is not considered implemented until backup copies, recovery keys, device caches, and offline devices are addressed.

## 15. Existing local Projects and migration

Existing local Projects are not silently assigned to an account.

Account sign-in, local Project adoption, and synchronisation enablement are separate explicit actions.

The existing local event sequence is preserved as local history. Adoption creates an explicit, auditable bootstrap/snapshot process with a defined origin and integrity boundary; it must not fabricate historical device signatures or pretend that legacy records were originally produced as signed sync bundles.

All migrations must be tested against disposable database copies. The user's actual .devbridge/devbridge.sqlite must not be used as a test database or modified during protocol development.

## 16. Current repository mapping

The following mapping is based on source inspection of build/v1-scope.

| Existing source | Observed responsibility | Sync design treatment |
|---|---|---|
| src/store.mjs | Owns a SQLite connection; schema v1–v4; Project/record/link/event persistence; append-only protections; transactional local appendRecord; local event sequence; handover | Preserve as continuity foundation. Extend through a transaction-aware persistence boundary so local record/event and sync outbox work can commit together. Do not reinterpret event sequence as device sequence. |
| src/session-lifecycle.mjs | Opens a separate SQLite connection; manages sessions, activations, handovers, provider delivery attempts, stale context, contribution intents and commits | Keep as session lifecycle. Session/activation IDs remain optional contribution attribution. Do not make lifecycle IDs sync identities. Review separate-connection transaction boundary before coupling any operation across modules. |
| src/cross-project-references.mjs | Stores source/target Project IDs and label; explicitly states it is not an authorization system | Preserve separation. Sync references only as references; never infer membership or target Project access. |
| src/cli.mjs | Local continuity CLI; defaults to .devbridge/devbridge.sqlite; creates directory and opens store | Do not run against default DB during tests. Future sync commands must require explicit account/device setup and safe database selection. |
| package.json | Node ESM package, Node >=22.13, test and local CLI scripts; no declared dependencies | Evaluate cryptographic and server dependencies only after compatibility/security review. |

### 16.1 Important implementation consequence: transaction ownership

openStore owns a private SQLite connection. openSessionLifecycle opens another connection to the same file and calls the continuity store for record commitment.

SQLite transactions cannot span those independent connections. Therefore sync outbox atomicity must be implemented at the same persistence boundary that owns the record/event transaction. A separate sync module may define pure protocol logic and orchestration, but it must not open an independent connection and pretend that two commits are atomic.

The recommended first implementation is to add a transaction-aware sync persistence interface owned by the local store, then keep serialization, cryptographic sealing, and network transport outside the SQLite transaction. A later database composition refactor may be considered if it materially improves separation without weakening atomicity.

### 16.2 Current implementation gaps

The inspected source does not yet implement:

- account identity, Project ownership or membership;
- device identity, enrolment or revocation;
- device signing keys or contribution signatures;
- end-to-end encryption or Project key distribution;
- sync contribution bundles;
- outbox/inbox or applied contribution ledger;
- remote import/application or dependency staging;
- server archive, transport, cursors or sync acknowledgements;
- full archive export/import or independent restore;
- distributed deletion or anti-resurrection.

Existing lifecycle acknowledgements relate to AI-provider context delivery, not sync delivery. Existing contribution intents are local session workflow reservations, not remote sync bundles. Existing timestamp cursors are local pagination, not replication cursors.

## 17. Implementation milestones

### Milestone 0 — Protocol and threat model
- Finalise canonical envelope and payload schema.
- Define integrity/signature coverage.
- Define routing metadata and privacy exposure.
- Define authority and revocation evidence.
- Select cryptographic standards and Android-compatible libraries after review.

### Milestone 1 — Local sync persistence
- Add versioned sync schema to disposable DB fixtures.
- Add per-device Project sequence allocation.
- Add atomic local contribution + durable outbox work item.
- Add resumable sealing state.
- Add inbox and applied ledger.
- Add tests for rollback, crash recovery, uniqueness, and idempotency.

### Milestone 2 — Local receiving acceptance
- Verify test signatures and ciphertext digests.
- Decrypt with test keys.
- Validate payload and dependencies.
- Stage missing dependencies.
- Atomically apply complete contributions.
- Test duplicate, altered, invalid, and interrupted deliveries.

### Milestone 3 — Authority and cryptographic identity
- Account and Project authority interfaces.
- Device enrolment and revocation.
- Device key creation and protected storage.
- Project key distribution and recovery.
- Security review before real user data.

### Milestone 4 — Server archive and transport
- Authenticated upload and download.
- Durable ciphertext archive.
- Immutable contribution ID/digest enforcement.
- Delivery queue and three acknowledgement levels.
- Revocation quarantine.

### Milestone 5 — Multi-device operation
- Offline creation and later delivery.
- At-least-once retry.
- Concurrent contributions.
- Device replacement and recovery.
- Multi-process and interruption testing.

### Milestone 6 — Portability and deletion
- Full Project archive export/import.
- Independent restore verification.
- Deletion scope and propagation.
- Backup expiry and cryptographic erasure.
- Anti-resurrection tests.

## 18. Acceptance test groups

The protocol must eventually pass tests covering:

- atomic local commit and outbox creation;
- rollback without orphaned records or outbox entries;
- sequence uniqueness per Project/device;
- crash between local commit and cryptographic sealing;
- exact-envelope retry;
- signature and digest tampering;
- duplicate delivery;
- same ID with altered content;
- dependency pending and later resolution;
- invalid or deleted dependencies;
- all-or-nothing remote application;
- interruption before and after commit but before acknowledgement;
- concurrent independent contributions;
- server receipt vs device receipt vs device acceptance;
- revocation and delayed offline upload quarantine;
- previous accepted history after revocation;
- trusted-device and recovery enrolment;
- replacement-device restoration;
- server unreadability of Project content and dependency details;
- full archive portability and independent restore;
- deletion propagation and offline anti-resurrection;
- interrupted migration and recovery using disposable databases.

## 19. Open technical decisions

These remain open and must be settled before the relevant implementation milestone:

- Canonical serialization format and exact envelope versioning.
- Cryptographic algorithms and Android/Termux-compatible libraries.
- Project key hierarchy, rotation, sharing, and recovery.
- Device enrolment proof and revocation evidence for offline contributions.
- Server hosting, database, object storage, and deployment model.
- Routing identifiers and metadata minimisation.
- Delivery cursor and acknowledgement retention.
- Archive format and independent restore tooling.
- Deletion key granularity, backup expiry, and offline-device policy.
- Safe adoption/bootstrap of existing local Projects.

## 20. Security and implementation rules

- No private signing key or readable recovery secret is stored on the sync server.
- Project plaintext and dependency relationships are not exposed to the server.
- Device ID and Project ID are identifiers, not authority.
- A valid signature proves origin/integrity, not factual truth or current permission.
- The server checks current transport authority; receivers verify signature, integrity, payload and local acceptance rules.
- No contribution is accepted partially.
- Unknown outcomes are not treated as confirmed success.
- No semantic merge or overwrite occurs automatically.
- No migration test touches the user's real local continuity database.
- No production cryptography is implemented using placeholder algorithms or custom primitives.

## 21. Current status

**Local continuity:** implemented and covered by the existing local test suite.  
**Synchronisation architecture:** direction and major decisions accepted.  
**Protocol/component design:** proposed in this document; technical details listed above remain subject to milestone gates.  
**Distributed synchronisation:** not implemented.  
**Production cryptography, account authority, server archive, multi-device recovery, and deletion:** not implemented.

The next coding milestone is **Milestone 1: Local sync persistence**, beginning with a disposable SQLite fixture and tests. No live server, real cryptographic key management, or changes to the user's actual local database are part of that first milestone.
