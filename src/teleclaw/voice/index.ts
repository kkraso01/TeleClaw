export type OnCallVoiceService = {
  speechToText: (audioUrl: string) => Promise<string>;
  textToSpeech: (text: string) => Promise<{ mediaUrl: string }>;
};

export function createOnCallVoiceService(): OnCallVoiceService {
  return {
    async speechToText(audioUrl) {
      // MVP: keep voice conversion outside worker runtime.
      return `transcript unavailable for ${audioUrl}`;
    },
    async textToSpeech(_text) {
      throw new Error("tts not configured");
    },
  };
}
