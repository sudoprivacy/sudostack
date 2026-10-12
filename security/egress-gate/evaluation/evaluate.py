"""Evaluate local analyzer predictions against public corpus span annotations."""

import argparse
import collections
import hashlib
import ipaddress
import json
import math
import pathlib
import random
import sys
import urllib.error
import urllib.parse
import urllib.request


ENTITY_MAPS = {
    "pii-bench-zh": {
        "person": "PERSON",
        "address": "LOCATION",
        "phone": "PHONE_NUMBER",
        "id_number": "CN_ID",
        "bank_card": "CREDIT_CARD",
        "email": "EMAIL_ADDRESS",
        "passport": "CN_PASSPORT",
        "license_plate": "CN_LICENSE_PLATE",
    },
    "tab": {"PERSON": "PERSON", "ORG": "ORGANIZATION", "LOC": "LOCATION"},
    "cluener": {
        "name": "PERSON",
        "company": "ORGANIZATION",
        "organization": "ORGANIZATION",
        "government": "ORGANIZATION",
        "address": "LOCATION",
        "scene": "LOCATION",
    },
}


def validate_span(text, start, end, expected_text=None):
    """Require Unicode code point offsets and reject malformed gold or outputs."""
    if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(text):
        raise ValueError("invalid span offsets")
    if expected_text is not None and text[start:end] != expected_text:
        raise ValueError("span text differs from its offsets")


def load_documents(data, corpus_format):
    """Preserve document boundaries, annotations and original masking decisions."""
    rows = json.loads(data) if corpus_format == "tab" else [
        json.loads(line) for line in data.splitlines() if line.strip()
    ]
    if not isinstance(rows, list) or not rows:
        raise ValueError("corpus must contain documents")
    result = []
    seen = set()
    mapping = ENTITY_MAPS[corpus_format]
    for index, row in enumerate(rows):
        text = row["text"]
        if not isinstance(text, str) or not text:
            raise ValueError("document text must be a nonempty string")
        doc_id = str(row.get("doc_id", row.get("id", index)))
        if doc_id in seen:
            raise ValueError("duplicate document ID")
        seen.add(doc_id)
        annotations = []
        if corpus_format == "tab":
            for annotator, annotation in row["annotations"].items():
                mentions = []
                for entity in annotation["entity_mentions"]:
                    start, end = entity["start_offset"], entity["end_offset"]
                    validate_span(text, start, end, entity["span_text"])
                    decision = entity["identifier_type"]
                    if decision not in ("DIRECT", "QUASI", "NO_MASK"):
                        raise ValueError("unknown TAB masking decision")
                    mentions.append({
                        "type": mapping.get(entity["entity_type"]),
                        "source_type": entity["entity_type"],
                        "start": start,
                        "end": end,
                        "mask": decision != "NO_MASK",
                        "decision": decision,
                        "entity_id": entity["entity_id"],
                    })
                annotations.append({"annotator": annotator, "mentions": mentions})
            language = "en"
        elif corpus_format == "pii-bench-zh":
            mentions = []
            for entity in row["entities"]:
                validate_span(text, entity["start"], entity["end"], entity["text"])
                mentions.append({
                    "type": mapping.get(entity["type"]),
                    "source_type": entity["type"],
                    "start": entity["start"],
                    "end": entity["end"],
                    # These are PII detection labels, not a business masking policy.
                    "mask": None,
                })
            annotations.append({"annotator": "gold", "mentions": mentions})
            language = row["lang"]
        else:
            mentions = []
            for source_type, entities in row["label"].items():
                for value, spans in entities.items():
                    for start, inclusive_end in spans:
                        end = inclusive_end + 1
                        validate_span(text, start, end, value)
                        mentions.append({
                            "type": mapping.get(source_type),
                            "source_type": source_type,
                            "start": start,
                            "end": end,
                            "mask": None,
                        })
            annotations.append({"annotator": "gold", "mentions": mentions})
            language = "zh"
        if not annotations:
            raise ValueError("document has no annotators")
        result.append({
            "id": doc_id, "text": text, "language": language, "annotations": annotations,
        })
    return result


