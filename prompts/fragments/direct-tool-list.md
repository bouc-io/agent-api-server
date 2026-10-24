---
id: frag.direct-tool-list
title: Zero-step direct available-tools block
version: 1
stage: direct
role: fragment
variables: [toolList]
note: Caller prepends one newline. Diverges from frag.executor-tool-list in both header wording and the trailing capability instruction.
---
Available tools you can use in multi-step tasks:
{{toolList}}
If asked what tools or capabilities you have, list these by name. Never claim you lack access to a tool that appears in this list.
