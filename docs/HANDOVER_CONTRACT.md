# DevBridge v1 — Handover Contract

**Status:** Agreed implementation contract for the first local handover  
**Parent:** [V1 Product Scope](V1_SCOPE.md)

## Purpose

A handover gives a new AI instance a compact, faithful entry point into a project. It must distinguish project identity, an index of the latest recorded context, and the underlying historical evidence.

It is a derived view, not a new authority and not a replacement for source records.

## 1. Project kernel

The initial kernel contains only:
- Stable project identifier.
- User-visible project name.
- User-provided purpose.

The initial `principles` collection is empty. A principle may be added only through a future explicit user action that marks it as an enduring project principle. DevBridge must not infer principles from repetition, tone, AI suggestions or ordinary decisions.

## 2. Current recorded state

The current-state section is a transparent index over records included in this handover. It groups record identifiers by their stored category and separately identifies:
- Records explicitly marked with status text `unresolved`.
- Status records with other supplied status text.
- Records explicitly superseded by a stored `supersedes` relationship.

It does not decide which proposal is correct, infer that work is complete, or silently remove superseded material. The referenced record content and provenance remain available in the historical record.

The index is limited to records included in this handover. Its metadata must disclose that limitation.

## 3. Historical record

The historical section preserves:
- Attributed project records in chronological order.
- Stored relationships, including their direction and type.
- Historical events, with their origin and timestamps.

A relationship is included when at least one endpoint is in the included record set. Each endpoint is marked as included or omitted, so a bounded handover does not disguise a missing endpoint.

Record and event counts disclose whether older material was omitted. Original records remain authoritative and append-only.

## 4. Provenance and non-judgement

Every contribution retains its stored origin, label, source reference, timestamp and status text. Status labels are supplied descriptions, not validation.

A simulated report remains a report from its stated origin. DevBridge does not upgrade it into a verified capability or completed task.

Contradictions and unresolved alternatives remain visible. DevBridge does not arbitrate them.

## 5. Versioning and completeness

The output format is `devbridge-handover-v2`. It includes:
- `kernel`
- `currentState`
- `history`
- `historyBoundary`, an exact Project event-sequence boundary with record/event counts and capture time
- `completeness` and explicit record/event counts.

The history boundary is captured from the same SQLite read snapshot as the handover records and events. It provides an ordered position for lifecycle staleness detection; timestamps alone are not used to decide whether a contribution is newer than a handover.

The existing top-level `project` and `records` fields remain available during this initial implementation for straightforward consumers. They refer to the same project and included records as the new sections.

Completeness remains `recorded_context_only`. The notice must state that private conversations, disconnected sources and activity never submitted or observed may be absent.
