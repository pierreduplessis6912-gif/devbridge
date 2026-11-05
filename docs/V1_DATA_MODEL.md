# DevBridge v1 — Data Model

**Status:** Revised conceptual model aligned with v1 scope and session lifecycle design v0.1  
**Parent:** [V1 Product Scope](V1_SCOPE.md)  
**Related design:** [Session Lifecycle Design](SESSION_LIFECYCLE_DESIGN.md)  
**Handover contract:** [Handover Contract](HANDOVER_CONTRACT.md)

This document defines the minimum information model required to preserve project continuity. It is deliberately independent of a database engine and provider API. It describes conceptual entities and relationships; it does not prescribe a physical schema or migration.

## 1. Model boundaries

The v1 model represents:
- A user's DevBridge account.
- Independent project identities.
- Meaningful user and AI contributions.
- Structured project records and their history.
- DevBridge-tracked sessions and their ordered project activations.
- Project handover snapshots and provider context-delivery history.
- Provider integrations and their declared capabilities.
- User-authorised connected information sources.
- References to externally stored project files and repositories.
- Explicit cross-project references that do not merge project context.

The model does **not** introduce task management, execution, approvals, testing, deployment, code review or technical arbitration.

A DevBridge Session is a continuity record, not a provider conversation. A session may move between projects while the underlying provider conversation continues. The project association therefore belongs to each Project Activation, not as one permanent project field on the Session.

## 2. Core entities

### Account

Represents the user's DevBridge identity.

Minimum information:
- Stable account identifier.
- Sign-in identity reference (not a provider conversation identity).
- Created and updated timestamps.
- Account-level preferences.

Authentication secrets are handled by the authentication mechanism and are not stored in project records.

### Project

Represents a persistent development initiative.

Minimum information:
- Stable project identifier.
- Account identifier.
- User-visible name.
- User-provided purpose or description.
- Created timestamp.
- Updated timestamp.
- Optional archive marker.

A project is created only after explicit user intent. It can exist without a repository, workspace or connected AI provider. Its identity and continuity remain independent of devices, paths, repositories and provider conversations.

### Project Record

A Project Record is one meaningful piece of structured project information.

Initial record categories:
- `requirement`
- `decision`
- `agreement`
- `commitment`
- `status`
- `user_contribution`
- `ai_contribution`
- `proposal`
- `disagreement`
- `change`
- `reference`

Minimum information:
- Stable record identifier.
- Project identifier.
- Record category.
- Content.
- Origin type: user, AI provider/session, or authorised connected source.
- Origin identifier/reference where available.
- Recorded timestamp.
- Optional status text supplied by the originating participant.
- Optional relationships to earlier or related records.
- Optional external references.
- Optional DevBridge session and Project Activation attribution, when the contribution arose within a tracked session.
- Optional provider/model and supplied handover reference/version, where applicable.

Record categories are predefined. Record content and status text remain flexible. DevBridge does not impose technical meaning or validity on a status label.

A record must preserve who or what supplied it. A user statement must not be silently rewritten as an AI conclusion, and an AI proposal must not silently become a user decision.

Contributions made outside a tracked AI session remain valid project records; session and activation attribution must therefore not be universally mandatory.

### Historical Event

Represents a new occurrence that changes or adds to the recorded project context.

Minimum information:
- Stable event identifier.
- Project identifier.
- Event type.
- Timestamp.
- Origin.
- Related record identifier(s).
- Optional prior event or record reference.
- Optional session and Project Activation attribution.

Historical events are append-only. A later change may supersede, correct, contradict or add context to an earlier record, but must not silently erase the earlier record.

### Session

Represents a DevBridge-tracked interaction spanning one or more periods of work with an AI provider. It is not the provider's conversation itself.

Minimum information:
- Stable DevBridge session identifier.
- Provider identifier.
- Model identifier, if available.
- Optional provider conversation identifier.
- Created and last-seen timestamps.
- Lifecycle state and lifecycle events, where available.

A Session does not have one permanent Project identifier. Its project-specific work is represented by an ordered sequence of Project Activations. At most one activation is the session's active primary project context at a time.

