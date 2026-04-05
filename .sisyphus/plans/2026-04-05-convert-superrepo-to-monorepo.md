# Plan: Convert `swiperflix` from Superrepo to True Monorepo

## Status
- Drafted by Prometheus
- Approved by Momus

## Objective
Convert the repository at `/Users/liqing/Documents/PersonalProjects/My_Proj/swiperflix` from a git superrepo with two submodules into a single monorepo that tracks `swiperflix-gateway/` and `swiperflix-player/` as normal repository content, with no backward-compatibility layer for submodule workflows.

## Fixed Inputs
- Main repo root: `/Users/liqing/Documents/PersonalProjects/My_Proj/swiperflix`
- Active implementation worktree: `/Users/liqing/Documents/PersonalProjects/My_Proj/swiperflix-monorepo-conversion`
- Base ref: `origin/main`
- Task branch: `chore/convert-superrepo-to-monorepo`
- Current root branch: `main`
- Current indexed gitlinks:
  - `swiperflix-gateway` -> `5fc9811735aa26f60f53e5e57c8248eb3d431237`
  - `swiperflix-player` -> `34b0aae49312d8d3aae2872bd3bc778fa30dbc37`
- Current submodule artifacts:
  - `.gitmodules` exists
  - root `.git/config` contains submodule entries
  - `swiperflix-gateway/.git` and `swiperflix-player/.git` are git pointer files
  - `.git/modules/swiperflix-gateway` and `.git/modules/swiperflix-player` exist
- Shared-metadata risk:
  - tracked file edits are isolated in the worktree
  - `.git/config` and `.git/modules/*` are shared repo metadata and affect all worktrees

## Required End State
- `swiperflix-gateway/` and `swiperflix-player/` are normal tracked directories in the root repo.
- No `160000` gitlinks remain in the index.
- `.gitmodules` is removed.
- No `submodule.*` config remains in shared git config.
- No nested `.git` file or `.git/` directory remains inside either service directory.
- `.git/modules/swiperflix-gateway` and `.git/modules/swiperflix-player` are removed.
- Root docs and CI describe a single repo with two service directories.
- No clone, init, update, or checkout instructions remain for submodules.

## Non-Goals
- Do not preserve `git clone --recurse-submodules`, `git submodule update`, or any submodule-era workflow.
- Do not add a compatibility note for users of the old superrepo layout.
- Do not add monorepo tooling that is not required for this conversion.
- Do not broaden the task into unrelated doc modernization.

## Acceptance Gates

### Baseline Checks
```bash
ROOT=/Users/liqing/Documents/PersonalProjects/My_Proj/swiperflix
WT=/Users/liqing/Documents/PersonalProjects/My_Proj/swiperflix-monorepo-conversion

git -C "$WT" ls-files -s swiperflix-gateway swiperflix-player
git -C "$ROOT" config --get-regexp '^submodule\.'
git -C "$WT/swiperflix-gateway" rev-parse HEAD
git -C "$WT/swiperflix-player" rev-parse HEAD
git -C "$WT/swiperflix-gateway" status --short
git -C "$WT/swiperflix-player" status --short
git -C "$ROOT" worktree list
```

Expected baseline:
- `git ls-files -s` shows exactly two `160000` entries:
  - `160000 5fc9811735aa26f60f53e5e57c8248eb3d431237 0 swiperflix-gateway`
  - `160000 34b0aae49312d8d3aae2872bd3bc778fa30dbc37 0 swiperflix-player`
- submodule config exists
- service HEADs match the indexed SHAs exactly
- both nested repos are clean
- the shared worktree list is understood before touching shared metadata

