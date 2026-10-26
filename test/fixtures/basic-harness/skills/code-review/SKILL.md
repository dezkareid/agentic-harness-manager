---
name: code-review
description: Review a diff for correctness bugs before opening a pull request.
metadata:
  version: "1.0.0"
---

# Code review

Read `references/checklist.md`, then review the diff.

<!-- ahm:tag:claude-code -->
Use the `Grep` and `Read` tools to inspect call sites.
<!-- /ahm:tag -->
<!-- ahm:tag:codex,antigravity -->
Use shell search (`rg`) to inspect call sites.
<!-- /ahm:tag -->
<!-- ahm:omit -->
Maintainer note: keep this skill under 200 lines.
<!-- /ahm:omit -->
<!-- ahm:only:strands --> Return findings as a JSON list.
