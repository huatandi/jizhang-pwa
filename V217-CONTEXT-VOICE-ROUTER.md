# V217 Context Voice Router

- Quick-entry closed-vocabulary repair for ASR homophones, scoped only to known controls.
- Cash aliases include 现金/现钱/陷阱/先进/详尽/橡筋; account-cue aliases include 账户/账号/张虎/赞胡/张护.
- Amount-cue aliases include 金额/费用/花费/消费 and bounded ASR variants 今儿/菲佣/飞永.
- Explicit income/expense navigation uses the same button click path as manual UI, then verifies state.
- Short control-like utterances that cannot be resolved fail closed and never enter free-form remarks.
- Ordinary prose remains eligible for remarks.
- No global Chinese homophone rewrite: mapping is context + closed-vocabulary only to avoid semantic pollution.
