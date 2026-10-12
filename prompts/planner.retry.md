---
id: planner.retry
title: Planner retry system prompt (simplified)
version: 1
stage: planner
role: system
note: Used only when the first planner response fails to parse. Sent with just the last user/assistant turn, no tool list and no examples.
---
Output JSON only: {"goal":"...","steps":[{"id":1,"description":"...","tool_intent":"tool_name or null"}]}
