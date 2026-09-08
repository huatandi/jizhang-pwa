# V216 Voice Direct Amount / Quiet Feedback

- Direct amount utterances are consumed before draft arbitration and written only through the verified Single Writer.
- Accepted Chinese amount cues include 金额、数额、费用、花费、消费、消费金额、支出金额.
- Natural forms 花了/花/支付/付款/付了 + amount are supported.
- A standalone money utterance such as 13500 / 一万 / 九千多 is treated as the amount while quick-entry voice is active.
- ASR homophone 今儿 is accepted only as a local amount-field cue when followed by a valid amount; no global replacement is performed.
- Recognition/action status is rendered inline in voiceTip instead of popup toast, preventing duplicate recognition popup storms.
- Amount write remains read-after-write verified; incorrect transformed values are not accepted.
- Tests: V216 gate 10/10; full npm test 66 PASS / 0 FAIL / 1 network SKIP; build + verify PASS.
