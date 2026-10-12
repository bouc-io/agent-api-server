---
id: direct.system
title: Zero-step direct response system prompt
version: 1
stage: direct
role: system
variables: [instructionPrefix, now, knowledgeSuffix, noParrotRule, completionInstruction, toolList]
note: >
  Used when the planner returns an empty steps array, which skips the executor entirely
  and answers in one LLM call. This is the most common path for conversational turns, yet
  it carries no FORMATTING rule, no ASSUMPTIONS rule and no SECURITY block, so a zero-step
  answer can return LaTeX while an executor answer cannot. Preserved exactly; aligning it
  with executor.system is a behaviour change and a separate follow-up.
---
/no_think
{{instructionPrefix}}Current date/time: {{now}}
You are a helpful assistant.
{{knowledgeSuffix}}{{noParrotRule}}
{{completionInstruction}}{{toolList}}
