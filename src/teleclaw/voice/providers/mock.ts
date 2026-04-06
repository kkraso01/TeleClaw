import type { OnCallVoiceTranscriptResult } from "../../types.js";

export async function transcribeWithMockProvider(input: {
  providerName: string;
  configuredProvider?: string;
  hasApiKey?: boolean;
  reason: string;
}): Promise<OnCallVoiceTranscriptResult> {
  return {
    text: "",
    provider: input.providerName,
    metadata: {
      configuredProvider: input.configuredProvider ?? null,
      hasApiKey: Boolean(input.hasApiKey),
      quality: "missing",
      reason: input.reason,
    },
  };
}
