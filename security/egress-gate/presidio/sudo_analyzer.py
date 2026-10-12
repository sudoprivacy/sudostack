"""Presidio application with a boot-time business policy on the gate endpoint."""

import math
import os

from flask import jsonify, request
from business_policy import BusinessPolicy


def create_app():
    """Reuse the pinned upstream engine and add deployment policy after recognition."""
    from app import Server

    policy = BusinessPolicy.load(os.environ.get("DLP_POLICY_FILE", "/app/conf-zh/business-policy.json"))
    server = Server()
    app = server.app
    app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024

    def analyze():
        try:
            data = request.get_json()
            allowed = {"text", "language", "entities", "score_threshold"}
            if not isinstance(data, dict) or set(data) - allowed:
                return jsonify(error="Unsupported analyzer request"), 400
            text, language = data.get("text"), data.get("language")
            entities, threshold = data.get("entities"), data.get("score_threshold", 0.5)
            if not isinstance(text, str) or not text or language not in ("en", "zh"):
                return jsonify(error="Invalid analyzer request"), 400
            if isinstance(threshold, bool) or not isinstance(threshold, (int, float)) or not math.isfinite(threshold) or not 0 <= threshold <= 1:
                return jsonify(error="Invalid score threshold"), 400
            if entities is not None and (not isinstance(entities, list) or not entities or any(not isinstance(item, str) or not item for item in entities)):
                return jsonify(error="Invalid entity selection"), 400
            results = server.engine.analyze(text=text, language=language, entities=entities, score_threshold=threshold)
            findings = [{"entity_type": item.entity_type, "start": item.start, "end": item.end, "score": item.score} for item in results]
            # Protection is deployment policy: callers cannot remove it with an
            # entity filter, an allow-list or a high statistical score threshold.
            return jsonify(policy.apply(text, findings))
        except Exception:
            # Provider exceptions can contain submitted text. Neither HTTP errors
            # nor application logs repeat that text at this trust boundary.
            return jsonify(error="Analyzer could not classify the request"), 500

    app.view_functions["analyze"] = analyze

    @app.get("/policy")
    def policy_identity():
        return jsonify(version=1, sha256=policy.sha256)

    return app
