use base64::{engine::general_purpose, Engine as _};
use hkdf::Hkdf;
use serde::Deserialize;
use serde::ser::{SerializeMap, SerializeSeq};
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
                    let key_bytes = serde_cbor::to_vec(&CanonValue(k)).map_err(serde::ser::Error::custom)?;
                    entries.push((key_bytes, k, v));
                }
                entries.sort_by(|(kb1, _, _), (kb2, _, _)| kb1.len().cmp(&kb2.len()).then_with(|| kb1.cmp(kb2)));

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
    let data = fs::read_to_string("tests/common/handshake/end_to_end_test_vectors.json")?;
    let doc: FlowDoc = serde_json::from_str(&data)?;
    let steps = &doc.handshake_flow.steps;
    if steps.len() < 3 {
        return Err("handshake_flow missing steps".into());
    }
    let resp = &steps[1].message;
    let complete = &steps[2].message;

    let encoded = encode_canonical(resp)?;
    let hash = Sha256::digest(&encoded);
    let handshake_hash = general_purpose::STANDARD.encode(hash);

    let hk = Hkdf::<Sha256>::new(None, &hash);
    let mut okm = [0u8; 32];
    hk.expand(b"FoxWhisper-SessionId", &mut okm)
        .map_err(|e| format!("hkdf expand failed: {e}"))?;
    let session_id = general_purpose::STANDARD.encode(okm);

    let expected_hash = complete["handshake_hash"].as_str().unwrap_or("");
    let expected_session = complete["session_id"].as_str().unwrap_or("");

    if handshake_hash != expected_hash {
        return Err(format!("handshake_hash mismatch: {} != {}", expected_hash, handshake_hash).into());
    }
    if session_id != expected_session {
        return Err(format!("session_id mismatch: {} != {}", expected_session, session_id).into());
    }

    println!("✅ handshake_flow derivation matches (Rust)");
    Ok(())
}
