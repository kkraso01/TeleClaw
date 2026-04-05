# OnCallDev Docker runtime provider

TeleClaw now supports a real Docker-backed runtime provider.

## Container identity

Each project maps to one deterministic container name:

- `teleclaw-<normalized-project-id>`
- normalization is lowercase slug-safe text

The runtime provider inspects by stored `containerId`, stored `containerName`, then deterministic name fallback.

## Runtime lifecycle operations

The Docker provider supports:

- inspect runtime container
- create runtime when missing
- start stopped runtime
- stop runtime
- restart runtime
- validate runtime attachability (`running` + container id)

## Image selection

Images are selected from runtime family, not user text:

- `python` -> `TELECLAW_DOCKER_IMAGE_PYTHON`
- `node` -> `TELECLAW_DOCKER_IMAGE_NODE`
- `generic` -> `TELECLAW_DOCKER_IMAGE_GENERIC`

Runtime family is inferred from explicit project metadata first, then workspace hints.

## Config

- `CONTAINER_RUNTIME=docker` or `TELECLAW_DOCKER_ENABLED=1`
- `TELECLAW_DOCKER_NETWORK`
- `TELECLAW_DOCKER_IMAGE_PYTHON`
- `TELECLAW_DOCKER_IMAGE_NODE`
- `TELECLAW_DOCKER_IMAGE_GENERIC`

## Limitations

- Provider currently uses Docker CLI calls (`docker inspect/create/start/stop/restart`).
- Health checks are process-state checks; app-level probes are still TODO.
- OpenHands adapter receives runtime binding context, but not every external worker backend guarantees strict container pinning yet.
