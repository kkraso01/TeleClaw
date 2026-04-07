# OnCallDev container deployment audit

## Audit date

April 7, 2026.

## Current container path before this change

- Main image build used the repo `Dockerfile` multi-stage flow.
- Runtime image copied `dist`, `node_modules`, `extensions`, `skills`, and `docs` into `/app`.
- Runtime image did **not** copy `vendor/openhands`.
- Runtime image did **not** guarantee Python availability.
- `OPENHANDS_MODE` default is `vendor_local`, so runtime default and image contents were inconsistent.

## Confirmed packaging gaps

1. Vendored OpenHands source missing in runtime image.
2. OpenHands local Python execution path missing Python runtime and package install.
3. Bridge default vendor path (`vendor/openhands`) could break when runtime cwd was not repo root.
4. Compose defaults did not expose TeleClaw/OpenHands container-aware env values.
5. Readiness checks did not validate vendored OpenHands path + Python binary.
6. Operator docs were local-first and did not clearly state container assumptions for mounted models.

## Packaging approach implemented

- Runtime image now copies `vendor/openhands` to `/app/vendor/openhands`.
- Runtime image now installs `python3`, `python3-pip`, and `python3-venv`.
- Runtime image now installs vendored OpenHands into Python (`pip install -e /app/vendor/openhands`) by default.
- Bridge config now uses container-safe fallback path `/app/vendor/openhands` when needed.
- Bridge startup now validates vendored OpenHands path and reports a direct fix if missing.
- Doctor now validates `OPENHANDS_VENDOR_PATH` and `OPENHANDS_PYTHON_BIN` for `vendor_local` mode.
- Compose now includes TeleClaw/OpenHands defaults and mount points for `/workspace` and `/models`.

## Voice packaging policy

- `whisper.cpp` and `piper` binaries are **not baked into** the main image by default.
- Operator should mount models and provide binaries (or custom image variant).
- Safe text fallback behavior remains intact when voice binaries are unavailable.

## Practical startup (container)

1. Build:
   - `pnpm teleclaw:docker:build`
2. Provide env in `.env` (Telegram token, TeleClaw/OpenHands vars).
3. Start:
   - `pnpm teleclaw:docker:up`
4. Check:
   - `docker compose exec openclaw-gateway node --import tsx scripts/teleclaw-doctor.ts`
5. Monitor:
   - `pnpm teleclaw:docker:logs`
