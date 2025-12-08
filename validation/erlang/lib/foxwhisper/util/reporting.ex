defmodule Foxwhisper.Util.Reporting do
  @moduledoc """
  Shared helpers for Elixir validators to locate test vectors and
  write result artifacts alongside other language outputs.
  """

  @root_dir Path.expand("../../../../..", __DIR__)
  @results_dir Path.join(@root_dir, "results")

  @spec root_dir() :: String.t()
  def root_dir, do: @root_dir

  @spec results_dir() :: String.t()
  def results_dir, do: @results_dir

  @spec ensure_results_dir() :: String.t()
  def ensure_results_dir do
    File.mkdir_p!(@results_dir)
    @results_dir
  end

  @spec input_path(String.t()) :: String.t()
  def input_path(relative), do: Path.join(@root_dir, relative)

  @spec load_json(String.t()) :: any()
  def load_json(relative) do
    relative
    |> input_path()
    |> File.read!()
    |> Jason.decode!()
  end

  @default_crypto_profile "fw-hybrid-x25519-kyber1024"

  @spec write_json(String.t(), map()) :: String.t()
  def write_json(filename, payload) do
    dir = ensure_results_dir()
    output_path = Path.join(dir, filename)
    with_profile = Map.put_new(payload, "crypto_profile", @default_crypto_profile)
    File.write!(output_path, Jason.encode!(with_profile, pretty: true))
    output_path
  end
end
