# Minimal protocol validators for Erlang/BEAM to keep CI parity with other languages.
# These perform structural checks on shared corpora and emit a JSON status file.

alias Foxwhisper.Util.Reporting

defmodule Foxwhisper.Validators.Schema do
  @tests [
    %{
      name: "multi_device_sync",
      rel: "tests/common/handshake/multi_device_sync_test_vectors.json",
      validator: &__MODULE__.validate_nonempty_map/1
    },
    %{
      name: "replay_poisoning",
      rel: "tests/common/handshake/replay_poisoning_test_vectors.json",
      validator: &__MODULE__.validate_nonempty_map/1
    },
    %{
      name: "malformed_fuzz",
      rel: "tests/common/adversarial/malformed_packets.json",
      validator: &__MODULE__.validate_nonempty_list/1
    },
    %{
      name: "replay_storm",
      rel: "tests/common/adversarial/replay_storm_profiles.json",
      validator: &__MODULE__.validate_nonempty_map/1
    },
    %{
      name: "epoch_fork",
      rel: "tests/common/adversarial/epoch_forks.json",
      validator: &__MODULE__.validate_epoch_fork/1
    }
  ]

  def main do
    IO.puts("FoxWhisper Schema/Corpus Validation - Erlang")
    IO.puts(String.duplicate("=", 55))

    results = Enum.map(@tests, &run_test/1)
    write_test_logs(results)
    write_results(results)
    summarize(results)
  end

  defp run_test(%{name: name, rel: rel, validator: validator}) do
    try do
      data = Reporting.load_json(rel)

      case validator.(data) do
        true -> success(name)
        {:error, reason} -> failure(name, reason)
        other -> failure(name, "Validator returned #{inspect(other)}")
      end
    rescue
      e -> failure(name, Exception.message(e))
    end
  end

  defp success(name) do
    IO.puts("✓ #{name}")
    %{name: name, success: true}
  end

  defp failure(name, reason) do
    IO.puts("✗ #{name}: #{reason}")
    %{name: name, success: false, error: reason}
  end

  # Validators
  def validate_nonempty_map(data) when is_map(data) and map_size(data) > 0, do: true
  def validate_nonempty_map(_), do: {:error, "expected non-empty map"}

  def validate_nonempty_list(data) when is_list(data) and length(data) > 0, do: true

  def validate_nonempty_list(%{"seeds" => seeds}) when is_list(seeds) and length(seeds) > 0,
    do: true

  def validate_nonempty_list(_), do: {:error, "expected non-empty list"}

  def validate_epoch_fork(data) when is_list(data) and length(data) > 0 do
    missing =
      data
      |> Enum.with_index()
      |> Enum.flat_map(fn {sc, idx} ->
        required = ["scenario_id", "graph", "event_stream", "expectations"]
        missing = Enum.filter(required, fn k -> Map.get(sc, k) == nil end)
        if missing == [], do: [], else: [{idx, missing}]
      end)

    if missing == [], do: true, else: {:error, "missing fields: #{inspect(missing)}"}
  end

  def validate_epoch_fork(_), do: {:error, "expected list of scenarios"}

  # Result writers
  defp write_test_logs(results) do
    dir = Reporting.ensure_results_dir()

    Enum.each(results, fn res ->
      status_label = if(res.success, do: "PASS", else: "FAIL")
      timestamp = DateTime.utc_now() |> DateTime.to_iso8601()

      lines =
        [
          "Test: #{res.name}",
          "Status: #{status_label}",
          "Timestamp: #{timestamp}"
        ] ++
          case Map.get(res, :error) do
            nil -> []
            error -> ["Error: #{error}"]
          end

      File.write!(Path.join(dir, "erlang_#{res.name}_results.log"), Enum.join(lines, "\n"))
    end)
  end

  defp write_results(results) do
    summary_success = Enum.all?(results, & &1.success)

    payload = %{
      language: "erlang",
      timestamp: DateTime.utc_now() |> DateTime.to_iso8601(),
      results:
        Enum.map(results, fn res ->
          %{
            name: res.name,
            test: res.name,
            success: res.success,
            status: if(res.success, do: "success", else: "failed"),
            error: Map.get(res, :error)
          }
        end) ++
          [
            %{
              name: "cbor_schema",
              test: "cbor_schema",
              success: summary_success,
              status: if(summary_success, do: "success", else: "failed")
            }
          ]
    }

    path = Reporting.write_json("erlang_schema_status.json", payload)
    IO.puts("Results written to #{path}")
  end

  defp summarize(results) do
    total = length(results)
    passed = Enum.count(results, & &1.success)

    IO.puts("\nSummary")
    IO.puts(String.duplicate("-", 30))

    Enum.each(results, fn res ->
      label = if res.success, do: "PASS", else: "FAIL"
      IO.puts("#{label} #{res.name}")
    end)

    IO.puts("\nOverall: #{passed}/#{total} passed")

    if passed == total do
      IO.puts("🎉 All Erlang protocol validations passed")
    else
      IO.puts("❌ Some Erlang protocol validations failed")
      System.halt(1)
    end
  end
end

Foxwhisper.Validators.Schema.main()
