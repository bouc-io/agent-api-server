---
id: frag.executor-tool-list
title: Executor available-tools block
version: 1
stage: executor
role: fragment
variables: [toolList]
note: Caller prepends two newlines. Tool descriptions come from the DB registry and from connected MCP servers; MCP descriptions are not sanitized before landing in this system prompt, which is a flagged follow-up.
---
Available tools:
{{toolList}}
