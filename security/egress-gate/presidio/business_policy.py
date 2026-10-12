"""Deployment-owned literal protection; offsets remain Unicode code points."""

import hashlib
import json
from pathlib import Path


class BusinessPolicy:
    """Protect known values and marked records independently of statistical NER."""

    def __init__(self, data):
        expected = {"version", "public_organizations", "protected_terms", "protected_markers"}
        if not isinstance(data, dict) or set(data) != expected or type(data["version"]) is not int or data["version"] != 1:
            raise ValueError("Invalid DLP policy schema")
        for key in expected - {"version"}:
            values = data[key]
            if not isinstance(values, list) or len(values) > 10000 or any(
                not isinstance(value, str) or not value.strip() or len(value) > 512 for value in values
            ) or len(set(values)) != len(values):
                raise ValueError("Invalid DLP policy list")
        self.public_organizations = frozenset(data["public_organizations"])
        self.protected_terms = tuple(data["protected_terms"])
        self.protected_markers = tuple(data["protected_markers"])
        canonical = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        self.sha256 = hashlib.sha256(canonical).hexdigest()

    @classmethod
    def load(cls, filename):
        """Load at startup; a missing, malformed or oversized policy aborts boot."""
        with Path(filename).open("rb") as stream:
            raw = stream.read(2 * 1024 * 1024 + 1)
        if len(raw) > 2 * 1024 * 1024:
            raise ValueError("DLP policy exceeds size limit")
        def unique_object(pairs):
            data = {}
            for key, value in pairs:
                if key in data:
                    raise ValueError("Duplicate DLP policy field")
                data[key] = value
            return data
        return cls(json.loads(raw, object_pairs_hook=unique_object))

    def apply(self, text, findings):
        """An explicit protection always wins over a public-company exception."""
        protected = []
        if text and any(marker in text for marker in self.protected_markers):
            protected.append({"entity_type": "PROTECTED_RECORD", "start": 0, "end": len(text), "score": 1.0})
        for term in self.protected_terms:
            start = text.find(term)
            while start >= 0:
                protected.append({"entity_type": "PROTECTED_TERM", "start": start, "end": start + len(term), "score": 1.0})
                start = text.find(term, start + 1)
        retained = []
        for finding in findings:
            start, end = finding["start"], finding["end"]
            if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(text):
                raise ValueError("Invalid analyzer span")
            is_public = finding["entity_type"] == "ORGANIZATION" and text[start:end] in self.public_organizations
            is_protected = any(start < item["end"] and item["start"] < end for item in protected)
            if not is_public or is_protected:
                retained.append(finding)
        unique = {(item["entity_type"], item["start"], item["end"]): item for item in retained + protected}
        return sorted(unique.values(), key=lambda item: (item["start"], item["end"], item["entity_type"]))
