# FoxWhisper Device Desync Validation (Erlang/Elixir)
# Full corpus-driven simulator aligned with Python oracle semantics.

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

# Helpers

defmodule DeviceState do
  def new(%{"device_id" => id} = m) do
    {
      id,
      %{
        dr_version: m["dr_version"],
        clock_ms: Map.get(m, "clock_ms", 0) || 0,
        state_hash: Map.get(m, "state_hash")
      }
    }
  end
end

defmodule DeviceDesyncSim do
  def simulate(%{"devices" => devices, "timeline" => timeline} = scenario) do
    devices = Map.new(devices, &DeviceState.new/1)
    events = Enum.sort_by(timeline, fn e -> {Map.get(e, "t", 0), Map.get(e, "event", "")} end)

    state = %{
      devices: devices,
      messages: %{},
      detection_time: nil,
      divergence_start: nil,
      recovery_time: nil,
      delivered: 0,
      expected: 0,
      dropped: 0,
      out_of_order: 0,
      dr_integral: 0,
      dr_samples: 0,
      max_dr_delta: 0,
      max_diverged: 0,
      max_clock_skew: clock_range(devices),
      skew_violations: 0,
      recovery_attempts: 0,
      successful_recoveries: 0,
      failed_recoveries: 0,
      max_rollback: 0,
      errors: [],
      notes: []
    }

    state = Enum.reduce(events, state, fn ev, acc -> process_event(ev, scenario, acc) end)

    state =
      if is_nil(state[:divergence_start]) and state.errors != [] do
        t =
          case events do
            [first | _] -> Map.get(first, "t", 0)
            _ -> 0
          end

        %{state | divergence_start: t, detection_time: state.detection_time || t}
      else
        state
      end

    {_min_ver, _max_ver, end_delta} = current_dr_stats(state.devices)
    residual_divergence = end_delta > 0

    detection_ms =
      case {state.detection_time, state.divergence_start} do
        {dt, ds} when is_integer(dt) and is_integer(ds) -> max(dt - ds, 0)
        _ -> nil
      end

    recovery_ms =
      case {state.recovery_time, state.detection_time} do
        {rt, dt} when is_integer(rt) and is_integer(dt) -> max(rt - dt, 0)
        _ -> nil
      end

    delivered_messages = state.delivered
    expected_messages = state.expected

    message_loss_rate =
      if expected_messages > 0 do
        max((expected_messages - delivered_messages) / expected_messages, 0.0)
      else
        0.0
      end

    out_of_order_rate =
      if delivered_messages > 0 do
        state.out_of_order / delivered_messages
      else
        0.0
      end

    avg_dr = if state.dr_samples > 0, do: state.dr_integral / state.dr_samples, else: 0.0

    errors =
      state.errors
      |> maybe_add_error("MESSAGE_LOSS", message_loss_rate > 0.0)
      |> maybe_add_error("OUT_OF_ORDER", state.out_of_order > 0)

    {min_for_metrics, _max, _delta} = current_dr_stats(state.devices)

    diverged_count =
      state.devices
      |> Map.values()
      |> Enum.count(fn d -> d.dr_version != min_for_metrics end)

    metrics = %{
      "max_dr_version_delta" => state.max_dr_delta,
      "avg_dr_version_delta" => avg_dr,
      "max_clock_skew_ms" => state.max_clock_skew,
      "diverged_device_count" => diverged_count,
      "max_diverged_device_count" => state.max_diverged,
      "delivered_messages" => delivered_messages,
      "expected_messages" => expected_messages,
      "message_loss_rate" => message_loss_rate,
      "out_of_order_deliveries" => state.out_of_order,
      "out_of_order_rate" => out_of_order_rate,
      "skew_violations" => state.skew_violations,
      "recovery_attempts" => state.recovery_attempts,
      "successful_recoveries" => state.successful_recoveries,
      "failed_recoveries" => state.failed_recoveries,
      "max_rollback_events" => state.max_rollback,
      "residual_divergence" => residual_divergence,
      "dropped_messages" => state.dropped
    }

    %{
      detection: not is_nil(state.divergence_start) or errors != [],
      detection_ms: detection_ms,
      recovery_ms: recovery_ms,
      errors: errors,
      notes: state.notes,
      metrics: metrics
    }
  end

  defp process_event(ev, scenario, acc) do
    t = Map.get(ev, "t", 0)
    kind = Map.get(ev, "event", "")
    devices = acc.devices

    # Align clocks to event time
    devices =
      Enum.reduce(devices, %{}, fn {id, d}, dacc ->
        Map.put(dacc, id, %{d | clock_ms: max(d.clock_ms, t)})
      end)

    acc = %{acc | devices: devices}

    case kind do
      "send" -> handle_send(ev, scenario, t, acc)
      "recv" -> handle_recv(ev, t, acc)
      "drop" -> handle_drop(ev, t, acc)
      "replay" -> handle_replay(ev, scenario, t, acc)
      "backup_restore" -> handle_backup_restore(ev, scenario, t, acc)
      "clock_skew" -> handle_clock_skew(ev, scenario, t, acc)
      "resync" -> handle_resync(ev, scenario, t, acc)
      _ -> acc |> add_error("UNSUPPORTED_EVENT", t)
    end
    |> update_metrics(t)
  end

  defp handle_send(ev, scenario, t, acc) do
    msg_id = ev["msg_id"]
    sender = ev["from"]
    targets = ev["to"] || []
    dr_version = ev["dr_version"]
    state_hash = ev["state_hash"]

    if not is_binary(msg_id) or not is_binary(sender) or not Map.has_key?(acc.devices, sender) do
      raise "[#{scenario["scenario_id"]}] invalid send event"
    end

    messages =
      if Map.has_key?(acc.messages, msg_id) do
        Map.update!(acc.messages, msg_id, fn env ->
          %{env | replay_count: env.replay_count + 1}
        end)
      else
        Map.put(acc.messages, msg_id, %{
          msg_id: msg_id,
          sender: sender,
          targets: Enum.map(targets, &to_string/1),
          dr_version: if(dr_version == nil, do: acc.devices[sender].dr_version, else: dr_version),
          state_hash: if(is_binary(state_hash), do: state_hash, else: nil),
          send_time: t,
          delivered: MapSet.new(),
          dropped: MapSet.new(),
          replay_count: 0
        })
      end

    acc = %{acc | messages: messages, expected: acc.expected + length(targets)}

    sender_state = acc.devices[sender]
    new_ver = if(dr_version == nil, do: sender_state.dr_version, else: dr_version)

    rollback =
      if(new_ver < sender_state.dr_version, do: sender_state.dr_version - new_ver, else: 0)

    devices =
      Map.put(acc.devices, sender, %{
        sender_state
        | dr_version: new_ver,
          state_hash: state_hash || sender_state.state_hash
      })

    max_rollback = max(acc.max_rollback, rollback)

    %{acc | devices: devices, max_rollback: max_rollback}
  end

  defp handle_recv(ev, t, acc) do
    msg_id = ev["msg_id"]
    device_id = ev["device"]

    acc =
      if not Map.has_key?(acc.messages, msg_id) or not Map.has_key?(acc.devices, device_id) do
        add_error(acc, "UNKNOWN_MESSAGE", t)
      else
        acc
      end

    if Map.has_key?(acc.messages, msg_id) and Map.has_key?(acc.devices, device_id) do
      envelope = acc.messages[msg_id]
      dev = acc.devices[device_id]

      acc =
        if MapSet.member?(envelope.delivered, device_id),
          do: add_error(acc, "DUPLICATE_DELIVERY", nil),
          else: acc

      out_of_order = acc.out_of_order + if(t < envelope.send_time, do: 1, else: 0)
      delivered = acc.delivered + 1

      envelope = %{envelope | delivered: MapSet.put(envelope.delivered, device_id)}
      messages = Map.put(acc.messages, msg_id, envelope)

      {dev, max_rollback} =
        case ev["apply_dr_version"] do
          nil ->
            {dev, acc.max_rollback}

          apply_ver ->
            rollback = if(apply_ver < dev.dr_version, do: dev.dr_version - apply_ver, else: 0)
            {%{dev | dr_version: apply_ver}, max(acc.max_rollback, rollback)}
        end

      dev = if is_binary(ev["state_hash"]), do: %{dev | state_hash: ev["state_hash"]}, else: dev

      devices = Map.put(acc.devices, device_id, dev)

      %{
        acc
        | messages: messages,
          devices: devices,
          delivered: delivered,
          out_of_order: out_of_order,
          max_rollback: max_rollback
      }
    else
      acc
    end
  end

  defp handle_drop(ev, t, acc) do
    msg_id = ev["msg_id"]
    targets = ev["targets"]

    cond do
      Map.has_key?(acc.messages, msg_id) ->
        envelope = acc.messages[msg_id]

        target_list =
          if(is_list(targets), do: Enum.map(targets, &to_string/1), else: envelope.targets)

        dropped = MapSet.union(envelope.dropped, MapSet.new(target_list))
        messages = Map.put(acc.messages, msg_id, %{envelope | dropped: dropped})
        %{acc | messages: messages, dropped: acc.dropped + length(target_list)}

      true ->
        add_error(acc, "UNKNOWN_MESSAGE", t)
    end
  end

  defp handle_replay(ev, scenario, t, acc) do
    msg_id = ev["msg_id"]
    sender = ev["from"]
    targets = ev["to"] || []
    dr_version = ev["dr_version"]

    if not is_binary(msg_id) or not is_binary(sender) or not Map.has_key?(acc.devices, sender) do
      raise "[#{scenario["scenario_id"]}] invalid replay event"
    end

    messages =
      if Map.has_key?(acc.messages, msg_id) do
        Map.update!(acc.messages, msg_id, fn env ->
          %{env | replay_count: env.replay_count + 1}
        end)
      else
        Map.put(acc.messages, msg_id, %{
          msg_id: msg_id,
          sender: sender,
          targets: Enum.map(targets, &to_string/1),
          dr_version: if(dr_version == nil, do: acc.devices[sender].dr_version, else: dr_version),
          state_hash: nil,
          send_time: t,
          delivered: MapSet.new(),
          dropped: MapSet.new(),
          replay_count: 1
        })
      end

    acc
    |> Map.put(:messages, messages)
    |> Map.update!(:expected, &(&1 + length(targets)))
    |> add_error("REPLAY_INJECTED", t)
  end

  defp handle_backup_restore(ev, scenario, t, acc) do
    device_id = ev["device"]
    dr_version = ev["dr_version"]
    state_hash = ev["state_hash"]

    dev =
      acc.devices[device_id] || raise "[#{scenario["scenario_id"]}] backup_restore unknown device"

    rollback = if(dr_version < dev.dr_version, do: dev.dr_version - dr_version, else: 0)

    dev = %{
      dev
      | dr_version: dr_version,
        state_hash: if(is_binary(state_hash), do: state_hash, else: dev.state_hash)
    }

    devices = Map.put(acc.devices, device_id, dev)
    acc = %{acc | devices: devices, max_rollback: max(acc.max_rollback, rollback)}
    if rollback > 0, do: add_error(acc, "ROLLBACK_APPLIED", t), else: acc
  end

  defp handle_clock_skew(ev, scenario, t, acc) do
    device_id = ev["device"]
    delta = ev["delta_ms"]
    dev = acc.devices[device_id] || raise "[#{scenario["scenario_id"]}] clock_skew unknown device"
    dev = %{dev | clock_ms: dev.clock_ms + delta}
    devices = Map.put(acc.devices, device_id, dev)
    max_clock_skew = max(acc.max_clock_skew, clock_range(devices))
    acc = %{acc | devices: devices, max_clock_skew: max_clock_skew}

    if max_clock_skew > scenario["expectations"]["max_clock_skew_ms"] do
      %{acc | skew_violations: acc.skew_violations + 1} |> add_error("CLOCK_SKEW_VIOLATION", t)
    else
      acc
    end
  end

  defp handle_resync(ev, scenario, _t, acc) do
    device_id = ev["device"]
    target_version = ev["target_dr_version"]
    state_hash = ev["state_hash"]
    dev = acc.devices[device_id] || raise "[#{scenario["scenario_id"]}] resync unknown device"

    before_delta = current_dr_stats(acc.devices) |> elem(2)

    rollback = if(target_version < dev.dr_version, do: dev.dr_version - target_version, else: 0)

    dev = %{
      dev
      | dr_version: target_version,
        state_hash: if(is_binary(state_hash), do: state_hash, else: dev.state_hash)
    }

    devices = Map.put(acc.devices, device_id, dev)

    after_delta = current_dr_stats(devices) |> elem(2)

    {successful_recoveries, failed_recoveries, notes} =
      cond do
        after_delta == 0 ->
          {acc.successful_recoveries + 1, acc.failed_recoveries, acc.notes}

        after_delta < before_delta ->
          {acc.successful_recoveries, acc.failed_recoveries,
           ["resync on #{device_id} reduced divergence" | acc.notes]}

        true ->
          {acc.successful_recoveries, acc.failed_recoveries + 1, acc.notes}
      end

    %{
      acc
      | devices: devices,
        recovery_attempts: acc.recovery_attempts + 1,
        max_rollback: max(acc.max_rollback, rollback),
        successful_recoveries: successful_recoveries,
        failed_recoveries: failed_recoveries,
        notes: notes
    }
  end

  defp update_metrics(acc, _t) do
    {_min_ver, _max_ver, dr_delta} = current_dr_stats(acc.devices)
    dr_integral = acc.dr_integral + dr_delta
    dr_samples = acc.dr_samples + 1
    max_dr_delta = max(acc.max_dr_delta, dr_delta)

    divergence_active = dr_delta > 0

    {divergence_start, detection_time, recovery_time, errors} =
      cond do
        divergence_active and is_nil(acc.divergence_start) ->
          dt = acc.detection_time || acc.divergence_start || acc.devices |> map_min_clock()

          {acc.divergence_start || acc.devices |> map_min_clock(),
           dt || acc.devices |> map_min_clock(), acc.recovery_time,
           uniq_error(acc.errors, "DIVERGENCE_DETECTED")}

        divergence_active ->
          {acc.divergence_start, acc.detection_time, acc.recovery_time,
           uniq_error(acc.errors, "DIVERGENCE_DETECTED")}

        not divergence_active and not is_nil(acc.divergence_start) and is_nil(acc.recovery_time) ->
          {acc.divergence_start, acc.detection_time, acc.devices |> map_min_clock(), acc.errors}

        true ->
          {acc.divergence_start, acc.detection_time, acc.recovery_time, acc.errors}
      end

    min_ver = acc.devices |> Map.values() |> Enum.map(& &1.dr_version) |> Enum.min(fn -> 0 end)
    diverged = acc.devices |> Map.values() |> Enum.count(&(&1.dr_version != min_ver))
    max_diverged = max(acc.max_diverged, diverged)
    max_clock_skew = max(acc.max_clock_skew, clock_range(acc.devices))

    %{
      acc
      | dr_integral: dr_integral,
        dr_samples: dr_samples,
        max_dr_delta: max_dr_delta,
        divergence_start: divergence_start,
        detection_time: detection_time,
        recovery_time: recovery_time,
        errors: errors,
        max_diverged: max_diverged,
        max_clock_skew: max_clock_skew
    }
  end

  defp current_dr_stats(devices) do
    versions = devices |> Map.values() |> Enum.map(& &1.dr_version)

    case versions do
      [] ->
        {0, 0, 0}

      _ ->
        min = Enum.min(versions)
        max = Enum.max(versions)
        {min, max, max - min}
    end
  end

  defp clock_range(devices) do
    clocks = devices |> Map.values() |> Enum.map(& &1.clock_ms)

    case clocks do
      [] -> 0
      _ -> Enum.max(clocks) - Enum.min(clocks)
    end
  end

  defp map_min_clock(devices) do
    devices
    |> Map.values()
    |> Enum.map(& &1.clock_ms)
    |> Enum.min(fn -> 0 end)
  end

  defp add_error(acc, code, at) do
    errors = uniq_error(acc.errors, code)

    detection_time =
      if is_nil(acc.detection_time) and is_integer(at), do: at, else: acc.detection_time

    %{acc | errors: errors, detection_time: detection_time}
  end

  defp uniq_error(errors, code) do
    if code in errors, do: errors, else: [code | errors]
  end

  defp maybe_add_error(errors, _code, false), do: errors
  defp maybe_add_error(errors, code, true), do: uniq_error(errors, code)