def validate_predictions(text, findings, entities, threshold):
    """Normalize predictions without retaining raw text in evidence files."""
    if not isinstance(findings, list):
        raise ValueError("analyzer must return a list")
    result = set()
    for finding in findings:
        kind, start, end = finding["entity_type"], finding["start"], finding["end"]
        validate_span(text, start, end)
        score = finding["score"]
        if type(score) not in (int, float) or not math.isfinite(score) or not 0 <= score <= 1:
            raise ValueError("analyzer returned an invalid confidence score")
        if kind not in entities:
            raise ValueError("analyzer returned an unrequested entity type")
        if score >= threshold:
            result.add((kind, start, end))
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("analyzer redirects are refused")


def analyze(documents, url, entities, threshold, timeout):
    """Send corpus text only to an explicit loopback analyzer; bypass proxies."""
    parsed = urllib.parse.urlparse(url)
    try:
        is_loopback = ipaddress.ip_address(parsed.hostname or "").is_loopback
    except ValueError:
        is_loopback = False
    if parsed.scheme != "http" or not is_loopback or parsed.username or parsed.password:
        raise ValueError("analyzer URL must use HTTP and a literal loopback address")
    if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise ValueError("analyzer URL must contain only the origin")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    predictions = {}
    for index, doc in enumerate(documents):
        payload = json.dumps({
            "text": doc["text"], "language": doc["language"],
            "entities": sorted(entities), "score_threshold": threshold,
        }).encode("utf-8")
        request = urllib.request.Request(
            url.rstrip("/") + "/analyze", payload, {"Content-Type": "application/json"},
        )
        with opener.open(request, timeout=timeout) as response:
            findings = json.load(response)
        predictions[doc["id"]] = validate_predictions(doc["text"], findings, entities, threshold)
        if (index + 1) % 100 == 0:
            print(json.dumps({"evaluated_documents": index + 1}), file=sys.stderr, flush=True)
    return predictions


def ratio(numerator, denominator):
    return numerator / denominator if denominator else None


