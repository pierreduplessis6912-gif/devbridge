# DevBridge — Session Lifecycle Design

**Version:** 0.1  
**Status:** Agreed architectural design; implementation not yet started  
**Branch:** `build/v1-scope`  
**Parent scope:** [V1 Product Scope](V1_SCOPE.md)  
**Related contract:** [Handover Contract](HANDOVER_CONTRACT.md)

---

## 1. Purpose

This document defines how DevBridge represents and manages an interaction with an AI provider when the user moves between projects, returns to earlier projects, or works across multiple AI sessions at the same time.

The design protects project continuity without making an AI conversation the owner of project knowledge.

It is an architectural contract, not a database schema or provider-specific implementation specification.

## 2. Governing principles

The session lifecycle must follow the established DevBridge boundaries:

- **Facilitate, don't dictate.**
- **Observe, don't interfere.**
- **Preserve, don't own.**
- The project is persistent; AI conversations are replaceable.
- The user directs the work. AI instances assist. DevBridge preserves continuity.
- DevBridge records activity and provenance; it does not judge technical correctness or resolve disagreements.

Additional session invariants:

1. A DevBridge Session is distinct from an external provider conversation.
2. One session has at most one active primary project context at a time.
3. A session may move between projects without requiring the external AI conversation to end.
4. Every project activation, including a return to a previously active project, requires a fresh handover.
5. Project identity must be confirmed before the new project's context is delivered.
6. A project transition is not complete until the required context delivery is acknowledged at the strongest level the provider actually supports.
7. If project confirmation or context delivery/acknowledgement fails, the transition stops. DevBridge must not authorise project work to continue under the unconfirmed context.
8. Concurrent sessions are allowed. Their contributions and context versions remain independently attributable.
9. DevBridge flags concurrency and stale context. It does not decide whether contributions conflict or which contribution is correct.
10. Historical contributions are preserved. A handover or refresh never overwrites project history.

## 3. Core concepts

### 3.1 Project

A persistent development initiative with its own identity and continuity records. It exists independently of any session, provider conversation, device or repository.

### 3.2 DevBridge Session

A DevBridge record of an interaction with an AI provider. It records the provider/model where known, optional external conversation identifier, lifecycle, and the sequence of project contexts activated during that interaction.

A DevBridge Session is not a transcript and is not the authoritative owner of project contributions.

A session can remain open while its active project changes.

### 3.3 Provider conversation

The provider-side conversation or interaction identifier, if the provider exposes one reliably. It is an optional external reference, not the DevBridge session identity.

A provider may recycle, truncate, fork or otherwise change conversation context. DevBridge must not assume that a persistent provider conversation ID proves that the model still has an earlier handover in context.

### 3.4 Project activation

A recorded period in which one project is the session's active primary project context.

A session can have a sequence such as:

`Project A → Project B → Project A`

Each activation is distinct and has its own handover/delivery record. Re-activating Project A does not reuse its earlier handover.

### 3.5 Contribution

A meaningful structured record supplied by the user, an AI instance or an authorised source. Every contribution made in a session is attributed directly to the project context active when the contribution is accepted and recorded, as well as to its originating session and source.

A contribution must not be reassigned to another project merely because the session later switches projects.

### 3.6 Handover

A provider-independent representation of a project's recorded context, prepared from a defined project state. It is a snapshot for delivery, not a replacement for the underlying append-only records.

Each handover must be identifiable and traceable to the project state/version or exact record set from which it was assembled.

## 4. Session and project relationship

A session is not permanently bound to one project.

Instead, it has an ordered history of project-context activations. At any point it has either:

- one active primary project context; or
- no active project context, for example before initial selection or while a transition is blocked.

Only one primary project context may be active in a session at a time.

A session may refer to another project only through an explicit, recorded cross-project reference. Such a reference does not activate that project, load its handover, or authorise contributions to be attributed to it.

Switching the active project is different from merely referencing another project.

### Attribution rule

Every accepted contribution must identify:

- project ID;
- DevBridge session ID;
- active project-activation ID;
- originating actor/source and provider/model where available;
- timestamp and source reference where available;
- the handover/context version supplied for that activation, where known.

If the active project cannot be established, DevBridge must not silently guess the project attribution.

## 5. Project transition lifecycle

A project switch is a deliberate context transition, not merely a label change.

For a switch from Project A to Project B:

1. **Switch requested.** The user or supported interaction requests Project B.
2. **Confirm intended project.** DevBridge makes the target project's identity clear and obtains confirmation that Project B is the intended project.
3. **Checkpoint outgoing context.** Following confirmation, DevBridge records a session checkpoint for Project A, preserving the session's recorded contributions and the context/version under which they were made. This does not close Project A or declare its work complete.
4. **Prepare incoming handover.** DevBridge assembles a fresh handover from Project B's latest recorded state. It must not reuse a handover from an earlier activation.
5. **Deliver through supported provider capability.** The provider adapter attempts delivery using an authorised, documented mechanism.
6. **Obtain delivery acknowledgement.** DevBridge records the strongest confirmation the provider interface actually exposes.
7. **Activate Project B.** Only after project identity is confirmed and required context delivery is acknowledged may the transition be marked complete and Project B become the active primary context.
8. **Resume project interaction.** Subsequent accepted contributions are attributed to Project B and this new activation.

The outgoing checkpoint and incoming activation are separate records. A successful checkpoint does not imply successful delivery of the incoming handover.

### Returning to an earlier project

Returning from B to A follows the same process. DevBridge prepares a new handover from A's latest recorded state, confirms A as the intended project, and delivers/acknowledges that handover.

The fact that the same provider conversation previously used A does not establish that its context is current or still present.

## 6. Context delivery and confirmation

Project identity confirmation and context-delivery confirmation are separate requirements.

### Project confirmation

The intended project must be unambiguous and explicitly confirmed before its context is delivered for activation.

**Agreed trust boundary:** Only an authenticated user action through a trusted DevBridge interface may authorise project activation. An AI provider, model response, background process, ordinary API caller, or unauthenticated client cannot assert or manufacture the user's confirmation.

The confirmation must be bound to the exact pending activation request, DevBridge Session and target Project. It must be single-use and must not be transferable to another request, session or project. DevBridge must verify the authenticated actor's authority at the confirmation boundary and record the actor, confirmation method, request identity and time as provenance.

A caller-supplied boolean or fields such as `confirmedBy`, `confirmedProjectId` or `confirmationMethod` are not, by themselves, evidence of authenticated user intent. Internal lifecycle functions must consume a verified confirmation result issued by the trusted boundary, rather than trusting arbitrary caller-provided confirmation claims.

A simulated confirmation adapter may be used in isolated tests, but it must be clearly identified as test-only and must not be treated as proof of production authentication.

### Context delivery status

The lifecycle must distinguish at least:

- **Prepared:** a handover snapshot was assembled.
- **Delivery attempted:** DevBridge attempted to send it.
- **Provider accepted/acknowledged:** the provider interface returned the documented acknowledgement available to the adapter.
- **Confirmed for activation:** the adapter's declared contract says the required delivery acknowledgement has been met and the project activation may proceed.
- **Failed:** delivery or acknowledgement failed.
- **Unknown:** the provider did not expose enough information to establish the outcome.

The adapter must declare what its acknowledgement means. Acceptance of a payload by an API must not be described as proof that a model understood, retained or correctly applied the content.

DevBridge must never claim a stronger guarantee than the provider integration can establish. If the provider offers no reliable way to establish the required receipt, that integration cannot silently bypass the context-before-continuation invariant; the limitation must be disclosed and the transition must remain incomplete unless a supported recovery path establishes the requirement.

## 7. Context-before-continuation invariant

**A project context transition is not complete until the intended project is confirmed and its required context has been successfully delivered and acknowledged.**

If either condition fails:

- the transition remains incomplete;
- the incoming project is not marked active;
- DevBridge does not authorise project continuation under the unconfirmed context;
- the failure and uncertainty are shown clearly;
- DevBridge suggests a remedy based on the actual failure.

Possible remedies include retrying delivery, reconnecting or repairing the provider integration, or starting a new provider conversation and delivering the handover there.

A new chat is a recovery option, not an automatic assumption that delivery will succeed.

**Agreed recovery decision — no automatic retry of an uncertain delivery:** if DevBridge cannot establish whether a provider accepted a delivery, it must preserve the outcome as **Unknown** and must not automatically resend that delivery. An unknown outcome is not evidence of failure.