### Final Green Checks
```bash
ROOT=/Users/liqing/Documents/PersonalProjects/My_Proj/swiperflix
WT=/Users/liqing/Documents/PersonalProjects/My_Proj/swiperflix-monorepo-conversion

git -C "$WT" ls-files -s | grep '^160000 '
git -C "$ROOT" config --get-regexp '^submodule\.'

test ! -e "$WT/.gitmodules"
test ! -e "$WT/swiperflix-gateway/.git"
test ! -d "$WT/swiperflix-gateway/.git"
test ! -e "$WT/swiperflix-player/.git"
test ! -d "$WT/swiperflix-player/.git"
test ! -d "$ROOT/.git/modules/swiperflix-gateway"
test ! -d "$ROOT/.git/modules/swiperflix-player"

git -C "$WT" grep -nE '\.gitmodules|submodule|submodules|--recurse-submodules|git submodule' -- \
  README.md AGENTS.md docs/ARCHITECTURE.md docs/DEPLOYMENT_GUIDE.md .github/workflows
```

Expected final state:
- no output from the `160000` check
- no output from the `submodule.*` config check
- no `.gitmodules`
- no nested `.git` file or directory under either service
- no stale `.git/modules/*` directories
- no remaining submodule wording in the planned conversion surfaces

## Implementation Plan

### 1. Freeze the Imported Content to the Exact Indexed SHAs
Use the indexed gitlink revisions as the source of truth for vendoring.
- `swiperflix-gateway` must be imported from `5fc9811735aa26f60f53e5e57c8248eb3d431237`
- `swiperflix-player` must be imported from `34b0aae49312d8d3aae2872bd3bc778fa30dbc37`

Rules:
- Do not import a nested repo if its HEAD differs from the gitlink SHA.
- Do not import dirty nested repo state.
- If either submodule is dirty or detached at the wrong commit, correct that before conversion.

#### Task 1 QA
**Tools/commands**
- `git -C "$WT" ls-files -s swiperflix-gateway swiperflix-player`
- `test "$(git -C "$WT/swiperflix-gateway" rev-parse HEAD)" = "5fc9811735aa26f60f53e5e57c8248eb3d431237"`
- `test "$(git -C "$WT/swiperflix-player" rev-parse HEAD)" = "34b0aae49312d8d3aae2872bd3bc778fa30dbc37"`
- `git -C "$WT/swiperflix-gateway" status --short`
- `git -C "$WT/swiperflix-player" status --short`

**Exact steps**
1. Run `git -C "$WT" ls-files -s swiperflix-gateway swiperflix-player`.
2. Confirm the output is exactly:
   - `160000 5fc9811735aa26f60f53e5e57c8248eb3d431237 0 swiperflix-gateway`
   - `160000 34b0aae49312d8d3aae2872bd3bc778fa30dbc37 0 swiperflix-player`
3. Run the two `test "$(git ... rev-parse HEAD)" = "..."` commands.
4. Run `git -C "$WT/swiperflix-gateway" status --short`.
5. Run `git -C "$WT/swiperflix-player" status --short`.

**Expected result**
- Step 1 shows the two exact `160000` gitlink lines above.
- Step 3 exits `0` for both services.
- Steps 4 and 5 print nothing.
- If any command fails or prints unexpected output, stop before importing content.

### 2. Replace Gitlinks with Normal Tracked Content
Perform the tracked-state conversion inside the worktree only.
- Remove the `swiperflix-gateway` and `swiperflix-player` gitlink entries from the root index while keeping files on disk.
- Remove `.gitmodules` from the tracked tree.
- Remove the nested `.git` pointer files from both service directories.
- Re-add both service directories as ordinary tracked files.
- Inspect the staged diff to confirm the index now contains normal file entries instead of gitlinks.

Success condition for this step:
- `git -C "$WT" ls-files -s swiperflix-gateway swiperflix-player` shows normal file entries, not `160000`.

