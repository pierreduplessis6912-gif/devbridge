# DevBridge — Domain Model

**Version:** 0.2  
**Status:** Proposed conceptual reference, aligned with agreed v1 scope  
**Stage:** Architecture and discovery  
**Primary scope authority:** [V1 Scope](V1_SCOPE.md)  
**Data-model detail:** [V1 Data Model](V1_DATA_MODEL.md)  
**Session lifecycle detail:** [Session Lifecycle Design](SESSION_LIFECYCLE_DESIGN.md)

---

## 1. Purpose and authority

This document describes the concepts and boundaries that make up DevBridge. It is a conceptual reference, not an implementation specification.

Where an older concept in this document conflicts with the agreed v1 scope, data model or session lifecycle design, those v1 documents take precedence.

DevBridge is a bridge for preserving and transferring development context. The user and the AI instances they choose do the building. DevBridge records and presents authorised, meaningful project context; it does not own the project or direct its technical work.

The guiding principles are:

> Facilitate, don't dictate. Observe, don't interfere. Preserve, don't own.

The product promise is:

> You can outgrow your AI instance without outgrowing your project.

The project must not derive its identity or continuity from a particular AI conversation, provider, model, device, filesystem path, repository or execution environment.

This document does not prescribe a database engine, schema, API, storage mechanism or provider implementation.

## 2. Core domain concepts

### 2.1 Project

A Project is the durable identity and continuity boundary for a development initiative.

It can exist before a repository, local workspace or AI session is connected. It remains meaningful when devices, workspaces, repositories or provider conversations are unavailable or replaced.

A Project provides the context boundary for:
- Its identity, user-provided name and purpose.
- Its recorded contributions, decisions, requirements and project history.
- Its explicit repository and workspace associations.
- Its sessions and project activations.
- Its current recorded state and generated handovers.

A Project does not mean DevBridge owns the project's files, code, infrastructure or external accounts.

### 2.2 Repository

A Repository identifies a source-control repository independently of any one Project or local checkout.

A repository may be associated with a Project, but Git is optional. A Project may exist and retain useful continuity without any repository.

Project-to-Repository association is explicit. A single repository may be associated with more than one Project only through separately established associations. Such an association does not automatically share:
- Project memory or continuity records.
- Project permissions or authorisations.
- Credentials or secrets.
- Decisions, contributions or evidence belonging to another Project.

An association may record project-specific context such as the repository's role or purpose for that Project.

DevBridge may retain repository identity and association metadata. It does not become the repository host or source of truth for repository contents.

### 2.3 Workspace and local project environment

A Workspace is a reference to a particular working environment or working copy associated with a Project and, where relevant, a Repository.

Examples may include:
- A local checkout.
- A working directory on a device.
- A separate worktree.
- A remote or hybrid working environment in a future integration.

A Workspace is not the Project and does not determine Project identity. Device identifiers, filesystem paths, branches and checkout locations are environment details that may change.

Project documents and continuity records must be conceptually independent of a Git checkout. The Project can exist before any Workspace or Repository is attached.

DevBridge is not the file-hosting provider for project files. Files remain in storage selected and controlled by the user; DevBridge may retain authorised references and recorded context about them.

### 2.4 Device, platform and execution environment

A Device is a place where a user may access DevBridge or work on a Project. A Platform describes the operating-system and device capabilities available there. An Execution Environment is where development tools or project operations may run.

These are environment concepts, not Project identity.

#### Platform independence

DevBridge is designed to support phone-based development, initially targeting Android devices generally. Its core domain must not depend on:
- A specific phone manufacturer or device model.
- Manufacturer-specific APIs.
- A particular screen size or hardware configuration.

The architecture should preserve the possibility of supporting other platforms without making them v1 requirements.

#### Termux as an initial adapter

Termux is the initial development and execution environment used to build and test DevBridge. It is an adapter and deployment choice, not the foundation of the domain model.

The core must not assume that every supported device has Termux, uses the same filesystem, or supports the same runtimes and native dependencies. Platform-specific capabilities belong behind appropriate adapters.

#### Capability-aware operation

An environment or integration should declare the capabilities it actually makes available. Depending on the environment, these may include:
- Available storage and memory.
- Supported runtimes and native dependencies.
- Git availability.
- Network connectivity.
- Background execution support.
- Available local or remote execution options.

