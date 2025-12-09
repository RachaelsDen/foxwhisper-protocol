defmodule Foxwhisper.Util.CBORCanonical do
  @moduledoc """
  Canonical CBOR encoding with RFC 8949 map-key ordering (shortest encoded key
  first, then lexicographic). Uses :cbor for encoding.
  """

  @spec encode_canonical(term()) :: binary()
  def encode_canonical(term) do
    term
    |> canonicalize()
    |> encode()
  end

  defp canonicalize(list) when is_list(list) do
    Enum.map(list, &canonicalize/1)
  end

  defp canonicalize(map) when is_map(map) do
    entries =
      map
      |> Enum.map(fn {k, v} ->
        k_c = canonicalize(k)
        v_c = canonicalize(v)
        key_bytes = encode(k_c)
        {key_bytes, k_c, v_c}
      end)
      |> Enum.sort_by(fn {kb, _, _} -> {byte_size(kb), kb} end)
      |> Enum.map(fn {_, k, v} -> {k, v} end)

    {:map, entries}
  end

  defp canonicalize(other), do: other

  defp encode(term) do
    case CBOR.encode(term, %{canonical: true}) do
      {:ok, iodata} -> IO.iodata_to_binary(iodata)
      {:error, reason} -> raise "CBOR encoding failed: #{inspect(reason)}"
      bin when is_binary(bin) -> bin
      iodata -> IO.iodata_to_binary(iodata)
    end
  end
end
