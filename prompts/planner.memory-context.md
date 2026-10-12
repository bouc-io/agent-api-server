---
id: planner.memory-context
title: Planner memory-context examples (appended when memories are present)
version: 1
stage: planner
role: fragment
note: Appended to planner.system only when memories were retrieved. These two examples exist to counteract confusion caused by injecting the knowledge suffix into the planner at all. Caller prepends two newlines.
---
[USER PROFILE and KNOWN FACTS are already injected into the executor context]
User: "what's my name?"
{"goal":"Answer from injected context","steps":[]}

User: "do you know my food preferences?"
{"goal":"Report food preferences from context","steps":[]}
