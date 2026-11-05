# DevBridge v1 — Product Scope

**Status:** Agreed product scope for the first build  
**Repository:** `pierreduplessis6912-gif/devbridge`  
**Branch:** `build/v1-scope`  
**Purpose:** Establish the smallest useful product that proves reliable project continuity across disposable AI conversations.

---

## 1. Product definition

DevBridge is a bridge between people, their projects and the AI instances they use to work on those projects.

It preserves meaningful project context as people move between disposable conversations, AI providers, devices and development environments.

**Core promise:** You can outgrow your AI instance without outgrowing your project.

The user does not need to be a software developer. They may direct a project through ordinary conversation, make decisions, challenge AI recommendations and change direction. DevBridge must preserve that journey without taking ownership of it.

### Product principles

- **Facilitate, don't dictate.**
- **Observe, don't interfere.**
- **Preserve, don't own.**
- The project is persistent; AI conversations are disposable.
- The user directs the project. AI instances assist the user. DevBridge preserves continuity.
- DevBridge is the bridge, not the destination.

---

## 2. Responsibility boundary

DevBridge is a continuity and context-preservation service. It is not a technical authority or project manager.

DevBridge does not:
- Decide whether an architectural recommendation is correct.
- Judge, rank or arbitrate competing AI opinions.
- Correct the user or an AI instance.
- Decide which proposal should be implemented.
- Run tests, validate code quality or repair project problems.
- Execute commands, apply code changes or deploy projects.
- Prescribe a development workflow or project file structure.
- Replace Git, an IDE, an AI provider or the user's chosen development environment.
- Host or take ownership of the user's actual project files.

The user and the AI instance they are speaking with decide what to do. DevBridge preserves the information and history they create.

If a test result or project change is made available through an authorised source, DevBridge may preserve the supplied or observed information and its origin. It does not independently validate the result.

---

## 3. Information DevBridge preserves

DevBridge does not archive complete conversations. It preserves meaningful, structured project information in predefined categories.

### Two primary contribution streams

**User contributions**
- Requirements, intentions and instructions.
- Decisions and changes of direction.
- Acceptance, rejection or challenge of AI recommendations.
- Agreements, commitments and corrections.
- Questions and unresolved concerns.

**AI contributions**
- Recommendations and reasoning.
- Proposals and alternatives.
- Investigations and findings.
- Reported work and progress.
- Disagreements with earlier contributions.
- Handover information.

Where the user authorises access, DevBridge may also quietly observe relevant project-environment activity. This is an additional source of recorded information, not a third decision-maker.

### Structured record categories

The initial record categories include:
- Requirements and intentions.
- Decisions.
- Agreements and contracts.
- Commitments.
- Statuses.
- AI and user contributions.
- Proposals and disagreements.
- Changes and historical events.
- References to files, repositories, workspaces and other sources.

The categories are predefined; their content must remain flexible across project types.

### Provenance and history

Each meaningful record should retain, where available:
- The project it belongs to.
- Its originating user, AI provider, AI session or connected source.
- When it was recorded.
- The relevant source or reference.
- Its relationship to earlier or later records.

A change creates a new historical record. Earlier records are not silently overwritten.

Status is descriptive. DevBridge does not assign technical validity, decide that a proposal is correct, or infer that a commitment was completed merely because it was discussed.

AI and user contributions may agree, disagree or contradict each other. DevBridge preserves the contributions without manufacturing consensus.

---

## 4. Project identity, account and storage

### Account

A user can sign in from different devices and recover their DevBridge identity and project catalogue. The exact authentication mechanism remains an implementation decision; it must be simple and must not tie the account to one AI provider.

### Projects

- One account can contain multiple independent projects.
- A new project is created only when the user explicitly asks for one.
- DevBridge provisions the new project identity and initial continuity space.
- A project can exist before any repository or Git remote is attached.
- Project identity is independent of device, path, repository and AI provider.
- Projects remain visible in the catalogue when their files or connected sources are temporarily unavailable.

### Project files and continuity records

The user's actual project files remain in the storage location they choose. DevBridge is not a project-file hosting service.

