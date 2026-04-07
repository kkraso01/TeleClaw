import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type CheckLevel = "pass" | "warn" | "fail";

type CheckResult = {
  level: CheckLevel;
  label: string;
  detail: string;
};

type EnvCheck = {
  key: string;
  required: boolean;
  recommendation?: string;
};

function readEnvValue(key: string): string | undefined {
  const value = process.env[key];
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function checkCommandOnPath(command: string): boolean {
  const result = spawnSync("bash", ["-lc", `command -v ${command}`], {
    stdio: "ignore",
  });
  return result.status === 0;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function envChecks(): CheckResult[] {
  const checks: EnvCheck[] = [
    { key: "ONCALLDEV_ENABLED", required: true, recommendation: "set to 1" },
    { key: "TELEGRAM_BOT_TOKEN", required: true },
    { key: "OPENHANDS_ENABLED", required: false, recommendation: "defaults to 1" },
    { key: "OPENHANDS_MODE", required: false, recommendation: "vendor_local" },
    { key: "OPENHANDS_ENDPOINT", required: false, recommendation: "http://localhost:3001" },
    {
      key: "OPENHANDS_VENDOR_PATH",
      required: false,
      recommendation: "vendor/openhands or /app/vendor/openhands",
    },
    { key: "OPENHANDS_PYTHON_BIN", required: false, recommendation: "python3" },
    { key: "TELECLAW_DATA_DIR", required: false, recommendation: "~/.openclaw/teleclaw" },
    { key: "PROJECTS_ROOT", required: false, recommendation: "/workspace" },
    { key: "CONTAINER_RUNTIME", required: false, recommendation: "local or docker" },
    { key: "STT_PROVIDER", required: false, recommendation: "whisper.cpp" },
    { key: "STT_WHISPERCPP_BIN", required: false, recommendation: "whisper-cli" },
    { key: "STT_WHISPERCPP_MODEL", required: false },
    { key: "TTS_PROVIDER", required: false, recommendation: "piper" },
    { key: "TTS_PIPER_BIN", required: false, recommendation: "piper" },
    { key: "TTS_PIPER_MODEL", required: false },
    { key: "ENABLE_VOICE_REPLIES", required: false, recommendation: "0 or 1" },
  ];

  return checks.map((check) => {
    const value = readEnvValue(check.key);
    if (value) {
      return {
        level: "pass",
        label: `env:${check.key}`,
        detail: value,
      };
    }
    if (check.required) {
      return {
        level: "fail",
        label: `env:${check.key}`,
        detail: `missing (required; ${check.recommendation ?? "set a value"})`,
      };
    }
    return {
      level: "warn",
      label: `env:${check.key}`,
      detail: `unset (optional${check.recommendation ? `; recommended: ${check.recommendation}` : ""})`,
    };
  });
}

async function dependencyChecks(): Promise<CheckResult[]> {
  const dataDir =
    readEnvValue("TELECLAW_DATA_DIR") ?? path.join(os.homedir(), ".openclaw", "teleclaw");
  const voiceDir =
    readEnvValue("TTS_OUTPUT_DIR") ?? path.join(os.homedir(), ".openclaw", "teleclaw", "voice");

  const whisperBin = readEnvValue("STT_WHISPERCPP_BIN") ?? "whisper-cli";
  const piperBin = readEnvValue("TTS_PIPER_BIN") ?? "piper";
  const openHandsPythonBin = readEnvValue("OPENHANDS_PYTHON_BIN") ?? "python3";
  const openHandsVendorPath =
    readEnvValue("OPENHANDS_VENDOR_PATH") ?? path.resolve("vendor/openhands");
  const openHandsMode = readEnvValue("OPENHANDS_MODE") ?? "vendor_local";
  const whisperModel = readEnvValue("STT_WHISPERCPP_MODEL");
  const piperModel = readEnvValue("TTS_PIPER_MODEL");
  const runtime = readEnvValue("CONTAINER_RUNTIME") ?? "local";

  const checks: CheckResult[] = [
    {
      level: checkCommandOnPath("docker") ? "pass" : runtime === "docker" ? "fail" : "warn",
      label: "binary:docker",
      detail: checkCommandOnPath("docker")
        ? "available on PATH"
        : runtime === "docker"
          ? "missing from PATH while CONTAINER_RUNTIME=docker"
          : "missing from PATH (required only for docker runtime)",
    },
    {
      level: checkCommandOnPath(whisperBin) ? "pass" : "warn",
      label: `binary:${whisperBin}`,
      detail: checkCommandOnPath(whisperBin)
        ? "available on PATH"
        : "not found on PATH (STT falls back to text-safe behavior)",
    },
    {
      level: checkCommandOnPath(piperBin) ? "pass" : "warn",
      label: `binary:${piperBin}`,
      detail: checkCommandOnPath(piperBin)
        ? "available on PATH"
        : "not found on PATH (TTS falls back to text-safe behavior)",
    },
    {
      level: checkCommandOnPath(openHandsPythonBin)
        ? "pass"
        : openHandsMode === "vendor_local"
          ? "fail"
          : "warn",
      label: `binary:${openHandsPythonBin}`,
      detail: checkCommandOnPath(openHandsPythonBin)
        ? "available on PATH"
        : openHandsMode === "vendor_local"
          ? "missing from PATH while OPENHANDS_MODE=vendor_local"
          : "missing from PATH (required only for OPENHANDS_MODE=vendor_local)",
    },
  ];

  checks.push({
    level: (await exists(dataDir)) ? "pass" : "warn",
    label: "path:teleclaw-data-dir",
    detail: `${dataDir}${(await exists(dataDir)) ? " exists" : " missing (created on first write)"}`,
  });

  checks.push({
    level: (await exists(voiceDir)) ? "pass" : "warn",
    label: "path:tts-output-dir",
    detail: `${voiceDir}${(await exists(voiceDir)) ? " exists" : " missing (created by first synthesis)"}`,
  });

  checks.push({
    level:
      openHandsMode === "vendor_local"
        ? (await exists(path.join(openHandsVendorPath, "pyproject.toml")))
          ? "pass"
          : "fail"
        : "warn",
    label: "path:openhands-vendor",
    detail:
      openHandsMode === "vendor_local"
        ? (await exists(path.join(openHandsVendorPath, "pyproject.toml")))
          ? `${openHandsVendorPath} looks valid`
          : `${openHandsVendorPath} missing pyproject.toml (vendored OpenHands not available)`
        : `${openHandsVendorPath} (unused when OPENHANDS_MODE=${openHandsMode})`,
  });

  checks.push({
    level: whisperModel ? ((await exists(whisperModel)) ? "pass" : "fail") : "warn",
    label: "path:whisper-model",
    detail: whisperModel
      ? (await exists(whisperModel))
        ? `${whisperModel} exists`
        : `${whisperModel} missing`
      : "unset (required for local whisper.cpp STT)",
  });

  checks.push({
    level: piperModel ? ((await exists(piperModel)) ? "pass" : "fail") : "warn",
    label: "path:piper-model",
    detail: piperModel
      ? (await exists(piperModel))
        ? `${piperModel} exists`
        : `${piperModel} missing`
      : "unset (required for local piper TTS)",
  });

  return checks;
}

function formatResult(check: CheckResult): string {
  const icon = check.level === "pass" ? "✅" : check.level === "warn" ? "⚠️" : "❌";
  return `${icon} ${check.label} — ${check.detail}`;
}

function summarize(results: CheckResult[]): string {
  const passed = results.filter((entry) => entry.level === "pass").length;
  const warnings = results.filter((entry) => entry.level === "warn").length;
  const failures = results.filter((entry) => entry.level === "fail").length;
  const summary = `Summary: ${passed} pass, ${warnings} warning, ${failures} fail`;
  if (failures > 0) {
    return `${summary}\nNext step: fix ❌ items before daily TeleClaw operation.`;
  }
  if (warnings > 0) {
    return `${summary}\nNext step: optional ⚠️ items can be deferred; voice/runtime paths may use safe fallback.`;
  }
  return `${summary}\nNext step: run \`pnpm teleclaw:smoke\` and execute the Telegram checklist.`;
}

async function main() {
  const results = [...envChecks(), ...(await dependencyChecks())];

  console.log("TeleClaw readiness doctor");
  console.log("=".repeat(28));
  for (const check of results) {
    console.log(formatResult(check));
  }
  console.log("\n" + summarize(results));

  const hasFailures = results.some((entry) => entry.level === "fail");
  if (hasFailures) {
    process.exitCode = 1;
  }
}

await main();
