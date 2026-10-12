import json
import tempfile
import unittest
from pathlib import Path

from business_policy import BusinessPolicy


def config(**changes):
    return {"version": 1, "public_organizations": [], "protected_terms": [], "protected_markers": [], **changes}


def organization(start, end):
    return {"entity_type": "ORGANIZATION", "start": start, "end": end, "score": 0.85}


class BusinessPolicyTests(unittest.TestCase):
    def test_public_exception_is_exact_and_only_for_organization(self):
        policy = BusinessPolicy(config(public_organizations=["Example"])); text = "Example Example Corp"
        person = {**organization(0, 7), "entity_type": "PERSON"}
        self.assertEqual(policy.apply(text, [organization(0, 7), organization(8, 20), person]), [person, organization(8, 20)])

    def test_explicit_protection_wins_even_without_a_ner_hit(self):
        policy = BusinessPolicy(config(public_organizations=["甲公司"], protected_terms=["甲公司"]))
        self.assertEqual(policy.apply("甲公司", [organization(0, 3)])[1]["entity_type"], "PROTECTED_TERM")
        self.assertEqual(policy.apply("甲公司", [])[0]["end"], 3)

    def test_literal_metacharacters_repeats_overlaps_and_unicode(self):
        policy = BusinessPolicy(config(protected_terms=["😀甲", "甲.乙", "aa"]))
        spans = {(item["start"], item["end"]) for item in policy.apply("😀甲.乙 aaa 😀甲", [])}
        self.assertEqual(spans, {(0, 2), (1, 4), (5, 7), (6, 8), (9, 11)})

    def test_marked_record_overrides_public_company(self):
        policy = BusinessPolicy(config(public_organizations=["甲公司"], protected_markers=["客户名单："]))
        findings = policy.apply("客户名单：甲公司", [organization(5, 8)])
        self.assertEqual(findings[0], {"entity_type": "PROTECTED_RECORD", "start": 0, "end": 8, "score": 1.0})
        self.assertEqual(len(findings), 2)

    def test_ordinary_prose_has_no_added_protection(self):
        policy = BusinessPolicy(config(protected_terms=["甲公司"], protected_markers=["客户名单："]))
        self.assertEqual(policy.apply("讨论客户名单功能和甲公示", []), [])

    def test_both_business_families_have_positive_and_negative_cases(self):
        acceptance = Path(__file__).resolve().parents[1] / "acceptance"
        policy = BusinessPolicy.load(acceptance / "business-policy.fixture.json")
        cases = json.loads((acceptance / "business-cases.fixture.json").read_text(encoding="utf-8"))["cases"]
        self.assertEqual({item["family"] for item in cases}, {"customer_contract", "source_technical"})
        for family in {item["family"] for item in cases}:
            self.assertEqual({item["protected"] for item in cases if item["family"] == family}, {True, False})
        for case in cases:
            with self.subTest(case=case["id"]):
                findings = policy.apply(case["text"], [])
                self.assertEqual(bool(findings), case["protected"])
                if case["whole_record"]:
                    self.assertTrue(any(item["start"] == 0 and item["end"] == len(case["text"]) for item in findings))

    def test_invalid_policies_abort_instead_of_dropping_rules(self):
        for data in [[], {}, config(version=True), config(version=2), config(unknown=[]), config(protected_terms=[""]), config(protected_terms=["a", "a"]), config(protected_terms="a"), config(public_organizations=[1])]:
            with self.subTest(data=data), self.assertRaises(ValueError):
                BusinessPolicy(data)

    def test_invalid_offsets_fail_classification(self):
        policy = BusinessPolicy(config())
        for start, end in [(-1, 1), (0, 3), (1, 1), (True, 2)]:
            with self.subTest(start=start, end=end), self.assertRaises(ValueError):
                policy.apply("甲乙", [organization(start, end)])

    def test_policy_identity_tracks_every_rule_and_ignores_json_formatting(self):
        first = BusinessPolicy(config(protected_terms=["a"]))
        same = BusinessPolicy(json.loads(json.dumps(config(protected_terms=["a"]), sort_keys=True)))
        self.assertEqual(first.sha256, same.sha256)
        self.assertNotEqual(first.sha256, BusinessPolicy(config(protected_terms=["b"])).sha256)

    def test_missing_invalid_and_oversized_files_abort(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "policy.json"
            with self.assertRaises(FileNotFoundError):
                BusinessPolicy.load(path)
            for raw in [b"{", b'{"version":1,"version":2}', b" " * (2 * 1024 * 1024 + 1)]:
                path.write_bytes(raw)
                with self.assertRaises(ValueError):
                    BusinessPolicy.load(path)


if __name__ == "__main__":
    unittest.main()
