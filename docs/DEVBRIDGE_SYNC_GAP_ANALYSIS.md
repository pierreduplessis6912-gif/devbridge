# DevBridge V1 — Synchronisation Gap Analysis

**Status:** Evidence review — proposed  
**Date:** 6 November 2026  
**Inspected branch:** `build/v1-scope`  
**Inspected commit:** `4c5f835ce53481a0f88927c1a3f18a0c17b536fb`  
**Related architecture decision:** ADR-SYNC-001 — Synchronisation Architecture Decision Record v0.1  
**Implementation status:** Local continuity foundation exists; synchronisation is not implemented.

---

## 1. Purpose

This document compares the current DevBridge implementation against the agreed V1 synchronisation architecture.

Its purpose is to establish:

- What the repository demonstrably implements.
- What exists partially but does not yet satisfy the synchronisation requirements.
- What is absent from the inspected implementation.
- Which architectural and technical decisions remain necessary before implementation.
- What evidence and acceptance tests are required before V1 synchronisation can be considered complete.

This is an evidence-based gap analysis, not an implementation proposal or authorisation to change code.

## 2. Scope and evidence boundary

The review examined the repository at the commit identified above.

The inspection covered:

- Project and record persistence.
- SQLite schema and migrations.
- Session and activation lifecycle.
- Contribution reservation and commitment.
- Cross-Project references.
- CLI operations and handover output.
- Repository searches for sync, transfer, encryption, identity, import/export, acknowledgements, dependencies, and recovery.
- Existing automated tests and package configuration.

The local database `.devbridge/devbridge.sqlite` was identified as an untracked local file. It is outside this review and must remain untouched.

**Evidence limitation:** Findings describe the inspected repository state. They do not establish that no separate external service, uninspected branch, or future implementation exists.

## 3. Executive assessment

The current implementation is a local continuity system with meaningful persistence, append-only history, Project separation, and session-lifecycle integrity controls.

It is not yet a multi-device synchronisation system.

The most important distinction is:

**Local continuity records what happened in one local store. Synchronisation must preserve and safely transfer that history between independently operating devices and a durable archive.**

The current repository does not contain the complete transfer, identity, cryptographic, remote-application, acknowledgement, recovery, or deletion mechanisms required by ADR-SYNC-001.

### Overall classification

| Capability | Current status |
|---|---|
| Local Project persistence | Implemented |
| Append-only record and event history | Implemented |
| Atomic local record contribution | Implemented |
| Local Project event sequencing | Implemented |
| Session and activation lifecycle | Implemented locally |
| Contribution reservation | Implemented locally |
| Cross-Project reference storage | Implemented locally |
| Account identity and Project ownership | Missing in inspected implementation |
| Device identity and enrolment | Missing |
| Cryptographic contribution signatures | Missing |
| End-to-end encryption | Missing |
| Sync bundle format | Missing |
| Server-mediated sync transport | Missing |
| Remote contribution acceptance | Missing |
| Idempotent remote application | Missing |
| Dependency staging and resolution | Missing |
| Sync-specific acknowledgements | Missing |
| Multi-device conflict preservation | Not implemented |
| Full Project archive export/import | Missing |
| Independent restoration | Missing |
| Sync-aware deletion and anti-resurrection | Missing |

## 4. Existing implementation

### 4.1 Local persistence

**Status: Implemented**

`src/store.mjs` provides SQLite-backed Project continuity.

The inspected schema includes:

- `projects`
- `project_records`
- `record_links`
- `project_events`

The store supports Project creation and retrieval, record creation and retrieval, history listing, event listing, handover generation, and closure.

The database uses foreign-key enforcement, WAL journalling, a busy timeout, and full synchronous mode.

The migration mechanism uses transactions around individual migrations. A failed migration attempts to roll back that migration.

**Assessment:** This is a useful local persistence foundation. It is not a distributed storage or synchronisation mechanism.

### 4.2 Append-only history and local atomicity

**Status: Implemented**

Records, record links, and Project events have append-only protections.

The local `appendRecord` operation validates the Project and related-record relationships, then performs the record, links, Project metadata update, and corresponding event insertion transactionally.

The result is a meaningful local guarantee: a contribution is not intentionally recorded as a record without its associated local event and links being handled in the same transaction.

**Assessment:** This local atomicity is a foundation that a future remote acceptance pipeline can build upon. It does not itself provide atomic transfer between devices.

### 4.3 Project event sequencing

**Status: Implemented locally**

The current schema maintains a Project-local event sequence.

This provides ordering within the inspected local Project store.

It does not yet identify the originating device or provide a globally meaningful order across independent devices.

