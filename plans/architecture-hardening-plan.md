# Plan: Architecture Hardening And Type Precision Pass

> Source report: [REPORT.md](/workspace/typescript/hulymcp/REPORT.md)
> Planning method: adapted from Matt Pocock's `prd-to-plan` skill at https://raw.githubusercontent.com/mattpocock/skills/refs/heads/main/prd-to-plan/SKILL.md

## Architectural decisions

Durable decisions that apply across all phases:

- **Execution path**: keep the existing end-to-end flow intact: Effect config and service layers -> MCP server and registry -> domain schemas -> Huly operations -> Huly SDK clients. The report found this split healthy and worth preserving, not replacing.
- **Validation boundary**: all MCP tool inputs continue to decode through Effect Schema before reaching operations. The registry already centralizes this in a good shape, and refactors should strengthen outputs without bypassing this parse path.
- **Type strategy**: prefer extending the existing branded vocabulary in `src/domain/schemas/shared.ts` and propagating those types into result interfaces and helper signatures instead of inventing parallel ad hoc aliases.
- **SDK boundary policy**: unsafe casts stay only at explicit Huly SDK edges. Dynamic document inspection should be isolated in adapter/decoder helpers, not spread through feature logic.
- **Slice design**: each phase must cut through schema/result types, operation logic, MCP behavior, and tests so it is verifiable on its own. No “types-only” or “tests-only” horizontal phases.
- **Verification**: every phase ends with `pnpm check-all`, plus relevant integration coverage if the slice changes behavior against live Huly. Current workspace also needs an `esbuild` platform fix before the standard gate can pass.

---

## Phase 1: Typed Output Baseline

**User stories**:
- As a maintainer, I can rely on returned MCP result shapes carrying stable domain types instead of widening back to bare strings.
- As an LLM caller, I receive outputs that mirror the same identifier semantics used on tool inputs.

### What to build

Harden one narrow, high-signal output slice end to end by converting the most obvious result-shape primitive leaks into branded or named domain types, starting with relation-style outputs and the smallest time-tracking return values. Keep the external JSON wire format unchanged while improving the internal TypeScript contracts and tests.

### Research notes

- The report identifies output primitive leakage as the highest-priority issue and cites `relations`, `custom-fields`, `time`, and `workspace` as the first targets.
- The strongest evidence for starting here is that input schemas are already precise while outputs widen back to `string`, creating an avoidable parse-precise / return-loose mismatch.
- `src/domain/schemas/shared.ts` already contains a large branded vocabulary, so this slice should mostly reuse existing domain types rather than invent new infrastructure.
- `src/mcp/tools/registry.ts` already guarantees parse -> execute -> serialize in one place, which means tightening return contracts here is low-risk and easy to verify.

### Acceptance criteria

- [ ] Relation result types stop using bare strings where an existing identifier or class-name domain type is available.
- [ ] Small time-tracking result types use existing branded IDs where appropriate.
- [ ] Tool behavior and JSON payloads stay backward-compatible at runtime.
- [ ] Tests are updated to prove result typing and serialized output still match expectations.

---

## Phase 2: Custom Fields Boundary Containment

**User stories**:
- As a maintainer, I can change custom-field behavior without touching untyped `Record<string, unknown>` access across the whole feature.
- As an LLM caller, custom-field metadata and values are described by a narrower, more predictable contract.

### What to build

Refactor the custom-fields vertical slice so dynamic Huly metadata is decoded once into narrow internal shapes, then used through typed helpers for listing fields, reading values, and setting values. Keep the feature behavior intact while shrinking the untyped surface area.

### Research notes

- The report calls `custom-fields` the single most type-eroded production hotspot.
- Evidence includes repeated `as unknown as Record<string, unknown>`, repeated `as string`, weak `typeName: string`, and reparsing string inputs later in the flow.
- This is the right second phase because it is both high-value and locally contained: it affects one category of tools but touches schema, operations, and tests end to end.
- This phase should define a closed custom-field-type domain instead of continuing to return open-ended `string` type names.

### Acceptance criteria

- [ ] Dynamic SDK reads for custom-field metadata are isolated behind dedicated typed adapters.
- [ ] Custom-field type names become a closed domain rather than open-ended strings wherever practical.
- [ ] The custom-field result contracts become more precise without breaking MCP callers.
- [ ] Tests cover list, read, and set flows through the new typed boundary.

