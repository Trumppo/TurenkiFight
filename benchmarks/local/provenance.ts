/**
 * Working-tree provenance for a local measurement run.
 *
 * A run writes generated result files into `benchmarks/results/`, so those
 * paths cannot count as source dirt: otherwise every committed result would
 * necessarily claim `workingTreeDirty: true`. Exactly one directory prefix is
 * excluded, and the exclusion list is recorded in the manifest and required by
 * the validator. A modified simulation, protocol, test or harness file still
 * makes the run dirty.
 */
import { execFileSync } from 'node:child_process';
import { LOCAL_DIRTY_EXCLUSIONS } from './manifest';

export type WorkingTreeState = {
  gitCommitSha: string;
  workingTreeDirty: boolean;
  dirtyExclusions: ['benchmarks/results/'];
};

const COMMIT = /^[0-9a-f]{40}$/;

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isExcludedPath(path: string, exclusions: readonly string[]): boolean {
  const normalized = normalizePath(path);
  return exclusions.some(exclusion => {
    const prefix = normalizePath(exclusion).replace(/\/+$/, '');
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  });
}

/**
 * `git status --porcelain` writes `XY path`; a rename writes
 * `XY old -> new`. Both sides of a rename must be excluded before the entry is
 * ignored, so renaming source code into the results directory still counts.
 */
function entryPaths(line: string): string[] {
  const rest = line.slice(3);
  const arrow = rest.indexOf(' -> ');
  return arrow === -1 ? [rest] : [rest.slice(0, arrow), rest.slice(arrow + 4)];
}

export function hasUnignoredWorkingTreeChanges(
  porcelain: string,
  exclusions: readonly string[] = LOCAL_DIRTY_EXCLUSIONS,
): boolean {
  const entries = porcelain.split(/\r?\n/).filter(line => line.length >= 4);
  return entries.some(line => {
    const paths = entryPaths(line);
    return !(paths.length > 0 && paths.every(path => isExcludedPath(path, exclusions)));
  });
}

export function readWorkingTree(cwd: string = process.cwd()): WorkingTreeState {
  const gitCommitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  if (!COMMIT.test(gitCommitSha)) throw new Error('Could not read the git commit SHA for provenance');
  const porcelain = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
  return {
    gitCommitSha,
    workingTreeDirty: hasUnignoredWorkingTreeChanges(porcelain),
    dirtyExclusions: [...LOCAL_DIRTY_EXCLUSIONS] as WorkingTreeState['dirtyExclusions'],
  };
}
