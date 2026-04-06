import { spawn } from "node:child_process";
import type { OnCallVoiceTranscriptResult } from "../../types.js";

const PYTHON_TRANSCRIBE_SCRIPT = String.raw`
import argparse
import json
import os
import tempfile
import urllib.request
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--audio", required=True)
parser.add_argument("--model", required=True)
parser.add_argument("--device", required=True)
parser.add_argument("--compute-type", required=True)
parser.add_argument("--language", default="")
parser.add_argument("--beam-size", type=int, default=5)
parser.add_argument("--vad-filter", action="store_true")
args = parser.parse_args()

audio_input = args.audio
cleanup_path = None

def resolve_audio_path(value: str) -> str:
    global cleanup_path
    if value.startswith("http://") or value.startswith("https://"):
        suffix = Path(value).suffix or ".audio"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            with urllib.request.urlopen(value, timeout=20) as response:
                tmp.write(response.read())
            cleanup_path = tmp.name
            return tmp.name
    if value.startswith("file://"):
        return value[len("file://") :]
    return value

audio_path = resolve_audio_path(audio_input)

try:
    from faster_whisper import WhisperModel

    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
    segments, info = model.transcribe(
        audio_path,
        beam_size=args.beam_size,
        vad_filter=args.vad_filter,
        language=(args.language if args.language else None),
    )

    seg_list = list(segments)
    text = " ".join((s.text or "").strip() for s in seg_list if (s.text or "").strip()).strip()
    segment_count = len(seg_list)
    avg_log_prob = None
    no_speech_prob = None

    if segment_count:
        avg_values = [getattr(s, "avg_logprob", None) for s in seg_list if getattr(s, "avg_logprob", None) is not None]
        if avg_values:
            avg_log_prob = sum(avg_values) / len(avg_values)
        no_speech_values = [getattr(s, "no_speech_prob", None) for s in seg_list if getattr(s, "no_speech_prob", None) is not None]
        if no_speech_values:
            no_speech_prob = sum(no_speech_values) / len(no_speech_values)

    payload = {
        "text": text,
        "language": getattr(info, "language", None),
        "duration": getattr(info, "duration", None),
        "duration_after_vad": getattr(info, "duration_after_vad", None),
        "avg_logprob": avg_log_prob,
        "no_speech_prob": no_speech_prob,
        "segment_count": segment_count,
    }
    print(json.dumps(payload))
except Exception as exc:
    print(json.dumps({"error": str(exc)}))
    raise
finally:
    if cleanup_path and os.path.exists(cleanup_path):
        try:
            os.remove(cleanup_path)
        except OSError:
            pass
`;

type FasterWhisperProviderConfig = {
  pythonBin: string;
  model: string;
  device: string;
  computeType: string;
  language?: string;
  beamSize: number;
  vadFilter: boolean;
  timeoutMs: number;
  minConfidence: number;
};

type PythonOutput = {
  text?: string;
  language?: string | null;
  duration?: number | null;
  duration_after_vad?: number | null;
  avg_logprob?: number | null;
  no_speech_prob?: number | null;
  segment_count?: number;
};

export type FasterWhisperRunner = (input: {
  command: string;
  args: string[];
  timeoutMs: number;
}) => Promise<{ stdout: string; stderr: string }>;

function defaultRunner(input: {
  command: string;
  args: string[];
  timeoutMs: number;
}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`stt_timeout_after_${input.timeoutMs}ms`));
    }, input.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr.trim() || `faster-whisper exited with code ${code ?? "unknown"}`));
    });
  });
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function confidenceFromSignals(output: PythonOutput): number | null {
  if (typeof output.avg_logprob !== "number" || !Number.isFinite(output.avg_logprob)) {
    return null;
  }

  // Whisper avg_logprob is commonly around -0.2 (better) to below -1.0 (worse).
  const logProbScore = clampConfidence((output.avg_logprob + 1.6) / 1.6);
  const noSpeechPenalty =
    typeof output.no_speech_prob === "number" && Number.isFinite(output.no_speech_prob)
      ? clampConfidence(1 - output.no_speech_prob)
      : 1;
  return clampConfidence(logProbScore * noSpeechPenalty);
}

export async function transcribeWithFasterWhisper(
  input: {
    audioUrl: string;
  },
  config: FasterWhisperProviderConfig,
  runner: FasterWhisperRunner = defaultRunner,
): Promise<OnCallVoiceTranscriptResult> {
  const args = [
    "-c",
    PYTHON_TRANSCRIBE_SCRIPT,
    "--audio",
    input.audioUrl,
    "--model",
    config.model,
    "--device",
    config.device,
    "--compute-type",
    config.computeType,
    "--beam-size",
    String(config.beamSize),
  ];

  if (config.language?.trim()) {
    args.push("--language", config.language.trim());
  }
  if (config.vadFilter) {
    args.push("--vad-filter");
  }

  const { stdout } = await runner({
    command: config.pythonBin,
    args,
    timeoutMs: config.timeoutMs,
  });

  const parsed = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as PythonOutput & {
    error?: string;
  };

  if (parsed.error) {
    throw new Error(parsed.error);
  }

  const confidence = confidenceFromSignals(parsed);
  const text = parsed.text?.trim() ?? "";
  const weakByConfidence = typeof confidence === "number" && confidence < config.minConfidence;

  return {
    text,
    provider: "faster-whisper",
    metadata: {
      language: parsed.language ?? null,
      durationSeconds: parsed.duration ?? null,
      durationAfterVadSeconds: parsed.duration_after_vad ?? null,
      segmentCount: parsed.segment_count ?? 0,
      avgLogprob: parsed.avg_logprob ?? null,
      noSpeechProb: parsed.no_speech_prob ?? null,
      confidence,
      quality: !text ? "missing" : weakByConfidence ? "low" : "high",
    },
  };
}