#### Task 2 QA
**Tools/commands**
- `git -C "$WT" ls-files -s | grep '^160000 '`
- `git -C "$WT" ls-files -s -- swiperflix-gateway/pyproject.toml swiperflix-player/package.json`
- `test ! -e "$WT/.gitmodules"`
- `test ! -e "$WT/swiperflix-gateway/.git"`
- `test ! -d "$WT/swiperflix-gateway/.git"`
- `test ! -e "$WT/swiperflix-player/.git"`
- `test ! -d "$WT/swiperflix-player/.git"`
- `git -C "$WT" diff --cached --stat`

**Exact steps**
1. Run `git -C "$WT" ls-files -s | grep '^160000 '`. 
2. Run `git -C "$WT" ls-files -s -- swiperflix-gateway/pyproject.toml swiperflix-player/package.json`.
3. Run `test ! -e "$WT/.gitmodules"`.
4. Run `test ! -e "$WT/swiperflix-gateway/.git"`.
5. Run `test ! -d "$WT/swiperflix-gateway/.git"`.
6. Run `test ! -e "$WT/swiperflix-player/.git"`.
7. Run `test ! -d "$WT/swiperflix-player/.git"`.
8. Run `git -C "$WT" diff --cached --stat`.

**Expected result**
- Step 1 prints nothing and exits with status `1`, proving no `160000` gitlinks remain in the index.
- Step 2 returns exactly two normal file entries: one for `swiperflix-gateway/pyproject.toml` and one for `swiperflix-player/package.json`.
- Step 2 must show normal file modes, expected `100644`, not `160000`.
- Steps 3 through 7 all exit with status `0`.
- Step 8 shows a staged deletion for `.gitmodules` and a non-empty staged addition set under both `swiperflix-gateway/` and `swiperflix-player/`.
- If Step 8 only reflects the former top-level gitlink paths instead of real file additions under both service directories, stop because the tracked conversion is incomplete.

### 3. Update Repo Metadata and Docs for Monorepo Wording
Apply only the edits required to make the root repo correct as a monorepo.

#### Files that must change
- `README.md`
- `AGENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/DEPLOYMENT_GUIDE.md`
- `.github/workflows/build-images.yml`

#### Files to audit and only change if needed for wording consistency
- `.github/workflows/cleanup.yml`
- `swiperflix-gateway/README.md`
- `swiperflix-player/README.md`
- `swiperflix-gateway/AGENTS.md`
- `swiperflix-player/AGENTS.md`

#### Required content changes
- Remove all `git clone --recurse-submodules` instructions.
- Remove all `git submodule update --init --recursive` instructions.
- Remove all `git submodule update --remote --merge` instructions.
- Remove wording that says the service directories are independent repos or independent git submodules.
- Remove `.gitmodules` from the repository layout descriptions.
- Change CI wording from “checkout with submodules” to normal repository checkout.
- Preserve the two-service architecture and existing service build paths.
- Do not add a backward-compatibility note for old submodule users.

#### Task 3 QA
**Tools/commands**
- `git -C "$WT" grep -nE '\.gitmodules|submodule|submodules|--recurse-submodules|git submodule|independent git submodule|independent git submodules' -- README.md AGENTS.md docs/ARCHITECTURE.md docs/DEPLOYMENT_GUIDE.md .github/workflows`
- `git -C "$WT" grep -n 'Checkout repository' -- .github/workflows/build-images.yml`
- `git -C "$WT" grep -n 'uses: actions/checkout@v4' -- .github/workflows/build-images.yml`
- `git -C "$WT" grep -n 'submodules:' -- .github/workflows/build-images.yml`

**Exact steps**
1. Run the negative `git grep -nE ...` search across `README.md`, `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT_GUIDE.md`, and `.github/workflows`.
2. Run `git -C "$WT" grep -n 'Checkout repository' -- .github/workflows/build-images.yml`.
3. Run `git -C "$WT" grep -n 'uses: actions/checkout@v4' -- .github/workflows/build-images.yml`.
4. Run `git -C "$WT" grep -n 'submodules:' -- .github/workflows/build-images.yml`.

