# DevBridge — Session Lifecycle Test Plan

**Version:** 0.1  
**Status:** Proposed test plan  
**Branch:** `build/v1-scope`  
**Acceptance contract:** [Session Lifecycle Acceptance Criteria](SESSION_LIFECYCLE_ACCEPTANCE.md)  
**Design authority:** [Session Lifecycle Design](SESSION_LIFECYCLE_DESIGN.md)

---

## 1. Objective

Verify that DevBridge enforces the agreed session and project-context lifecycle before connecting a real AI provider.

The test plan begins with a deterministic simulated provider adapter. It must be possible to control delivery outcomes without relying on network access, provider accounts, timing luck or real AI behaviour.

The tests verify DevBridge's own records and guarantees. They do not establish the capabilities of any real provider.

## 2. Test layers

### Layer A — Domain and state-transition tests

Exercise lifecycle rules using an isolated store and deterministic inputs.

Verify:
- Legal and illegal transition conditions.
- Session and activation state.
- Project confirmation.
- Handover identity and history boundary.
- Contribution attribution.
- Checkpoint, delivery and lifecycle-event history.
- Staleness and concurrency markers.

### Layer B — Simulated-adapter integration tests

Exercise the lifecycle coordinator through an adapter contract with deterministic outcomes:
- Acknowledged at a declared level.
- Failed before delivery.
- Delivery outcome unknown.
- Retry acknowledged after an earlier failure.
- Duplicate or mismatched acknowledgement.
- Adapter capability insufficient to meet the activation requirement.

The simulated adapter must not pretend to prove model comprehension.

### Layer C — End-to-end workflow tests

Exercise complete user-visible sequences using temporary databases:
- Initial project activation.
- A → B → A.
- Failed switch and recovery.
- Concurrent sessions and deferred refresh.
- Cross-project reference.
- Session ending and project persistence.

All test data must be disposable and isolated. Tests must never use a real project database or production service.

## 3. Deterministic test fixtures

Use generated or fixed identifiers and a controllable logical clock/sequence source. Do not rely on sleep calls or timestamp ordering alone.

### Projects
- Project A with a known initial set of records.
- Project B with a separate known initial set of records.

### Sessions
- Session S1 and Session S2, initially unbound.
- Each Session has an independent lifecycle.

### Contributions
Use identifiable records such as:
- A-REC-1: initial Project A requirement.
- A-REC-2: later Project A contribution, added after S1's handover.
- B-REC-1: initial Project B decision.
- S1-REC-1 and S2-REC-1: concurrent contributions with distinct provenance.

### Simulated adapter
The adapter should accept a prepared handover and return a configured result without making network calls.

Each result must state:
- Attempt identity.
- Outcome: acknowledged, failed or unknown.
- Declared acknowledgement level/capability.
- Provider-side reference when simulated and useful.
- A deterministic test sequence value.

Test controls should allow the same scenario to produce different outcomes on successive attempts.

## 4. Scenario-to-test mapping

| Test ID | Acceptance scenario | Core assertions |
|---|---|---|
| SLT-01 | SLA-01 Initial activation | No activation before confirmation and acknowledgement; active only after both; exact handover and attempt linked |
| SLT-02 | SLA-02 Switch A → B | A checkpoint persists; B activation waits for acknowledgement; one active primary Project |
| SLT-03 | SLA-03 Return B → A | New A activation and handover; newer A record included; earlier A handover retained |
| SLT-04 | SLA-04 Failed/unknown delivery | Target remains inactive; transition blocked; no continuation attributed to target |
| SLT-05 | SLA-05 Checkpoint survives failure | Outgoing activation remains ended; failed incoming delivery creates no activation; recovery requires a fresh confirmed activation and handover; original checkpoint and attempts remain immutable |
| SLT-06 | SLA-06 Contribution attribution | Each record maps to exact active Project, Session and Activation; no active activation rejects continuation |
| SLT-07 | SLA-07 Staleness detection | New contribution beyond another activation's handover boundary marks that activation potentially stale |
| SLT-08 | SLA-08 Deferred refresh | Ongoing work not interrupted at marker creation; next continuation pauses; acknowledged fresh delivery required |
| SLT-09 | SLA-09 Concurrent contributions | Reserve both Session submissions at the same current Project boundary before either commit; commit in the order that makes the second activation stale; assert both records survive with distinct provenance, reciprocal staleness facts and later-continuation gates |
| SLT-10 | SLA-10 No semantic judgement | Reserve differing statements from two current Sessions; commit both; assert exact content/provenance survives, staleness markers remain factual, and no automatic relationship/conflict event/table appears; after an acknowledged refresh, assert an explicit disagreement is a new attributed contribution with only its user-specified relationship |
| SLT-11 | SLA-11 Cross-project reference | Reference creates no activation, handover delivery or inherited access |
| SLT-12 | SLA-12 Session end | Session ends; Project, contributions and lifecycle history remain |

