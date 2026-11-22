use base64::{engine::general_purpose, Engine as _};
use serde::ser::{SerializeMap, SerializeSeq};
use serde::Deserialize;
use serde_cbor::value::{to_value, Value};
use sha2::{Digest, Sha256};
use std::error::Error;
use std::fs;

fn encode_canonical(value: &serde_json::Value) -> Result<Vec<u8>, serde_cbor::Error> {
    let val: Value = to_value(value)?;
    serde_cbor::to_vec(&CanonValue(&val))
}

struct CanonValue<'a>(&'a Value);

impl<'a> serde::Serialize for CanonValue<'a> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self.0 {
            Value::Array(items) => {
                let mut seq = serializer.serialize_seq(Some(items.len()))?;
                for item in items {
                    seq.serialize_element(&CanonValue(item))?;
                }
                seq.end()
            }
            Value::Map(map) => {
                let mut entries = Vec::with_capacity(map.len());
                for (k, v) in map.iter() {
                    let key_bytes =
                        serde_cbor::to_vec(&CanonValue(k)).map_err(serde::ser::Error::custom)?;
                    entries.push((key_bytes, k, v));
                }
                entries.sort_by(|(kb1, _, _), (kb2, _, _)| {
                    kb1.len().cmp(&kb2.len()).then_with(|| kb1.cmp(kb2))
                });

                let mut map_ser = serializer.serialize_map(Some(entries.len()))?;
                for (_, k, v) in entries {
                    map_ser.serialize_entry(&CanonValue(k), &CanonValue(v))?;
                }
                map_ser.end()
            }
            other => other.serialize(serializer),
        }
    }
}

#[derive(Deserialize)]
struct FlowDoc {
    handshake_flow: HandshakeFlow,
}

#[derive(Deserialize)]
struct HandshakeFlow {
    steps: Vec<Step>,
}

#[derive(Deserialize)]
struct Step {
    message: serde_json::Value,
}

fn main() -> Result<(), Box<dyn Error>> {
    let data = fs::read_to_string("tests/common/handshake/v0.9/handshake_flow_test_vectors.json")?;
    let doc: serde_json::Value = serde_json::from_str(&data)?;
    let flow = doc.get("handshake_flow").ok_or("missing handshake_flow")?;
    let transcript = flow
        .get("transcript")
        .ok_or("missing handshake_flow.transcript")?;

    let raw_cbor_b64 = transcript
        .get("handshake_transcript_raw_cbor_b64")
        .and_then(|v| v.as_str())
        .ok_or("missing transcript.handshake_transcript_raw_cbor_b64")?;
    let expected_session = transcript
        .get("session_id_b64")
        .and_then(|v| v.as_str())
        .ok_or("missing transcript.session_id_b64")?;

    let raw_cbor = general_purpose::STANDARD.decode(raw_cbor_b64)?;
    let derived_session = general_purpose::STANDARD.encode(Sha256::digest(&raw_cbor));
    if derived_session != expected_session {
        return Err(format!(
            "session_id_b64 mismatch: {} != {}",
            expected_session, derived_session
        )
        .into());
    }

    let steps = flow
        .get("steps")
        .and_then(|v| v.as_array())
        .ok_or("handshake_flow.steps missing")?;
    if steps.len() < 3 {
        return Err("handshake_flow missing steps".into());
    }
    let init = steps[0].get("message").ok_or("step0 missing message")?;
    let resp = steps[1].get("message").ok_or("step1 missing message")?;
    let complete = steps[2].get("message").ok_or("step2 missing message")?;

    let resp_session = resp
        .get("session_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let complete_session = complete
        .get("session_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if resp_session != expected_session {
        return Err(format!(
            "HANDSHAKE_RESPONSE.session_id mismatch: {} != {}",
            resp_session, expected_session
        )
        .into());
    }
    if complete_session != expected_session {
        return Err(format!(
            "HANDSHAKE_COMPLETE.session_id mismatch: {} != {}",
            complete_session, expected_session
        )
        .into());
    }

    for (msg, name) in [
        (init, "HANDSHAKE_INIT"),
        (resp, "HANDSHAKE_RESPONSE"),
        (complete, "HANDSHAKE_COMPLETE"),
    ] {
        if msg.get("timestamp_ms").is_none() {
            return Err(format!("{} missing timestamp_ms", name).into());
        }
    }

    println!("✅ handshake_flow v0.9 transcript binding matches (Rust)");
    Ok(())
}