**Expected result**
- Step 1 returns no matches.
- Step 2 returns one match for the renamed standard checkout step.
- Step 3 returns one match for `uses: actions/checkout@v4`.
- Step 4 returns no matches.
- If Step 1 or Step 4 returns any output, the wording cleanup is incomplete.

### 4. Verify the Services Before Shared Metadata Cleanup
Run functional verification while rollback is still cheap.

#### Player verification
```bash
cd /Users/liqing/Documents/PersonalProjects/My_Proj/swiperflix-monorepo-conversion/swiperflix-player
pnpm build
pnpm lint
```

#### Gateway verification
```bash
cd /Users/liqing/Documents/PersonalProjects/My_Proj/swiperflix-monorepo-conversion/swiperflix-gateway
python -m compileall app
```

Pass criteria:
- player build succeeds
- player lint succeeds
- gateway source compiles cleanly

#### Task 4 QA
**Tools/commands**
- `cd "$WT/swiperflix-player" && pnpm build`
- `test -d "$WT/swiperflix-player/dist"`
- `cd "$WT/swiperflix-player" && pnpm lint`
- `cd "$WT/swiperflix-gateway" && python -m compileall app`
- `git -C "$WT" diff --quiet -- swiperflix-player swiperflix-gateway`

**Exact steps**
1. Run `cd "$WT/swiperflix-player" && pnpm build`.
2. Run `test -d "$WT/swiperflix-player/dist"`.
3. Run `cd "$WT/swiperflix-player" && pnpm lint`.
4. Run `cd "$WT/swiperflix-gateway" && python -m compileall app`.
5. Run `git -C "$WT" diff --quiet -- swiperflix-player swiperflix-gateway`.

**Expected result**
- Step 1 exits with status `0`.
- Step 2 exits with status `0`, proving the build output directory exists.
- Step 3 exits with status `0`.
- Step 4 exits with status `0`.
- Step 5 exits with status `0`, proving the verification commands did not introduce additional unstaged tracked-file modifications under either service directory.
- Untracked or ignored build artifacts are acceptable only if Step 5 still exits `0`.

### 5. Remove Shared Git Metadata
This step is repo-wide because it operates under the shared git common directory at `/Users/liqing/Documents/PersonalProjects/My_Proj/swiperflix/.git`.

Actions:
- remove the two `[submodule "..."]` sections from shared `.git/config`
- remove `.git/modules/swiperflix-gateway`
- remove `.git/modules/swiperflix-player`

Do not touch:
- `.git/worktrees/swiperflix-monorepo-conversion`
- unrelated shared repo metadata

Important:
- Git keeps module directories around unless they are explicitly deleted.
- The conversion is not complete until the stale module directories are removed.
- Because worktrees share common metadata, this cleanup affects the root `main` checkout too.

#### Task 5 QA
**Tools/commands**
- `git -C "$ROOT" config --get-regexp '^submodule\.'`
- `test ! -d "$ROOT/.git/modules/swiperflix-gateway"`
- `test ! -d "$ROOT/.git/modules/swiperflix-player"`
- `git -C "$ROOT" worktree list`
- `test -d "$ROOT/.git/worktrees/swiperflix-monorepo-conversion"`
- `git -C "$WT" status --short --branch`

**Exact steps**
1. Run `git -C "$ROOT" config --get-regexp '^submodule\.'`.
2. Run `test ! -d "$ROOT/.git/modules/swiperflix-gateway"`.
3. Run `test ! -d "$ROOT/.git/modules/swiperflix-player"`.
4. Run `git -C "$ROOT" worktree list`.
5. Run `test -d "$ROOT/.git/worktrees/swiperflix-monorepo-conversion"`.
6. Run `git -C "$WT" status --short --branch`.

