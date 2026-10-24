/**
 * POST /v1/chats/:chatId/stream — the chat turn, streamed.
 *
 * This is the one endpoint whose wire format is load-bearing: monochrome-chatbot-ui reads
 * SSE off this same POST response, so the event names, their order and the payload keys
 * are a contract with a UI that is not changing. See useChatStream.ts in that repo.
 *
 * Sequence: user_message.created -> run.status -> (message.token |
 * message.thinking_token)* -> message.created -> run.completed. Failures before the
 * headers go out are plain JSON with a non-2xx status, which is what the UI's
 * `response.ok` check expects; after that they are a run.failed event.
 *
 * It streams synchronously rather than going through the run worker. See chatTurn.ts for
 * why. The Run row is still written, so usage, metrics and promptset provenance work.
 */

import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { getUserContextFromRequest } from "../lib/auth";
import { createComponentLogger } from "../lib/logger";
import {
  chatStreamDisconnectsTotal,
  llmTokensTotal,
  runDuration,
  runsTotal,
} from "../lib/promMetrics";
import {
  createLLMClientFromConfig,
  fetchAssignmentConfig,
} from "../services/llm/assignmentConfigClient";
import { isStreamingClient } from "../types/llm";
import { CHAT_SURFACE } from "./chatShared";
import {
  abandonChatRun,
  buildChatTurn,
  completeChatRun,
  openChatRun,
} from "../services/chat/chatTurn";
import { maybeDistillChat } from "../services/chat/distillation";

const log = createComponentLogger("chat-stream-controller");

const SSE_HEARTBEAT_MS = parseInt(process.env.SSE_HEARTBEAT_MS || "15000", 10);

