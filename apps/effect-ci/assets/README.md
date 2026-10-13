# Effect CI app icon

`bolt-stack.svg` is the editable source of truth. `bolt-stack.png` is its 1024px
export for GitHub and Slack, which accept raster app icons.

All three layers reuse one bolt path. The outlined layers translate only along Y
(72px and 144px). The top layer is filled white with no masking stroke, so it meets
the middle outline. The middle layer's orange fill and 56px masking stroke separate
it from the lowest outline. The background and GitHub badge color are `#f38020`.

Change the shared path rather than redrawing individual layers. Keep app permissions,
credentials, webhook settings, and repository access unchanged when updating icons.