The provider conversation identifier is optional and opportunistic. It must never be required for project continuity or used as the sole identity of a DevBridge session. A provider conversation may continue while the DevBridge session switches projects, subject to the project-confirmation and context-delivery rules below.

A session may become inactive or interrupted without closing its project or deleting its history. A later session can continue the same project without being treated as the same conversation.

### Project Activation

Represents one period during which a Session is authorised to work with one Project as its primary context.

A session that switches from Project A to Project B and later returns to Project A creates three distinct activations. It does not rewrite one session-level project field.

Minimum conceptual information:
- Stable activation identifier.
- DevBridge session identifier.
- Project identifier.
- Activation sequence within the session.
- Activation start and end timestamps, where known.
- Activation lifecycle state.
- Reference to the handover snapshot prepared for this activation.
- Context-delivery state and acknowledgement reference.
- Optional outgoing checkpoint reference.
- Optional stale-context marker and the project version/event boundary against which the activation's handover was prepared.

An activation is not considered active merely because a project was selected or a handover was prepared. Activation requires explicit confirmation of the intended project and successful context delivery acknowledged at the strongest level the provider adapter actually supports.

If project confirmation, delivery or required acknowledgement fails or remains unknown, the transition remains incomplete and the incoming project is not activated for DevBridge-authorised continuation.

Ending an activation does not end the project. Switching away from a project does not close it.

### Handover Snapshot

Represents a reproducible, derived view of project context prepared for a Project Activation or refresh.

Minimum conceptual information:
- Stable snapshot identifier.
- Project identifier.
- Snapshot format/version.
- Preparation timestamp.
- A consistent project-history boundary, such as an event sequence or explicit included-record set.
- References to the included project records, relationships and events.
- Completeness and omission information.
- Reference to the handover contract used.

A handover is derived from authoritative project records; it does not replace them. Its boundary must be reproducible so that concurrent contributions cannot produce an ambiguous mixture of project states. The precise boundary mechanism is a physical-schema and implementation decision.

A fresh handover is required for every project activation, including a return to a project activated earlier in the same session. An old handover must not be reused as if it represented the latest project state.

### Context Delivery Attempt

Represents an attempt to deliver a Handover Snapshot to the provider context for a Project Activation.

Minimum conceptual information:
- Stable delivery-attempt identifier.
- Session and Project Activation identifiers.
- Handover Snapshot identifier.
- Provider and adapter version.
- Declared capability used for delivery and acknowledgement.
- Attempt timestamp.
- Delivery outcome.
- Acknowledgement outcome and exact acknowledgement level, if returned.
- Provider response/reference where safely available.
- Failure or unknown reason, where applicable.

The model distinguishes:
1. Handover prepared.
2. Delivery attempted.
3. Provider accepted or acknowledged delivery.
4. Activation confirmed.
5. Delivery failed or outcome unknown.

These are not interchangeable states. Provider acceptance is not proof that a model understood, retained or correctly used the context. The adapter must declare what its acknowledgement means. If a provider offers no reliable supported acknowledgement, DevBridge must not pretend that delivery was confirmed or bypass the activation invariant.

### Provider Integration

Represents a supported AI provider adapter.

Minimum information:
- Stable provider identifier.
- Provider name.
- Adapter version.
- Declared supported capabilities.
- Connection state.
- Provider-specific configuration reference.

Capabilities must be declared by each adapter. The core must not assume all providers expose the same features. Delivery and acknowledgement records must refer to the capability actually used, rather than implying unsupported provider behaviour.

### Connected Source

Represents an information source the user has explicitly authorised DevBridge to access.

Examples include a local project location, repository host or supported provider connection.

Minimum information:
- Stable source identifier.
- Project and account association.
- Source type.
- User authorisation/connection state.
- External source reference.
- Last successful access or observation time, where available.

Disconnecting a source stops future access. It does not automatically delete records already preserved from that source.

### Project Location Reference

Represents where the user's actual project material can be found. It is a reference, not a DevBridge-hosted copy.

Examples:
- Local folder reference.
- Git repository remote.
- Cloud storage location.
- Other user-selected workspace.

