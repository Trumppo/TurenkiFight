# Hybrid agent workflow (M1)

The shared source of task intent is [AGENT_TASKS.yaml](../.github/AGENT_TASKS.yaml). **No agent is launched automatically.** A human starts a Work/Codex session, gives it a role, and asks it to read this file and its `specification` document.

## Worker procedure

1. Pull current `main`; inspect `.github/AGENT_TASKS.yaml`.
2. Select a `ready` task with your `assigned_role` and satisfied dependencies.
3. Claim it by setting `status: claimed`, `session_id` to a human-readable unique identifier, and `last_updated` to today's date. Submit this change in a small PR or coordinate an authorized direct update. **Wait until the claim is merged** before treating it as exclusive; concurrent claims are not atomic.
4. Create the task's named feature branch from current `main`, implement the specification, and run tests.
5. Group 2–5 related tasks into a coherent work package when practical. Commit incremental changes on one feature branch, run focused local checks, and open one PR only when the package is independently reviewable. Include `Task: M1-GAMEPLAY` (replace with the primary task ID) in the PR body; list any other task IDs in prose. Keep PR open for review.
6. Update the primary task to `review` and record `pull_request` URL and `session_id` with the implementation PR or a coordinated metadata update. Avoid separate PRs for interim status changes.
7. Reviewer checks tests, code and visual quality; user approves merge. Only then mark `done` in a separate follow-up commit.

## GitHub Actions

- **Agent task validation** runs on YAML/schema changes and manually, rejecting missing IDs, invalid statuses, duplicate IDs, unresolved dependencies and cycles.
- **Agent PR tracking** currently runs on each PR opening/edit/update and expects one primary task and `Task: <ID>` in the body. Work-package support does not yet extend this validator to multiple task IDs. It publishes results in the workflow job and Actions summary. This is a read-only check; it does **not** assign, merge, comment, launch agents or update the YAML.
- Existing CI remains responsible for build/unit/browser tests.

## Coordination limits

A single YAML file is suitable for a small number of agents. Claims through separate PRs are not an atomic lock; use GitHub Issues/labels or a dedicated dispatcher for stronger coordination later. A PR can become stale when `main` changes. Task state is intentionally updated by humans/agents through reviewed Git changes, not guessed from PR events.

If GitHub branch protection is configured, make validation, PR tracking and CI required checks. Workflow checks can fail but cannot themselves prevent a repository administrator from merging without branch protection. Avoid granting workflows write tokens or storing agent credentials in this hybrid phase.

## Current responsibilities

- Planning session: specifications, backlog, review and acceptance.
- Gameplay session: M1-GAMEPLAY on `feature/m1-gameplay`.
- Graphics session: M1-VISUAL-QA once gameplay is done.

No automatic Work/Codex session creation is provided.

## Work-package model (backward-compatible rollout)

`work_packages` in `.github/AGENT_TASKS.yaml` is an optional planning layer; existing `tasks` entries, IDs, statuses and dependency rules remain authoritative for automation. Each package names an owner, related `task_ids`, a shared branch, acceptance criteria and a single PR boundary. Package status is not an automatic lock or substitute for claiming tasks. A package should normally contain 2–5 related tasks, but coherent small or urgent fixes may use one. Avoid unrelated bundling or excessively large reviews. No retroactive conversion of completed tasks is required.

During implementation, use multiple commits and focused local checks. Open a PR only when package acceptance criteria are met and the change is reviewable. Run required CI, repair failures in the same PR, and seek owner approval before merge. Preserve the existing primary `Task: <ID>` marker and include other task IDs in the PR description until the tracker supports package IDs. For documentation-only changes, CI optimization should be introduced separately and must not bypass required checks.