/** Write one SSE event. The chatbot did not inject a `type` key, so neither do we. */
function sendEvent(res: Response, event: string, data: unknown): void {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export const streamChat = async (req: Request, res: Response) => {
  const ctx = getUserContextFromRequest(req);
  if (!ctx) {
    return res.status(401).json({ error: "Unauthorized: User ID missing" });
  }

  const chatId = String(req.params.chatId);
  const { content, think } = req.body as { content?: string; think?: boolean };

  if (!content) {
    return res.status(400).json({ error: "content is required" });
  }

  // ---- everything below the headers is SSE; everything above is plain JSON ----

  const chat = await prisma.assignment.findUnique({
    where: { id: chatId },
    select: {
      id: true,
      user_id: true,
      surface: true,
      last_distilled_at: true,
      distilled_message_count: true,
    },
  });
  if (!chat || chat.surface !== CHAT_SURFACE) {
    return res.status(404).json({ error: "Chat not found" });
  }
  if (chat.user_id !== ctx.userId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  // Resolve the provider before anything is persisted, so a non-streaming client is a
  // clean pre-stream error rather than a half-open stream.
  const assignmentConfig = ctx.accessToken
    ? await fetchAssignmentConfig("chatbot", ctx.accessToken).catch((err) => {
        log.warn({ err }, "Assignment config fetch failed, using env fallback");
        return null;
      })
    : null;
  const client = createLLMClientFromConfig(assignmentConfig);
  if (!isStreamingClient(client)) {
    log.error(
      { provider: assignmentConfig?.provider },
      "Resolved LLM client cannot stream",
    );
    return res
      .status(503)
      .json({ error: "Configured LLM provider does not support streaming" });
  }
  const resolvedModel =
    assignmentConfig?.model ?? process.env.OLLAMA_MODEL ?? "unknown";

  let userMessageId: string;
  try {
    const saved = await prisma.message.create({
      data: { assignment_id: chatId, role: "user", content },
      select: { id: true },
    });
    userMessageId = saved.id;
  } catch (error) {
    log.error({ err: error }, "Failed to save user message");
    return res.status(500).json({ error: "Failed to save message" });
  }

  let turn;
  try {
    turn = await buildChatTurn({
      prisma,
      chatId,
      userId: ctx.userId,
      content,
      excludeMessageId: userMessageId,
      accessToken: ctx.accessToken,
    });
  } catch (error) {
    log.error({ err: error }, "Failed to assemble chat turn");
    return res.status(500).json({ error: "Failed to prepare response" });
  }

  const run = await openChatRun(prisma, {
    chatId,
    userId: ctx.userId,
    orgId: ctx.orgId,
    triggerMessageId: userMessageId,
    modelName: resolvedModel,
    memoriesCount: turn.memoriesCount,
  });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  // Without this, a buffering proxy holds the whole stream until it closes.
  res.setHeader("X-Accel-Buffering", "no");
  req.socket?.setTimeout(0);

  // The chatbot had no heartbeat. The UI's parser skips a ":"-prefixed line, so this is
  // additive, and it keeps a long wait for the first token from looking like a dead
  // connection to anything in between.
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": keepalive\n\n");
  }, SSE_HEARTBEAT_MS);

  let clientGone = false;
  req.on("close", () => {
    clientGone = true;
  });

  sendEvent(res, "user_message.created", { message_id: userMessageId });
  sendEvent(res, "run.status", { status: "running" });

  let fullResponse = "";
  let savedThinking = "";
  let promptTokens = 0;
  let completionTokens = 0;

  try {
    await client.chatStream(
      turn.messages,
      {
        onToken: (token) => {
          if (clientGone) return;
          fullResponse += token;
          sendEvent(res, "message.token", { token });
        },
        onThinkingToken: (token) => {
          if (clientGone) return;
          sendEvent(res, "message.thinking_token", { token });
        },
        onDone: (usage) => {
          promptTokens = usage.prompt_tokens;
          completionTokens = usage.completion_tokens;
          if (usage.thinking) savedThinking = usage.thinking;
        },
      },
      { think: think !== undefined ? Boolean(think) : undefined },
    );
  } catch (error) {
    clearInterval(heartbeat);
    const message = error instanceof Error ? error.message : "Stream failed";
    log.error({ err: error, chat_id: chatId }, "Chat stream failed");
    await abandonChatRun(prisma, run.id, "failed", message).catch(() => {});
    runsTotal.inc({ status: "failed" });
    sendEvent(res, "run.failed", { error: message });
    return res.end();
  }

  clearInterval(heartbeat);

  // A client that vanished mid-stream leaves its user message with no reply, exactly as
  // chatbot-api-server did. The UI's resubmit flow is how a user recovers.
  if (clientGone) {
    log.info({ chat_id: chatId }, "Client disconnected, discarding answer");
    await abandonChatRun(prisma, run.id, "cancelled").catch(() => {});
    runsTotal.inc({ status: "cancelled" });
    chatStreamDisconnectsTotal.inc();
    return;
  }

  // The <think> wrapper is load-bearing: ChatMessage.tsx parses it back out of stored
  // content to render the collapsible reasoning block on reload.
  const finalContent = savedThinking
    ? `<think>${savedThinking}</think>\n\n${fullResponse}`
    : fullResponse;
  const totalTokens = promptTokens + completionTokens;

  let assistantMessageId = "";
  try {
    const assistant = await prisma.message.create({
      data: {
        assignment_id: chatId,
        role: "assistant",
        content: finalContent,
        metadata: { model_name: resolvedModel },
        provenance: { run_id: run.id },
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
      },
      select: { id: true },
    });
    assistantMessageId = assistant.id;
  } catch (error) {
    log.error({ err: error }, "Failed to save assistant message");
  }

  await completeChatRun(prisma, run.id, {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
  }).catch((err) => log.error({ err }, "Failed to close chat run"));

  runsTotal.inc({ status: "completed" });
  runDuration.observe((Date.now() - run.startedAt.getTime()) / 1000);
  if (promptTokens) llmTokensTotal.inc({ kind: "prompt" }, promptTokens);
  if (completionTokens) {
    llmTokensTotal.inc({ kind: "completion" }, completionTokens);
  }

  sendEvent(res, "message.created", {
    role: "assistant",
    content: finalContent,
    message_id: assistantMessageId,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    model_name: resolvedModel,
  });
  sendEvent(res, "run.completed", {});
  res.end();

  // After the response: never let distillation delay or fail a turn.
  await maybeDistillChat(prisma, chat, ctx.userId, ctx.accessToken).catch(
    (err) => log.error({ err, chat_id: chatId }, "Distillation check failed"),
  );
};
