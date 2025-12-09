use serde::{ser::SerializeMap, ser::SerializeSeq, Serialize};
use serde_cbor::value::{to_value, Value};

/// Encode a serde-serializable value into canonical CBOR bytes (RFC 8949 ordering).
///
/// Map keys are sorted by their canonical CBOR encoding: shortest first, then
/// lexicographic. Nested arrays/maps are canonicalized recursively.
pub fn encode_canonical<T: Serialize>(value: &T) -> Result<Vec<u8>, serde_cbor::Error> {
    let val = to_value(value)?;
    serde_cbor::to_vec(&CanonValue(&val))
}

struct CanonValue<'a>(&'a Value);

impl<'a> Serialize for CanonValue<'a> {
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
                // Map is BTreeMap; we re-sort entries by canonical CBOR key bytes.
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
