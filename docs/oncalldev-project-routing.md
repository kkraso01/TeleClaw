# OnCallDev project routing

OnCallDev routes Telegram requests into a single safe project context before worker execution.

## Project registry storage

Project metadata is stored in a durable JSON registry. By default it is written to:

- `${TELECLAW_DATA_DIR}/projects.json`

You can override this with `TELECLAW_PROJECTS_STORE_PATH`.

Each project record contains:

- `id`, `name`, and normalized `aliases`
- `workspacePath` and optional `containerId`
- runtime metadata (`language`, `runtimeFamily`, `defaultReplyMode`)
- lifecycle status (`active`, `paused`, `archived`)
- timestamps (`createdAt`, `updatedAt`)

## Project resolution order

For each inbound request, the router resolves project context in this order:

1. explicit project reference in intent text (`project`, `repo`, `workspace`, `switch to`, `continue` patterns)
2. active project for the chat/session
3. recent project fallback from project registry per `chatId`
4. if exactly one project exists, use it
5. otherwise return `needs_clarification`

The router does not silently guess when multiple projects match.

## Project switching rules

- Explicit switch (`switch to billing`) overrides the existing active project.
- Explicitly named project in a task (`continue frontend`) can switch active project.
- No project name uses the active chat project if one is present.
- Ambiguous references return candidate project names and require clarification.

Session project binding is persisted immediately after a successful switch.

## Safety boundaries

- `workspacePath` must stay inside `PROJECTS_ROOT` or `ALLOWED_PROJECT_MOUNTS`.
- Project status must allow execution (`active` only).
- Execution requires a valid project + container binding.
- Worker calls receive resolved project context from the router, not from raw user text.

## Current TODOs

- Move project creation/administration to explicit CLI/API commands.
- Add per-user authorization for project access (current routing is chat-scoped).
- Add stricter fuzzy-matching controls per deployment policy.
