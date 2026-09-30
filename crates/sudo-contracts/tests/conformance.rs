//! Conformance for the derived Rust crate against the shared fixture corpus.
//!
//! The fixtures are materialized from the nexus owner repo at the pinned
//! revision; they are the final judge across every enabled language. This is
//! the Rust seat at that table — the TS package and the owner-side Python
//! adapter face the same cases.
use serde::de::DeserializeOwned;
use serde_json::Value;
use sudo_contracts::{
    RuntimeResourceScope, Validate, Zone, ZoneCreateRequest, ZoneDelegation,
    ZoneDelegationIssueRequest, ZoneDelegationScopeRule, ZoneGrant, ZoneGrantCreateRequest,
    ZoneOperation, ZonePatchRequest,
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
        "auth/v1/zone-delegation-scope-rule.schema.json" => judge::<ZoneDelegationScopeRule>(payload),
        "auth/v1/zone-delegation-issue-request.schema.json" => judge::<ZoneDelegationIssueRequest>(payload),
        "auth/v1/zone-delegation.schema.json" => judge::<ZoneDelegation>(payload),
        "runtime/v2/runtime-resource-scope.schema.json" => judge::<RuntimeResourceScope>(payload),
        // common/v1 kinds appear nested inside the auth fixtures; standalone
        // cases for them live in the valid corpus under their own schema key.
        "common/v1/principal-ref.schema.json" => {
            serde_json::from_value::<sudo_contracts::PrincipalRef>(payload.clone())
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

/// Deserialize into the DTO and serialize back — the real roundtrip. A
/// rename_all typo or a `skip_serializing_if` that drops a present field
/// shows up here as a key that changed or vanished, which is exactly the
/// class of bug a Value→Value copy could never see.
fn roundtrip_by_schema(schema: &str, payload: &Value) -> Value {
    macro_rules! rt {
        ($t:ty) => {
            serde_json::to_value(serde_json::from_value::<$t>(payload.clone()).expect("fixture must deserialize"))
                .expect("DTO serialization must not fail")
        };
    }
    match schema {
        "auth/v1/zone.schema.json" => rt!(Zone),
        "auth/v1/zone-create-request.schema.json" => rt!(ZoneCreateRequest),
        "auth/v1/zone-patch-request.schema.json" => rt!(ZonePatchRequest),
        "auth/v1/zone-grant.schema.json" => rt!(ZoneGrant),
        "auth/v1/zone-grant-create-request.schema.json" => rt!(ZoneGrantCreateRequest),
        "auth/v1/zone-operation.schema.json" => rt!(ZoneOperation),
        "auth/v1/zone-delegation-scope-rule.schema.json" => rt!(ZoneDelegationScopeRule),
        "auth/v1/zone-delegation-issue-request.schema.json" => rt!(ZoneDelegationIssueRequest),
        "auth/v1/zone-delegation.schema.json" => rt!(ZoneDelegation),
        "runtime/v2/runtime-resource-scope.schema.json" => rt!(RuntimeResourceScope),
        "common/v1/principal-ref.schema.json" => rt!(sudo_contracts::PrincipalRef),
        "common/v1/resource-ref.schema.json" => rt!(sudo_contracts::ResourceRef),
        other => panic!("no Rust roundtrip mapped for {other}"),
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
        let once = roundtrip_by_schema(&schema, &payload);
        // Every key the wire payload carried must survive the DTO with the
        // same value — a rename_all typo or a skip_serializing_if dropping a
        // present field breaks this immediately.
        let input = payload.as_object().expect("object payload");
        for (key, value) in input {
            assert_eq!(once.get(key), Some(value), "roundtrip/{name}: key `{key}` changed");
        }
        // Serialization may only ADD documented serde defaults (`ttl_s` on
        // the delegation issue request); anything else added is a surprise.
        let added: Vec<&String> = once
            .as_object()
            .expect("serialized DTO is an object")
            .keys()
            .filter(|k| !input.contains_key(*k))
            .collect();
        assert!(
            added.iter().all(|k| k.as_str() == "ttl_s"),
            "roundtrip/{name}: unexpected keys added by serialization: {added:?}"
        );
        assert!(judge_by_schema(&schema, &once), "roundtrip/{name} must stay valid");
    }
}

/// Boundary cases the shared corpus does not (yet) carry: the exact inputs
/// where the hand-written value layer could silently disagree with the owner
/// schema. Each of these three once separated Rust's verdict from the
/// schema's while every fixture stayed green.
#[test]
fn owner_schema_boundaries_hold_where_fixtures_are_silent() {
    use serde_json::json;

    let cases = cases_with_schema("valid");
    let find = |schema: &str| cases.iter().find(|c| c.1 == schema).expect(schema).2.clone();

    // 1. Capability segments are [a-z-] per the schema pattern
    //    `^zone\.[a-z-]+\.[a-z-]+$` — digits are not legal in any segment.
    let mut grant = find("auth/v1/zone-grant.schema.json");
    grant["capabilities"][0] = json!("zone.data2.read");
    assert!(!judge_by_schema("auth/v1/zone-grant.schema.json", &grant));
    let mut gcr = find("auth/v1/zone-grant-create-request.schema.json");
    gcr["capabilities"][0] = json!("zone.data2.read");
    assert!(!judge_by_schema("auth/v1/zone-grant-create-request.schema.json", &gcr));
    let mut rule = find("auth/v1/zone-delegation-scope-rule.schema.json");
    rule["capability"] = json!("zone.data2.read");
    assert!(!judge_by_schema("auth/v1/zone-delegation-scope-rule.schema.json", &rule));

    // 2. The schema sets minProperties: 1 on patch deployment — an empty
    //    placement object is not a patch.
    let patch = json!({"api_version": "auth.sudo.dev/v1", "kind": "ZonePatchRequest", "deployment": {}});
    assert!(!judge_by_schema("auth/v1/zone-patch-request.schema.json", &patch));

    // 3. result and error.details are type: object in the schema — a scalar
    //    in either position must be refused.
    let mut op = find("auth/v1/zone-operation.schema.json");
    op["result"] = json!("oops");
    assert!(!judge_by_schema("auth/v1/zone-operation.schema.json", &op));
    let mut op_err = find("auth/v1/zone-operation.schema.json");
    op_err["error"] = json!({
        "code": "ZONE_QUORUM_UNAVAILABLE",
        "message": "quorum lost",
        "retryable": true,
        "details": "oops"
    });
    assert!(!judge_by_schema("auth/v1/zone-operation.schema.json", &op_err));
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
