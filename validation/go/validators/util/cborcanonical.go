package util

import (
	"github.com/fxamacker/cbor/v2"
)

// EncodeCanonical encodes the given value using RFC 8949 canonical CBOR rules.
func EncodeCanonical(v any) ([]byte, error) {
	enc, err := cbor.CanonicalEncOptions().EncMode()
	if err != nil {
		return nil, err
	}
	return enc.Marshal(v)
}
