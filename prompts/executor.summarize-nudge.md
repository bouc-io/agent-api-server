---
id: executor.summarize-nudge
title: Executor forced-summarization nudge
version: 1
stage: executor
role: user
note: Sent when the model returns neither content nor tool calls but tool results exist. The call deliberately omits tools so the model cannot make further tool calls and must produce text.
---
Based on the tool results above, provide a complete and clear response to the user. If additional tool calls are still needed to fulfill the request, make them now.
