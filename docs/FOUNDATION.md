# DevBridge

## Product and Architecture Foundation — v0.1

**Status:** Proposed foundation
**Stage:** Discovery and architecture
**Primary environment:** Android phone, Termux
**Initial test project:** A private Git repository, with The Office used only as a controlled test project

**Core principle:** The project is permanent. The AI is replaceable. The environment is persistent.

---

## 1. Product definition

DevBridge is a mobile-first development environment that connects AI-assisted development sessions to persistent projects, repositories, tools and execution environments.

It removes the friction of repeatedly transferring project context, code, instructions, decisions and results between AI conversations and development tools.

A developer should be able to move between supported AI providers or sessions without losing the project's identity, history, working state or accumulated knowledge.

DevBridge is not primarily another AI coding assistant. It is the environment in which different AI assistants can work on persistent projects.

### The problem

Today, working across multiple AI assistants and a phone-based development environment creates several problems:

- Project context is repeatedly reconstructed.
- Important decisions become buried in conversations.
- Different AI sessions can make contradictory assumptions.
- Code, commands and results must be transferred manually.
- The developer becomes the human integration layer between otherwise disconnected tools.
- Progress and evidence are difficult to preserve consistently.

DevBridge should make the project itself the source of continuity.

---

## 2. Core design principles

1. **Project-owned memory:** Project knowledge belongs to the project, not an AI conversation.
2. **Provider independence:** No single AI provider should own the project or its history.
3. **Persistent execution:** The repository and execution environment remain available across AI sessions.
4. **Evidence before assumptions:** Observations, decisions, inferences and unknowns must remain distinguishable.
5. **Human authority:** The developer controls permissions, approvals and consequential actions.
6. **Small, composable components:** Avoid unnecessary frameworks, dependencies and infrastructure.
7. **Mobile-first operation:** The phone is a first-class development environment, not a reduced desktop afterthought.
8. **Portable data:** Project memory and configuration should be exportable and recoverable.
9. **Replaceable integrations:** AI providers, execution tools and interfaces should be replaceable without rewriting the project.
10. **No hidden authority:** An AI suggestion must not silently become an approved project decision or an executed action.

---

## 3. Conceptual architecture

DevBridge consists of five logical components.

### A. Mobile interface

The developer's control surface.

Responsibilities:

- Browse projects and repositories.
- View current branch and working state.
- Create and manage tasks.
- Review AI-generated task briefs.
- View changes, test results and evidence.
- Approve or reject proposed actions.
- Switch between supported AI providers and sessions.

The interface should be lightweight and usable from a mobile browser.

### B. Project context engine

The continuity layer.

Responsibilities:

- Maintain project identity and metadata.
- Store confirmed decisions and constraints.
- Record evidence and its source.
- Track open questions and unresolved risks.
- Maintain task history and outcomes.
- Generate focused context packages for new AI sessions.
- Prevent unverified AI assumptions from becoming established facts.

Project memory should be structured, inspectable and versionable.

### C. AI integration layer

The replaceable intelligence layer.

Responsibilities:

- Connect to supported provider APIs and agent harnesses.
- Manage provider-specific authentication and configuration.
- Prepare task-specific context.
- Receive proposed changes, explanations and results.
- Associate AI activity with the relevant project and task.

Provider adapters must remain independent of project memory and execution permissions.

**Important limitation:** consumer chat subscriptions and programmable APIs are different access mechanisms. DevBridge must use supported provider interfaces and must not depend on circumventing subscription limits or automating unsupported consumer interfaces.

### D. Execution engine

The controlled interface between AI work and the actual project.

Responsibilities:

- Inspect files and repository state.
- Read and search source code.
- Run approved tests and checks.
- Prepare proposed file changes.
- Capture command output and evidence.
- Manage Git status, diffs and commits through explicit permissions.

The execution engine should not automatically inherit unrestricted authority from an AI provider.

### E. Project workspace

The persistent working environment.

Responsibilities:

- Hold project repositories.
- Preserve files and local state.
- Maintain Git history.
- Store project-specific configuration.
- Provide the execution environment independently of AI sessions.

Initially, this can be local to Termux. A cloud coordinator is not a prerequisite.

---

## 4. Project memory and evidence model

This is a foundational feature, not an optional convenience.

Every stored project statement should have a distinguishable status.

| Classification | Meaning |
|---|---|
| Observed | Directly established by inspection or execution |
| Documented | Explicitly stated in an authoritative project document |
| Decision | Explicitly approved by the developer |
| Inference | Reasoned conclusion that has not been verified |
| Unknown | Information not yet established |
| Superseded | Previously valid information replaced by newer evidence or a decision |

Where practical, records should include:

- Project identifier.
- Statement or content.
- Classification.
- Source or evidence reference.
- Date recorded.
- Relevant commit or version.
- Author or originating AI session.
- Approval status, where applicable.
- Supersession relationship.

AI-generated content should never silently become a confirmed decision.

### Context packaging

A new AI session should receive a focused task brief rather than the entire conversation history.

A task brief should contain:

1. Project identity.
2. Repository and current branch.
3. Current commit and working-tree status.
4. Task objective.
5. Relevant architecture and constraints.
6. Confirmed decisions.
7. Relevant evidence.
8. Acceptance criteria.
9. Known risks and unknowns.
10. Permissions and prohibited actions.

The brief should be reproducible and traceable to the project records used to create it.

---

## 5. AI provider and session model

An AI session is temporary. Project knowledge is not.

