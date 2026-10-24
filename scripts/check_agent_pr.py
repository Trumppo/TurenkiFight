#!/usr/bin/env python3
"""Read-only PR-to-task policy check; posts results to Actions summary."""
import json
import os
import sys
from pathlib import Path
from validate_agent_tasks import validate

def run():
    tasks, errors = validate(Path(".github/AGENT_TASKS.yaml"))
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    pr = event.get("pull_request", {})
    branch = pr.get("head", {}).get("ref", "")
    body = pr.get("body") or ""
    number = pr.get("number", "?")
    matches = [t for t in tasks if isinstance(t, dict) and t.get("branch") == branch]
    if not matches:
        print(f"PR #{number}: no agent task assigned to {branch!r}; check not applicable")
        return 0
    if len(matches) != 1:
        errors.append(f"PR #{number}: branch {branch!r} matches multiple tasks")
    else:
        task = matches[0]
        tid = task["id"]
        if f"Task: {tid}" not in body:
            errors.append(f"PR #{number}: body must contain 'Task: {tid}'")
        if task["status"] == "backlog":
            errors.append(f"PR #{number}: task {tid} is still backlog")
        if task.get("assigned_role") == "planning-session" and branch.startswith("feature/"):
            errors.append(f"PR #{number}: planning-only task cannot be claimed as implementation")
    lines = [f"## Agent PR check — #{number}", f"Branch: \`{branch}\`", "", "### Validation"]
    lines += [f"- ❌ {e}" for e in errors] if errors else ["- ✅ Task mapping and metadata valid"]
    summary = os.getenv("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as out:
            out.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    return int(bool(errors))

if __name__ == "__main__":
    sys.exit(run())
