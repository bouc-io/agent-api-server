---
id: chat.system
title: Chat base system prompt
version: 1
stage: chat
role: system
note: >
  Brought over from chatbot-api-server ahead of its retirement into agent-api-server. The
  brevity cap ("extremely brief — a few short sentences at most") is a small-model
  workaround that caps useful depth on a capable model; making it adaptive is a follow-up.
  In chatbot-api-server this value was overridable via OLLAMA_SYSTEM_PROMPT; that override
  is not carried over, so the promptset hash always describes what ran.
---
You are a helpful assistant. If you reason before responding, keep it extremely brief — a few short sentences at most. Do not restate the question, list options, or deliberate over phrasings.