ADR-SYNC-001 instead specifies a monotonically increasing sequence per device and Project, with gaps permitted. That identity model has not yet been implemented.

### 4.4 Session lifecycle and attribution

**Status: Implemented locally**

`src/session-lifecycle.mjs` provides session and Project activation workflows, handover delivery, stale-context detection, contribution reservation, commitment, and session ending.

The current implementation associates records with optional session, activation, and handover snapshot identifiers.

These identifiers provide useful attribution within the local lifecycle.

They do not establish account ownership, device identity, or cryptographic provenance.

### 4.5 Contribution reservation

**Status: Implemented locally; not a sync bundle**

The `contribution_intents` table contains:

- Intent ID.
- Record ID.
- Session ID.
- Activation ID.
- Project ID.
- Handover snapshot ID.
- Project event sequence.
- Serialized payload.
- Creation timestamp.

The reservation process checks that the activation remains current, that the context is not stale, and that the Project event boundary has not changed in a way that invalidates the reservation.

The payload is stored in an append-only intent.

The local lifecycle distinguishes pending and committed contributions by checking whether the reserved record exists in `project_records`.

Commitment retrieves the stored payload and passes it to the local continuity store.

This is a valuable local submission-integrity mechanism.

However, it does not provide:

- A globally unique sync contribution identity.
- An origin device identity.
- A device signature.
- An independently transferable atomic bundle.
- Remote dependency resolution.
- A remote acceptance transaction.
- A receiving-device acknowledgement.

**Important distinction:** A locally pending contribution is not equivalent to a sync contribution waiting for dependencies or remote acceptance.

### 4.6 Cross-Project references

**Status: Implemented locally**

`src/cross-project-references.mjs` stores references containing source Project ID, target Project ID, label, and creation time.

The implementation explicitly treats these references as a data-separation boundary rather than an authorisation system.

A reference does not itself load target Project information, grant access, or activate another Project.

This is consistent with the requirement that Projects remain independent.

The synchronisation design will still need to define how references behave when the target Project is unavailable, not shared, deleted, or restored separately.

## 5. Identity and authority gaps

### 5.1 Account identity

**Status: Missing in inspected implementation**

The documentation describes an account model, but the inspected `projects` schema has no account ownership field.

The current local store does not demonstrate authenticated account identity or account-level authorisation.

### 5.2 Project ownership

**Status: Missing in inspected implementation**

The Project schema contains Project identity and descriptive metadata, but no account owner or membership relationship.

The current store retrieves Projects by Project ID.

Possession of a Project ID is not an ownership or access-control mechanism.

### 5.3 Device identity

**Status: Missing**

The inspected source contains no device enrolment model, device identity, device revocation mechanism, or device-specific signing key infrastructure.

The device identity required by ADR-SYNC-001 is not yet represented in the implementation.

### 5.4 Activation confirmation authority

**Status: Partial**

The session lifecycle requires an injected `confirmationAuthority` and checks the returned confirmation information, including an actor ID and confirmation metadata.

However:

- No production authority implementation was found in the inspected source.
- The simulated confirmation authority is test support.
- The recorded actor ID is not independently authenticated account membership.
- The confirmation mechanism does not establish device enrolment or sync authority.

The interface is a useful boundary, but the production trust model remains unimplemented.

### 5.5 Project separation

**Status: Implemented locally; account authorisation remains missing**

The store enforces Project relationships for records and links.

Cross-Project references are separate from access grants.

These controls support local data separation, but they do not replace account and Project authorisation.

## 6. Synchronisation and transfer gaps

### 6.1 Immutable sync contribution bundles

**Status: Missing**

The current contribution intent is a local lifecycle reservation.

No sync-specific bundle format was found.

ADR-SYNC-001 requires an atomic contribution bundle containing the contribution identity, Project identity, originating device, device-local sequence, timestamp, content, relationships, event evidence, provenance, and schema version.

The current payload is not yet that protocol object.

### 6.2 Contribution identity and idempotency

**Status: Missing for synchronisation**

The local system uses record and intent IDs.

No complete sync application mechanism was found that guarantees repeated delivery of the same contribution cannot create duplicate history.

A globally unique contribution identity and an idempotent receiving-side application transaction remain necessary.

### 6.3 Transport and durable archive

**Status: Missing**

No sync server, remote transport, encrypted contribution archive, upload/download mechanism, or durable delivery queue was found in the inspected source.

The current package contains a local CLI and local persistence modules.

The agreed server-mediated transport architecture has not been implemented.

### 6.4 Remote application and atomic acceptance

**Status: Missing**

No remote contribution import or application pipeline was found.

