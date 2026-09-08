# UI / ID Photo / Pet Controls Fix

- Removed duplicated Album vs Import-photo entry. One import-photo action + one camera action + More remain.
- ID-photo panels and controls now use system surface/border/text/primary tokens with rounded corners.
- Pet enable/activity controls now use the same semantic system surfaces and rounded styling.
- Relight upgraded to bounded low-frequency illumination equalization. It does not synthesize facial features, sharpen, reshape, smooth skin, or replace the background. Background replacement remains a separate explicit control (original/white/light-blue/red/gray + tolerance).
- Regression: npm test 63 PASS / 0 FAIL / 1 network-only SKIP; build + verify PASS.
