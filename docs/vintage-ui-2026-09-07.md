# Banana Browser chrome studies

Issue #21 remains a direction choice. The production interface is unchanged by this exploration.

Open `experiments/vintage-ui/index.html` directly in a browser, or use the existing Vite server at `/experiments/vintage-ui/`. Everything is inline and runs offline. The preview never connects accounts, stores credentials, calls models, or generates charges.

## Directions

| Concept | Tokens | Type and structure | Rationale |
| --- | --- | --- | --- |
| Navigator | Frame `#dce0e3`, edge `#7c858e`, title `#244765`, page `#ffffff`, ink `#182531` | Arial chrome, 1px corners, shallow bevels, navigation and address in one row | Recognizable early browser controls with restrained depth and generous page space. |
| Platinum | Frame `#e4e4e4`, edge `#727272`, stripes `#adadad`, light `#f7f7f7`, ink `#222222` | Arial chrome, centered striped titlebar, rounded navigation controls, 5px frame details | Classic desktop utility with a quieter monochrome personality. |
| Workbench | Frame `#efe398`, edge `#a19555`, action `#454932`, separator `#c3b86e`, page `#ffffff` | Arial chrome, narrow left navigation rail, square controls | The strongest Banana identity; a muted yellow frame and asymmetric tool placement. |

Shared page typography uses Georgia for sample headlines and Arial for body text. The sample content stays identical while switching chrome, so generated-page styling does not obscure the decision. Focus uses `#1264d3`; controls are natively keyboard accessible. Controls wrap on small screens; Workbench retains its rail. There is no animation or external font dependency.

## Layout plan and critique

Navigator: title → navigation/address/connection → page controls → page → source/usage. Platinum retains that familiar structure but changes title alignment, control shape, and material. Workbench: full-width title → left navigation rail alongside address/controls/page → shared status.

The first two concepts intentionally share the proven browser layout. Workbench tests a meaningful structural alternative instead of merely reskinning the same toolbar. Removed ornamental menus, fake window close buttons, promotional copy, and loud page effects. Bevels and title stripes are the historical cues; the content remains calm and readable.

## Review interactions

Switch concepts, click a story, try back/forward, enter a sample URL and press Go, select a bookmark, open Settings, choose Custom style, inspect Usage, and switch between ChatGPT plan and API credits. Billing selection is visibly separate and states that API billing is separate from plan usage. This is a visual interaction study; controls simulate behavior rather than invoking production operations.

Run `node experiments/vintage-ui/verify.mjs` for offline interaction checks. These checks cover all concept switches, history, settings disclosure, custom style, billing label, address submission, and lack of external assets. They do not verify browser rendering or reproduce the full production connection flow.

Choose a chrome direction before integrating into `src/main.ts` and `src/style.css`. Integration should preserve the production API confirmation, connection flow, model availability, progress, attribution, section controls, and usage breakdown rather than replacing them with the simplified preview state.

Chromium visual checks: reviewed all three desktop concepts at 1280 pixels and Workbench at 390 pixels. All three concepts fit a 390-pixel viewport without horizontal page overflow. Offline interaction verification passed. These are previews; production authentication and paid operations remain unconnected.
