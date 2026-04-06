import type { OpenClawConfig } from "../../config/config.js";
import { createOnCallRouter } from "../../teleclaw/index.js";
import type { DispatchInboundResult } from "../dispatch.js";
import {
  dispatchInboundMessageWithBufferedDispatcher,
  dispatchInboundMessageWithDispatcher,
} from "../dispatch.js";
import type { FinalizedMsgContext, MsgContext } from "../templating.js";
import type { ReplyPayload } from "../types.js";
import type { GetReplyOptions } from "../types.js";
import type {
  ReplyDispatcherOptions,
  ReplyDispatcherWithTypingOptions,
} from "./reply-dispatcher.js";

const onCallRouter = createOnCallRouter();

function isOnCallDevEnabled() {
  return process.env.ONCALLDEV_ENABLED === "1";
}

function isTelegramContext(ctx: MsgContext | FinalizedMsgContext) {
  return ctx.OriginatingChannel === "telegram" || ctx.Provider === "telegram";
}

async function maybeDispatchOnCallDev(params: {
  ctx: MsgContext | FinalizedMsgContext;
  dispatcherOptions: ReplyDispatcherWithTypingOptions;
}): Promise<DispatchInboundResult | null> {
  if (!isOnCallDevEnabled() || !isTelegramContext(params.ctx)) {
    return null;
  }

  const userId = params.ctx.SenderId ?? params.ctx.From ?? "telegram-user";
  const body = params.ctx.BodyForCommands ?? params.ctx.CommandBody ?? params.ctx.Body;
  const hasVoiceAttachment =
    params.ctx.MediaType?.startsWith("audio/") === true ||
    params.ctx.MediaTypes?.some((mediaType) => mediaType.startsWith("audio/")) === true;
  if (!body?.trim() && !hasVoiceAttachment) {
    return null;
  }

  const response = hasVoiceAttachment
    ? await onCallRouter.processVoiceInbound({
        channel: "telegram",
        body: params.ctx.Transcript ?? "",
        userId,
        sessionKey: params.ctx.SessionKey,
        transcript: params.ctx.Transcript,
        audioUrl: params.ctx.MediaUrl ?? params.ctx.MediaUrls?.[0],
        timestampMs: Date.now(),
      })
    : await onCallRouter.processInbound({
        channel: "telegram",
        body: body ?? "",
        userId,
        sessionKey: params.ctx.SessionKey,
        transcript: params.ctx.Transcript,
        timestampMs: Date.now(),
      });

  const payload: ReplyPayload = {
    text: response.text,
    audioAsVoice: response.replyMode === "voice" && Boolean(response.voiceReply?.mediaUrl),
    mediaUrl: response.voiceReply?.mediaUrl,
  };
  await params.dispatcherOptions.deliver(payload, { kind: "final" });

  return {
    queuedFinal: true,
    counts: {
      tool: 0,
      block: 0,
      final: 1,
    },
  };
}

export async function dispatchReplyWithBufferedBlockDispatcher(params: {
  ctx: MsgContext | FinalizedMsgContext;
  cfg: OpenClawConfig;
  dispatcherOptions: ReplyDispatcherWithTypingOptions;
  replyOptions?: Omit<GetReplyOptions, "onToolResult" | "onBlockReply">;
  replyResolver?: typeof import("../reply.js").getReplyFromConfig;
}): Promise<DispatchInboundResult> {
  const onCallResult = await maybeDispatchOnCallDev({
    ctx: params.ctx,
    dispatcherOptions: params.dispatcherOptions,
  });
  if (onCallResult) {
    return onCallResult;
  }

  return await dispatchInboundMessageWithBufferedDispatcher({
    ctx: params.ctx,
    cfg: params.cfg,
    dispatcherOptions: params.dispatcherOptions,
    replyResolver: params.replyResolver,
    replyOptions: params.replyOptions,
  });
}

export async function dispatchReplyWithDispatcher(params: {
  ctx: MsgContext | FinalizedMsgContext;
  cfg: OpenClawConfig;
  dispatcherOptions: ReplyDispatcherOptions;
  replyOptions?: Omit<GetReplyOptions, "onToolResult" | "onBlockReply">;
  replyResolver?: typeof import("../reply.js").getReplyFromConfig;
}): Promise<DispatchInboundResult> {
  return await dispatchInboundMessageWithDispatcher({
    ctx: params.ctx,
    cfg: params.cfg,
    dispatcherOptions: params.dispatcherOptions,
    replyResolver: params.replyResolver,
    replyOptions: params.replyOptions,
  });
}
