# OnCallDev workspace bootstrap

TeleClaw bootstraps project workspaces before runtime start.

## Bootstrap flow

1. Validate workspace path against `PROJECTS_ROOT` + `ALLOWED_PROJECT_MOUNTS`
2. Create workspace directory when missing (if bootstrap enabled)
3. Detect runtime family
4. Persist bootstrap outcome into project metadata

## Runtime family detection

Order:

1. project metadata `runtimeFamily`
2. language hints (`py`, `ts`, `js`)
3. workspace file hints:
   - `package.json` -> `node`
   - `pyproject.toml` or `requirements.txt` -> `python`
4. fallback `generic`

## Config

- `TELECLAW_RUNTIME_BOOTSTRAP_ENABLED=1` (default on)
- `PROJECTS_ROOT`
- `ALLOWED_PROJECT_MOUNTS`

## Stored metadata

TeleClaw persists bootstrap metadata per project:

- `workspaceBootstrappedAt`
- `workspaceBootstrapError`
- `runtimeFamily` (when detected)

If bootstrap fails, runtime is marked with an error and worker execution stays blocked by policy/runtime checks.
