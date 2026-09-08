# V220 Voice Page Navigation / No Multi Recognition

- Explicit phrases such as “切换到收入页面 / 进入支出页面” now plan `NAVIGATE_PAGE` and call the application's canonical `gotoPage()` path, then verify the target page is active.
- Bare “收入 / 支出 / 选择收入” remains a Quick Entry type selector (`SET_ENTRY_TYPE`) rather than application page navigation.
- Automatic quick-voice multi-entry splitting is disabled. No multi-entry recognition prompt, editable batch preview, or “保存全部” prompt is produced.
- Legacy batch-save code remains unreachable only for rollback compatibility; new voice input cannot enter that path.
- Command-like utterances continue to fail closed instead of falling into remarks.

Evidence: V220 gate 12/12 PASS; V218 regression gate 16/16 PASS; JS syntax 156/156 PASS; build/verify PASS; APP_SHELL 191.
