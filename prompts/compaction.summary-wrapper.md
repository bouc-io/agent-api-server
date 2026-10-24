---
id: compaction.summary-wrapper
title: Compaction summary wrapper
version: 1
stage: compaction
role: system
variables: [summaryText]
note: Wraps the compaction summary and re-inserts it into the message list with role "system".
---
Summary of earlier conversation (older turns compacted to save context):
{{summaryText}}