**Expected result**
- Step 1 prints nothing and exits non-zero because no `submodule.*` keys remain.
- Steps 2 and 3 exit `0`.
- Step 4 still lists both the root worktree and `/Users/liqing/Documents/PersonalProjects/My_Proj/swiperflix-monorepo-conversion`.
- Step 5 exits `0`, proving the linked-worktree admin directory still exists.
- Step 6 succeeds and reports the active branch for the task worktree, expected as `## chore/convert-superrepo-to-monorepo` or equivalent branch-tracking status.
- If Step 4, Step 5, or Step 6 fails, stop immediately because the shared metadata cleanup damaged worktree state.

### 6. Run Final Verification
After tracked conversion and shared metadata cleanup, rerun all final green checks.

Required verification:
```bash
ROOT=/Users/liqing/Documents/PersonalProjects/My_Proj/swiperflix
WT=/Users/liqing/Documents/PersonalProjects/My_Proj/swiperflix-monorepo-conversion

git -C "$WT" ls-files -s | grep '^160000 '
git -C "$ROOT" config --get-regexp '^submodule\.'
test ! -e "$WT/.gitmodules"
test ! -e "$WT/swiperflix-gateway/.git"
test ! -d "$WT/swiperflix-gateway/.git"
test ! -e "$WT/swiperflix-player/.git"
test ! -d "$WT/swiperflix-player/.git"
test ! -d "$ROOT/.git/modules/swiperflix-gateway"
test ! -d "$ROOT/.git/modules/swiperflix-player"

cd "$WT/swiperflix-player" && pnpm build && pnpm lint
cd "$WT/swiperflix-gateway" && python -m compileall app
```

#### Task 6 QA
**Tools/commands**
- `git -C "$WT" ls-files -s | grep '^160000 '`
- `git -C "$ROOT" config --get-regexp '^submodule\.'`
- `test ! -e "$WT/.gitmodules"`
- `test ! -e "$WT/swiperflix-gateway/.git"`
- `test ! -d "$WT/swiperflix-gateway/.git"`
- `test ! -e "$WT/swiperflix-player/.git"`
- `test ! -d "$WT/swiperflix-player/.git"`
- `test ! -d "$ROOT/.git/modules/swiperflix-gateway"`
- `test ! -d "$ROOT/.git/modules/swiperflix-player"`
- `git -C "$WT" grep -nE '\.gitmodules|submodule|submodules|--recurse-submodules|git submodule' -- README.md AGENTS.md docs/ARCHITECTURE.md docs/DEPLOYMENT_GUIDE.md .github/workflows`
- `cd "$WT/swiperflix-player" && pnpm build`
- `test -d "$WT/swiperflix-player/dist"`
- `cd "$WT/swiperflix-player" && pnpm lint`
- `cd "$WT/swiperflix-gateway" && python -m compileall app`
- `git -C "$WT" diff --quiet -- README.md AGENTS.md docs/ARCHITECTURE.md docs/DEPLOYMENT_GUIDE.md .github/workflows swiperflix-player swiperflix-gateway`

**Exact steps**
1. Run `git -C "$WT" ls-files -s | grep '^160000 '`. 
2. Run `git -C "$ROOT" config --get-regexp '^submodule\.'`.
3. Run `test ! -e "$WT/.gitmodules"`.
4. Run `test ! -e "$WT/swiperflix-gateway/.git"`.
5. Run `test ! -d "$WT/swiperflix-gateway/.git"`.
6. Run `test ! -e "$WT/swiperflix-player/.git"`.
7. Run `test ! -d "$WT/swiperflix-player/.git"`.
8. Run `test ! -d "$ROOT/.git/modules/swiperflix-gateway"`.
9. Run `test ! -d "$ROOT/.git/modules/swiperflix-player"`.
10. Run `git -C "$WT" grep -nE '\.gitmodules|submodule|submodules|--recurse-submodules|git submodule' -- README.md AGENTS.md docs/ARCHITECTURE.md docs/DEPLOYMENT_GUIDE.md .github/workflows`.
11. Run `cd "$WT/swiperflix-player" && pnpm build`.
12. Run `test -d "$WT/swiperflix-player/dist"`.
13. Run `cd "$WT/swiperflix-player" && pnpm lint`.
14. Run `cd "$WT/swiperflix-gateway" && python -m compileall app`.
15. Run `git -C "$WT" diff --quiet -- README.md AGENTS.md docs/ARCHITECTURE.md docs/DEPLOYMENT_GUIDE.md .github/workflows swiperflix-player swiperflix-gateway`.

