defmodule FWCBORCanonical do
  @moduledoc """
  Minimal canonical CBOR encoder for FoxWhisper handshake hashing (RFC 8949 ordering).
  Supports: maps with string keys; values that are non-negative integers, binaries/strings,
  lists (arrays), or nested maps.
  """

  @spec encode(term()) :: binary()
  def encode(term), do: term |> encode_term() |> IO.iodata_to_binary()

  defp encode_term(map) when is_map(map), do: encode_map(map)
  defp encode_term(list) when is_list(list), do: encode_array(list)
  defp encode_term(int) when is_integer(int) and int >= 0, do: encode_uint(int)
  defp encode_term(bin) when is_binary(bin), do: encode_text(bin)
  defp encode_term(other), do: raise({:unsupported_term, other})

  # Major type 0: unsigned int
  defp encode_uint(n) when n < 24, do: <<0::3, n::5>>
  defp encode_uint(n) when n < 256, do: <<0::3, 24::5, n::8>>
  defp encode_uint(n) when n < 65_536, do: <<0::3, 25::5, n::16>>
  defp encode_uint(n) when n < 4_294_967_296, do: <<0::3, 26::5, n::32>>
  defp encode_uint(n) when n < 18_446_744_073_709_551_616, do: <<0::3, 27::5, n::64>>
  defp encode_uint(n), do: raise({:uint_too_large, n})

  # Major type 3: text strings (UTF-8)
  defp encode_text(bin) when is_binary(bin), do: [encode_len(3, byte_size(bin)), bin]

  # Major type 4: arrays
  defp encode_array(list) do
    encoded = Enum.map(list, &encode_term/1)
    [encode_len(4, length(list)) | encoded]
  end

  # Major type 5: maps with canonical key ordering
  defp encode_map(map) do
    entries =
      map
      |> Enum.map(fn {k, v} ->
        key_bin = encode_key(k)
        {IO.iodata_to_binary(key_bin), key_bin, encode_term(v)}
      end)
      |> Enum.sort(fn {kb1, _, _}, {kb2, _, _} ->
        case byte_size(kb1) - byte_size(kb2) do
          0 -> kb1 <= kb2
          diff when diff < 0 -> true
          _ -> false
        end
      end)

    header = encode_len(5, length(entries))
    body = Enum.flat_map(entries, fn {_, kbin, vbin} -> [kbin, vbin] end)
    [header | body]
  end

  defp encode_key(key) when is_binary(key), do: encode_text(key)

  defp encode_key(key) when is_list(key),
    do: key |> :unicode.characters_to_binary(:utf8, :utf8) |> encode_text()

  defp encode_key(other), do: raise({:unsupported_map_key, other})

  # Length helper for major types 2/3/4/5
  defp encode_len(major, len) when len < 24, do: <<major::3, len::5>>
  defp encode_len(major, len) when len < 256, do: <<major::3, 24::5, len::8>>
  defp encode_len(major, len) when len < 65_536, do: <<major::3, 25::5, len::16>>
  defp encode_len(major, len) when len < 4_294_967_296, do: <<major::3, 26::5, len::32>>

  defp encode_len(major, len) when len < 18_446_744_073_709_551_616,
    do: <<major::3, 27::5, len::64>>

  defp encode_len(_major, len), do: raise({:len_too_large, len})
end
