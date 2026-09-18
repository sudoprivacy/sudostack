//! Conformance for the derived Rust crate against the shared fixture corpus.
//!
//! The fixtures are materialized from the nexus owner repo at the pinned
//! revision; they are the final judge across every enabled language. This is
//! the Rust seat at that table — the TS package and the owner-side Python
//! adapter face the same cases.
use serde::de::DeserializeOwned;
use serde_json::Value;
use sudo_contracts::{
    Validate, Zone, ZoneCreateRequest, ZoneGrant, ZoneGrantCreateRequest, ZoneOperation,
    ZonePatchRequest,
};
use std::fs;
use std::path::PathBuf;

fn fixtures(name: &str) -> Vec<(String, Value)> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("contracts")
        .join("zone-v1")
        .join("fixtures")
        .join(format!("{name}.gen.json"));
    let doc: Value = serde_json::from_str(&fs::read_to_string(path).expect("fixture file"))
        .expect("fixture json");
    doc["cases"]
        .as_array()
        .expect("cases array")
        .iter()
        .map(|c| (c["name"].as_str().unwrap_or("?").to_string(), c["payload"].clone()))
        .collect()
}

/// Both layers must pass: serde structure (required/enums/unknown-tolerance)
/// and the value layer (validate()).
fn judge<T: DeserializeOwned + Validate>(payload: &Value) -> bool {
    serde_json::from_value::<T>(payload.clone())
        .map(|dto| dto.validate().is_ok())
        .unwrap_or(false)
}

fn judge_by_schema(schema: &str, payload: &Value) -> bool {
    match schema {
        "auth/v1/zone.schema.json" => judge::<Zone>(payload),
        "auth/v1/zone-create-request.schema.json" => judge::<ZoneCreateRequest>(payload),
        "auth/v1/zone-patch-request.schema.json" => judge::<ZonePatchRequest>(payload),
        "auth/v1/zone-grant.schema.json" => judge::<ZoneGrant>(payload),
        "auth/v1/zone-grant-create-request.schema.json" => judge::<ZoneGrantCreateRequest>(payload),
        "auth/v1/zone-operation.schema.json" => judge::<ZoneOperation>(payload),
        // common/v1 kinds appear nested inside the auth fixtures; standalone
        // cases for them live in the valid corpus under their own schema key.
        "common/v1/principal-ref.schema.json" => {
            judge::<Zone>(payload).then_some(false).unwrap_or_else(|| false)
                || serde_json::from_value::<sudo_contracts::PrincipalRef>(payload.clone())
                    .map(|p| p.validate().is_ok())
                    .unwrap_or(false)
        }
        "common/v1/resource-ref.schema.json" => serde_json::from_value::<sudo_contracts::ResourceRef>(
            payload.clone(),
        )
        .map(|r| r.validate().is_ok())
        .unwrap_or(false),
        other => panic!("no Rust judge mapped for {other}"),
    }
}

fn cases_with_schema(name: &str) -> Vec<(String, String, Value)> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("contracts")
        .join("zone-v1")
        .join("fixtures")
        .join(format!("{name}.gen.json"));
    let doc: Value = serde_json::from_str(&fs::read_to_string(path).expect("fixture file")).unwrap();
    doc["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| {
            (
                c["name"].as_str().unwrap_or("?").to_string(),
                c["schema"].as_str().unwrap_or("").to_string(),
                c["payload"].clone(),
            )
        })
        .collect()
}

#[test]
fn every_valid_fixture_is_accepted() {
    for (name, schema, payload) in cases_with_schema("valid") {
        assert!(judge_by_schema(&schema, &payload), "valid/{name} should parse and validate");
    }
}

#[test]
fn every_invalid_fixture_is_rejected() {
    for (name, schema, payload) in cases_with_schema("invalid") {
        assert!(!judge_by_schema(&schema, &payload), "invalid/{name} must be rejected");
    }
}

#[test]
fn path_traversal_is_rejected() {
    for (name, schema, payload) in cases_with_schema("path-traversal") {
        assert!(!judge_by_schema(&schema, &payload), "path-traversal/{name} must be rejected");
    }
}

#[test]
fn secret_styled_unknown_optionals_are_accepted_at_the_wire_layer() {
    // serde ignores unknown fields by design — the wire rule for unknown
    // optionals. Secret-styled unknown keys therefore survive deserialization
    // gating but never appear on the DTO (there is no field to carry them).
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("contracts")
        .join("zone-v1")
        .join("fixtures")
        .join("secret-negative.gen.json");
    let doc: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    for case in doc["cases"].as_array().unwrap() {
        if case["expect"].as_str() != Some("accepted-and-dropped") {
            continue;
        }
        let schema = case["schema"].as_str().unwrap();
        assert!(judge_by_schema(schema, &case["payload"]), "secret-negative case must be accepted");
    }
}

#[test]
fn roundtrip_is_semantically_equivalent() {
    for (name, schema, payload) in cases_with_schema("roundtrip") {
        let once = serde_json::to_value(&payload).unwrap();
        let twice = serde_json::from_str::<Value>(&serde_json::to_string(&once).unwrap()).unwrap();
        assert_eq!(once, twice, "roundtrip/{name} must be JSON-stable");
        assert!(judge_by_schema(&schema, &twice), "roundtrip/{name} must stay valid");
    }
}

#[test]
fn compatibility_baseline_verdicts_hold() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("contracts")
        .join("zone-v1")
        .join("fixtures")
        .join("compatibility.gen.json");
    let doc: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    for case in doc["cases"].as_array().unwrap() {
        let expected = case["expected"].as_str() == Some("valid");
        let schema = case["schema"].as_str().unwrap();
        let name = case["name"].as_str().unwrap_or("?");
        assert_eq!(
            judge_by_schema(schema, &case["payload"]),
            expected,
            "compatibility/{name} drifted from the baseline"
        );
    }
}