The product should communicate capability and availability honestly. It must not assume that all devices or environments are equivalent, or imply that an unavailable capability exists.

The user interface, project context and execution environment are separate architectural responsibilities. Execution may initially happen locally through Termux; a future remote or hybrid environment should not change Project identity or ownership.

Execution and command-running are not DevBridge v1 product responsibilities. Environment capability concepts do not grant DevBridge authority to execute commands, modify files, run tests or deploy projects.

Project data should be portable and recoverable when a device is replaced, lost or unavailable. Local-first operation is the initial architectural direction; backup, restoration and future synchronisation must be considered. Local-only project files cannot be recovered by DevBridge unless an available user-controlled source or backup contains them.

### 2.5 Session

A DevBridge Session is a record of a period of interaction involving an AI provider, model or other supported participant. It is distinct from the provider's own conversation or chat identifier.

A Session:
- Records the provider and model when known.
- May record an external conversation identifier when the provider exposes one reliably.
- Has its own lifecycle and provenance.
- May include multiple ordered Project Activations over its lifetime.
- Preserves references to the context delivered and contributions recorded during it.

A Session is not the authoritative location for Project memory. Provider conversations may be recycled, inaccessible or lost without removing the Project's recorded continuity.

A returning provider conversation is not assumed to be the same DevBridge session unless a reliable supported identifier establishes that association. Otherwise, DevBridge treats it as a new or not-yet-associated session.

### 2.6 Project Activation

A Project Activation represents a period during a Session in which one Project is the confirmed primary context.

A Session may switch from Project A to Project B and later return to Project A. Each activation requires explicit confirmation of the intended Project and a fresh handover based on the latest recorded state.

An activation is not complete until the required context has been delivered and acknowledged at the strongest level the provider integration actually supports. If confirmation or delivery acknowledgement fails or is unknown, the transition remains incomplete and DevBridge must not authorise continuation under the unconfirmed Project context.

Outgoing checkpoints preserve the outgoing activation's recorded position. They do not close or lock the Project. Returning to a Project requires a fresh handover; an old handover is not reused as if it were current.

The detailed lifecycle, event types, delivery states and invariants are defined in [Session Lifecycle Design](SESSION_LIFECYCLE_DESIGN.md) and [V1 Data Model](V1_DATA_MODEL.md).

### 2.7 Provider, Model and Adapter

A Provider is an external AI service or supported integration. A Model identifies a model offered through a Provider. An Adapter is the provider-specific integration boundary through which DevBridge uses supported capabilities.

Provider and model identities are descriptive integration context; they do not own Project data.

Each adapter must declare its actual supported capabilities and the meaning of any acknowledgement it returns. Provider capabilities are not assumed to be equal. DevBridge must use documented and authorised interfaces and must not circumvent provider access restrictions or private-chat boundaries.

Credentials and secrets must be handled separately from Project continuity records and must never be stored in ordinary contributions, handovers or project descriptions.

### 2.8 Contribution and recorded project information

A Contribution is a meaningful piece of project information submitted by a user, an AI participant or an authorised observation source.

Examples include:
- A user-stated goal, requirement or constraint.
- An AI proposal or recommendation.
- A user challenge, acceptance or rejection.
- An explicit decision or unresolved question.
- A reported progress update or status.
- A documented disagreement or alternative proposal.
- An authorised observation about project activity.

Each record should preserve its provenance, including its origin, source reference where available, timestamp, Project and Session/Activation association where applicable.

Contributions are append-only historical records. Later changes or disagreements do not silently erase earlier contributions. Relationships such as supersedes, supports, contradicts or references may connect records without making DevBridge the judge of their correctness.

DevBridge does not ingest complete private conversation transcripts as a general capability. It records only meaningful information submitted through supported interfaces or observed through explicitly authorised sources.

### 2.9 Evidence, inference and unknowns

Recorded information should distinguish:
- **Observed:** directly seen or measured by an authorised source.
- **Documented:** explicitly stated in a referenced source.
- **User-provided:** supplied by the user.
- **AI-reported:** stated by an AI participant, without implying independent verification.
- **Inference:** a reasoned interpretation, attributed to its source.
- **Unknown:** not established by the available record.

