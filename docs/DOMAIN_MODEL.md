# DevBridge — Domain Model

**Version:** 0.1  
**Status:** Proposed  
**Stage:** Architecture and discovery  
**Parent document:** [Product and Architecture Foundation](FOUNDATION.md)

---

## 1. Purpose

This document defines the conceptual domain model for DevBridge.

It identifies the durable objects, their responsibilities, relationships and important boundaries.

It is deliberately independent of any database engine, programming language, framework or AI provider.

The domain model must preserve the central DevBridge principle:

> The project is permanent. The AI is replaceable. The environment is persistent.

The model must not make project knowledge dependent on a particular AI conversation, provider or model.

---

## 2. Core domain objects

### 2.1 Project

A Project is the permanent container for a development initiative.

It owns or references the information required to continue work across sessions, providers and environments.

Responsibilities:
- Project identity and metadata.
- Repository associations.
- Workspace associations.
- Tasks and project activity.
- Evidence and decisions.
- Project-level configuration and memory.

A Project must remain meaningful even when every AI session has ended.

### 2.2 Repository

A Repository represents a source-control repository associated with a Project.

It identifies the Git repository and its remote identity.

Responsibilities:
- Repository identity.
- Remote URL and hosting information.
- Default branch and relevant source-control metadata.
- Association with local workspaces.

A repository is not the same thing as a workspace. One repository may have multiple working copies.

### 2.3 Workspace

A Workspace represents a working environment in which repository content is available for inspection or modification.

Examples:
- A local checkout.
- A separate working directory.
- A future Git worktree.
- A controlled execution environment.

Responsibilities:
- Identify the working location.
- Record the repository and checkout relationship.
- Record relevant branch and revision information.
- Establish the context in which changes and executions occur.

A workspace must not automatically imply permission to execute arbitrary commands.

### 2.4 Task

A Task is a durable unit of work within a Project.

It survives the end of any individual AI session.

Responsibilities:
- Describe the intended outcome.
- Record scope and constraints.
- Track status and progress.
- Link relevant evidence and decisions.
- Link sessions that contributed to the work.
- Record proposed changes and completed work.

A Task may be resumed by a different provider or model.

Task status and session status are separate concepts.

### 2.5 Session

A Session represents a temporary interaction with an AI provider.

It records the context in which an assistant participated in project work.

Responsibilities:
- Identify the provider and model used.
- Associate the interaction with a Project.
- Optionally associate it with a Task.
- Record session lifecycle and relevant outputs.
- Preserve references to work produced during the session.

A Session may be exploratory and therefore need not belong to a specific Task.

A Session is not the authoritative location for project memory.

### 2.6 Provider and Model

A Provider represents an external AI service or supported execution integration.

A Model identifies a particular model offered by a Provider.

These are integration concepts, not owners of project data.

Responsibilities:
- Identify supported providers and models.
- Describe integration capabilities.
- Support provider replacement.
- Keep provider-specific behaviour behind defined interfaces.

Credentials and secrets must be handled separately from project memory and must never be stored in ordinary evidence, task descriptions or execution logs.

### 2.7 Evidence

Evidence is a recorded observation or source-backed fact relevant to a Project or Task.

Examples:
- A file inspected at a particular revision.
- A test result.
- A command output.
- A repository state.
- A documented external requirement.
- A user-confirmed fact.

Evidence must preserve its provenance wherever possible.

Evidence classifications:
- **Observed:** directly inspected or measured.
- **Documented:** explicitly stated in an authoritative source.
- **Decision:** not an evidence classification; decisions are separate records.
- **Inference:** reasoned conclusion based on available evidence.
- **Unknown:** information not yet established.
- **Superseded:** information replaced by newer evidence or a decision.

Evidence must not silently turn an AI assumption into an established fact.

Sensitive credentials and secrets must not be captured in evidence.

### 2.8 Decision

A Decision is an explicit choice made or approved by the human project owner.

Responsibilities:
- Record what was decided.
- Record why it was decided.
- Identify supporting evidence.
- Record who or what proposed it.
- Record when it was accepted.
- Identify whether it remains active or has been superseded.

A proposal from an AI is not an accepted Decision until the required human approval has occurred.

### 2.9 Change Set

A Change Set is a proposed or completed collection of modifications.

It must identify:
- The Project and relevant Task.
- The Workspace in which it was prepared.
- The repository and base revision.
- The proposed changes.
- The originating Session, where applicable.
- Its review and approval status.

A Change Set must be reviewable before execution or application.

Approval must refer to the specific proposed change, not merely to a general statement of trust in an AI session.

### 2.10 Approval

An Approval is a human authorization event for a defined action.

