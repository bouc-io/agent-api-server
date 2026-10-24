---
id: planner.tool-list
title: Planner valid tool_intent list
version: 1
stage: planner
role: fragment
variables: [toolList]
note: Appended to planner.system when tools are available. Caller prepends two newlines. The names here are generated from the live registry, but planner.system's few-shot examples hardcode tool names, so the two can contradict each other when a tool is disabled.
---
VALID tool_intent values (use ONLY these exact names or null):
{{toolList}}
