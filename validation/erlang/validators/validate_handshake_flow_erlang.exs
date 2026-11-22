# Erlang/Elixir handshake flow validator
# Verifies v0.9 transcript binding: session_id = SHA256(handshake_transcript_raw_cbor).

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

path = Reporting.input_path("tests/common/handshake/v0.9/handshake_flow_test_vectors.json")
{:ok, json} = File.read(path)
{:ok, doc} = Jason.decode(json)

flow = Map.fetch!(doc, "handshake_flow")
steps = Map.fetch!(flow, "steps")
transcript = Map.fetch!(flow, "transcript")

if length(steps) < 3 do
  IO.puts("handshake_flow missing steps")
  System.halt(1)
end

init = steps |> Enum.at(0) |> Map.fetch!("message")
resp = steps |> Enum.at(1) |> Map.fetch!("message")
complete = steps |> Enum.at(2) |> Map.fetch!("message")

raw_cbor_b64 = Map.fetch!(transcript, "handshake_transcript_raw_cbor_b64")
expected_session_b64 = Map.fetch!(transcript, "session_id_b64")

raw_cbor = Base.decode64!(raw_cbor_b64)
derived_session_b64 = :crypto.hash(:sha256, raw_cbor) |> Base.encode64()

if derived_session_b64 != expected_session_b64 do
  IO.puts("session_id_b64 mismatch")
  IO.puts("expected: #{expected_session_b64}")
  IO.puts("got:      #{derived_session_b64}")
  System.halt(1)
end

if resp["session_id"] != expected_session_b64 do
  IO.puts("HANDSHAKE_RESPONSE.session_id mismatch")
  IO.puts("expected: #{expected_session_b64}")
  IO.puts("got:      #{resp["session_id"]}")
  System.halt(1)
end

if complete["session_id"] != expected_session_b64 do
  IO.puts("HANDSHAKE_COMPLETE.session_id mismatch")
  IO.puts("expected: #{expected_session_b64}")
  IO.puts("got:      #{complete["session_id"]}")
  System.halt(1)
end

for {m, name} <- [
      {init, "HANDSHAKE_INIT"},
      {resp, "HANDSHAKE_RESPONSE"},
      {complete, "HANDSHAKE_COMPLETE"}
    ] do
  if is_nil(m["timestamp_ms"]) do
    IO.puts("#{name} missing timestamp_ms")
    System.halt(1)
  end
end

IO.puts("✅ handshake_flow v0.9 transcript binding matches (Erlang)")
