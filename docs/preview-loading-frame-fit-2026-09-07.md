# Unfinished previews and image-proportioned frames

Preview captions explicitly say Still generating alongside the stage number. A subtle two-second brightness pulse and spinner identify unfinished content; reduced-motion preferences disable both animations. Existing decoded crossfades remain, and the final canvas has no pulse. The viewport exposes aria-busy while generation is running.

The browser frame is centered and sized from the decoded preview/final image aspect ratio, available window space, and measured control dimensions. It remeasures wrapping controls on resize and settings changes using a bounded width solve. Narrow/portrait frames retain a 520px control-width minimum capped by the available width. If a very short window cannot fit, it uses full width and preserves at least 120px of image space with document scrolling.

Verification used captured images and synthetic aspect-ratio fixtures, without paid calls. With expanded settings and a 3:2 image:
- 2048×1060: frame1151×1036, image viewport1113×742; no large internal gutters or overflow.
- 1512×850: frame836×826, image viewport798×532; no overflow.
- 2560×1440,768×1024,390×844 and360×640 also fit without document overflow.
- 844×390: full available832px width,120px image area; vertical scrolling intentionally allowed for expanded controls.
- Square,16:9 and portrait actual image dimensions preserve their aspect ratios and remain within a1512×850 window.

Preview pulse and spinner computed animation names become none with reduced motion. Final canvas animation is none and aria-busy is false. All180 tests and build passed. Independent review found no remaining issues after the short-window fallback was fixed.
