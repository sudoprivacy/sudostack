# ShareOne: readable architecture diagrams with a compact overview

## Current reproduction

The first diagram at https://s.shareone.vip/md/sudo-cloud-plan preserves 27
nodes, 33 directed relationships and nested deployment and trust boundaries.
The source is the marked first Mermaid block in [sudo-cloud-plan.md](sudo-cloud-plan.md)
at the same commit as this request. The generated HTML comes from that source;
use its complete labels, stable IDs, edge directions, styles and group membership.
There are 17 diagrams in the updated source and 25 folded historical records;
all 24 records from the preceding published checkpoint remain byte-identical.

The 30 October local check uses Mermaid 11.12.1 and authored Dagre TB with
nodeSpacing=60 and rankSpacing=15. Its SVG is 3881.727 × 4619.5, ratio 0.840291.
At 1440 × 1100 it fits as 605.009 × 720 into a 1148 × 760 viewport; at
390 × 844 it fits as 305.999 × 364.159 into 346 × 607.672. Desktop light and
mobile dark retain all 27 nodes, 33 relationships and 17 diagrams without
document overflow. Edge endpoints/directions and group membership are unchanged.
The initial local attempt kept nodeSpacing=15 after updating the labels and
measured 3555.477 × 4619.5, ratio 0.769667; that failed receipt is preserved.
Horizontal spacing was adjusted while keeping the same aspect-ratio assertion.

These measurements qualify the local source. Public byte and visual checks
belong to the publication receipt; local geometry alone does not prove delivery.
The preceding published plan121 used nodeSpacing=15/rankSpacing=15, measured
3555.477 × 4355.5 (ratio 0.816319), and contained 24 folded historical records.

The aspect ratio is acceptable, but long edges and large empty areas inside
groups still make fit-to-window text too small. The product layout improvement
below remains a request; the current document does not claim it is implemented.

## Requested behavior

Offer an explicit optional Compact overview alongside the authored layout.
Preserve the source, every label, relationship, arrow, style and group. Do not
summarize labels, merge nodes or hide version, failure or pending-acceptance text.

1. Try bounded supported Dagre/ELK candidates and spacing values. Investigate
   graph wrapping and group packing using measured node and label dimensions.
   These are candidates to validate on this exact compound graph, not a claim
   that changing one configuration already solves it.
2. Score against the actual viewport: readable fit scale, crossings, label/node
   overlap and empty area. Keep a useful aspect ratio; 0.8–1.25 is the current
   fallback target. Measure node area, fit scale and readability rather than
   treating a square bounding box alone as success.
3. Reject a candidate if it loses any semantic content, clips text, overlaps
   nodes or renders an error. Compare all IDs, full labels, edge endpoints,
   directions, styles and group hierarchy before and after. Counts alone do
   not establish preservation.
4. Keep fit, zoom/pan, 100%, group focus and expanded view. Resize may refit the
   transform, but must not continuously rearrange a graph the user is reading.
   Layout changes are explicit and keep selection by ID.
5. Preserve the original share ID `3v34NpWDDcLTgBqo`, URL, settings, comments and
   their object IDs. Do not guess new targets for old comment anchors; report
   unresolved anchors using the existing workflow.
6. Validate desktop/mobile, both themes, comments open/closed, delayed fonts,
   cold loading, hidden-to-visible transitions, resize and renderer failure.
   Zero-sized containers must not cache an invalid layout. Keep all 17 diagrams,
   25 folded histories, navigation and original anchors working.
7. Compare the published bytes to the reviewed canonical HTML, then check real
   public screenshots. Keep raw SVG/source available for 100% detail inspection.

Primary references: [Mermaid layouts](https://mermaid.js.org/config/layouts),
[ELK wrapping strategy](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-wrapping-strategy.html).
The current fixture uses Mermaid 11; validate the applicable loading and
configuration contract rather than assuming newer documentation applies unchanged.

## Previous compound-graph measurement text (historical)

<details>
<summary>29 October request measurements, preserved verbatim</summary>

<pre>There are 17 diagrams in the document and 23 folded historical records.

The 29 October local check uses Mermaid 11.12.1 and authored Dagre TB with
nodeSpacing=15 and rankSpacing=25. Its SVG is 3555.477 × 4400.5, ratio 0.807971.
At 1440 × 1100, the diagram fits into a 1148 × 760 viewport as 581.738 × 720.
At 390 × 844, it fits as 305.999 × 378.726 inside 346 × 607.672. Both views
preserve the complete graph with no document overflow. The preceding published
checkpoint was also checked on both screen sizes: ratio 0.890539, 27 nodes,
33 relationships, all 17 diagrams and all 22 then-existing folded records.
</pre>
</details>

## Earlier measurements and request (historical fixture)

The complete earlier request is retained below. Its 22 nodes and 25 relationships
describe that older fixture, not the current plan.

<details>
<summary>Earlier request and original measurements</summary>

<pre># ShareOne: readable architecture diagrams with a compact overview

## Problem

The first diagram at https://s.shareone.vip/md/sudo-cloud-plan has 22 nodes,
25 labeled relationships and nested deployment and trust boundaries. Mermaid
ELK with a top-to-bottom direction produces an approximately 1228 × 3890
canvas. Fit-to-window makes its text too small to read. Changing direction alone
produces a wide strip instead.

## Requested behavior

Offer an optional **Compact overview** layout alongside the author&#x27;s original
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
   unresolved anchors using ShareOne&#x27;s existing anchor workflow.

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
</pre>

</details>
