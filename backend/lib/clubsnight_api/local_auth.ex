defmodule ClubsnightApi.LocalAuth do
  @iterations 100_000
  @key_len 32

  def hash_password(password) when is_binary(password) do
    salt = :crypto.strong_rand_bytes(16)
    hash = :crypto.pbkdf2_hmac(:sha256, password, salt, @iterations, @key_len)
    "#{Base.encode16(salt, case: :lower)}:#{Base.encode16(hash, case: :lower)}"
  end

  def verify_password(password, stored_hash) when is_binary(password) and is_binary(stored_hash) do
    case String.split(stored_hash, ":") do
      [salt_hex, hash_hex] ->
        with {:ok, salt} <- Base.decode16(salt_hex, case: :lower),
             {:ok, expected} <- Base.decode16(hash_hex, case: :lower) do
          computed = :crypto.pbkdf2_hmac(:sha256, password, salt, @iterations, @key_len)
          Plug.Crypto.secure_compare(computed, expected)
        else
          _ -> false
        end
      _ ->
        false
    end
  end

  def normalize_username(raw) when is_binary(raw) do
    raw
    |> String.trim()
    |> String.downcase()
    |> String.replace(~r/[^a-z0-9_]/, "")
  end
  def normalize_username(_), do: ""

  def generate_cn_id do
    "cn_" <> (:crypto.strong_rand_bytes(6) |> Base.encode16(case: :lower))
  end
end