DevBridge should distinguish between:

- **Provider:** the service or model provider.
- **Model:** the selected model.
- **Session:** one interaction context.
- **Project:** the persistent development subject.
- **Task:** a defined unit of work.
- **Execution:** actions performed against the workspace.

A task may involve multiple AI sessions. A session may end without completing the task. Another provider should be able to continue from the same project state using a newly generated brief.

Provider-specific capabilities must be declared rather than assumed.

For example, a provider may support text generation but not direct tool calls, structured output or agent execution.

---

## 6. Security and permissions

Security must be designed into the architecture from the beginning.

### Initial permission levels

**Level 1 — Read**

- Read project files.
- Search source code.
- Inspect Git status and history.
- Read documentation.

**Level 2 — Propose**

- Prepare patches.
- Suggest commands.
- Propose configuration changes.
- Explain expected effects.

**Level 3 — Approved execution**

- Execute explicitly approved commands.
- Apply reviewed changes.
- Run approved tests.
- Create commits when authorized.

### Excluded from initial MVP

- Unrestricted shell access.
- Automatic production deployments.
- Access to The Office production credentials or customer data.
- Unreviewed destructive operations.
- Automatic permission escalation.

Every consequential execution should have an identifiable task, actor, permission and result.

Plan mode or an AI promise not to modify files is not a security boundary. The execution engine must enforce permissions independently.

---

## 7. Initial technical direction

These are working hypotheses, not final technology selections.

| Area | Initial direction |
|---|---|
| Host environment | Termux on Android |
| Runtime | Node.js, subject to compatibility checks |
| Workspace | Local Git repositories |
| Interface | Lightweight local web application |
| Project data | Structured local storage with backup/export |
| AI integration | Provider adapter architecture |
| Execution | Controlled local agent/service |
| Communication | Local HTTP initially; WebSockets if justified |
| Cloud infrastructure | Deferred until a real requirement emerges |

Cretli remains a reference implementation for studying mobile hosting, authentication, terminal communication and agent permissions. It is not the architectural foundation and will not dictate DevBridge's dependencies.

---

## 8. MVP scope

The MVP must prove the core idea with the smallest useful system.

### Included

- One phone.
- One developer.
- One local project.
- One Git repository.
- One supported AI integration.
- Persistent project identity and memory.
- Evidence and decision records.
- Task creation and task briefs.
- Read-only repository inspection.
- Proposed changes and reviewable diffs.
- Explicit approval before execution.
- Basic audit history.

### Excluded initially

- Multi-user collaboration.
- Public SaaS hosting.
- Billing and subscriptions.
- Multiple simultaneous agents.
- Complex workflow automation.
- Built-in browser automation.
- Automatic deployment.
- Support for every AI provider.
- A general-purpose IDE replacement.

---

## 9. MVP acceptance criteria

The MVP is not complete merely because a chat interface works.

It must demonstrate that:

1. A project can be registered and reopened without losing its identity.
2. Project memory survives application restarts.
3. A new AI session can receive an accurate task brief without manually reconstructing the project history.
4. The AI can inspect the selected repository through an authorized mechanism.
5. The developer can inspect proposed changes before applying them.
6. Unauthorized execution is rejected by the execution layer.
7. Evidence from commands and tests can be attached to a task.
8. A task can be paused and resumed in another AI session.
9. The project can be backed up and restored.
10. The system remains useful when the AI provider is changed.

---

## 10. Development stages

### Stage 0 — Foundation

- Finalize product boundaries.
- Define project and task data models.
- Define evidence and decision classifications.
- Establish the permission model.
- Inspect relevant existing tools and dependencies.

### Stage 1 — Local project core

- Project registration.
- Repository discovery.
- Git inspection.
- Persistent project records.
- Basic mobile interface.

### Stage 2 — Context engine

- Evidence records.
- Decision records.
- Task management.
- Context brief generation.
- Session handover.

### Stage 3 — AI connection

- One supported provider.
- Provider adapter contract.
- Context delivery.
- Response capture.
- Session-to-task association.

### Stage 4 — Controlled execution

- Read-only inspection.
- Proposed patches.
- Diff review.
- Approval-gated commands.
- Test execution and evidence capture.

### Stage 5 — Validation

- Restart and recovery tests.
- Provider-switch test.
- Session-handover test.
- Permission enforcement tests.
- Backup and restore test.
- Mobile usability review.

Only after these stages should we consider broader integrations, cloud hosting or commercial distribution.

---

## 11. Strategic direction

DevBridge should ultimately make it possible for developers to choose their AI tools without surrendering control of their projects, context or development environment.

The commercial proposition is not simply access to more AI models or more tokens.

It is the productive development environment that connects them.

> One development environment. Any supported AI. Your projects, always in context.

---

## 12. Open architectural questions

These remain unresolved and must be investigated before implementation:

1. Should the local project context engine use SQLite from the beginning?
2. Should project memory be stored as structured records, versioned Markdown, or a combination?
3. Should the execution engine run as a separate local service from the interface?
4. What is the smallest reliable provider adapter contract?
5. How should AI-generated patches be transferred and reviewed?
6. How do we securely handle provider credentials on Android?
7. What backup and recovery mechanism is practical on a phone?
8. Which parts should eventually be portable to another device or host?

These are research questions, not assumptions disguised as decisions.

---

**Foundation status:** Proposed.
**Implementation status:** Not started.
**Next milestone:** Validate the architecture and resolve the foundational data, execution and security boundaries before scaffolding the application.
