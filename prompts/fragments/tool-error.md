---
id: frag.tool-error
title: Tool error observation template
version: 1
stage: executor
role: fragment
variables: [error]
note: Injected as the tool-role observation content when a tool call fails, so the model sees the failure rather than a silent gap.
---
TOOL ERROR: {{error}}. Report this failure to the user. Do NOT make up data.