end

defmodule Foxwhisper.Validators.DeviceDesync do
  @moduledoc """
  Device desync simulator (Erlang/Elixir) aligned with Python oracle.
  """

  @corpus "tests/common/adversarial/device_desync.json"

  alias Foxwhisper.Util.Reporting
  alias DeviceDesyncSim

  def main do
    IO.puts("FoxWhisper Device Desync Validation - Erlang")
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

    path = Reporting.write_json("erlang_device_desync_status.json", payload)
    IO.puts("Results written to #{path}")
    summarize(results)

    if summary_success, do: :ok, else: System.halt(1)
  end

  defp run_scenario(scenario) do
    result = DeviceDesyncSim.simulate(scenario)
    {status, failures} = evaluate_expectations(scenario["expectations"], result)

    %{
      scenario_id: scenario["scenario_id"] || "unknown",
      status: status,
      failures: failures,
      errors: Enum.reverse(result.errors),
      metrics: result.metrics,
      notes: Enum.reverse(result.notes)
    }
  end

  defp load_corpus do
    case Reporting.load_json(@corpus) do
      list when is_list(list) and list != [] -> list
      _ -> raise "device desync corpus missing or empty"
    end
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

  defp evaluate_expectations(exp, result) do
    failures = []

    failures =
      if result.detection != exp["detected"],
        do: ["detection_mismatch" | failures],
        else: failures

    failures =
      if exp["detected"] do
        cond do
          is_nil(result.detection_ms) ->
            ["missing_detection_ms" | failures]

          exp["max_detection_ms"] > 0 and result.detection_ms > exp["max_detection_ms"] ->
            ["detection_sla" | failures]

          true ->
            failures
        end
      else
        if not is_nil(result.detection_ms) and result.detection_ms != 0 do
          ["unexpected_detection_ms" | failures]
        else
          failures
        end
      end

    failures =
      if exp["healing_required"] do
        failures =
          cond do
            is_nil(result.recovery_ms) ->
              ["missing_recovery_ms" | failures]

            exp["max_recovery_ms"] > 0 and result.recovery_ms > exp["max_recovery_ms"] ->
              ["recovery_sla" | failures]

            true ->
              failures
          end

        if not exp["residual_divergence_allowed"] and result.metrics["residual_divergence"] do
          ["residual_divergence" | failures]
        else
          failures
        end
      else
        failures
      end

    failures =
      if result.metrics["max_dr_version_delta"] > exp["max_dr_version_delta"],
        do: ["dr_delta_exceeded" | failures],
        else: failures

    failures =
      if result.metrics["max_clock_skew_ms"] > exp["max_clock_skew_ms"],
        do: ["clock_skew_exceeded" | failures],
        else: failures

    failures =
      if result.metrics["message_loss_rate"] > exp["allow_message_loss_rate"],
        do: ["message_loss_rate" | failures],
        else: failures

    failures =
      if result.metrics["out_of_order_rate"] > exp["allow_out_of_order_rate"],
        do: ["out_of_order_rate" | failures],
        else: failures

    failures =
      if result.metrics["max_rollback_events"] > exp["max_rollback_events"],
        do: ["rollback_exceeded" | failures],
        else: failures

    missing_errors =
      (exp["expected_error_categories"] || [])
      |> Enum.reject(fn code -> code in result.errors end)

    failures =
      if missing_errors != [], do: ["missing_error_categories" | failures], else: failures

    status = if failures == [], do: "pass", else: "fail"
    {status, Enum.reverse(failures)}
  end
end

Foxwhisper.Validators.DeviceDesync.main()