DevBridge maintains the structured continuity records and project catalogue locally and synchronises the continuity information needed to access projects across devices.

The storage and synchronisation implementation must preserve user ownership, portability and recovery. It must not make project continuity usable only while the user remains dependent on a proprietary file store.

Git is optional. It is a useful source of project history and recovery where the user chooses to use it, but DevBridge must also accommodate projects that have not adopted Git.

---

## 5. Project continuity and AI sessions

### Reliable project continuity

Project continuity is persistent and shared. It must not depend on recognising a particular AI conversation.

The project continuity model includes:
1. **Project kernel:** minimal identity, purpose and essential project context.
2. **Current project state:** the latest accumulated recorded context, including meaningful user and AI contributions, decisions, agreements and statuses.
3. **Historical records:** prior contributions and changes, retained for reference and accountability.
4. **References:** pointers to relevant project files, repositories, workspaces and external sources.

### Opportunistic session continuity

Session continuity is optional and opportunistic.

If a provider exposes a reliable conversation identifier, DevBridge may associate activity with it. If it does not, an incoming conversation is treated as a new session.

DevBridge must never depend on identifying a returning chat to preserve project continuity.

A returning or new AI instance receives the current project context. It may be offered a refresher or references to deeper history, but the user decides how much additional context they want to explore.

### Context assembly

DevBridge assembles a compact, provider-independent representation of project continuity. Provider-specific adapters present or deliver it using the supported capabilities of each provider.

The underlying project record is not limited by an individual AI model's context window. Context capacity affects delivery and presentation, not what DevBridge retains.

The handover is an entry point, not a restriction. The incoming AI and user remain free to investigate the project further.

---

## 6. AI provider integrations

The continuity model is provider-independent. Integrations are provider-specific.

- The first release supports one provider integration.
- The architecture must allow additional providers without changing the core project record model.
- Each adapter declares the capabilities it actually supports.
- Capabilities and permissions must not be assumed to be identical across providers or models.
- Use documented, authorised provider interfaces.
- Do not circumvent subscription limits or automate unsupported private consumer-chat interfaces.
- Provider credentials are kept separate from ordinary project continuity records.

The first provider is to be selected after checking the supported integration path and the user's intended way of connecting AI conversations.

---

## 7. Conversational connection and discovery

The connection experience should remain conversational.

When an AI connects:
- DevBridge surfaces the user's known projects and their availability.
- The AI guides the user through the available choices.
- The user decides whether to continue an existing project, explore it, select another area or start something new.
- DevBridge does not force an administrative wizard or prescribed workflow.

When the user explicitly requests a new project, the AI can guide the conversation and DevBridge provisions the new project identity.

When the user returns to an existing project, DevBridge restores its latest recorded state. The AI can offer a refresher, but the user controls whether to receive one or explore deeper history.

---

## 8. User control, access and privacy

- The user controls every connected information source.
- Access is never inherited merely because an AI instance has access.
- DevBridge only observes sources and activity the user has authorised and the integration can actually expose.
- Disconnecting a source stops future access.
- Disconnecting a source does not automatically erase continuity records already preserved from it.
- Credentials and secrets must not be captured as ordinary project records.
- The user must be able to inspect and export their continuity information.
- The system must be honest about the last recorded update and gaps in available information.

DevBridge preserves successfully received information. It cannot guarantee recovery of private conversation content or project activity that was never made available to it.

---

## 9. Explicit v1 scope

### Included

1. User account and sign-in.
2. Multiple project identities per account.
3. Project catalogue and project availability.
4. Explicit user-initiated project creation.
5. Structured user and AI contribution records.
6. Decisions, agreements, commitments, requirements, statuses and disagreements.
7. Append-only historical changes with source attribution.
8. Project kernel and current-state context assembly.
9. Compact handover generation.
10. Opportunistic session identification when reliable provider identifiers are available.
11. One initial AI provider adapter.
12. Provider-specific capability declaration.
13. A conversational connection and project-selection experience.
14. Local continuity storage and cross-device synchronisation of continuity records.
15. User-controlled source connections and basic export/recovery.

