---
id: replanner.input
title: Re-planner user input template
version: 1
stage: replanner
role: user
variables: [originalUserMessage, goal, completedText, latestObservation, remainingSteps]
---
Original user request: "{{originalUserMessage}}"
Goal: {{goal}}

Completed step results:
{{completedText}}

Latest observation: {{latestObservation}}

Remaining plan steps:
{{remainingSteps}}

Is the remaining plan still valid?