## 5. Additional integrity and fault-injection tests

These tests supplement the twelve main scenarios.

### SLT-13 — Duplicate activation request

Submit the same activation request more than once, including a retry after an interrupted response.

Assert that idempotency rules prevent duplicate active primary activations and that all distinct attempts/events remain traceable.

### SLT-14 — Acknowledgement mismatch

Return an acknowledgement for a different handover, activation request or delivery attempt.

Assert that it cannot activate the requested Project.

### SLT-15 — Cross-session/project reference integrity

Attempt to attach:
- An activation from S1 to a handover for the wrong Project.
- A contribution from S1 to an activation owned by S2.
- A checkpoint to an unrelated activation.

Assert that invalid associations are rejected atomically.

### SLT-16 — Interrupted transition

Inject failure between lifecycle steps, especially:
- After outgoing checkpoint creation.
- After handover preparation.
- After delivery attempt creation.
- After provider acknowledgement but before activation finalisation.

Reopen the store in a fresh process or fresh store instance and verify that recovery produces an explicit, consistent state. It must not invent success or lose recorded history.

### SLT-21 — Unknown delivery is never automatically replayed

Create and persist a delivery intent with a stable delivery identifier. Simulate provider acceptance followed by process termination before DevBridge records the acknowledgement. Reopen the lifecycle store in a fresh process.

Assert that:
- The unresolved outcome is reconstructed as Unknown/pending reconciliation, not silently treated as Failed or Acknowledged.
- Startup and ordinary lifecycle recovery do not call the provider adapter to resend the delivery.
- The original delivery intent and identifier remain unchanged; a provider attempt is not fabricated when no response was recorded.
- A retry of the same logical delivery is allowed only when the adapter contract proves idempotency for that same identifier, or provider reconciliation establishes that the earlier delivery was not accepted.
- If neither condition can be established, the original intent remains unresolved/Unknown and recovery requires a separately authorised safe path, such as a new provider session and a newly prepared handover.
- A separately confirmed activation in a fresh DevBridge Session may prepare a new handover and delivery ID without rewriting or erasing the original unknown intent.

### SLT-22 — Confirmation is authenticated, bound and single-use

Exercise the injected confirmation-authority boundary with the test-only simulated authority. Verify that forged tokens, mismatched request/session/project scope, and repeated confirmation are rejected; confirmation evidence is stored separately and append-only; activation cannot proceed without a verified confirmation; and the authenticated actor/method/reference are preserved. This test authority is not production authentication.

### SLT-23 — Durable outgoing checkpoint boundary

Activate Project A, record additional A history, confirm a switch request to Project B, and checkpoint A before attempting B delivery.