The existing local record transaction is useful, but it does not implement the complete receiving-side process required by ADR-SYNC-001.

The receiving side must validate authority, signature, integrity, schema, Project identity, and dependencies before committing a contribution atomically.

### 6.5 Dependency handling

**Status: Missing for synchronisation**

The current lifecycle has pending local intents and activation dependencies.

These are not the sync states specified in ADR-SYNC-001.

The agreed sync model distinguishes:

- **Received:** The bundle has arrived.
- **Pending:** The bundle is not yet accepted because required dependencies are missing.
- **Applied:** The contribution has passed validation and has been committed locally.

Invalid dependencies must be flagged rather than silently invented, discarded, or partially applied.

No such remote dependency pipeline was found.

### 6.6 Acknowledgements

**Status: Partial, but not sync acknowledgements**

The session lifecycle contains acknowledgement handling for AI-provider context delivery.

Those acknowledgements concern delivery of a handover or refreshed context to an AI session.

They do not establish that a contribution has been durably archived, downloaded to another device, or accepted into another device's local history.

The sync architecture requires three distinct acknowledgements:

1. **Server receipt:** Encrypted bundle durably stored.
2. **Device receipt:** Bundle downloaded.
3. **Device acceptance:** Bundle verified and committed locally.

These are not interchangeable.

### 6.7 Cursors and pagination

**Status: Local pagination only**

The inspected `cursor` usage in `store.mjs` relates to local record pagination using a timestamp boundary.

It is not a remote sync cursor, replication position, or durable acknowledgement checkpoint.

A sync protocol will require its own delivery and recovery position model.

## 7. Concurrent contributions and ordering

**Status: Not implemented across devices**

The current Project event sequence is local to one store.

There is no implementation of concurrent multi-device contribution exchange or merge.

The agreed architecture requires both concurrent contributions to be preserved, with their originating identities and provenance.

DevBridge must not silently overwrite one contribution with another or perform semantic arbitration.

The user and their chosen AI tools remain responsible for interpreting the combined context.

Technical ordering, identity collision handling, and dependency validation remain implementation design work.

## 8. Export, import, and recovery

### 8.1 Current CLI handover

**Status: Implemented, but bounded**

The CLI provides:

`node src/cli.mjs handover --project ID`

This calls `store.buildHandover()` and outputs JSON.

The handover identifies itself as `devbridge-handover-v2` and uses the completeness classification `recorded_context_only`.

Its own notice makes clear that the context may omit private conversations, disconnected sources, and unobserved activity, and that it is not independently verified.

The CLI also supports Project listing, Project creation, record addition, and record listing.

### 8.2 Full Project archive

**Status: Missing**

The current handover is not a full Project archive.

No complete Project export/import mechanism was found that preserves all required identity, contributions, links, provenance, history, and integrity/recovery information.

### 8.3 Independent restoration

**Status: Missing**

No demonstrated process was found for restoring an account or individual Project archive independently of the original DevBridge service.

The existing tests establish local persistence and selected lifecycle behaviours, not independent archive restoration.

**Assessment:** Handover generation is a context-delivery capability, not a backup, archive, or disaster-recovery system.

## 9. Deletion and retention

**Status: Architectural requirement; implementation not established**

The current local history uses append-only protections on records, links, events, and contribution intents.

That supports history integrity but does not solve user-directed deletion across devices and archives.

ADR-SYNC-001 requires explicit deletion scope, propagation, protection against offline reintroduction, and treatment of server archives and backups.

Cryptographic erasure has been proposed, but the key hierarchy, backup retention, and deletion metadata design remain open.

Append-only history must not be interpreted as permission to deny a legitimate user deletion request.

## 10. Testing evidence and limitations

The latest recorded fresh test run at the inspected commit reported:

- 41 tests.
- 41 passed.
- 0 failed.
- 0 skipped.

This is positive evidence for the implemented local behaviour.

The tests do not establish:

- Multi-device synchronisation.
- Device enrolment or revocation.
- Cryptographic signatures.
- End-to-end encryption.
- Server archive durability.
- Remote idempotent application.
- Dependency staging.
- Concurrent multi-device contribution preservation.
- Offline delivery and retry.
- Full Project export/import.
- Independent restoration.
- Distributed deletion and anti-resurrection.

The disposable Git execution probe also demonstrated that patch applicability alone does not establish approval or integrity. It is separate evidence for the execution-security direction, not evidence that sync has been implemented.

## 11. Relationship to ADR-SYNC-001

The agreed synchronisation architecture remains the intended target.

The current implementation provides a useful local foundation for that architecture, but most of the distributed system remains future work.