**Expected result**
- Step 1 prints nothing and exits with status `1`, proving there are no `160000` entries left.
- Step 2 prints nothing and exits with status `1`, proving there is no remaining `submodule.*` config.
- Steps 3 through 9 all exit with status `0`.
- Step 10 prints nothing and exits with status `1`, proving the planned conversion surfaces no longer contain submodule-era wording.
- Step 11 exits with status `0`.
- Step 12 exits with status `0`.
- Step 13 exits with status `0`.
- Step 14 exits with status `0`.
- Step 15 exits with status `0`, proving the final QA commands did not introduce additional unstaged tracked-file modifications in the converted repo.
- Final pass criteria: every command above must match the expected exit status and output exactly; any deviation is a failed final verification.

## File-Level Edit Map

| Path | Required action |
| --- | --- |
| `.gitmodules` | Delete |
| `README.md` | Rewrite repo layout, clone/setup, update, and license wording to remove all submodule assumptions |
| `AGENTS.md` | Rewrite repo description, structure, conventions, and commands to remove submodule assumptions |
| `docs/ARCHITECTURE.md` | Rewrite repo-topology text and remove submodule-era decision framing |
| `docs/DEPLOYMENT_GUIDE.md` | Rewrite repository setup and CI wording to plain monorepo checkout |
| `.github/workflows/build-images.yml` | Remove `submodules: recursive`; rename checkout step to standard checkout wording |
| `.github/workflows/cleanup.yml` | Audit only; no functional change expected |
| `swiperflix-gateway/README.md` | Normalize wording if standalone-repo phrasing becomes misleading in the monorepo |
| `swiperflix-player/README.md` | Audit only |
| `swiperflix-gateway/AGENTS.md` | Audit only |
| `swiperflix-player/AGENTS.md` | Audit only |

## Risks and Rollback Notes

### Shared metadata risk
- `.git/config` and `.git/modules/*` are shared across worktrees.
- Cleanup there affects both `/Users/liqing/Documents/PersonalProjects/My_Proj/swiperflix` and `/Users/liqing/Documents/PersonalProjects/My_Proj/swiperflix-monorepo-conversion`.

### Nested git metadata risk
- The service directories currently use `.git` pointer files.
- If either service contains an embedded `.git/` directory instead of only a pointer file at execution time, that must also be removed or the directory will remain an independent repo.
- Verification must check for both `.git` file and `.git/` directory absence.

### Import fidelity risk
- If the nested repo HEADs do not match the indexed SHAs, the conversion could vendor the wrong content.
- The SHA checks are mandatory before replacing gitlinks.

### Rollback boundary
- Before deleting `.git/modules/*`, rollback is straightforward because tracked conversion can still be reversed from Git history and staged state.
- After deleting `.git/modules/*`, rollback is no longer fully represented in Git history because the deleted module metadata is outside the tracked tree.
- For safe execution, keep the exact source SHAs and only remove `.git/modules/*` after all tracked verification has passed.

## Definition of Done
- `swiperflix-gateway/` and `swiperflix-player/` are tracked as normal content.
- no `160000` gitlinks remain.
- no `.gitmodules` file remains.
- no `submodule.*` config remains.
- no nested `.git` file or directory remains in either service directory.
- no `.git/modules/swiperflix-*` directories remain.
- player build and lint pass.
- gateway syntax validation passes.
- root docs and CI no longer mention or depend on submodules.
