# FoxWhisper SFU Abuse Validation (Erlang/Elixir)

unless Code.ensure_loaded?(Mix.Project) and Mix.Project.get() do
  Mix.install([
    {:jason, "~> 1.4"}
  ], lockfile: Path.expand("../mix.lock", __DIR__))
end

Code.ensure_loaded?(Foxwhisper.Util.Reporting) ||
  Code.require_file(Path.expand("../lib/foxwhisper/util/reporting.ex", __DIR__))

alias Foxwhisper.Util.Reporting

defmodule Foxwhisper.Validators.SFUAbuse do
  @moduledoc """
  SFU abuse simulator (Erlang/Elixir shim) aligned with Python oracle structure.
  """

  @corpus "tests/common/adversarial/sfu_abuse.json"

  def main do
    IO.puts("FoxWhisper SFU Abuse Validation - Erlang")
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

    path = Reporting.write_json("erlang_sfu_abuse_status.json", payload)
    IO.puts("Results written to #{path}")
    summarize(results)

    if summary_success, do: :ok, else: System.halt(1)
  end

  defp load_corpus do
    case Reporting.load_json(@corpus) do
      list when is_list(list) and list != [] -> list
      _ -> raise "sfu abuse corpus missing or empty"
    end
  end

  defp run_scenario(%{"scenario_id" => id} = scenario) do
    events = Enum.sort_by(scenario["timeline"] || [], &(&1["t"] || 0))
    expectations = scenario["expectations"] || %{}

    {errors, metrics} = evaluate_events(events, scenario)
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

  defp evaluate_events(events, scenario) do
    participants = Map.new(scenario["participants"] || [], fn p -> {p["id"], p} end)
    authed = MapSet.new()
    routes = %{}
    track_layers = %{}

    unauthorized_tracks = 0
    hijacked_tracks = 0
    key_leak_attempts = 0
    replayed_tracks = 0
    duplicate_routes = 0
    simulcast_spoofs = 0
    bitrate_abuse_events = 0
    false_positive_blocks = 0
    false_negative_leaks = 0
    affected = MapSet.new()

    errors = []
    detection_time = nil

    {errors, unauthorized_tracks, hijacked_tracks, key_leak_attempts, replayed_tracks, duplicate_routes, simulcast_spoofs, bitrate_abuse_events, false_positive_blocks, false_negative_leaks, affected, detection_time, authed, routes, track_layers} =
      Enum.reduce(events, {errors, unauthorized_tracks, hijacked_tracks, key_leak_attempts, replayed_tracks, duplicate_routes, simulcast_spoofs, bitrate_abuse_events, false_positive_blocks, false_negative_leaks, affected, detection_time, authed, routes, track_layers}, fn ev, acc ->
        {errs, unauth, hijacked, keyleak, replayed, dup, spoof, bitrate, fpb, fnl, affected_acc, det_time, authed_acc, routes_acc, layers_acc} = acc
        t = ev["t"] || 0
        case ev["event"] do
          "join" ->
            pid = ev["participant"]
            token = ev["token"]
            part = Map.get(participants, pid)
            cond do
              part == nil -> {add_err(errs, "IMPERSONATION"), unauth, hijacked, keyleak, replayed, dup, spoof, bitrate, fpb, fnl, affected_acc, det_time || t, authed_acc, routes_acc, layers_acc}
              token not in (part["authz_tokens"] || []) -> {add_err(errs, "IMPERSONATION"), unauth, hijacked, keyleak, replayed, dup, spoof, bitrate, fpb, fnl, affected_acc, det_time || t, authed_acc, routes_acc, layers_acc}
              true -> {errs, unauth, hijacked, keyleak, replayed, dup, spoof, bitrate, fpb, fnl, MapSet.put(authed_acc, pid), det_time, routes_acc, layers_acc}
            end
          "publish" ->
            pid = ev["participant"]
            track_id = ev["track_id"]
            layers = ev["layers"] || []
            if not MapSet.member?(authed_acc, pid) do
              {add_err(errs, "UNAUTHORIZED_SUBSCRIBE"), unauth + 1, hijacked, keyleak, replayed, dup, spoof, bitrate, fpb, fnl, affected_acc, det_time || t, authed_acc, routes_acc, layers_acc}
            else
              routes2 = Map.put(routes_acc, track_id, pid)
              layers2 = Map.put(layers_acc, track_id, layers)
              {errs, unauth, hijacked, keyleak, replayed, dup, spoof, bitrate, fpb, fnl, affected_acc, det_time, MapSet.put(authed_acc, pid), routes2, layers2}
            end
          "subscribe" ->
            pid = ev["participant"]
            track_id = ev["track_id"]
            if not MapSet.member?(authed_acc, pid) or not Map.has_key?(routes_acc, track_id) do
              {add_err(errs, "UNAUTHORIZED_SUBSCRIBE"), unauth + 1, hijacked, keyleak, replayed, dup, spoof, bitrate, fpb, fnl, affected_acc, det_time || t, authed_acc, routes_acc, layers_acc}
            else
              {errs, unauth, hijacked, keyleak, replayed, dup, spoof, bitrate, fpb, fnl, affected_acc, det_time, authed_acc, routes_acc, layers_acc}
            end
          "ghost_subscribe" ->
            {add_err(errs, "UNAUTHORIZED_SUBSCRIBE"), unauth + 1, hijacked, keyleak, replayed, dup, spoof, bitrate, fpb, fnl, MapSet.put(affected_acc, ev["participant"] || "ghost"), det_time || t, authed_acc, routes_acc, layers_acc}
          "impersonate" ->
            {add_err(errs, "IMPERSONATION"), unauth, hijacked, keyleak, replayed, dup, spoof, bitrate, fpb, fnl, MapSet.put(affected_acc, ev["participant"] || "unknown"), det_time || t, authed_acc, routes_acc, layers_acc}
          "replay_track" ->
            track_id = ev["track_id"]
            if Map.has_key?(routes_acc, track_id) do
              {add_err(errs, "REPLAY_TRACK"), unauth, hijacked, keyleak, replayed + 1, dup, spoof, bitrate, fpb, fnl, affected_acc, det_time || t, authed_acc, routes_acc, layers_acc}
            else
              acc
            end
          "dup_track" ->
            track_id = ev["track_id"]
            if Map.has_key?(routes_acc, track_id) do
              {add_err(errs, "DUPLICATE_ROUTE"), unauth, hijacked, keyleak, replayed, dup + 1, spoof, bitrate, fpb, fnl, affected_acc, det_time || t, authed_acc, routes_acc, layers_acc}
            else
              acc
            end
          "simulcast_spoof" ->
            track_id = ev["track_id"]
            requested = ev["requested_layers"] || []
            allowed = Map.get(layers_acc, track_id, [])
            if Enum.any?(requested, fn r -> not Enum.member?(allowed, r) end) do
              {add_err(errs, "SIMULCAST_SPOOF"), unauth, hijacked, keyleak, replayed, dup, spoof + 1, bitrate, fpb, fnl, affected_acc, det_time || t, authed_acc, routes_acc, layers_acc}
            else
              acc
            end
          "bitrate_abuse" -> {add_err(errs, "BITRATE_ABUSE"), unauth, hijacked, keyleak, replayed, dup, spoof, bitrate + 1, fpb, fnl, affected_acc, det_time || t, authed_acc, routes_acc, layers_acc}
          "key_rotation_skip" -> {add_err(errs, "STALE_KEY_REUSE"), unauth, hijacked, keyleak + 1, replayed, dup, spoof, bitrate, fpb, fnl, affected_acc, det_time || t, authed_acc, routes_acc, layers_acc}
          "stale_key_reuse" -> {add_err(errs, "STALE_KEY_REUSE"), unauth, hijacked, keyleak + 1, replayed, dup, spoof, bitrate, fpb, fnl, affected_acc, det_time || t, authed_acc, routes_acc, layers_acc}
          "steal_key" -> {add_err(errs, "KEY_LEAK_ATTEMPT"), unauth, hijacked, keyleak + 1, replayed, dup, spoof, bitrate, fpb, fnl, affected_acc, det_time || t, authed_acc, routes_acc, layers_acc}
          _ -> acc
        end
      end)

    metrics = %{
      "unauthorized_tracks" => unauthorized_tracks,
      "hijacked_tracks" => hijacked_tracks,
      "impersonation_attempts" => if Enum.member?(errors, "IMPERSONATION"), do: 1, else: 0,
      "key_leak_attempts" => key_leak_attempts,
      "duplicate_routes" => duplicate_routes,
      "replayed_tracks" => replayed_tracks,
      "simulcast_spoofs" => simulcast_spoofs,
      "bitrate_abuse_events" => bitrate_abuse_events,
      "accepted_tracks" => map_size(routes),
      "rejected_tracks" => unauthorized_tracks,
      "false_positive_blocks" => false_positive_blocks,
      "false_negative_leaks" => false_negative_leaks,
      "max_extra_latency_ms" => detection_time || 0,
      "affected_participant_count" => MapSet.size(affected)
    }

    {Enum.uniq(errors), metrics}
  end

  defp evaluate_expectations(exp, errors, metrics) do
    should_detect = Map.get(exp, "should_detect", false)
    expected_errors = Map.get(exp, "expected_errors", [])
    allow_partial = Map.get(exp, "allow_partial_accept", false)
    residual_allowed = Map.get(exp, "residual_routing_allowed", false)

    failures = []

    detection = errors != []
    failures = if detection != should_detect, do: ["detection_mismatch" | failures], else: failures

    missing = Enum.reject(expected_errors, &(&1 in errors))
    failures = if missing != [], do: ["missing_expected_errors" | failures], else: failures

    failures =
      if not allow_partial and Map.get(metrics, "rejected_tracks", 0) > Map.get(exp, "max_unauthorized_tracks", 0) do
        ["unauthorized_tracks_exceeded" | failures]
      else
        failures
      end

    failures =
      if Map.get(metrics, "key_leak_attempts", 0) > Map.get(exp, "max_key_leak_attempts", 0) do
        ["key_leak_exceeded" | failures]
      else
        failures
      end

    failures =
      if Map.get(metrics, "max_extra_latency_ms", 0) > Map.get(exp, "max_detection_ms", 0) do
        ["latency_exceeded" | failures]
      else
        failures
      end

    if not residual_allowed and Map.get(metrics, "duplicate_routes", 0) > 0 do
      failures = ["residual_routing" | failures]
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

Foxwhisper.Validators.SFUAbuse.main()