Assert that:
- The checkpoint identifies the exact outgoing activation, Project A and its original handover.
- The checkpoint is bound to the exact confirmed incoming request for Project B.
- The Project event sequence, final event identifier/time and record/event counts describe one consistent history boundary.
- The Session lifecycle sequence identifies the last event before checkpoint creation.
- The checkpoint, activation_checkpointed event and activation_ended event commit atomically and reference one another.
- The outgoing activation is no longer active after checkpointing.
- Later Project A contributions receive a higher event sequence and do not alter the checkpoint.
- Checkpoint update/delete attempts are rejected.
- A delivery attempt for Project B cannot begin before checkpointing, and can proceed after the checkpoint is committed.
### SLT-17 — Staleness boundary correctness

Create multiple activations at different project-history boundaries. Add a contribution and verify only eligible older active activations are marked potentially stale.

Verify that a refresh addresses a marker only when the acknowledged fresh handover includes the relevant newer boundary. A marker must not be cleared merely because a refresh was attempted.

### SLT-18 — Deterministic ordering

Create multiple lifecycle events with equal wall-clock timestamps and delayed/out-of-order supplied timestamps.

Assert that a stable sequence or equivalent ordering mechanism preserves deterministic event order and does not move the recorded Project history boundary backwards.

### SLT-19 — Append-only lifecycle history

Attempt ordinary application-level update/delete operations against lifecycle events, delivery attempts, checkpoints and historical activation events.

Assert that prior outcomes cannot be silently rewritten or deleted.

### SLT-20 — Transaction atomicity

Inject an error during a transition write.

Assert that no partial active activation, orphan handover association, dangling delivery acknowledgement or incomplete checkpoint is left behind. Durable pre-existing history remains intact.

## 6. Test execution and isolation

- Use a fresh temporary SQLite database for each test or test group.
- Close database handles and remove temporary directories in guaranteed cleanup.
- Never point tests at the user's default `.devbridge/devbridge.sqlite`.
- Do not require a real provider, account, API key or network connection.
- Use deterministic IDs and controllable sequence/time inputs.
- Avoid timing-dependent sleeps.
- Verify persisted state after reopening the database.
- Keep fixtures small but include multiple Projects and Sessions.
- Include both successful and failed paths.

## 7. Test progression and implementation gates

### Gate 1 — Contract tests

**Established in the current branch:** lifecycle design, acceptance criteria, test plan and deterministic provider/confirmation test doubles.

### Gate 2 — Initial lifecycle implementation

**Implemented and locally verified in Termux at commit `f4cff73`:** initial activation, injected confirmation authority, append-only confirmation evidence, durable delivery intents, stable delivery identifiers, acknowledgement validation, fail-closed unknown handling, per-Project event sequencing, immutable outgoing checkpoint creation and SLA-06 contribution attribution.

The complete test command `npm test` passed on Android/Termux with Node `v26.3.1`: **35 tests, 28 passed, 0 failed, 7 TODO** (1.20 seconds). The run includes passing SLA-01 through SLA-06 implementation tests, including the dedicated contribution-attribution test, plus the SLA-02 A → B switch, SLA-03 A → B → A return path, SLA-05 failed-switch recovery, unknown-delivery restart handling, confirmation-boundary checks, migration tests and the SLT-23 checkpoint-boundary test. The seven TODO entries are the SLA-06 acceptance placeholder and SLA-07 through SLA-12; they are not failed tests. This is not the complete Session Lifecycle. Stale-context refresh, concurrent contribution handling, semantic non-judgement assertions, cross-Project reference behaviour and Session ending remain to be implemented and/or verified.

### Gate 3 — Recovery and hardening

The branch includes passing Termux tests for process termination after simulated provider acceptance, mismatched acknowledgement, duplicate delivery invocation, separately authorised fresh-Session recovery, schema migration to v4 contribution attribution and the SLT-23 outgoing checkpoint boundary. SLA-02 A → B switching, SLA-03 A → B → A return, SLA-05 failed-switch recovery and SLA-06 contribution attribution passed in the earlier full run at `f4cff73` (35 tests, 28 passed, 0 failed, 7 TODO).

