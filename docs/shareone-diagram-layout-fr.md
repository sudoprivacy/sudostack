# ShareOne: readable architecture diagrams with a compact overview

## Problem

The first diagram at https://s.shareone.vip/md/sudo-cloud-plan has 22 nodes,
25 labeled relationships and nested deployment and trust boundaries. Mermaid
ELK with a top-to-bottom direction produces an approximately 1228 × 3890
canvas. Fit-to-window makes its text too small to read. Changing direction alone
produces a wide strip instead.

## Requested behavior

Offer an optional **Compact overview** layout alongside the author's original
layout. Preserve the source, stable node identities, every relationship, edge
label, arrow direction, group and group membership. Never summarize labels,
merge nodes or remove edges to improve the score.

1. Try bounded candidates: supported Dagre/ELK engines, both directions, and a
   small range of node and layer spacing values.
2. Score the rendered SVG against the actual available viewport: readable fit
   scale first, then crossings, label/node overlaps and excessive empty space.
   Penalize extreme aspect ratios. A square diagram is a useful fallback, not
   the only target: mobile, desktop and comment-panel widths differ.
3. Reject candidates with lost content, clipped labels, overlapping nodes or
   rendering errors. Verify the semantic graph before and after layout.
4. Keep zoom/pan, fit-to-window, 100%, group focus and an expanded view. Resize
   changes the fit transform; it must not continuously rearrange a diagram the
   user is reading. Switching layout is explicit and keeps selection by ID.
5. Preserve comments and their object IDs. Do not automatically reattach an old
   text or region comment to a guessed target after a layout change. Report
   unresolved anchors using ShareOne's existing anchor workflow.

## Concrete reproduction and acceptance

For this exact source, Dagre TB with nodeSpacing=30 and rankSpacing=130 produces
about 3126 × 2732 (ratio 1.14), preserving all 22 nodes and 25 relationships.
The authored source can use this immediately; the generic product feature is
still a separate request for the ShareOne maintainer.

Validate dark/light themes, phone/desktop sizes, comments open/closed, repeated
fit/zoom, expansion, and a renderer failure fallback. Compare graph IDs,
labels, edges and groups against the original. Keep raw SVG/source available
for inspecting dense details at 100%.

No ShareOne product change is claimed by this document.
