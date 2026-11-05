# DevBridge v1 — Data Model

**Status:** Initial implementation model for v1  
**Parent:** [V1 Product Scope](V1_SCOPE.md)

This document defines the minimum information model required to preserve project continuity. It is deliberately independent of a database engine and provider API.

## 1. Model boundaries

The v1 model represents:
- A user's DevBridge account.
- Independent project identities.
- Meaningful user and AI contributions.
- Structured project records and their history.
- Temporary AI sessions, with opportunistic provider conversation identification.
- Provider integrations and their declared capabilities.
- User-authorised connected information sources.
- References to externally stored project files and repositories.

The model does **not** introduce task management, execution, approvals, testing, deployment, code review or technical arbitration.

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

A project is created only after explicit user intent. It can exist without a repository, workspace or connected AI provider.

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

Record categories are predefined. Record content and status text remain flexible. DevBridge does not impose technical meaning or validity on a status label.

A record must preserve who or what supplied it. A user statement must not be silently rewritten as an AI conclusion, and an AI proposal must not silently become a user decision.

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

Historical events are append-only. A later change may supersede, correct, contradict or add context to an earlier record, but must not silently erase the earlier record.

### Session

Represents a DevBridge-tracked interaction with an AI provider. It is not the provider's conversation itself.

Minimum information:
- Stable DevBridge session identifier.
- Project identifier.
- Provider identifier.
- Model identifier, if available.
- Optional provider conversation identifier.
- Created and last-seen timestamps.
- Optional lifecycle information.

The provider conversation identifier is optional and opportunistic. It must never be required for project continuity or used as the sole identity of a DevBridge session.

A session may contribute records and then become inactive. A later session can continue the same project without being treated as the same conversation.

### Provider Integration

Represents a supported AI provider adapter.

Minimum information:
- Stable provider identifier.
- Provider name.
- Adapter version.
- Declared supported capabilities.
- Connection state.
- Provider-specific configuration reference.

Capabilities must be declared by each adapter. The core must not assume all providers expose the same features.

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

## 3. Relationships

Conceptually:

```text
Account
  └── Projects
       ├── Project Records
       │    └── Historical Events
       ├── Sessions
       │    └── Provider Integration
       ├── Connected Sources
       └── Project Location References
```

- An Account has multiple Projects.
- A Project has multiple Project Records and Historical Events.
- A Project may have multiple Sessions over time.
- A Session may be associated with a provider conversation identifier when reliably available.
- A Project may have multiple Connected Sources and Project Location References.
- A Project Record may relate to earlier or other records without overwriting them.
- Provider integrations are replaceable and do not own project records.

## 4. Provenance without judgement

DevBridge preserves origin and references; it does not grade truth.

The model should make it possible to distinguish:
- A user statement or decision.
- An AI recommendation or report.
- An observation made available by an authorised connected source.
- A reference to an external file, repository or conversation.

These distinctions describe where information came from. They do not mean DevBridge has validated it.

DevBridge does not decide which contributor is correct, whether a decision is good, whether code works or whether a reported task is complete.

## 5. Current project state and handover

The current project snapshot and an AI handover are derived views assembled from Project Records and Historical Events.

They are not replacements for the underlying records.

A context package should be able to include:
- Project identity and purpose.
- The current recorded project position.
- Relevant user contributions and decisions.
- Relevant AI contributions and proposals.
- Agreements, commitments and status information.
- Unresolved disagreements or questions.
- Recent changes.
- References to relevant sources.
- Last recorded update and known capture gaps.

The package should retain references to the records from which it was assembled. Historical material is retrieved when requested or needed; it is not all loaded into every new AI context.

## 6. Record integrity and synchronisation

The initial storage implementation must support:
- Stable identifiers.
- Durable local persistence.
- Append-only historical records.
- Source attribution.
- Export of user-owned continuity information.
- Synchronisation without silently discarding concurrent contributions.
- Recovery after an interrupted application session.

The exact database, serialisation format, sync protocol and conflict handling are implementation decisions to validate separately.

## 7. Explicit exclusions

The v1 data model does not define:
- Task or project-management entities.
- Code change sets, execution jobs or command permissions.
- Test runs or quality scores.
- Architecture approval workflows.
- AI debate arbitration.
- Developer or team role hierarchies.
- A mandatory repository/workspace structure.
- A complete provider conversation transcript.

These concepts would expand DevBridge beyond its agreed continuity responsibility and are not required for the first product.

## 8. Open implementation questions

- Which local persistence mechanism is compatible with the actual Termux Node runtime?
- What record serialisation format is easiest to inspect, export and synchronise?
- Which account and sync service design gives cross-device continuity without turning DevBridge into project-file hosting?
- How should provider adapters submit structured records where native reporting interfaces differ?
- How should the derived project snapshot be assembled while retaining source references?
- How should offline updates merge without deleting or rewriting history?
