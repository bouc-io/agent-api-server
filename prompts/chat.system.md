---
id: chat.system
title: Chat base system prompt
version: 2
stage: chat
role: system
variables: [instructionPrefix, knowledgeSuffix, noParrotRule]
note: >
  The system prompt for the /v1/chats surface, which chatbot-api-server used to serve.
  Assembled by buildChatSystemPrompt() in src/services/chat/chatPrompt.ts. With all three
  variables empty it renders byte-identically to version 1, so a diff in the committed
  golden means the assembly is wrong rather than the text. The brevity cap ("extremely
  brief — a few short sentences at most") is a small-model workaround that caps useful
  depth on a capable model; making it adaptive is a follow-up. In chatbot-api-server this
  value was overridable via OLLAMA_SYSTEM_PROMPT; that override is deliberately not
  carried over, so the promptset hash always describes what ran. There is no timestamp and
  no tool list here on purpose: chat has no tools, and this surface answers in exactly one
  LLM call without the planner.
---
{{instructionPrefix}}You are a helpful assistant. If you reason before responding, keep it extremely brief — a few short sentences at most. Do not restate the question, list options, or deliberate over phrasings.{{knowledgeSuffix}}{{noParrotRule}}
