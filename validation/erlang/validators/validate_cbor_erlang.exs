# FoxWhisper CBOR Validation - Elixir Implementation
# Mirrors other language validators by loading shared test vectors,
# performing canonical CBOR encoding, and writing a JSON status report
# into the repository-level results directory.

unless Code.ensure_loaded?(Mix.Project) and Mix.Project.get() do
  Mix.install(
    [
      {:jason, "~> 1.4"},
      {:cbor, "~> 1.0"}
    ],
    lockfile: Path.expand("../mix.lock", __DIR__)
  )
end

Code.ensure_loaded?(CBOR)

Code.ensure_loaded?(Foxwhisper.Util.Reporting) ||
  Code.require_file(Path.expand("../lib/foxwhisper/util/reporting.ex", __DIR__))

alias Foxwhisper.Util.Reporting

defmodule Foxwhisper.Validators.CBOR do
  @vector_candidates [
    "tests/common/handshake/cbor_test_vectors_fixed.json",
    "tests/common/handshake/cbor_test_vectors.json"
  ]

  @binary_fields ~w(client_id server_id session_id handshake_hash x25519_public_key nonce kyber_public_key kyber_ciphertext)

  def main do
    IO.puts("FoxWhisper CBOR Validation - Elixir")
    IO.puts(String.duplicate("=", 50))

    vectors = load_vectors()

    results =
      vectors
      |> Enum.map(fn {name, vector} -> {name, validate_vector(name, vector)} end)

    write_results(results)
    summarize(results)
  end

  defp load_vectors do
    Enum.find_value(@vector_candidates, fn rel ->
      path = Reporting.input_path(rel)

      if File.exists?(path) do
        Reporting.load_json(rel)
      else
        nil
      end
    end) || raise "CBOR test vectors not found"
  end

  defp validate_vector(name, %{"tag" => tag, "data" => data}) do
    try do
      prepared = prepare_map(data)
      tagged = %CBOR.Tag{tag: tag, value: prepared}
      encoded = encode_canonical(tagged)
      hex = Base.encode16(encoded, case: :upper)

      IO.puts("✓ #{name} encoded (#{byte_size(encoded)} bytes)")

      %{success: true, hex: hex, length: byte_size(encoded)}
    rescue
      error ->
        IO.puts("✗ #{name} failed: #{Exception.message(error)}")
        %{success: false, error: Exception.message(error)}
    end
  end

  defp prepare_map(map) when is_map(map) do
    map
    |> Enum.map(&prepare_entry/1)
    |> Enum.into(%{})
  end

  defp prepare_map(other), do: other

  defp prepare_entry({key, value}) do
    prepared_value =
      cond do
        key in @binary_fields -> decode_binary(value)
        is_map(value) -> prepare_map(value)
        is_list(value) -> Enum.map(value, &prepare_value/1)
        true -> value
      end

    {key, prepared_value}
  end

  defp prepare_value(value) when is_map(value), do: prepare_map(value)
  defp prepare_value(value) when is_list(value), do: Enum.map(value, &prepare_value/1)
  defp prepare_value(value), do: value

  defp decode_binary(value) when is_binary(value) do
    case Base.url_decode64(value, padding: false) do
      {:ok, bin} ->
        bin

      :error ->
        case Base.decode64(value) do
          {:ok, bin} -> bin
          :error -> value
        end
    end
  end

  defp decode_binary(other), do: other

  defp encode_canonical(term) do
    encoded =
      if function_exported?(CBOR, :encode, 1) do
        CBOR.encode(term)
      else
        raise "CBOR.encode/1 not available; ensure :cbor dependency is installed"
      end

    normalize_encoded(encoded)
  end

  defp normalize_encoded({:ok, data}), do: IO.iodata_to_binary(data)
  defp normalize_encoded({:error, reason}), do: raise("CBOR encode error: #{inspect(reason)}")
  defp normalize_encoded(data) when is_binary(data), do: data
  defp normalize_encoded(data), do: IO.iodata_to_binary(data)

  defp write_results(results) do
    payload = %{
      language: "elixir",
      timestamp: DateTime.utc_now() |> DateTime.to_iso8601(),
      results:
        Enum.map(results, fn {message, result} ->
          %{
            message: message,
            success: result.success,
            status: if(result.success, do: "success", else: "failed"),
            output: Map.get(result, :hex) || Map.get(result, :error),
            encoded_length: result[:length]
          }
        end)
    }

    path = Reporting.write_json("elixir_cbor_status.json", payload)
    IO.puts("Results written to #{path}")
  end

  defp summarize(results) do
    total = length(results)
    passed = Enum.count(results, fn {_name, result} -> result.success end)

    IO.puts("\nSummary")
    IO.puts(String.duplicate("-", 30))

    Enum.each(results, fn {name, result} ->
      label = if result.success, do: "PASS", else: "FAIL"
      IO.puts("#{label} #{name}")
    end)

    IO.puts("\nOverall: #{passed}/#{total} passed")

    if passed == total do
      IO.puts("🎉 All Elixir CBOR validations passed")
    else
      IO.puts("❌ Some Elixir CBOR validations failed")
      System.halt(1)
    end
  end
end

Foxwhisper.Validators.CBOR.main()
