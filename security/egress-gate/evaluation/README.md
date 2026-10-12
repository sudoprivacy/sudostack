# Shared DLP quality evaluation

Sudo Cloud, Sudo Private and SudoEdge share corpus adapters, source pins and
quality reports here. Detection and enforcement stay in Presidio and Nexus;
deployment repositories record the runtime they accepted.

## Public sources reviewed on 2026-10-12

| Source | Use here | Limits |
|---|---|---|
| [Presidio Evaluator](https://github.com/data-privacy-stack/presidio-research) | Reference framework for recognizer comparisons, error analysis and synthetic generation with separate templates for training and evaluation. | MIT code. Fake Name Generator identities have separate attribution and share-alike terms. Its scores do not establish Chinese business quality. |
| [TAB](https://github.com/NorskRegnesentral/text-anonymization-benchmark), [paper](https://aclanthology.org/2022.cl-4.19/) | Research baseline for masking decisions and repeated mentions. Pinned dev/test downloads and adapter are implemented. | English court documents. Annotators remain separate. This runner exports masks for upstream evaluation but computes its own strict diagnostics; those numbers are not the official TAB metrics. MIT data; retain its license. |
| [CLUENER2020](https://github.com/CLUEbenchmark/CLUENER2020) | Chinese name, company, organization and location recognition. Local adapter handles inclusive end offsets. | NER labels do not indicate confidentiality. No explicit corpus redistribution license was found in the reviewed repository; automatic corpus download is not configured. |
| [PII Bench ZH](https://huggingface.co/datasets/wan9yu/pii-bench-zh) | Reproducible Chinese baseline: 5,000 formal and 3,000 noisy chat samples. Downloads and adapter are implemented. | Recent synthetic templates, not proof of broad industry adoption. No company labels or PII-free document coverage. Do not tune on these samples and report them as unseen tests. Dataset card declares Apache 2.0. |
| [OpenPII 1.5M](https://huggingface.co/datasets/ai4privacy/pii-masking-openpii-1.5m) | Candidate for broader Chinese and multilingual validation. | Chinese is included in this newer synthetic release; the older 300k lacks Chinese. Pinned card declares CC-BY-4.0; credit Ai4Privacy / Ai Suisse SA. Adapter and Chinese subset extraction are pending. |
| [Query-aware PII-Bench](https://aclanthology.org/2026.acl-long.227/) | Research reference for whether a task needs particular private information. | Query relevance does not define tenant export permission. No adapter yet. Distinct from PII Bench ZH and the separately published PIIBench corpus. |

This review has not identified one accepted industry suite that establishes our
complete DLP behavior across Chinese recognition, tenant policy and actual exports.
Public corpora provide useful baselines without replacing business acceptance.

## Reproduce a baseline

Python 3.10+ and its standard library suffice. Downloads are explicit; normal
CI tests run offline using synthetic adapter fixtures.

From the repository root:

~~~sh
python3 security/egress-gate/evaluation/fetch.py \
  --dataset pii-zh-chat --cache security/egress-gate/evaluation/work/corpora

python3 security/egress-gate/evaluation/evaluate.py \
  --format pii-bench-zh \
  --input security/egress-gate/evaluation/work/corpora/pii_bench_zh_chat.jsonl \
  --analyzer-url http://127.0.0.1:59080 \
  --entities PERSON,LOCATION,ORGANIZATION --threshold 0.5 \
  --model-id 'image-digest;nlp-config-sha256' \
  --output security/egress-gate/evaluation/work/chat-baseline
~~~

Use the actual immutable image and configuration identifier. The loopback URL
can be a tunnel to the deployment's analyzer. Proxies and redirects are refused.

Other fetch choices: `pii-zh-formal`, `tab-dev`, `tab-test`. Use `--format tab`
for TAB or `--format cluener` for a separately acquired labeled CLUENER JSONL file.
[sources.json](sources.json) pins revisions, asset hashes and sizes.

Every document is evaluated by default. `--limit N --seed 42` samples documents,
explicitly recorded in the report. Existing output directories are refused.
Errors and invalid spans fail the run rather than skipping samples.
Offline adapters can supply `--predictions FILE`: a JSON mapping of every selected
document ID to findings with `entity_type`, `start`, `end` and `score`.

## What reports establish

- Exact Unicode span precision, recall and F1 per requested category. Duplicate
  findings do not inflate the score. Categories without gold labels have
  undefined recall rather than a perfect score.
- Character coverage and full-span coverage, independently of predicted type,
  distinguish partial recognition from complete coverage. Unmatched predictions
  count as false positives against this corpus, not automatically as incorrect
  real-world findings: types without gold support are listed explicitly.
- Gold categories excluded from the recognition comparison.
- For TAB, full-character protection per mention and entity, and the rate at
  which `NO_MASK` annotations were touched. Unsupported categories remain in the
  protection denominator. Every protected mention must be covered before an
  entity counts as protected.
- Input, evaluator and model identifiers, threshold, categories, document count
  and sampling seed. Reports and TAB-compatible `masked-spans.json` contain IDs
  and offsets rather than corpus text.

The default categories match our contextual analyzer. Chinese identity numbers,
cards, mobiles and credentials use Nexus rules; this analyzer call does not
evaluate them. Excluded counts remain visible. Reports carry `scope: analyzer_only`.
A successful exit means evaluation completed, not that a quality target passed.
No release quality threshold is enforced yet.

## Business and transport coverage

Additional shared coverage remains to be built:

- Public company names allowed vs protected customer lists; approved vs
  disallowed external recipient.
- Ordinary text and PII-free documents to measure disruption from false alarms.
- JSON escaping, Unicode, chat noise and tool results, checked against the exact
  bytes forwarded through model and A2A mounts.
- Local model unchanged; cloud allow/redact/deny; analyzer outage; credential
  recovery; artifact and conversation export.

[acceptance/](../acceptance/) asserts on real runtime and Router traffic.
Public recognition corpora complement it. No fixture here changes deployed policy.

`python3 -m unittest discover -s security/egress-gate/evaluation -v` checks
adapter boundaries and scoring failures in CI. Actual corpus quality is retained
with the accepting deployment's evidence.
