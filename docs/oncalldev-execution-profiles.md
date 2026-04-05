# OnCallDev execution profiles

TeleClaw now stores a per-project execution profile that captures run conventions.

## Execution profile fields

- `installCommand`
- `testCommand`
- `lintCommand`
- `buildCommand`
- `runCommand`
- `packageManager`
- `preferredShell`

## Default profiles

TeleClaw initializes defaults from runtime family:

- `python`: `uv sync`, `pytest`
- `node`: `npm install`, `npm test`
- `generic`: safe placeholder commands

You can override defaults through environment variables:

- `TELECLAW_BOOTSTRAP_DEFAULT_RUNTIME`
- `TELECLAW_DEFAULT_PYTHON_INSTALL_COMMAND`
- `TELECLAW_DEFAULT_PYTHON_TEST_COMMAND`
- `TELECLAW_DEFAULT_NODE_INSTALL_COMMAND`
- `TELECLAW_DEFAULT_NODE_TEST_COMMAND`

## Worker lifecycle integration

Execution now tracks coarse phases and state updates:

- planning
- implementing
- testing
- summarizing/reporting

Structured state captures install/test/build status plus summary/blocker hints.