Recovery must first seek evidence from the provider where a documented status/reconciliation capability exists. A retry of the same logical delivery is permissible only where the provider contract establishes safe idempotency using the same persistent delivery identifier, or reconciliation establishes that the earlier delivery was not accepted. Otherwise, DevBridge must preserve the unresolved attempt and use a separately authorised recovery path, such as a fresh provider session with a newly prepared handover. The original unknown attempt remains in history and is never rewritten as failed or successful without evidence.

A process restart must not interpret an unresolved delivery intent as permission to send again. It must reconstruct the pending/unknown state and require reconciliation or an explicit safe recovery decision.

The outgoing project's checkpoint remains preserved throughout the failure.

This is a DevBridge control over its own mediated workflow. It cannot guarantee that an external provider or user will never send or receive messages independently of DevBridge. Such activity must not be represented as a confirmed DevBridge project continuation.

## 8. Stale-context detection and refresh

A project may change while one or more sessions are active.

When a new project contribution is recorded, DevBridge can identify other activations whose supplied handover predates that contribution. Those activations are marked **potentially stale**.

Stale-context handling is deferred rather than interrupting active work immediately:

1. Record the new contribution and its project/session provenance.
2. Mark other active project activations as potentially stale when their handover state is older.
3. Do not interrupt an ongoing interaction solely because another session changed the project.
4. At the next interaction in a stale activation, disclose that its context is outdated and pause normal project continuation.
5. Prepare a fresh handover from the latest recorded project state.
6. Deliver and obtain the required acknowledgement.
7. Resume only after the refresh is confirmed.

A session returning to a project after switching away is always a new activation and always receives a fresh handover, whether or not DevBridge has separately marked the previous activation stale.

A stale marker is a statement about version age, not a judgement that the session's work is wrong.

## 9. Concurrent sessions and race-condition records

Multiple AI sessions may work on the same project at the same time. DevBridge must not assume that one session is the successor or authority over another.

When overlapping activity is observed, DevBridge records the relevant facts, including where available:

- project ID;
- session and activation IDs;
- contribution IDs;
- timestamps and ordering information;
- handover/context version used by each activation;
- whether a contribution was made against a handover already known to be stale;
- the observed overlap or concurrency marker.

### Flag only — no conflict judgement

DevBridge flags concurrency and stale-context conditions only.

It does not:
- decide that two contributions are incompatible;
- infer a semantic conflict;
- rank contributions;
- choose a winning session;
- discard or suppress either contribution;
- resolve disagreements;
- decide which proposal should be implemented.

Concurrency is not itself proof of conflict. A stale-context marker is not proof that a contribution is incorrect.

If the user or an AI identifies a disagreement or resolves it, that information may be recorded as a new attributed contribution and linked to the relevant history. DevBridge does not manufacture that conclusion.

### Preserve every contribution

Contributions from concurrent sessions remain separately attributed and historically available. A later handover may include both. Refreshing a session must not overwrite, merge away or silently discard another session's contributions.

## 10. Failure and recovery behaviour

The transition must fail closed with respect to DevBridge-authorised project continuation.

Examples:

| Failure | Required behaviour |
|---|---|
| Target project identity is ambiguous or not confirmed | Do not prepare activation as complete; ask the user to identify/confirm the intended project. |
| Handover cannot be prepared | Keep transition incomplete; report the preparation failure and preserve the outgoing checkpoint. |
| Provider delivery attempt definitively fails before acceptance | Keep transition incomplete; preserve the failed attempt and offer a supported recovery remedy. |
| Provider acknowledgement is absent or unknown | Do not claim receipt or activate the project; preserve the outcome as Unknown. Never automatically resend it. Reconcile with provider evidence where supported; otherwise use a separately authorised safe recovery path, potentially a fresh provider session. |
| Provider confirms only payload acceptance | Record that exact level; do not claim model comprehension. Apply the adapter's declared activation rule. |
| Fresh handover is required because context is stale | Pause project continuation until refreshed delivery is acknowledged. |

Recovery must be explicit and traceable. Retrying delivery creates or updates delivery-attempt history; it must not rewrite the original project contributions or outgoing checkpoint.

## 11. Conceptual lifecycle states

These are conceptual states for design discussion, not final enum values.

### Session state

- **Unbound:** no active project context has been established.
- **Active:** one project activation is confirmed.
- **Transition pending:** a project switch is in progress.
- **Refresh required:** the active project's supplied context is stale and must be refreshed before continuation.
- **Blocked:** a required confirmation or delivery condition failed or remains unknown.
- **Ended:** the DevBridge session has ended; project history remains.