The following architectural decisions are agreed but not implemented:

- Atomic immutable contribution bundles.
- Per-device Project sequencing.
- Preservation of concurrent contributions.
- At-least-once delivery with idempotent acceptance.
- Server-mediated encrypted transport and archive.
- Device identity and signing.
- Account and Project authority.
- End-to-end encryption.
- Explicit device receipt and acceptance.
- Full archive export and independent restore.
- User-directed deletion and anti-resurrection.

The following technical decisions remain open:

- Physical sync schema and serialization format.
- Server and storage provider.
- Cryptographic algorithms and key hierarchy.
- Device enrolment and recovery protocol.
- Delivery cursors and acknowledgement persistence.
- Metadata minimisation.
- Backup and independent restore format.
- Cryptographic deletion and backup expiry.
- Migration and explicit adoption of existing local Projects into account ownership.

### Design clarification required

The ADR describes both server-side validation of device authority and receiving-device validation of sender authority and signatures.

These responsibilities should be separated precisely in the protocol design:

- The server authenticates the uploading device and enforces current account/Project permissions for transport and archive operations.
- The receiving device verifies the contribution signature and integrity, and applies the agreed rules for contribution authority and revocation evidence.

The exact evidence required for an offline contribution created before revocation but uploaded after revocation must be specified before implementation.

Similarly, encrypted archival storage and cryptographic deletion must be designed together, including key granularity, backup retention, and recovery consequences.

## 12. Implementation gates

The following gates should be satisfied before declaring V1 synchronisation complete.

| Gate | Required evidence |
|---|---|
| Account authority | Authenticated account identity and enforceable Project ownership/membership |
| Device authority | Enrolment, identity, signing keys, revocation and recovery |
| Contribution protocol | Versioned immutable bundle with globally unique identity |
| Cryptographic integrity | Signature generation and verification tests |
| Privacy | End-to-end encryption and server unreadability evidence |
| Durable archive | Server-side encrypted storage and recovery evidence |
| Delivery | At-least-once transfer with durable receipt and retry |
| Idempotency | Repeated delivery cannot duplicate accepted history |
| Dependencies | Pending, resolution, invalid-dependency and retry tests |
| Atomicity | No partially accepted contribution bundles |
| Concurrency | Independent contributions survive concurrent exchange |
| Offline operation | Offline contribution creation and later safe delivery |
| Acknowledgements | Separate server receipt, device receipt and device acceptance |
| Portability | Full Project and account archive export/import |
| Independent restore | Restore without relying on the original device or service |
| Deletion | Explicit deletion, propagation, backup treatment and anti-resurrection |
| Existing data | Safe, explicit local Project adoption and account association |
| Migration | Tested upgrades, interrupted migration and recovery |
| Multi-device validation | Tests across separate stores and independent device identities |

## 13. Recommended implementation sequence

This sequence is a proposed order of work, not approval to begin implementation.

1. **Close the protocol design:** Specify bundle identity, schema, signatures, ordering, dependencies, acknowledgements, and revocation evidence.
2. **Establish authority:** Define account identity, Project ownership, device enrolment, recovery, and revocation.
3. **Define cryptographic architecture:** Settle encryption, signing, key distribution, recovery, and deletion together.
4. **Define archive and transport:** Specify the server's ciphertext storage, delivery queue, retention, and acknowledgement responsibilities.
5. **Build local acceptance:** Implement and test bundle validation, dependency staging, idempotency, and atomic application using disposable test databases.
6. **Build delivery:** Add retry, offline operation, durable acknowledgements, and multi-device exchange.
7. **Build portability and recovery:** Implement full archive export/import and independent restoration.
8. **Complete deletion:** Implement user-directed deletion, propagation, backup expiry, and anti-resurrection.
9. **Validate the complete system:** Run multi-device, failure, recovery, concurrency, security, and migration tests.

## 14. Final assessment

DevBridge has a meaningful local continuity foundation.

Its strongest existing capabilities are local persistence, append-only history, Project-level relationship integrity, transactional record creation, and carefully bounded session contribution handling.

Those capabilities should be preserved and extended rather than casually replaced.

However, the current repository should not be described as having synchronisation, multi-device continuity, portable Project archives, or disaster recovery.

The correct current status is:

**Local continuity implemented. Synchronisation architecture agreed. Distributed synchronisation implementation pending.**

The next engineering task should be to translate ADR-SYNC-001 into a concrete protocol and component design, resolve the remaining technical questions, and only then approve implementation.

---

**Review status:** Approved by user for repository documentation.  
**Git status:** Documentation-only change; no application code or local database changed.