A project may have zero or more location references. The project identity remains independent of them. An unavailable location must not make the project disappear.

### Cross-Project Reference

Represents an explicit reference from one project to another project or to a record in another project.

Minimum conceptual information:
- Stable reference identifier.
- Source project identifier.
- Target project identifier and optional target record identifier.
- Origin and timestamp.
- User authorisation or confirmation reference, where required.
- Optional descriptive context.

Cross-project references are distinct from ordinary within-project record relationships. They do not merge project histories, activate the target project, load its handover, or transfer its permissions. Referencing another project must not silently expose that project's private continuity context.

## 3. Relationships

Conceptually:

```text
Account
  └── Projects
       ├── Project Records
       │    └── Historical Events
       ├── Project Activations
       │    ├── Session
       │    ├── Handover Snapshots
       │    └── Context Delivery Attempts
       ├── Connected Sources
       ├── Project Location References
       └── Cross-Project References

Session
  └── Ordered Project Activations
       └── Each activation has one primary Project context

Provider Integration
  └── Sessions and Context Delivery Attempts
```

- An Account has multiple Projects.
- A Project has multiple Project Records and Historical Events.
- A Project may be activated many times across one or more Sessions.
- A Session has an ordered sequence of Project Activations and at most one active primary activation at a time.
- A Project Activation belongs to exactly one Session and one Project.
- A Project Record or Historical Event may be attributed to a Session and Project Activation when it arose within that activation; attribution remains optional for contributions outside tracked sessions.
- A Project Activation uses a fresh Handover Snapshot for its project context.
- A Handover Snapshot identifies a consistent project-history boundary and the records included in that view.
- A Context Delivery Attempt belongs to an activation and refers to the snapshot it attempted to deliver.
- A Session and its delivery attempts identify the provider integration and adapter capabilities actually involved.
- A Project may have multiple Connected Sources and Project Location References.
- A Project Record may relate to earlier or other records within the same project without overwriting them.
- Cross-Project References are explicit and separate; they do not weaken same-project integrity rules for ordinary record relationships.
- Provider integrations are replaceable and do not own project records.

## 4. Session and project lifecycle invariants

The model must be capable of preserving these rules from [SESSION_LIFECYCLE_DESIGN.md](SESSION_LIFECYCLE_DESIGN.md):

1. A DevBridge Session is distinct from an external provider conversation.
2. A Session may switch projects without ending the provider conversation.
3. Each project activation, including a return to a previously active project, requires a fresh handover.
4. The intended project must be explicitly confirmed before its context is delivered for activation.
5. A project activation is not complete until the required context delivery is acknowledged at the strongest provider-supported level.
6. Failed or unknown delivery leaves the transition incomplete; the incoming project is not active for DevBridge-authorised continuation.
7. Outgoing project history and any checkpoint remain preserved if an incoming transition fails.
8. Contributions are attributable to their project and, when applicable, the session and activation under which they arose.
9. Concurrent sessions may contribute to the same project. Both contributions remain preserved with provenance.
10. A contribution made after another activation's handover boundary may mark that activation as potentially stale. This is a version/context fact, not a semantic judgement.
11. A stale activation is not silently refreshed in the middle of ongoing work. Before its next DevBridge-authorised continuation, the changed state is disclosed and a fresh handover is delivered and acknowledged.
12. DevBridge records concurrency and staleness; it does not decide which contribution is correct or which one should prevail.
13. Ending a Session or Project Activation does not end or erase the Project.

These invariants govern DevBridge-mediated project context and continuation. They do not claim that DevBridge can prevent a user or external provider from exchanging messages outside a supported DevBridge workflow.

## 5. Provenance without judgement

DevBridge preserves origin and references; it does not grade truth.

The model should make it possible to distinguish:
- A user statement or decision.
- An AI recommendation or report.
- An observation made available by an authorised connected source.
- A contribution made in a particular DevBridge Session and Project Activation.
- The provider/model and handover version supplied to that activation, where known.
- A reference to an external file, repository or conversation.

These distinctions describe where information came from and what context DevBridge recorded as supplied. They do not mean DevBridge has validated the information or that a provider model understood it.