### Project activation state

- **Requested**
- **Project confirmed**
- **Handover prepared**
- **Delivery attempted**
- **Delivery acknowledged**
- **Active**
- **Potentially stale**
- **Checkpointed**
- **Blocked**
- **Ended**

The implementation may refine these states, but it must preserve the distinctions and invariants in this document.

## 12. Conceptual records to support the lifecycle

No physical schema is prescribed here. The domain model will likely need concepts equivalent to:

- **Session:** DevBridge interaction identity and provider references.
- **Session context event / project activation:** append-only record of project activation, switch, return, checkpoint and lifecycle transitions.
- **Handover snapshot:** identity/version of the prepared project context and its included record set.
- **Context delivery attempt:** provider adapter, capability/acknowledgement level, attempt time and outcome.
- **Contribution:** direct project and session attribution, including the activation/context version.
- **Concurrency/staleness marker:** observed overlap or stale handover relationship, without a semantic conflict judgement.
- **Cross-project reference:** explicit reference that does not itself activate or load another project's context.

A single immutable `session.project_id` is insufficient to represent a session that can switch A → B → A. A chronological activation/context-event relationship is the conceptual direction. The exact relational model, constraints and transaction boundaries remain to be designed and tested.

## 13. Relationship to existing documents

This design elaborates the session-continuity and handover requirements in [V1 Product Scope](V1_SCOPE.md) and uses the existing [Handover Contract](HANDOVER_CONTRACT.md).

The earlier proposed [Domain Model](DOMAIN_MODEL.md) describes a Session as belonging to a Project. That relationship is too restrictive for the agreed A → B → A behaviour. The domain model must later be reconciled so that a session has a sequence of project activations and each contribution is directly attributed to its project.

The older [Foundation](FOUNDATION.md) includes execution, approval and project-management concepts that are outside the currently agreed v1 scope. This session design does not reinstate those excluded capabilities.

This document does not modify existing domain or implementation files.

## 14. Open implementation questions

The following require provider and storage evidence before implementation:

1. Which provider interface can reliably support the required context delivery and acknowledgement?
2. What exact provider response qualifies as acknowledgement for each adapter?
3. Can the adapter distinguish payload acceptance from context availability to the model?
4. How should a handover be versioned against a consistent project record snapshot while concurrent contributions arrive?
5. What transaction boundaries ensure that activation, delivery state and contribution attribution cannot become inconsistent?
6. How should provider status reconciliation and explicitly safe, idempotent recovery be implemented for interrupted delivery attempts?
7. How should stale activations be discovered efficiently across devices and sessions?
8. What ordering guarantees are available when timestamps are equal, delayed or supplied by different devices?

These questions do not weaken the agreed invariants. If a provider or implementation cannot meet them, the limitation must be explicit rather than silently relaxing the design.

## 15. Acceptance scenarios

The session lifecycle design is satisfied when tests can demonstrate:

1. A session activates Project A only after project confirmation and fresh context delivery acknowledgement.
2. A switch A → B checkpoints A, confirms B, delivers B's fresh handover and activates B only after acknowledgement.
3. A return B → A generates and delivers a new A handover rather than reusing the earlier one.
4. Failed or unknown delivery leaves the transition incomplete and prevents DevBridge-authorised continuation under the target project.
5. The outgoing checkpoint and all historical contributions survive a failed transition.
6. Contributions are attributed to the project and activation active when they were accepted.
7. A contribution recorded by Session 2 marks an older active Session 1 activation as potentially stale without interrupting ongoing work.
8. Session 1 must refresh and receive acknowledgement before its next project continuation.
9. Concurrent contributions are both retained and their provenance/context versions are recorded.
10. DevBridge flags concurrency and stale context but does not classify semantic conflicts or choose a winner.
11. An explicit cross-project reference does not activate that project or silently transfer context.
12. A session can end without affecting the persistent project identity or history.

---

**Design status:** Agreed architectural direction, including the no-automatic-retry rule for uncertain delivery; provider mechanics, physical schema and implementation remain open. Trusted confirmation is an agreed requirement; its concrete authentication/session-binding mechanism must be designed and tested before real integration.  
**Core guarantee:** A project conversation may persist across switches, but project context is never assumed. It is confirmed, freshly delivered and acknowledged before DevBridge authorises continuation.