These labels preserve provenance; they do not certify technical correctness. An AI-reported test result, for example, remains a report unless independently verified by an appropriate source.

A later contribution may supersede an earlier one, but the earlier record remains part of history. DevBridge does not silently convert an inference into an established fact or decide which competing claim is correct.

### 2.10 Decision

A Decision is an explicit choice recorded as having been made by the user or other clearly identified decision-maker.

A proposal or recommendation from an AI is not a user decision merely because it was recorded, repeated or implemented in a report. The record should preserve who made the choice, what was chosen, when it was recorded and the relevant supporting or superseded contributions.

DevBridge preserves the decision and its provenance; it does not decide on the user's behalf or arbitrate between competing technical recommendations.

### 2.11 Handover and current recorded state

A Handover is a bounded presentation of recorded Project context prepared for a Session or Project Activation.

It may contain:
- Project identity and user-provided purpose.
- A transparent index of current recorded information within the included history boundary.
- Relevant attributed contributions and their relationships.
- Relevant lifecycle or activity events.
- Explicit completeness and staleness information.

A handover is a derived view, not a replacement for append-only source records or a guarantee that all project activity has been captured. It must disclose when history is bounded or information may be missing.

Current-state indexes must be traceable to the records included in that handover. DevBridge must not infer that a task is complete, that a proposal is correct, or that an AI understood a delivered context merely because a handover was prepared or accepted by a provider.

### 2.12 Concurrency and staleness

Multiple Sessions may contribute to the same Project concurrently. Contributions remain separately attributed to their originating Session, Activation, source and context boundary.

When a newer contribution means another active Session may be working from an older handover, DevBridge may record a staleness marker and disclose the possibility of stale context at the next appropriate interaction.

DevBridge does not interrupt ongoing work to resolve a semantic disagreement, choose a winning contribution, rank AI providers or reconcile code changes. It preserves the contributions and flags relevant context freshness; the user and their chosen AI decide what to do.

### 2.13 Cross-Project Reference

A Cross-Project Reference records an explicit reference from one Project to another.

A reference does not activate the referenced Project, deliver its handover, or grant access to its memory, files, credentials or permissions. Access and context transfer require their own explicit supported actions.

## 3. Conceptual relationships

The principal v1 relationships are:

- A user account may catalogue multiple independent Projects.
- A Project may exist without a Repository or Workspace.
- A Project may have explicit associations with one or more Repositories and Workspaces.
- A Repository may have multiple working copies and may be explicitly associated with more than one Project.
- A Project has append-only Contributions, recorded relationships, events and derived Handovers.
- A Session may contain an ordered sequence of Project Activations.
- A Project Activation identifies one confirmed primary Project for a period within a Session.
- A Project Activation may reference the handover prepared and delivered for that activation, its delivery attempts and its outgoing checkpoint.
- A Contribution may be associated with a Project, Session and Activation where applicable; its provenance remains explicit.
- Multiple Sessions may contribute to the same Project concurrently.
- A Handover is derived from a bounded set of Project records and events.
- A Cross-Project Reference links Project identities without merging their continuity or permissions.
- Provider Adapters expose declared capabilities; Provider and Model identities do not own Project records.

Conceptually:

```text
Account
 └── Project catalogue
      ├── Project A
      │    ├── Repository associations
      │    ├── Workspace / environment references
      │    ├── Contributions and relationships
      │    ├── Decisions and recorded events
      │    ├── Handovers
      │    ├── Sessions
      │    │    └── Project Activations
      │    │         ├── Context delivery attempts
      │    │         └── Outgoing checkpoints
      │    └── Cross-Project References
      └── Project B

Provider Adapter
 ├── Provider
 ├── Model
 └── Declared capabilities
```

This diagram is conceptual. It does not prescribe physical tables, ownership implementation or transaction boundaries.

## 4. Important domain boundaries

### Project versus Repository versus Workspace

Project identity and continuity are independent of Git, a checkout, a device and a path. A repository identifies source-control history; a workspace identifies a working environment. Neither becomes the Project.

### Project continuity versus conversation history

Project continuity is the durable record of meaningful, attributed information. Provider conversation history may be useful but is neither guaranteed to be accessible nor authoritative.

### Session versus Project Activation

A Session is a period of provider interaction. A Project Activation is a confirmed period of primary Project context within that Session. One Session may contain multiple activations, including returning to a previously active Project.