DevBridge does not decide which contributor is correct, whether a decision is good, whether code works or whether a reported task is complete.

## 6. Current project state and handover

The current project snapshot and an AI handover are derived views assembled from Project Records and Historical Events. They are not replacements for the underlying records.

The initial handover contract is defined in [HANDOVER_CONTRACT.md](HANDOVER_CONTRACT.md). It separates three layers:

1. **Project kernel:** initially only stable project identity, name and user-provided purpose. Enduring principles remain empty unless the user explicitly marks them as such through a future supported action.
2. **Current recorded state:** a transparent index over included records, grouped by category, with explicit unresolved, reported-status and superseded-record references. It does not determine correctness, completion or which alternative should prevail.
3. **Historical record:** attributed records, directional relationships and historical events, with counts and disclosure when bounded output omits older material.

Every derived reference points back to a stored record. Relationship endpoints outside a bounded record set are identified as omitted rather than silently dropped. User and AI provenance remains attached to the underlying record.

A Handover Snapshot adds a reproducible boundary to this derived view. The precise implementation must ensure that records arriving concurrently with snapshot assembly are either consistently included or consistently outside that snapshot boundary.

The handover is an entry point. Deeper history can be retrieved when requested or needed; it is not all loaded into every new AI context.

## 7. Concurrency and stale context

Multiple Sessions may work on the same Project at the same time. This is permitted and does not imply that one session is the successor or owner of another.

When a project contribution is recorded after an activation's handover boundary:
- The affected activation may be marked potentially stale.
- The marker identifies the newer project-history boundary or contribution that caused the change.
- The currently ongoing interaction is not forcibly interrupted.
- Before the next DevBridge-authorised continuation under that activation, the user/AI is informed that its context may be stale.
- A fresh handover is prepared, delivered and acknowledged before continuation resumes.

Staleness is a statement about recorded versions, not a claim that an AI's reasoning is wrong or that it has failed to see an external conversation. DevBridge does not infer semantic conflicts, choose a winner or discard either contribution.

## 8. Record integrity and synchronisation

The initial storage implementation must support:
- Stable identifiers.
- Durable local persistence.
- Append-only historical records and lifecycle events.
- Source attribution, including optional session/activation attribution.
- Integrity of ordinary within-project record relationships.
- Explicitly separate cross-project references.
- Reproducible handover boundaries.
- Distinct handover preparation, delivery and acknowledgement history.
- Preservation of concurrent contributions without silently discarding or rewriting history.
- Export of user-owned continuity information.
- Recovery after an interrupted application session.

The exact database, physical schema, transaction boundaries, serialisation format, sync protocol and conflict handling are implementation decisions to validate separately. The conceptual model does not imply that these capabilities are already implemented.

## 9. Explicit exclusions

The v1 data model does not define:
- Task or project-management entities.
- Code change sets, execution jobs or command permissions.
- Test runs or quality scores.
- Architecture approval workflows.
- AI debate arbitration.
- Developer or team role hierarchies.
- A mandatory repository/workspace structure.
- A complete provider conversation transcript.
- Guaranteed access to private provider conversations or unsupported provider interfaces.
- Automatic project switching based on inferred intent.
- Semantic conflict detection or automatic resolution.

These concepts would expand DevBridge beyond its agreed continuity responsibility and are not required for the first product.

## 10. Open implementation questions

- Which local persistence mechanism is compatible with the actual Termux Node runtime?
- What record serialisation format is easiest to inspect, export and synchronise?
- Which account and sync service design gives cross-device continuity without turning DevBridge into project-file hosting?
- How should provider adapters submit structured records where native reporting interfaces differ?
- Which initial provider exposes sufficient supported capabilities for project-context delivery and acknowledgement?
- What exact acknowledgement levels can that provider reliably report?
- How should Project Activation, Handover Snapshot and Context Delivery Attempt be represented in the physical schema?
- What snapshot boundary and transaction strategy guarantee a consistent handover while other sessions contribute?
- How should stale-context markers be generated and cleared without semantic judgement?
- How should offline updates merge without deleting or rewriting history?
- How should cross-project references be authorised and exposed without loading unrelated project context?
