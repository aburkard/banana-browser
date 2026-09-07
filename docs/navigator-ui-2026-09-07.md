# Navigator browser chrome

Navigator is the reversible production starting point from the three vintage chrome studies. The generated canvas remains the primary content; the browser frame provides navigation, rendering controls, connection choice, source attribution, and session usage.

## Design plan

- Palette: navy `#244765`, cool grey `#dce0e3`, white `#ffffff`, graphite `#182531`, steel `#7c858e`, focus blue `#1264d3`.
- Type: Arial/Helvetica for familiar desktop browser controls; tabular numbers for usage. No external fonts.
- Layout: navy title strip, Location/navigation row, bookmarks/style/image row, optional Settings, page and scrollbar, source attribution, inset status strip. On narrow screens Location takes its own row and options wrap.
- Principles: restrained bevels on actual controls, one contiguous window, minimal copy, no decorative navigation or invented controls. Setup and billing confirmation use the same palette while preserving the existing flows.

The initial plan was reviewed against the brief: the title strip is the single strong visual feature. The earlier centered product header and separate rounded toolbar cards were removed so the app reads as a browser. The banana mark remains small; generated content supplies the rest of the color.

## Implementation and checks

All existing control IDs and event wiring remain. Browser controls have explicit accessible labels, Settings exposes its expanded state, and status uses a polite live region. Focus rings apply throughout; reduced-motion preferences suppress loading/scroll animations. Usage tables scroll within a viewport-bounded popover on small screens. Billing mode, estimates, session totals, source links, generation feedback, canvas interactions, and connection recovery remain available.

Ran `node --test tests/connection-ui.test.mjs tests/progress.test.mjs`: 14 passed. This checks API confirmation and cancellation, connection switching/recovery, loading elapsed time, disabled controls, canvas replacement, subscription usage, and partial API costs without paid model calls.

The first build attempt reached unrelated in-progress source-list passage type errors. The integrating task is responsible for the final build and shared browser screenshot pass.

Visual review checklist: desktop and 390px mobile; initial setup, both connection modes, Settings expanded, custom style input, usage details with enough rows to scroll, generated canvas plus source links, and keyboard focus. Browser screenshots are delegated to the integrating task to avoid competing for its shared profile.

Integrating visual review: inspected the actual setup, desktop1440 toolbar/settings/custom style, API mode at390px and plan mode at390px with usage open. No horizontal overflow. Mobile labels now wrap with their selects; the empty plan image-settings row is hidden. The old “~2× slower” setup claim is replaced with “Speed and image quality vary,” consistent with the repeated latency observations. All model endpoints were blocked for these UI checks; fake local credentials were used only in the isolated headless profile.

Final integrated validation:144 app tests and the production build passed. The final plan mobile screenshot confirms its unsupported image-settings row is hidden and there is no horizontal overflow.
