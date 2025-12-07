# FoxWhisper Corrupted EARE Validation (Erlang/Elixir)

unless Code.ensure_loaded?(Mix.Project) and Mix.Project.get() do
  Mix.install(
    [
      {:jason, "~> 1.4"}
    ],
    lockfile: Path.expand("../mix.lock", __DIR__)
  )
end

Code.ensure_loaded?(Foxwhisper.Util.Reporting) ||
  Code.require_file(Path.expand("../lib/foxwhisper/util/reporting.ex", __DIR__))

alias Foxwhisper.Util.Reporting

defmodule Foxwhisper.Validators.CorruptedEARE do
  @moduledoc """
  Corrupted EARE structural simulator (Erlang/Elixir shim).
  """

  @corpus "tests/common/adversarial/corrupted_eare.json"

  def main do
    IO.puts("FoxWhisper Corrupted EARE Validation - Erlang")
    IO.puts(String.duplicate("=", 60))

    scenarios = load_corpus()

    results =
      scenarios
      |> Enum.map(&run_scenario/1)

    summary_success = Enum.all?(results, &(&1.status == "pass"))

    payload = %{
      language: "erlang",
      timestamp: DateTime.utc_now() |> DateTime.to_iso8601(),
      results: results
    }

    path = Reporting.write_json("erlang_corrupted_eare_status.json", payload)
    IO.puts("Results written to #{path}")
    summarize(results)

    if summary_success, do: :ok, else: System.halt(1)
  end

  defp load_corpus do
    case Reporting.load_json(@corpus) do
      list when is_list(list) and list != [] -> list
      _ -> raise "corrupted EARE corpus missing or empty"
    end
  end

  defp run_scenario(%{"scenario_id" => id} = scenario) do
    nodes = scenario["nodes"] || []
    nodes = Enum.sort_by(nodes, &(&1["epoch_id"] || 0))
    corruptions = scenario["corruptions"] || []
    expectations = scenario["expectations"] || %{}

    {errors, metrics} = evaluate_nodes(nodes, corruptions)
    {status, failures} = evaluate_expectations(expectations, errors, metrics)

    %{
      scenario_id: id || "unknown",
      status: status,
      failures: failures,
      errors: errors,
      metrics: metrics,
      notes: []
    }
  end

  defp evaluate_nodes(nodes, corruptions) do
    corr_by_target = Enum.group_by(corruptions, fn c -> Map.get(c, "target_node", "*") end)

    {errors, hash_breaks, accepted, rejected, last_hash} =
      Enum.reduce(nodes, {[], 0, 0, 0, nil}, fn node, {errs, breaks, acc, rej, last} ->
        prev = Map.get(node, "previous_epoch_hash")
        node_hash = Map.get(node, "eare_hash")

        {errs, breaks, acc, rej} =
          if last && prev != last do
            {add_err(errs, "HASH_CHAIN_BREAK"), breaks + 1, acc, rej + 1}
          else
            {errs, breaks, acc + 1, rej}
          end

        targets = [Map.get(node, "node_id"), "*"]

        errs =
          Enum.reduce(targets, errs, fn t, acc_errs ->
            corrs = Map.get(corr_by_target, t, [])

            Enum.reduce(corrs, acc_errs, fn c, e ->
              case String.upcase(to_string(Map.get(c, "type", ""))) do
                "INVALID_SIGNATURE" -> add_err(e, "INVALID_SIGNATURE")
                "INVALID_POP" -> add_err(e, "INVALID_POP")
                "HASH_CHAIN_BREAK" -> add_err(e, "HASH_CHAIN_BREAK")
                "TRUNCATED_EARE" -> add_err(e, "TRUNCATED_EARE")
                "EXTRA_FIELDS" -> add_err(e, "EXTRA_FIELDS")
                "PAYLOAD_TAMPERED" -> add_err(e, "PAYLOAD_TAMPERED")
                "TAMPER_PAYLOAD" -> add_err(e, "PAYLOAD_TAMPERED")
                "STALE_EPOCH_REF" -> add_err(e, "STALE_EPOCH_REF")
                _ -> e
              end
            end)
          end)

        {errs, breaks, acc, rej, node_hash}
      end)

    metrics = %{
      "chain_length" => length(nodes),
      "hash_chain_breaks" => hash_breaks,
      "corruptions_applied" => length(corruptions),
      "accepted_nodes" => accepted,
      "rejected_nodes" => rejected
    }

    {Enum.uniq(errors), metrics}
  end

  defp evaluate_expectations(exp, errors, metrics) do
    should_detect = Map.get(exp, "should_detect", false)
    expected_errors = Map.get(exp, "expected_errors", [])
    allow_partial = Map.get(exp, "allow_partial_accept", false)
    residual_allowed = Map.get(exp, "residual_divergence_allowed", false)

    failures = []

    detection = errors != []

    failures =
      if detection != should_detect, do: ["detection_mismatch" | failures], else: failures

    missing = Enum.reject(expected_errors, &(&1 in errors))
    failures = if missing != [], do: ["missing_expected_errors" | failures], else: failures

    failures =
      if not allow_partial and Map.get(metrics, "rejected_nodes", 0) > 0 do
        ["partial_accept_not_allowed" | failures]
      else
        failures
      end

    failures =
      if not residual_allowed and Map.get(metrics, "hash_chain_breaks", 0) > 0 do
        ["residual_divergence" | failures]
      else
        failures
      end

    status = if failures == [], do: "pass", else: "fail"
    {status, Enum.reverse(failures)}
  end

  defp add_err(list, code) do
    if code in list, do: list, else: [code | list]
  end

  defp summarize(results) do
    total = length(results)
    passed = Enum.count(results, &(&1.status == "pass"))

    IO.puts("\nSummary")
    IO.puts(String.duplicate("-", 30))

    Enum.each(results, fn res ->
      label = if res.status == "pass", do: "PASS", else: "FAIL"
      IO.puts("#{label} #{res.scenario_id}")
    end)

    IO.puts("\nOverall: #{passed}/#{total} passed")
  end
end

Foxwhisper.Validators.CorruptedEARE.main()
