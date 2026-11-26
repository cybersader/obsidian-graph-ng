---
description: Graph NG product and interface rules for wording, counts, help, icons, motion, device settings and size budgets.
---

# Design principles

A person should be able to tell what the graph shows, what is missing and what their next action will do. Use these rules when writing a label, designing a setting or reviewing a screenshot.

## Say what the graph means

- **Use words that work in any vault.** Say *note*, *group*, *property* or *connection*. A declaration supplies names and meaning. A special case in code or default copy would make the next collection of notes look like the wrong kind of data.
- **Name what each count counts.** Use “8 notes shown” and “2 notes hidden by this filter”, not “8 of 10”. Give each difference its own reason and a route to inspect it. A missing target is not a hidden note.
- **Separate facts visually.** No em dashes or middle-dot separators in UI text. Use short sentences, labelled rows or chips; put issues in their own list. A line of joined statistics makes it hard to match a number with its label.
- **Put help within reach, not under every control.** Lead with the label, current value and action. An underlined term or info control can explain the consequence on focus, tap or hover. Persistent paragraphs bury the choices; unexplained internal keys are not a substitute.

## Make controls feel native

- **Use Obsidian and T3 Code as the quality bar.** Match host type, spacing, alignment and theme contrast. Keep secondary controls quiet. During work, name the actual stage; any shimmer should be subtle. Honour reduced motion, allow interruption and stop animating when idle.
- **Close with an X icon.** Give the button an accessible name such as “Close connections”. The icon keeps cards, chips and panels compact without leaving assistive technology to guess.
- **Use one disclosure chevron.** Rotate the same outline right when closed and down when open, including nested sections. Do not reuse it as the selected-state indicator: opening a section and choosing a value are different actions.
- **Offer credible alternatives as settings.** Choose and document a useful default and a way back to it. For example, jumping to a note and filtering as you type serve different intentions. Let people compare them on their own data when both can be supported. A research prototype is not a setting until it works.

## Protect the person using the graph

- **Device choices belong to the device.** Performance mode, engine preference and local diagnostics must not go in room-shared `data.json`. One person's hardware or opt-in must not change another person's experience. Keep small, non-sensitive preferences namespaced; do not put note-derived content in browser preference storage.
- **Ask before raising bundle caps.** Measure the actual built artifact. If the feature is worth the extra bytes, propose explicit new limits to the project owner instead of silently raising a cap or stripping a useful feature to fit. Approval changes the size budget, not the correctness checks.