It records:
- Who authorized the action.
- What exact action or Change Set was authorized.
- The scope of the authorization.
- When it was granted.
- Whether it was used, expired or revoked.

An approval must not silently expand to cover materially different changes or commands.

### 2.11 Execution

An Execution is a recorded operation performed within an authorized environment.

Examples:
- Running an approved test command.
- Applying an approved Change Set.
- Running a build.
- Performing a permitted repository operation.

Responsibilities:
- Record the requested operation.
- Identify the Workspace.
- Record the initiating Session or Task where applicable.
- Identify the applicable authorization.
- Record the outcome and relevant output.
- Preserve an auditable history.

Execution permissions must be enforced by the environment, not by relying on an AI model to follow instructions.

Secrets must be excluded or redacted from execution output.

---

## 3. Conceptual relationships

The initial conceptual relationships are:

- A Project can be associated with one or more Repositories.
- A Repository can have one or more Workspaces.
- A Project contains Tasks.
- A Project can have Sessions.
- A Session belongs to a Project and may optionally be associated with a Task.
- A Task can have multiple Sessions over its lifetime.
- Evidence can relate to a Project, Task, Session, Decision or Execution.
- Decisions belong to a Project and may relate to Tasks.
- Change Sets are associated with a Project and a relevant Workspace; they may also relate to a Task and originating Session.
- Approvals authorize specific actions or Change Sets.
- Executions occur within a Workspace and must reference the authorization applicable to the operation.

Conceptually:

```text
Project
 ├── Repositories
 │    └── Workspaces
 ├── Tasks
 │    └── Sessions
 ├── Sessions (including exploratory sessions)
 ├── Evidence
 ├── Decisions
 └── Activity
      ├── Change Sets
      ├── Approvals
      └── Executions


---

## 4. Important domain boundaries

### Project knowledge versus conversation history

Project knowledge must survive deletion, expiry or loss of a provider conversation.

Conversation history may be useful input, but it is not the authoritative project record.

### Repository versus Workspace

A repository identifies source-control history and remote identity.

A workspace identifies a particular working environment or checkout.

They must remain separate concepts.

### Task versus Session

A Task describes work that persists.

A Session describes a temporary AI interaction.

One Task may span multiple Sessions, and one Project may have exploratory Sessions without Tasks.

### Evidence versus Decision

Evidence describes what is known and how it is known.

A Decision records what the project owner chose to do.

An inference must not become a Decision without explicit acceptance.

### Proposal versus Approval versus Execution

A proposed change is not authorization.

Authorization is not execution.

Execution is not proof that the intended result was achieved.

These must remain separately traceable.

### AI identity versus project identity

Projects must not be owned by a provider, model or individual AI session.

Provider integrations must be replaceable without losing project history.

---

## 5. Initial MVP constraints

The conceptual model allows future expansion, but the first implementation remains deliberately small:

- One developer.
- One phone.
- One Project.
- One Repository.
- One Workspace.
- One supported AI integration initially.
- Durable Tasks and Sessions.
- Evidence and Decision records.
- Read-only repository inspection.
- Proposed changes and human approval.
- Controlled execution with audit history.

The model may support multiple repositories and workspaces conceptually, but the MVP does not need to implement them.

---

## 6. Security invariants

1. Project memory must never contain provider credentials or secrets.
2. AI instructions are not a security boundary.
3. Execution permissions must be enforced outside the model.
4. Every consequential execution must have an applicable authorization.
5. Authorization must be scoped to the action approved.
6. Change Sets must be reviewable before approval.
7. Execution history must distinguish success, failure and unknown outcomes.
8. Evidence and logs must not expose secrets.
9. Provider replacement must not require transferring ownership of project data.
10. Destructive operations must have explicit safeguards and recoverability.


---

## 7. Open architectural questions

These remain unresolved and must be investigated before implementation decisions are locked:

- What is the minimum durable project-memory structure?
- Should structured records, versioned Markdown or a combination be authoritative?
- How should evidence reference files, commits, command output and external documents?
- How should project memory be summarized into provider-specific session context?
- How should concurrent sessions avoid conflicting changes?
- What is the exact boundary between a Workspace and an execution environment?
- How should approvals be bound to exact commands, patches and revisions?
- What recovery and backup guarantees are required?
- Which provider interfaces can be supported through documented APIs and agent harnesses?
- How should local and remote state reconcile when the phone is offline?

---

## 8. Status and change control

This document is a proposed conceptual model, not an approved implementation specification.

No database schema, storage engine, API contract or execution mechanism is implied by this document.

Changes to the domain model should:

- Identify the reason for the change.
- Identify affected concepts and relationships.
- Preserve the distinction between evidence, inference and decision.
- Be reviewed against the product foundation.
- Be explicitly accepted before becoming an implementation constraint.

