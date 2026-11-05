# DevBridge — Session Lifecycle Acceptance Criteria

**Version:** 0.1  
**Status:** Proposed executable acceptance contract  
**Branch:** `build/v1-scope`  
**Parent design:** [Session Lifecycle Design](SESSION_LIFECYCLE_DESIGN.md)  
**Related model:** [V1 Data Model](V1_DATA_MODEL.md)  
**Product boundary:** [V1 Scope](V1_SCOPE.md)

---

## 1. Purpose

This document turns the agreed Session Lifecycle Design into observable acceptance criteria for implementation and automated testing.

It defines what the system must demonstrate, not how the database, API, provider adapter or user interface must be implemented.

The acceptance contract applies to DevBridge-mediated activity. It does not claim control over messages or actions that take place independently inside an external provider.

## 2. Terms used by the criteria

- **Session:** a DevBridge interaction identity. It is not the provider's conversation ID.
- **Project Activation:** one confirmed period in which a Project is the Session's primary context.
- **Handover:** a fresh, identifiable snapshot of a Project's recorded context at a defined history boundary.
- **Delivery acknowledgement:** the strongest receipt/acceptance confirmation explicitly supported and declared by the adapter. It is not proof of model comprehension.
- **Outgoing checkpoint:** a durable record of the outgoing activation's recorded position. It does not close the Project.
- **Potentially stale:** an activation's supplied handover predates a relevant Project contribution recorded afterwards.
- **Continuation:** a new DevBridge-mediated contribution or operation accepted under an active Project Activation.

## 3. Global invariants

Every acceptance scenario must preserve these rules:

1. A Session has no more than one active primary Project Activation at a time.
2. A Session may exist without an active Project, including while a transition is pending or blocked.
3. A Project Activation cannot become active before the intended Project is explicitly confirmed and the required fresh handover delivery is acknowledged.
4. Every activation, including a return to a previously used Project, receives a new handover based on the latest recorded Project state.
5. An outgoing checkpoint does not end, lock or declare the Project complete.
6. Every accepted Session contribution is attributed to the Project and Activation active when it is accepted, with source provenance and context boundary where available.
7. A failed or unknown transition does not silently fall back to the outgoing Project or activate the incoming Project.
8. Historical contributions, lifecycle events, delivery attempts and checkpoints are preserved; retries append history rather than rewriting earlier outcomes.
9. Concurrent Sessions may contribute to the same Project. Neither Session is implicitly the successor or authority.
10. Staleness and concurrency markers describe recorded version/overlap facts only. They are not semantic conflict judgements.
11. A cross-Project reference does not activate the referenced Project, deliver its context or grant access to it.
12. Ending a Session does not delete or alter the persistent Project or its history.

## 4. Acceptance scenarios

### SLA-13 — Project confirmation must be authenticated, exact and single-use

**Given**
- Session S has a pending activation request R for Project A.
- The user is authenticated through a trusted DevBridge interface.

**When**
- The authenticated user explicitly confirms R for Project A.

**Then**
- The confirmation is bound to R, S and Project A.
- DevBridge records the authenticated actor, confirmation method and time.
- The confirmation can authorise only R and cannot be replayed for another request, Session or Project.

**And**
- A provider/model message, background process, ordinary API caller, unauthenticated client, or caller-supplied confirmation fields cannot authorise activation.
- A forged, mismatched, expired or replayed confirmation is rejected and does not trigger handover delivery or activation.
- A test-only simulated confirmation mechanism is never represented as production authentication.

### SLA-01 — Initial activation requires confirmation and acknowledged delivery

**Given**
- Project A exists.
- Session S exists without an active Project.
- The adapter can prepare and deliver a handover and return a declared acknowledgement.

**When**
- The user requests Project A.
- Project A is explicitly confirmed.
- A fresh handover is prepared and delivery is acknowledged.

**Then**
- A new activation for A is recorded.
- The activation references the exact handover delivered.
- The adapter's acknowledgement level and outcome are recorded.
- A becomes the single active primary Project for S.
- Contributions accepted afterwards are attributed to this activation.

**And**
- Before confirmation and acknowledgement, A is not active.

### SLA-02 — Switching A → B checkpoints A and activates B only after delivery

**Given**
- Session S has active Project A activation A1.
- Project B exists.

**When**
- A switch to B is requested and B is confirmed.
- The outgoing A1 position is checkpointed.
- A fresh B handover is prepared, delivered and acknowledged.