---

## Phase 3: Workspace And Time Precision Pass

**User stories**:
- As a maintainer, I can trust workspace and time-tracking outputs to preserve meaningful types for IDs, timestamps, names, and constrained string domains.
- As an LLM caller, I get clearer semantics for workspace/profile/time fields that already have stable meanings in the codebase.

### What to build

Apply the same output-hardening pattern to the workspace and time vertical slices. Tighten result interfaces, reduce anonymous string maps where possible, and preserve the existing operational behavior of workspace/profile/time tools.

### Research notes

- The report highlights `workspace` as clean operationally but under-modeled in its result contracts.
- It also highlights `time` as having several low-effort wins, including branded IDs already available in shared schema definitions.
- These two slices fit together because both are output-heavy and less dependent on custom metadata decoding than `custom-fields`.
- The existing branded/shared schema layer already contains `Timestamp`, `WorkspaceUuid`, `PersonUuid`, and time-related IDs, so the missing work is propagation, not invention.

### Acceptance criteria

- [ ] Workspace result types use domain-specific identifiers and constrained-string aliases where stable and justified.
- [ ] Time-tracking outputs stop widening known IDs back to `string`.
- [ ] No new sentinel-string states are introduced while tightening these contracts.
- [ ] Tool tests verify that the refined types do not change successful runtime output.

---

## Phase 4: Shared Helper Discipline

**User stories**:
- As a maintainer, I can follow one consistent style for SDK reference conversion, fallback lookups, and shared helper control flow.
- As a reviewer, I can enforce the repo’s immutability and cast rules without treating common helper modules as exceptions.

### What to build

Refine the shared helper layer so common lookup utilities and SDK reference bridges preserve more domain information and comply with the project’s own review rules. This includes removing low-signal `let`-based fallback patterns and tightening the signatures around reference conversion.

### Research notes

- The report identifies `toRef` as the central cast escape hatch. It is justified, but currently accepts any `string`, which erases domain distinctions before values hit the SDK.
- The report also identifies `test-management-shared` as violating the repo’s immutability rule via repeated “query then reassign on fallback” patterns.
- This phase comes after the feature slices so shared helpers can be tightened based on real refactor pressure instead of theoretical cleanup.
- A reusable “find by ID or name” helper is likely to reduce both mutation and duplication across several domains, especially test-management.

### Acceptance criteria

- [ ] Shared reference-conversion helpers accept narrower inputs where practical.
- [ ] Fallback lookup helpers avoid `let`-based conditional reassignment.
- [ ] Test-management shared finders are rewritten into a style consistent with `.claude/review-rules.md`.
- [ ] Cast justifications remain explicit and are limited to true SDK boundaries.

---

## Phase 5: Guardrails And Regression Proof

**User stories**:
- As a maintainer, I can keep string-type discipline from regressing after this pass lands.
- As a reviewer, I can quickly spot when a feature starts widening branded values back to primitives or leaking dynamic records outside adapter boundaries.

### What to build

Close the loop by adding reviewable guardrails, targeted tests, and lightweight documentation updates so the type-precision work becomes the new default rather than a one-time cleanup.

### Research notes

- The report found the architectural foundation strong but adoption inconsistent. That means the final phase should lock in the good patterns already present rather than add more architecture.
- The project already uses a strict quality harness and review rules, so the best follow-up is to align code examples, tests, and review checklists with the stronger type discipline.
- `src/domain/schemas/shared.ts` is already the durable type vocabulary. This phase should make “reuse existing brands first” an explicit working rule during future feature work.
- Verification remains blocked today by the workspace’s `esbuild` platform mismatch; fixing the environment is prerequisite to reliable enforcement of `pnpm check-all`.

### Acceptance criteria

- [ ] Targeted tests cover the new typed result contracts and boundary helpers.
- [ ] Documentation or reviewer guidance explicitly points contributors toward existing shared branded types.
- [ ] The standard quality gate runs cleanly in a correctly provisioned environment.
- [ ] The report’s high- and medium-severity findings are either resolved or explicitly converted into tracked follow-up items.
