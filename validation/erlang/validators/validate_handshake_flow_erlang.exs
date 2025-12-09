# Erlang/Elixir handshake flow validator
# Recomputes handshake_hash/session_id from HANDSHAKE_RESPONSE using canonical CBOR
# ordering and compares to HANDSHAKE_COMPLETE in the shared vector.

Mix.install(
  [
    {:jason, "~> 1.4"}
  ],
  lockfile: Path.expand("../mix.lock", __DIR__)
)

Code.require_file(Path.expand("../lib/foxwhisper/util/reporting.ex", __DIR__))
Code.require_file(Path.expand("../lib/foxwhisper/util/fw_cbor_canonical.ex", __DIR__))

alias Foxwhisper.Util.Reporting
alias FWCBORCanonical, as: CBCOR

hkdf_one_block = fn ikm, info ->
  salt = <<0::256>>
  prk = :crypto.mac(:hmac, :sha256, salt, ikm)
  t1 = :crypto.mac(:hmac, :sha256, prk, <<info::binary, 1>>)
  binary_part(t1, 0, 32)
end

path = Reporting.input_path("tests/common/handshake/end_to_end_test_vectors.json")
{:ok, json} = File.read(path)
{:ok, doc} = Jason.decode(json)

flow = Map.fetch!(doc, "handshake_flow")
steps = Map.fetch!(flow, "steps")

if length(steps) < 3 do
  IO.puts("handshake_flow missing steps")
  System.halt(1)
end

resp = steps |> Enum.at(1) |> Map.fetch!("message")
complete = steps |> Enum.at(2) |> Map.fetch!("message")

encoded = CBCOR.encode(resp)
handshake_hash = :crypto.hash(:sha256, encoded) |> Base.encode64()

session_id = hkdf_one_block.(Base.decode64!(handshake_hash), "FoxWhisper-SessionId")
session_b64 = Base.encode64(session_id)

if handshake_hash != complete["handshake_hash"] do
  IO.puts("handshake_hash mismatch")
  IO.puts("expected: #{complete["handshake_hash"]}")
  IO.puts("got:      #{handshake_hash}")
  System.halt(1)
end

if session_b64 != complete["session_id"] do
  IO.puts("session_id mismatch")
  IO.puts("expected: #{complete["session_id"]}")
  IO.puts("got:      #{session_b64}")
  System.halt(1)
end

IO.puts("✅ handshake_flow derivation matches (Erlang)")