### Contribution versus decision

A proposal, report, inference, disagreement and user decision are distinct kinds of recorded information. Recording a proposal does not make it accepted; recording a reported action does not verify its outcome.

### Handover versus archive

A Handover is a bounded context view. It is not a complete archive, backup or restore mechanism. Its limits and recorded-context-only status must remain visible.

### Provider capability versus product guarantee

An adapter may expose only the capabilities supported by its provider and interface. DevBridge must not claim reliable session identity, context delivery acknowledgement, observation or background operation where the integration cannot establish it.

### Facilitation versus control

DevBridge preserves and transfers context. It does not decide architecture, arbitrate AI disagreements, manage tasks, prescribe project workflows, execute commands, modify code, run tests, repair code or deploy projects.

## 5. V1 scope boundary

The [V1 Scope](V1_SCOPE.md) is authoritative for what the first release includes and excludes.

The v1 domain focuses on:
- Account identity and a catalogue of multiple independent Projects.
- Explicit user-initiated Project creation.
- Project identity independent of repository, device, path and provider.
- Optional, explicit Repository and Workspace references.
- Structured, attributed Contributions and append-only history.
- Project kernel, current recorded state and bounded Handovers.
- Sessions and ordered Project Activations with confirmation and delivery lifecycle.
- One initial AI Provider Adapter, with honest capability declarations.
- User-controlled source connections and authorised observations.
- Basic cross-device continuity synchronisation and export/recovery planning.
- Conversational Project selection and discovery.

The following are not v1 domain responsibilities or implementation commitments:
- Durable Task management or project-management workflows.
- Change Set generation, code review or automatic file modification.
- Approval and authorisation workflows for code execution.
- Shell or command execution, test running, code fixing or deployment.
- Hosting or ownership of project files.
- Complete conversation archiving.
- Mandatory Git or a mandatory local Workspace.
- Multiple simultaneous provider integrations.
- Multi-user collaboration and team permissions.
- Billing and monetisation.

Some of these may be considered as separate future extensions. Their appearance in an older conceptual model must not be interpreted as approval to include them in v1.

## 6. Security, privacy and integrity boundaries

1. Project identity and continuity must not be owned by a Provider, Model, Session, Device, Repository or Workspace.
2. Project records and handovers must not contain provider credentials or secrets.
3. Source connections and observations require explicit user authorisation and supported interfaces.
4. A reference to another Project does not grant access to it.
5. Repository association does not automatically share memory, permissions, credentials or decisions.
6. Contributions and their provenance must remain attributable and historically preserved.
7. Derived Handovers must disclose their history boundary and must not replace source records.
8. Provider capability and acknowledgement claims must match what the adapter can actually establish.
9. Unavailable sources or devices must not erase Project identity or recorded continuity.
10. DevBridge must not imply it can recover local files that were never synchronised or backed up.
11. DevBridge v1 does not execute project commands or modify project files; any future execution capability would require a separately approved product and security design.

## 7. Open architectural questions

The following remain open unless resolved in the authoritative v1 design documents:
- Account and cross-device synchronisation mechanism.
- Durable storage and recovery guarantees.
- The exact supported provider and its documented integration capabilities.
- How authorised environment observations are obtained and represented.
- How repository and workspace references are discovered, refreshed and marked unavailable.
- How bounded handovers are sized and how older history is retrieved on demand.
- How offline changes and synchronisation conflicts are represented without losing provenance.
- Which Project catalogue and cross-Project discovery operations are appropriate for v1.

These questions must not be answered by silently expanding DevBridge into a project manager or execution platform.

## 8. Status and change control

This is a proposed conceptual reference aligned with the agreed v1 direction. It is not, by itself, an approved implementation specification.

Changes should:
- Identify the reason for the change.
- Identify affected concepts and relationships.
- Preserve provenance and the distinction between evidence, inference, report and decision.
- Be reviewed against [V1 Scope](V1_SCOPE.md), [V1 Data Model](V1_DATA_MODEL.md) and [Session Lifecycle Design](SESSION_LIFECYCLE_DESIGN.md).
- Be explicitly accepted before becoming an implementation constraint.

No database schema, storage engine, API contract or execution mechanism is implied by this document.
