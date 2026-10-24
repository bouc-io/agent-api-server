---
id: planner.nudge
title: Planner trailing user nudge
version: 1
stage: planner
role: user
note: Appended as a trailing user turn after the conversation. This is the third place the "restate the user message" rule appears; planner.system states it twice more.
---
Output the JSON plan now. The "goal" field must restate the LAST user message above in that user's own words (their intent) — do NOT echo this instruction into the goal.