**Then**
- A's checkpoint is durable and references A1 and its recorded boundary.
- A1 is no longer the active primary activation for S.
- A new activation B1 is recorded and becomes active only after acknowledgement.
- B1 references the fresh B handover and its delivery outcome.
- A's Project history remains available and unchanged.

### SLA-03 — Returning B → A creates a fresh A activation and handover

**Given**
- Session S previously activated A, then switched to B.
- A has received at least one new contribution since the earlier A handover.

**When**
- S requests a return to A.
- A is explicitly confirmed.
- DevBridge prepares and delivers a new A handover.

**Then**
- A new activation A2 is created; the earlier A1 activation is not reused.
- A2 references a new handover whose history boundary includes the newer contribution.
- The earlier A handover remains historically identifiable.
- A becomes active only after the new delivery is acknowledged.

### SLA-04 — Failed or unknown delivery blocks the incoming activation

**Given**
- Session S has an outgoing active activation, or has no active Project.
- A target Project is requested and confirmed.

**When**
- Delivery fails, or the adapter cannot establish the delivery outcome.

**Then**
- The transition remains incomplete/blocked.
- The target Project is not active.
- No contribution can be accepted as a continuation under the target activation.
- The exact failed or unknown attempt is preserved.
- The system reports the limitation without claiming delivery succeeded.

**And**
- The system does not silently reactivate the outgoing Project as though the requested transition succeeded.

### SLA-05 — Failed transition preserves outgoing checkpoint and all history

**Given**
- Session S has active Project A.
- A has contributions and a recorded outgoing position.

**When**
- A switch to B is confirmed.
- A's outgoing checkpoint is recorded.
- B handover delivery then fails or remains unknown.

**Then**
- A's checkpoint remains available and unchanged.
- All A contributions and events remain intact.
- B's failed/unknown transition history remains visible.
- Retrying B does not overwrite the original failed/unknown attempt or create duplicate A contributions.

### SLA-06 — Contributions use the active Project Activation

**Given**
- Session S has a confirmed active activation A1 for Project A.

**When**
- A contribution is accepted.
- S later switches to Project B and receives active activation B1.
- Another contribution is accepted.

**Then**
- The first contribution is attributed to Project A and A1.
- The second is attributed to Project B and B1.
- Both preserve actor/source provenance and their relevant handover/context boundary.
- A contribution is never reassigned merely because S later switches Projects.

**And**
- If no active confirmed activation exists, DevBridge does not guess the Project attribution or accept the contribution as an ordinary project continuation.

### SLA-07 — A newer contribution marks another active activation potentially stale

**Given**
- Sessions S1 and S2 have active activations for the same Project.
- Both activations were based on handovers at known history boundaries.

**When**
- S2 records a new Project contribution beyond S1's supplied handover boundary.

**Then**
- S1 is marked potentially stale against that newer recorded boundary.
- S2's contribution and provenance are preserved.
- S1's ongoing interaction is not forcibly interrupted solely by this marker.
- The marker does not claim S1's work is wrong or that S1 has seen the new contribution.

### SLA-08 — A stale activation refreshes before its next continuation

**Given**
- Session S1 has an active activation marked potentially stale.
- A newer Project contribution exists beyond its supplied handover boundary.

**When**
- S1 attempts its next DevBridge-mediated Project continuation.

**Then**
- The stale condition is disclosed.
- Normal continuation is paused.
- A fresh handover including the newer recorded boundary is prepared and delivered.
- S1 resumes only after the required acknowledgement is recorded.
- A refresh creates traceable lifecycle history and does not overwrite prior contributions or the original handover.

**And**
- If refresh delivery fails or is unknown, the activation remains unable to continue under the stale context.

### SLA-09 — Concurrent contributions remain distinct and attributable

**Given**
- Sessions S1 and S2 are active against the same Project.
- Each has its own activation and handover boundary.

**When**
- Both Sessions submit contributions, including contributions made before either has refreshed.

**Then**
- Both contributions are retained.
- Each contribution remains attributed to its own Session, activation, actor/source and context boundary.
- Neither contribution overwrites or absorbs the other.
- A later handover can represent both contributions and their provenance, subject to its declared history boundary.

### SLA-10 — Concurrency and staleness do not become semantic conflict judgements

**Given**
- Two Sessions contribute to the same Project, potentially with differing or contradictory statements.

**When**
- DevBridge detects overlapping activity or a newer contribution relative to an older handover.