**SLA-07 is implemented and locally verified** on branch `build/v1-scope`. At commit `8da1486`, the user ran `npm test` in Android/Termux with Node `v26.3.1`: **37 tests, 30 passed, 0 failed, 7 TODO** (1.39 seconds). Both SLA-07 tests passed: a newer Project contribution marks other older active activations potentially stale, and a contribution arriving during handover delivery marks the new activation stale when it is registered. The seven TODO entries remain acceptance placeholders for SLA-06 through SLA-12; they are not failed tests.

**SLA-08 is implemented and locally verified** on branch `build/v1-scope`. At commit `51f3348`, the user ran `npm test` in Android/Termux with Node `v26.3.1`: **40 tests, 34 passed, 0 failed, 6 TODO** (1.80 seconds). The implementation adds append-only refresh intents and outcomes, a fresh handover boundary per refresh, explicit disclosure of unaddressed staleness markers, and a continuation gate enforced both by the lifecycle API and a SQLite insert trigger. Only an acknowledged refresh covers markers at or before its captured Project event sequence. A contribution arriving during delivery remains newer than that boundary and keeps the activation stale. Definitive failure permits a separately invoked fresh refresh with a new delivery ID; an Unknown or unrecorded outcome blocks automatic replay. Passing tests cover successful refresh, failed-refresh recovery, unknown-delivery blocking, contribution-during-refresh, preservation of the original activation/handover, and direct-store bypass rejection. The six TODO entries are the SLA-06 and SLA-07 acceptance placeholders plus SLA-09 through SLA-12; they are not failed tests. SLA-09 through SLA-12 and remaining integrity scenarios are still outstanding.

### Gate 4 — Review

Review:
- Whether every acceptance invariant is enforced by the store, not only by CLI conventions.
- Whether a fresh process can reconstruct a consistent lifecycle state.
- Whether provider acknowledgement semantics are explicit and capability-aware.
- Whether implementation remains inside the v1 responsibility boundary.

Only after this review should selection and investigation of a real provider integration begin.

## 8. Reporting test results

For each run, report:
- Exact commit and branch.
- Runtime and platform.
- Test command.
- Total, passed and failed tests.
- Scenario/test IDs covered.
- Any skipped or unimplemented cases.
- Whether tests used only temporary disposable databases.
- Any known limitations.

A green test suite proves only the behaviours it exercises. It does not prove real-provider compatibility, multi-device synchronisation, backup/restore or production readiness.

---

**Test principle:** Prove DevBridge's lifecycle rules with a deterministic adapter before depending on a real provider.


### SLA-09 Termux verification

Verified locally by the user on Android/Termux with Node.js v26.3.1 after pulling commit `1181ae7` (SLA-09 implementation and acceptance/test-plan updates):

- Tests: 41
- Passed: 35
- Failed: 0
- Cancelled: 0
- Skipped: 0
- TODO placeholders: 6
- Duration: 1467.187292 ms

The dedicated test `SLA-09: overlapping Session submissions are both retained with distinct attribution` passed. The six TODO entries are acceptance-plan placeholders, not failed or skipped tests. This verifies the implemented overlapping-submission scenario in the local SQLite test environment; it does not establish multi-process production concurrency or provider integration behaviour.

### SLA-10 Termux verification

Verified locally by the user on Android/Termux with Node.js v26.3.1 after pulling commit `e4804b5`:

- Command: `npm test`
- Tests: 42
- Passed: 36
- Failed: 0
- Cancelled: 0
- Skipped: 0
- TODO placeholders: 6
- Duration: 1417.595937 ms

The dedicated test `SLA-10: differing concurrent contributions remain neutral until an attributed contribution records a relationship` passed. It verifies that differing concurrent statements remain separately preserved and attributed; staleness markers do not create semantic conflict judgements; no automatic relationship or conflict event/table is introduced; and a relationship such as `contradicts` is recorded only through a new attributed contribution explicitly supplied by the user.

The six TODO entries are remaining acceptance placeholders, not failed or skipped tests. This run verifies the implemented SLA-10 scenario in the local SQLite test environment. It does not establish real-provider behaviour, production authentication, multi-process production concurrency or production readiness.
