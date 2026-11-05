# DimHookah: UI redline

Based on [unslop by Damir Sokolovsky (@heydamir)](https://github.com/heydamir/unslop), licensed CC BY 4.0. Applied to the existing app, not to a static replacement.

## Direction

- Product: a personal hookah session timer, tobacco catalog and journal.
- Character: direct, tactile, playful.
- World: printed comics, paper and ink; retain the existing Underdog identity.
- Moments: the working warmup ticket and original tobacco photos in the moving reel.
- Signature: a bowl with three coals beside the actual timer duration.

## Audit and passes

1. Spacing: the start action and duration selector were separate cards. Joined them, aligned their edges, and kept shortcuts and recent sessions as separate groups. Compact section headings remain.
2. Color: purple shadows, colored shortcut cards and strong navigation selection competed with the primary action. Replaced these with neutral surfaces; retained yellow for starting the timer and the reel pointer.
3. Icons: kept the existing line SVG navigation, reduced shortcut icons to 24px, removed the console sparkle and redundant arrow decorations. The illustration is a local code-native SVG, cached offline.
4. Copy: replaced vague slogans with “Таймер прогрева”, “Случайный выбор табака” and “Чаша, табак и оценка”. Functional action labels remain unchanged.
5. Type: removed italic emphasis and tracked uppercase labels from the revised surfaces; enlarged small captions to 12px. Underdog remains the established identity, with system numerals for the duration.
6. Layout: retained the section order, mobile bottom navigation, desktop grid, actual catalog, recording forms and timer panel. No promotional banner was added.
7. Details: quieter counts, consistent shortcut padding, visible focus, disabled duration controls at each boundary. Removed retired hero CSS from the experience layer.
8. Visuals: one local bowl illustration with real HTML text and timer figures. No generated images or rewritten catalog photos.
9. Motion: retained functional reel motion and reduced-motion support. Color feedback uses explicit transition properties, without hover movement on product cards.

## Duration behavior

The new-session selector offers every whole minute from 4 through 10. Default remains 7. The existing preference key is retained; old preferences below/above the range resolve to 4/10. Starting a new local timer validates the range. Saved history, active timers and server/Siri timing records are not shortened or rewritten.
