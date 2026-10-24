#!/usr/bin/env python3
"""Validate TurenkiFight's declarative agent task queue. Requires PyYAML."""
import argparse
import sys
from pathlib import Path

import yaml

STATUSES = {"backlog", "ready", "claimed", "in_progress", "review", "blocked", "done"}
PRIORITIES = {"P0", "P1", "P2", "P3"}

def validate(path: Path) -> tuple[list[dict], list[str]]:
    errors = []
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        return [], [f"Cannot parse {path}: {exc}"]
    if not isinstance(data, dict) or data.get("schema_version") != 1:
        return [], ["Expected YAML mapping with schema_version: 1"]
    if data.get("project") != "Trumppo/TurenkiFight":
        errors.append("project must be Trumppo/TurenkiFight")
    tasks = data.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        return [], errors + ["tasks must be a nonempty list"]
    ids = set()
    for index, task in enumerate(tasks):
        label = f"tasks[{index}]"
        if not isinstance(task, dict):
            errors.append(f"{label} must be a mapping")
            continue
        tid = task.get("id")
        if not isinstance(tid, str) or not tid.strip():
            errors.append(f"{label}.id must be nonempty")
        elif tid in ids:
            errors.append(f"Duplicate task id {tid}")
        else:
            ids.add(tid)
        for field in ("title", "assigned_role", "specification"):
            if not isinstance(task.get(field), str) or not task[field].strip():
                errors.append(f"{label}.{field} must be nonempty")
        if task.get("status") not in STATUSES:
            errors.append(f"{label}.status invalid")
        if task.get("priority") not in PRIORITIES:
            errors.append(f"{label}.priority invalid")
        for field in ("depends_on", "scope", "acceptance"):
            if not isinstance(task.get(field), list) or any(not isinstance(v, str) or not v.strip() for v in task[field]):
                errors.append(f"{label}.{field} must be a list of nonempty strings")
        if task.get("status") in {"claimed", "in_progress", "review"} and not task.get("session_id"):
            errors.append(f"{label} requires session_id when claimed/in_progress/review")
        if task.get("status") == "review" and not task.get("pull_request"):
            errors.append(f"{label} requires pull_request in review")
        if task.get("status") == "done" and task.get("pull_request") is None and task.get("branch") is not None:
            errors.append(f"{label} done implementation task requires pull_request")
    graph = {}
    for task in tasks:
        if not isinstance(task, dict) or not isinstance(task.get("id"), str):
            continue
        tid = task["id"]
        deps = task.get("depends_on", [])
        if not isinstance(deps, list):
            continue
        graph[tid] = deps
        for dep in deps:
            if dep not in ids:
                errors.append(f"{tid}: unknown dependency {dep}")
            if dep == tid:
                errors.append(f"{tid}: cannot depend on itself")
        if task.get("status") == "ready" and any(next((x.get("status") for x in tasks if isinstance(x, dict) and x.get("id") == dep), None) != "done" for dep in deps):
            errors.append(f"{tid}: ready task has unfinished dependencies")
    visiting, visited = set(), set()
    def visit(tid):
        if tid in visiting:
            errors.append(f"Dependency cycle at {tid}")
            return
        if tid in visited:
            return
        visiting.add(tid)
        for dep in graph.get(tid, []):
            if dep in graph:
                visit(dep)
        visiting.remove(tid)
        visited.add(tid)
    for tid in graph:
        visit(tid)
    return tasks, errors

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("path", nargs="?", default=".github/AGENT_TASKS.yaml")
    args = parser.parse_args()
    tasks, errors = validate(Path(args.path))
    for error in errors:
        print(f"ERROR: {error}", file=sys.stderr)
    print(f"Validated {len(tasks)} tasks: {'FAIL' if errors else 'PASS'}")
    sys.exit(bool(errors))
