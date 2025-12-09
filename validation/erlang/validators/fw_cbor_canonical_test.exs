ExUnit.start()
Code.require_file(Path.expand("../lib/foxwhisper/util/fw_cbor_canonical.ex", __DIR__))

# Ensure module is available
Code.require_file(Path.expand("../lib/foxwhisper/util/fw_cbor_canonical.ex", __DIR__))

defmodule CBCORCanonicalTest do
  use ExUnit.Case, async: true

  test "map keys are sorted canonically" do
    bin = FWCBORCanonical.encode(%{"b" => 2, "a" => 1})
    # Expected: a2 61 61 01 61 62 02
    assert bin == <<0xA2, 0x61, 0x61, 0x01, 0x61, 0x62, 0x02>>
  end

  test "uint encoding" do
    assert FWCBORCanonical.encode(1) == <<1>>
    assert FWCBORCanonical.encode(24) == <<0x18, 0x18>>
  end

  test "array encoding" do
    assert FWCBORCanonical.encode([1, 2]) == <<0x82, 0x01, 0x02>>
  end
end