def score(documents, predictions, entities):
    """Compute strict span diagnostics; retain every TAB annotator separately."""
    if set(predictions) != {doc["id"] for doc in documents}:
        raise ValueError("predictions must cover exactly the selected documents")
    counts = {kind: collections.Counter() for kind in sorted(entities)}
    coverage = collections.defaultdict(collections.Counter)
    policy = collections.Counter()
    excluded = collections.Counter()
    for doc in documents:
        actual = predictions[doc["id"]]
        covered = {i for _, start, end in actual for i in range(start, end)}
        for annotation in doc["annotations"]:
            mentions = annotation["mentions"]
            gold = {(m["type"], m["start"], m["end"]) for m in mentions if m["type"] in entities}
            for kind in entities:
                expected = {span for span in gold if span[0] == kind}
                detected = {span for span in actual if span[0] == kind}
                counts[kind].update(tp=len(expected & detected), fp=len(detected - expected), fn=len(expected - detected))
            for mention in mentions:
                offsets = set(range(mention["start"], mention["end"]))
                coverage[mention["source_type"]].update(
                    mentions=1,
                    fully_covered=int(offsets <= covered),
                    characters=len(offsets),
                    covered_characters=len(offsets & covered),
                )
                if mention["type"] not in entities:
                    excluded[mention["source_type"]] += 1
            # Business-policy diagnostics require gold masking decisions.
            # Use all TAB types here, including unsupported ones, so omissions
            # cannot inflate the claimed protection rate.
            groups = collections.defaultdict(list)
            for mention in mentions:
                offsets = set(range(mention["start"], mention["end"]))
                if mention["mask"] is True:
                    fully_covered = offsets <= covered
                    policy["protected_mentions"] += 1
                    policy["fully_covered_mentions"] += fully_covered
                    policy[mention["decision"].lower() + "_mentions"] += 1
                    policy[mention["decision"].lower() + "_fully_covered"] += fully_covered
                    groups[mention["entity_id"]].append(fully_covered)
                elif mention["mask"] is False:
                    policy["no_mask_mentions"] += 1
                    policy["no_mask_mentions_touched"] += bool(offsets & covered)
            policy["protected_entities"] += len(groups)
            policy["fully_covered_entities"] += sum(all(group) for group in groups.values())
    def metrics(counter):
        tp, fp, fn = counter["tp"], counter["fp"], counter["fn"]
        return {
            "tp": tp, "fp": fp, "fn": fn,
            "precision": ratio(tp, tp + fp), "recall": ratio(tp, tp + fn),
            "f1": ratio(2 * tp, 2 * tp + fp + fn),
        }
    total = sum(counts.values(), collections.Counter())
    return {
        "documents": len(documents),
        "annotation_sets": sum(len(d["annotations"]) for d in documents),
        "strict_spans": metrics(total),
        "strict_spans_by_type": {kind: metrics(counter) for kind, counter in counts.items()},
        "prediction_types_without_gold_support": sorted(
            kind for kind, counter in counts.items() if counter["tp"] + counter["fn"] == 0
        ),
        "span_coverage_by_source_type": {
            kind: {
                **dict(counter),
                "full_span_recall": ratio(counter["fully_covered"], counter["mentions"]),
                "character_recall": ratio(counter["covered_characters"], counter["characters"]),
            }
            for kind, counter in sorted(coverage.items())
        },
        "excluded_gold_mentions_by_source_type": dict(sorted(excluded.items())),
        "masking_diagnostics": {
            **dict(policy),
            "fully_covered_mention_recall": ratio(policy["fully_covered_mentions"], policy["protected_mentions"]),
            "fully_covered_entity_recall": ratio(policy["fully_covered_entities"], policy["protected_entities"]),
            "no_mask_touch_rate": ratio(policy["no_mask_mentions_touched"], policy["no_mask_mentions"]),
        } if policy["protected_mentions"] or policy["no_mask_mentions"] else None,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--format", choices=ENTITY_MAPS, required=True)
    parser.add_argument("--input", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--model-id", required=True, help="immutable image/model/config revision")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--analyzer-url")
    source.add_argument("--predictions", type=pathlib.Path, help="JSON {document ID: Presidio-style findings}")
    parser.add_argument("--entities", default="PERSON,LOCATION,ORGANIZATION")
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument("--timeout", type=float, default=15)
    parser.add_argument("--limit", type=int, default=0, help="0 evaluates the whole corpus")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    if not math.isfinite(args.threshold) or not 0 <= args.threshold <= 1 or not math.isfinite(args.timeout) or args.timeout <= 0 or args.limit < 0:
        parser.error("invalid threshold, timeout or limit")
    entities = set(args.entities.split(","))
    if not entities or any(not kind or kind.strip() != kind for kind in entities):
        parser.error("entities must be nonempty, comma-separated labels")
    if args.output.exists():
        parser.error("output already exists; choose a new evidence directory")
    data = args.input.read_bytes()
    documents = load_documents(data.decode("utf-8"), args.format)
    available = len(documents)
    if args.limit and args.limit < available:
        documents = random.Random(args.seed).sample(sorted(documents, key=lambda d: d["id"]), args.limit)
    if args.predictions:
        raw = json.loads(args.predictions.read_bytes())
        if set(raw) != {doc["id"] for doc in documents}:
            raise ValueError("predictions must cover exactly the selected documents")
        predictions = {doc["id"]: validate_predictions(doc["text"], raw[doc["id"]], entities, args.threshold) for doc in documents}
    else:
        predictions = analyze(documents, args.analyzer_url, entities, args.threshold, args.timeout)
    report = {
        "scope": "analyzer_only",
        "metric_definition": "strict_unicode_spans_and_full_character_mask_coverage_v1",
        "input_sha256": hashlib.sha256(data).hexdigest(),
        "evaluator_sha256": hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
        "model_id": args.model_id, "format": args.format,
        "threshold": args.threshold, "entities": sorted(entities),
        "available_documents": available, "sampled": len(documents) < available, "seed": args.seed,
        **score(documents, predictions, entities),
    }
    args.output.mkdir(parents=True)
    (args.output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    # TAB-compatible mask output for the upstream official evaluation framework.
    masks = {doc_id: sorted({(start, end) for _, start, end in spans}) for doc_id, spans in predictions.items()}
    (args.output / "masked-spans.json").write_text(json.dumps(masks), encoding="utf-8")
    typed_spans = {
        doc_id: [{"entity_type": kind, "start": start, "end": end} for kind, start, end in sorted(spans)]
        for doc_id, spans in predictions.items()
    }
    (args.output / "typed-spans.json").write_text(json.dumps(typed_spans), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, urllib.error.URLError) as error:
        # Do not copy raw corpus text or provider response bodies into CI logs.
        print(f"Evaluation failed ({type(error).__name__}); no complete report was written.", file=sys.stderr)
        sys.exit(1)
