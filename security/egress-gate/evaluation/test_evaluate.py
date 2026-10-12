"""Checks for corrupted corpus spans and misleading evaluation reports."""

import json
import unittest

from evaluate import analyze, load_documents, score, validate_predictions


def doc(text, mentions):
    return {"id": "doc", "text": text, "annotations": [{"mentions": mentions}]}


class EvaluationTests(unittest.TestCase):
    def test_unicode_offsets_and_inclusive_cluener_end(self):
        row = {"text": "🙂客户张三", "label": {"name": {"张三": [[3, 4]]}}}
        document = load_documents(json.dumps(row, ensure_ascii=False), "cluener")[0]
        self.assertEqual(document["annotations"][0]["mentions"][0]["start"], 3)
        self.assertEqual(document["annotations"][0]["mentions"][0]["end"], 5)
        self.assertIsNone(document["annotations"][0]["mentions"][0]["mask"])

    def test_unknown_labels_and_negative_context_are_retained(self):
        rows = [
            {"id": "positive", "text": "张三", "lang": "zh", "entities": [
                {"type": "person", "text": "张三", "start": 0, "end": 2},
            ]},
            {"id": "negative", "text": "你好", "lang": "zh", "entities": []},
        ]
        documents = load_documents("\n".join(map(json.dumps, rows)), "pii-bench-zh")
        report = score(documents, {"positive": {("PERSON", 0, 2)}, "negative": {("PERSON", 0, 2)}}, {"PERSON"})
        self.assertEqual(report["strict_spans"]["precision"], 0.5)
        self.assertEqual(report["strict_spans"]["recall"], 1)
        self.assertEqual(report["prediction_types_without_gold_support"], [])
        self.assertIsNone(report["masking_diagnostics"])

    def test_missing_predictions_cannot_improve_score(self):
        with self.assertRaises(ValueError):
            score([doc("文本", [])], {}, {"PERSON"})
        with self.assertRaises(ValueError):
            score([doc("文本", [])], {"doc": set(), "extra": set()}, {"PERSON"})

    def test_partial_mask_is_still_a_disclosure_and_public_name_is_overmasked(self):
        mentions = [
            {"type": "PERSON", "source_type": "PERSON", "start": 0, "end": 2,
             "mask": True, "decision": "DIRECT", "entity_id": "person"},
            {"type": "PERSON", "source_type": "PERSON", "start": 3, "end": 5,
             "mask": True, "decision": "DIRECT", "entity_id": "person"},
            {"type": "ORGANIZATION", "source_type": "ORG", "start": 6, "end": 8,
             "mask": False, "decision": "NO_MASK", "entity_id": "public"},
            {"type": None, "source_type": "DEM", "start": 9, "end": 11,
             "mask": True, "decision": "QUASI", "entity_id": "demographics"},
        ]
        report = score([doc("张三 张三 公司 工程", mentions)], {
            "doc": {("PERSON", 0, 2), ("PERSON", 3, 4), ("ORGANIZATION", 6, 8)},
        }, {"PERSON", "ORGANIZATION"})
        policy = report["masking_diagnostics"]
        self.assertEqual(policy["fully_covered_mentions"], 1)
        self.assertEqual(policy["protected_mentions"], 3)
        self.assertEqual(policy["fully_covered_entities"], 0)
        self.assertEqual(policy["no_mask_touch_rate"], 1)
        self.assertEqual(report["excluded_gold_mentions_by_source_type"], {"DEM": 1})
        self.assertEqual(report["span_coverage_by_source_type"]["PERSON"]["full_span_recall"], 0.5)
        self.assertEqual(report["span_coverage_by_source_type"]["PERSON"]["character_recall"], 0.75)

    def test_tab_keeps_annotator_disagreement(self):
        mention = {"entity_type": "PERSON", "start_offset": 0, "end_offset": 2,
                   "span_text": "张三", "identifier_type": "DIRECT", "entity_id": "a"}
        row = {"doc_id": "doc", "text": "张三", "annotations": {
            "a": {"entity_mentions": [mention]},
            "b": {"entity_mentions": [{**mention, "identifier_type": "NO_MASK"}]},
        }}
        documents = load_documents(json.dumps([row]), "tab")
        report = score(documents, {"doc": {("PERSON", 0, 2)}}, {"PERSON"})
        self.assertEqual(report["annotation_sets"], 2)
        self.assertEqual(report["masking_diagnostics"]["fully_covered_mentions"], 1)
        self.assertEqual(report["masking_diagnostics"]["no_mask_mentions_touched"], 1)

    def test_corrupted_gold_spans_and_duplicate_documents_fail(self):
        row = {"id": "id", "text": "🙂张三", "lang": "zh", "entities": [
            {"type": "person", "text": "张三", "start": 4, "end": 6},
        ]}
        with self.assertRaises(ValueError):
            load_documents(json.dumps(row), "pii-bench-zh")
        row["entities"] = []
        with self.assertRaises(ValueError):
            load_documents(json.dumps(row) + "\n" + json.dumps(row), "pii-bench-zh")

    def test_predictions_refuse_invalid_spans_and_nonfinite_scores(self):
        valid = {"entity_type": "PERSON", "start": 0, "end": 2, "score": 0.85}
        for mutation in [{"end": 3}, {"start": True}, {"score": float("nan")},
                         {"score": -0.1}, {"entity_type": "UNREQUESTED"}]:
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                validate_predictions("张三", [{**valid, **mutation}], {"PERSON"}, 0.5)
        self.assertEqual(validate_predictions("张三", [valid, valid], {"PERSON"}, 0.5), {("PERSON", 0, 2)})
        self.assertEqual(validate_predictions("张三", [{**valid, "score": 0.49}], {"PERSON"}, 0.5), set())

    def test_no_gold_is_undefined_rather_than_perfect_recall(self):
        report = score([doc("普通文本", [])], {"doc": set()}, {"PERSON"})
        self.assertIsNone(report["strict_spans"]["recall"])
        self.assertIsNone(report["strict_spans"]["f1"])

    def test_analyzer_refuses_external_destinations_before_sending_text(self):
        for url in ["http://example.com", "http://127.0.0.1.example.com",
                    "http://localhost", "http://127.0.0.1/api",
                    "http://user:pass@127.0.0.1", "http://127.0.0.1?target=external"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                analyze([], url, {"PERSON"}, 0.5, 1)


if __name__ == "__main__":
    unittest.main()