**Then**
- DevBridge may record concurrency and staleness facts.
- It does not infer a semantic conflict solely from overlap or version age.
- It does not rank Sessions or contributions, choose a winner, discard either contribution or resolve the disagreement.
- An explicit user/AI disagreement or resolution may be recorded only as a new attributed contribution.

### SLA-11 — Cross-Project reference does not activate or disclose another Project

**Given**
- Session S has active Project A.
- Project B exists and has its own independent continuity records.

**When**
- An explicit cross-Project reference from A to B is recorded.

**Then**
- A remains the active Project for S.
- No B activation is created.
- No B handover is delivered or silently included.
- The reference itself does not grant access to B's records, files, credentials or permissions.
- Any later B activation requires the ordinary confirmation and fresh-delivery lifecycle.

### SLA-12 — Ending a Session leaves Project identity and history intact

**Given**
- Session S has one or more Project Activations and recorded contributions.
- Its Project has persistent history.

**When**
- S is ended.

**Then**
- S is marked ended through a traceable lifecycle event/state.
- Its activations, handovers, checkpoints, delivery attempts and contributions remain historically available.
- The Project remains independently accessible in the Project catalogue.
- No Project history is deleted or rewritten because the Session ended.

## 5. Cross-scenario failure and integrity requirements

The implementation and test suite must additionally establish:

- Lifecycle events have stable identities and a deterministic ordering mechanism that does not rely solely on wall-clock timestamps.
- A handover is tied to a reproducible Project history boundary.
- A delivery retry is a distinct attempt with its own outcome and timestamp.
- Duplicate submission/retry handling cannot silently create two active primary activations for one Session.
- A failed transaction cannot leave a partially active Project Activation.
- A Session cannot attribute a contribution to an activation belonging to another Session or Project.
- A Project Activation cannot reference a handover belonging to another Project.
- A Project Activation cannot become active from an acknowledgement belonging to a different delivery attempt.
- Cross-Project references are stored separately from within-Project record relationships.
- Historical lifecycle events, checkpoints and delivery attempts cannot be silently rewritten or deleted through ordinary application operations.
- The implementation discloses when provider capability cannot establish the required acknowledgement.

These requirements are intentionally expressed as observable integrity properties. Physical constraints and transaction boundaries remain implementation decisions.

### Additional confirmation trust-boundary requirements

- Unauthenticated confirmation is rejected.
- A confirmation issued for one activation request cannot be used for another request.
- A confirmation for one Project or Session cannot authorise another.
- Provider-originated statements and ordinary application/API parameters cannot substitute for an authenticated user action.
- Replayed confirmation tokens/results are rejected.
- The authenticated actor and confirmation provenance are preserved in lifecycle history.
- Test fixtures clearly distinguish simulated confirmation from production authentication.

## 6. Test evidence standard

A passing test must assert observable stored state and externally visible behaviour, not merely that a function returned without throwing.

Where relevant, tests must inspect:
- Session and activation identities and states.
- Exact Project and handover associations.
- Handover history boundaries and included records.
- Delivery-attempt outcome and acknowledgement level.
- Lifecycle event order and provenance.
- Checkpoint persistence after failure.
- Contribution attribution.
- Staleness marker target and newer boundary.
- Preservation of all competing/concurrent contributions.
- Absence of unintended activation, access or mutation.

A simulated provider can prove DevBridge's internal lifecycle behaviour. It cannot prove that a real provider exposes the same capabilities or acknowledgement semantics.

## 7. Scope exclusions

These criteria do not authorise:
- Real provider integration.
- Shell/command execution or project-file modification.
- Test execution against user projects.
- Technical conflict arbitration or automatic resolution.
- Complete provider conversation archiving.
- Multi-user collaboration.

The first implementation should use a deterministic simulated adapter to exercise acknowledged, failed and unknown delivery outcomes.

---

**Acceptance contract:** All thirteen scenarios and cross-scenario integrity requirements above must pass before the session lifecycle is considered implemented.

**Implementation note:** The lifecycle core now requires a confirmation authority injected by its trusted composition root. Confirmation evidence is stored in a separate append-only table and bound to one activation request, Session and Project. The repository currently contains only a test-only simulated authority; this does not constitute production authentication or a trusted user interface. Delivery intents are also persisted before provider calls with stable identifiers. A missing outcome is exposed as Unknown after reopening the store, and automatic replay is blocked. Provider reconciliation and safe idempotent retry are not yet implemented.