### Explicitly out of scope for v1

- Technical architecture judgement or arbitration.
- AI project management or prescribed workflows.
- Code execution, shell access or automatic file modification.
- Running tests, code validation or fixing defects.
- Deployment and hosting of project applications.
- Hosting the user's actual project files.
- Complete conversation transcript archiving.
- Mandatory Git adoption.
- Multiple simultaneous provider integrations.
- Multi-user collaboration and team permissions.
- Billing, subscriptions and commercial monetisation.
- Automatic cross-project intelligence and broad historical recovery.
- General-purpose IDE functionality.

---

## 10. First build sequence

Build in small, independently understandable steps. Do not select infrastructure or add dependencies until the relevant requirement has been established.

### Milestone 1 — Product and data foundation
- Finalise the minimal domain model around Account, Project, Contribution, Record, Historical Event, Provider, Session and Source.
- Define record provenance and relationships.
- Define project identity independently of storage and device.
- Define what constitutes a current project snapshot.

### Milestone 2 — Local continuity core
- Create and reopen projects.
- Store structured records persistently.
- Preserve user and AI contributions.
- Append historical changes without overwriting earlier records.
- Generate a project kernel and current-state handover.

### Milestone 3 — Account and synchronisation
- Add portable user sign-in.
- Synchronise project catalogue and continuity records across devices.
- Preserve user control and exportability.
- Handle offline and conflicting updates without silently deleting or overwriting historical records.

### Milestone 4 — Provider connection
- Define the provider adapter contract.
- Implement one supported provider integration.
- Deliver project context to an incoming AI instance.
- Receive structured contribution reports.
- Use provider conversation identifiers opportunistically when available.

### Milestone 5 — Conversational project experience
- Surface known projects and their availability.
- Guide project selection through the connected AI.
- Support explicit new-project creation.
- Support return to an existing project and user-controlled refreshers.

### Milestone 6 — First end-to-end demonstration
Demonstrate:
1. A user explicitly creates a project.
2. An AI conversation contributes meaningful project information.
3. DevBridge preserves the user and AI contributions separately.
4. The conversation ends or is replaced.
5. A fresh AI conversation connects and receives the current project context.
6. The fresh AI can continue without reconstructing the project from the original transcript.
7. A previous conversation can return, if the provider exposes a reliable identifier, but project continuity does not depend on that recognition.
8. The user can access the same continuity from another device.

---

## 11. v1 acceptance criteria

The first release is useful when all of the following can be demonstrated:

- A user can explicitly create and identify multiple independent projects.
- A project can exist without Git or a connected repository.
- Meaningful user and AI contributions can be preserved as distinct records.
- Contradictory contributions remain visible without DevBridge choosing a winner.
- A new record does not erase the historical record it changes.
- Project continuity survives application restarts and a change of AI conversation.
- An incoming AI can receive a compact, useful project handover.
- Returning-session recognition is opportunistic, not a prerequisite.
- The user controls whether a refresher or deeper history is explored.
- Project identity and continuity are accessible after signing in on another device, subject to synchronisation and connectivity.
- Unavailable files or sources do not cause the project identity to disappear.
- The user can inspect and export continuity records.
- The product does not run tests, judge architecture, execute project changes or claim access to information it has not received.

---

## 12. Decisions deliberately left open

The product scope is agreed; these implementation choices still require investigation and evidence:

- Local database and record format.
- Local-first synchronisation design and conflict handling.
- Authentication method.
- Initial provider and its supported integration mechanism.
- Provider-specific context delivery and contribution reporting.
- How authorised environment observation is implemented.
- How source references remain useful when files move or repositories change.
- Backup, export and recovery format.
- Android packaging and the eventual multi-device interface.

These must be resolved during implementation without expanding DevBridge's responsibility boundary.

---

## 13. Definition of success

DevBridge succeeds when a person can move between AI conversations, providers and devices while their project retains its identity, meaningful history and current recorded context.

**DevBridge is the bridge. The user and their AI do the building.**
