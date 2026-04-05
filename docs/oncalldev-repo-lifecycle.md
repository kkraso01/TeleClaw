# OnCallDev repo lifecycle

TeleClaw tracks repository state per project workspace.

## Repository inspection behavior

For each inspection, TeleClaw records:

- Whether git is available
- Whether the workspace is a git repository
- Current branch
- Clean/dirty/error status

## Repo state fields

- `repoStatus`: `missing` | `present` | `dirty` | `clean` | `error`
- `branch`
- `lastRepoSyncAt`
- `repoError`

## Lifecycle events

TeleClaw persists repo lifecycle events into memory:

- `repo.cloned`
- `repo.initialized`
- `repo.inspected`
- `repo.sync_requested`

## Intentional scope

Repo operations are narrow and explicit for this milestone:

- inspect
- clone
- init

Arbitrary git command execution remains out of scope.
