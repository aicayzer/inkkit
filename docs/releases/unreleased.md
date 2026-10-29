# Inkkit, next release

A `file` presentation takes two optional fields, so a host can show a placeholder card that fills the column and opens from anywhere on the card.

- `layout: 'fill'` stretches the card to the full width of the column.
- `activation: 'card'` makes the whole card one control with the `button` role. A click, or Return or Space with the card focused, calls `FileAdapter.open`. The card has no separate Open button.

Both fields are optional and additive. Hosts that do not set them see no change. An unknown value makes the presentation invalid and reports `file-unavailable`. See [file card options](https://inkkit.cyzr.me/reference/adapters#file-card-options).

Rename this file to the version's name when the release is prepared.
