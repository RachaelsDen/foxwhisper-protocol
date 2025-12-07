defmodule FoxwhisperValidationErlang.MixProject do
  use Mix.Project

  def project do
    [
      app: :foxwhisper_validation_erlang,
      version: "0.1.0",
      elixir: "~> 1.15",
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      elixirc_paths: elixirc_paths(Mix.env())
    ]
  end

  def application do
    [
      extra_applications: [:logger]
    ]
  end

  defp elixirc_paths(:test), do: ["lib"]
  defp elixirc_paths(_), do: ["lib"]

  defp deps do
    [
      {:jason, "~> 1.4"},
      {:cbor, "~> 1.0"}
    ]
  end
end
