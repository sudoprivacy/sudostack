use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const COMMON_API_VERSION: &str = "common.sudo.dev/v1";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResourceRef {
    pub api_version: String,
    pub kind: String,
    pub zone_id: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ErrorInfo {
    pub api_version: String,
    pub kind: String,
    pub code: String,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cause_ref: Option<ResourceRef>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

pub fn validate_resource_ref(value: &ResourceRef) -> Result<(), String> {
    if value.api_version != COMMON_API_VERSION {
        return Err("unsupported api_version".into());
    }
    if value.kind != "ResourceRef" {
        return Err("expected ResourceRef".into());
    }
    validate_no_forbidden_inline_fields(&value.extra)?;
    validate_zone_id_shape(&value.zone_id)?;
    if !value.path.starts_with('/') {
        return Err("path must be zone-relative absolute".into());
    }
    if let Some(size) = value.size_bytes {
        let _ = size;
    }
    if let Some(digest) = &value.digest {
        if !is_digest(digest) {
            return Err("digest must carry an algorithm prefix".into());
        }
    }
    if let Some(media_type) = &value.media_type {
        if !is_media_type(media_type) {
            return Err("media_type must be type/subtype".into());
        }
    }
    Ok(())
}

pub fn validate_error_info(value: &ErrorInfo) -> Result<(), String> {
    if value.api_version != COMMON_API_VERSION {
        return Err("unsupported api_version".into());
    }
    if value.kind != "ErrorInfo" {
        return Err("expected ErrorInfo".into());
    }
    validate_no_forbidden_inline_fields(&value.extra)?;
    if value.message.is_empty() {
        return Err("message must not be empty".into());
    }
    if !value
        .code
        .chars()
        .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
        || !value.code.chars().next().is_some_and(|c| c.is_ascii_uppercase())
    {
        return Err("code must be upper snake case".into());
    }
    if let Some(cause_ref) = &value.cause_ref {
        validate_resource_ref(cause_ref)?;
    }
    if let Some(details) = &value.details {
        validate_no_forbidden_value(details)?;
    }
    Ok(())
}

fn validate_zone_id_shape(id: &str) -> Result<(), String> {
    let len = id.chars().count();
    if !(3..=63).contains(&len) {
        return Err("zone_id length must be 3-63".into());
    }
    if id.starts_with('-') || id.ends_with('-') {
        return Err("zone_id must not start or end with hyphen".into());
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err("zone_id contains an unsupported character".into());
    }
    Ok(())
}

fn is_digest(value: &str) -> bool {
    let Some((algorithm, body)) = value.split_once(':') else {
        return false;
    };
    !algorithm.is_empty()
        && algorithm
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '+' | '.' | '-'))
        && algorithm.chars().next().is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && !body.is_empty()
        && body
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '~' | '+' | '/' | '=' | '-'))
}

fn is_media_type(value: &str) -> bool {
    let Some((top, sub)) = value.split_once('/') else {
        return false;
    };
    !top.is_empty()
        && !sub.is_empty()
        && !top.chars().any(char::is_whitespace)
        && !sub.chars().any(char::is_whitespace)
}

fn validate_no_forbidden_inline_fields(extra: &BTreeMap<String, serde_json::Value>) -> Result<(), String> {
    for (key, value) in extra {
        if is_forbidden_inline_field(key) {
            return Err(format!("forbidden inline secret-like field {key}"));
        }
        validate_no_forbidden_value(value)?;
    }
    Ok(())
}

fn validate_no_forbidden_value(value: &serde_json::Value) -> Result<(), String> {
    match value {
        serde_json::Value::Object(map) => {
            for (key, value) in map {
                if is_forbidden_inline_field(key) {
                    return Err(format!("forbidden inline secret-like field {key}"));
                }
                validate_no_forbidden_value(value)?;
            }
        }
        serde_json::Value::Array(values) => {
            for value in values {
                validate_no_forbidden_value(value)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn is_forbidden_inline_field(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    key.contains("secret")
        || key.contains("credential")
        || key.contains("password")
        || key.contains("private_key")
        || key.contains("private-key")
        || key.contains("access_token")
        || key.contains("access-token")
        || key.contains("refresh_token")
        || key.contains("refresh-token")
        || key.contains("id_token")
        || key.contains("id-token")
        || key.contains("api_key")
        || key.contains("api-key")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf};

    fn repo() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(|p| p.parent())
            .expect("crate is under crates/rust")
            .to_path_buf()
    }

    #[test]
    fn valid_fixtures_parse_and_validate() {
        for path in fixture_files("fixtures/valid/common/v1") {
            parse_and_validate(&path).unwrap_or_else(|err| panic!("{}: {err}", path.display()));
        }
    }

    #[test]
    fn invalid_fixtures_are_refused() {
        for path in fixture_files("fixtures/invalid/common/v1") {
            assert!(
                parse_and_validate(&path).is_err(),
                "{} should be rejected",
                path.display()
            );
        }
    }

    #[test]
    fn roundtrip_fixtures_keep_semantics() {
        for path in fixture_files("fixtures/roundtrip/common/v1") {
            let json = fs::read_to_string(&path).unwrap();
            let value: serde_json::Value = serde_json::from_str(&json).unwrap();
            let again = parse_validate_and_serialize(&path)
                .unwrap_or_else(|err| panic!("{}: {err}", path.display()));
            assert_eq!(value, again, "{} changed during roundtrip", path.display());
        }
    }

    fn fixture_files(root: &str) -> Vec<PathBuf> {
        let mut out = Vec::new();
        visit(&repo().join(root), &mut out);
        out.sort();
        out
    }

    fn visit(dir: &PathBuf, out: &mut Vec<PathBuf>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                visit(&path, out);
            } else if path.extension().is_some_and(|ext| ext == "json") {
                out.push(path);
            }
        }
    }

    fn parse_and_validate(path: &PathBuf) -> Result<(), String> {
        let json = fs::read_to_string(path).map_err(|err| err.to_string())?;
        let value: serde_json::Value = serde_json::from_str(&json).map_err(|err| err.to_string())?;
        let kind = value
            .get("kind")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| "missing kind".to_string())?;
        match kind {
            "ResourceRef" => {
                let value: ResourceRef = serde_json::from_str(&json).map_err(|err| err.to_string())?;
                validate_resource_ref(&value)
            }
            "ErrorInfo" => {
                let value: ErrorInfo = serde_json::from_str(&json).map_err(|err| err.to_string())?;
                validate_error_info(&value)
            }
            other => Err(format!("unsupported kind {other}")),
        }
    }

    fn parse_validate_and_serialize(path: &PathBuf) -> Result<serde_json::Value, String> {
        let json = fs::read_to_string(path).map_err(|err| err.to_string())?;
        let value: serde_json::Value = serde_json::from_str(&json).map_err(|err| err.to_string())?;
        let kind = value
            .get("kind")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| "missing kind".to_string())?;
        match kind {
            "ResourceRef" => {
                let value: ResourceRef = serde_json::from_str(&json).map_err(|err| err.to_string())?;
                validate_resource_ref(&value)?;
                serde_json::to_value(value).map_err(|err| err.to_string())
            }
            "ErrorInfo" => {
                let value: ErrorInfo = serde_json::from_str(&json).map_err(|err| err.to_string())?;
                validate_error_info(&value)?;
                serde_json::to_value(value).map_err(|err| err.to_string())
            }
            other => Err(format!("unsupported kind {other}")),
        }
    }
}
