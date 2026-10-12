# Current DGX analyzer baseline

Measured on 2026-10-12 against the existing DGX analyzer, without changing its
image, configuration or startup time. Complete corpora were used, with no sample
selection or tuning. Requests stayed on loopback; no corpus text went to a model.

Evidence on DGX:
`/home/taolei/sudo-dgx/shared-assembly/dlp-evaluation-20261012T081359Z/`.
The directory contains corpus bytes, source notices, input hashes, typed findings,
TAB-compatible masked spans and complete reports. Aggregate reports live here;
the raw corpora and document predictions are not vendored.

| Corpus | Documents | Person precision / recall / F1, exact spans | Address complete-span coverage |
|---|---:|---|---:|
| [PII Bench ZH formal](zh-formal.json) | 5,000 | 87.2% / 67.8% / 76.3% | 1.7% |
| [PII Bench ZH chat](zh-chat.json) | 3,000 | 82.6% / 49.5% / 61.9% | 28.6% |
| [TAB dev](tab-dev.json) | 127 | 34.0% / 31.8% / 32.9% | see LOC in the report |

The Chinese analyzer detects some address characters without covering the whole
address: character coverage is 34.9% for formal text and 68.1% for chat. This is
more than a strict span-boundary mismatch and leaves portions unrecognized.

PII Bench ZH has no organization annotations. Unmatched ORGANIZATION outputs
there cannot establish organization accuracy or the business false-alarm rate.
Use a company-labeled corpus and separate public-company/customer-list policy
samples for those questions.

TAB retains each annotator's decisions. Treating every contextual analyzer
finding as a mask covers 19.6% of protected mentions fully, and touches 65.1%
of NO_MASK mentions. These are our strict character diagnostics, not the official
TAB metrics. The analyzer received text only, without TAB's target-person task;
it cannot make the benchmark's contextual masking decisions.

These results assess the contextual analyzer for PERSON, LOCATION and
ORGANIZATION at threshold 0.5. They omit Nexus's deterministic identifier rules
and actual export enforcement. The reports say `scope: analyzer_only` and
record every excluded category. The six startup regressions are useful but
do not establish corpus quality or a tenant's complete DLP acceptance.

Next comparisons should use fixed corpus revisions, identical requested labels,
and separate development and held-out results. For synthetic data, keep generation
templates separate across tuning and evaluation. Address completion, chat person
recall and public-vs-protected company policy need improvement before broad quality
claims. This baseline imposes no new release threshold.
