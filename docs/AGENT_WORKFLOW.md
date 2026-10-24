# Hybrid agent workflow (M1)

The shared source of task intent is [AGENT_TASKS.yaml](../.github/AGENT_TASKS.yaml). **No agent is launched automatically.** A human starts a Work/Codex session, gives it a role, and asks it to read this file and its `specification` document.

## Worker procedure

1. Pull current `main`; inspect `.github/AGENT_TASKS.yaml`.
2. Select a `ready` task with your `assigned_role` and satisfied dependencies.
3. Claim it by setting `status: claimed`, `session_id` to a human-readable unique identifier, and `last_updated` to today's date. Submit this change in a small PR or coordinate an authorized direct update. **Wait until the claim is merged** before treating it as exclusive; concurrent claims are not atomic.
4. Create the task's named feature branch from current `main`, implement the specification, and run tests.
5. Open an implementation PR whose body contains exactly `Task: M1-GAMEPLAY` (replace ID appropriately). Keep PR open for review.
6. Update the task to `review` and record `pull_request` URL and `session_id` in a separate metadata PR or coordinated change. The validator requires these fields.
7. Reviewer checks tests, code and visual quality; user approves merge. Only then mark `done` in a separate follow-up commit.

## GitHub Actions

- **Agent task validation** runs on YAML/schema changes and manually, rejecting missing IDs, invalid statuses, duplicate IDs, unresolved dependencies and cycles.
- **Agent PR tracking** runs on each PR opening/edit/update and checks whether the source branch corresponds to one task and whether the PR body includes `Task: <ID>`. It publishes results in the workflow job and Actions summary. This is a read-only check; it does **not** assign, merge, comment, launch agents or update the YAML.
- Existing CI remains responsible for build/unit/browser tests.

## Coordination limits

A single YAML file is suitable for a small number of agents. Claims through separate PRs are not an atomic lock; use GitHub Issues/labels or a dedicated dispatcher for stronger coordination later. A PR can become stale when `main` changes. Task state is intentionally updated by humans/agents through reviewed Git changes, not guessed from PR events.

If GitHub branch protection is configured, make validation, PR tracking and CI required checks. Workflow checks can fail but cannot themselves prevent a repository administrator from merging without branch protection. Avoid granting workflows write tokens or storing agent credentials in this hybrid phase.

## Current responsibilities

- Planning session: specifications, backlog, review and acceptance.
- Gameplay session: M1-GAMEPLAY on `feature/m1-gameplay`.
- Graphics session: M1-VISUAL-QA once gameplay is done.

No automatic Work/Codex session creation is provided.
