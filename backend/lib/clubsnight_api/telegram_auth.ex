defmodule ClubsnightApi.TelegramAuth do
  def verify(params) when is_map(params) do
    bot_token = System.fetch_env!("TELEGRAM_BOT_TOKEN")
    received_hash = Map.get(params, "hash", "")
    auth_date =
      case params |> Map.get("auth_date", "0") |> to_string() |> Integer.parse() do
        {value, ""} -> value
        _ -> 0
      end

    if System.system_time(:second) - auth_date > 86_400 do
      {:error, :expired}
    else
      data_check_string =
        params
        |> Map.delete("hash")
        |> Enum.sort_by(fn {k, _} -> k end)
        |> Enum.map_join("\n", fn {k, v} -> "#{k}=#{v}" end)

      secret_key = :crypto.hash(:sha256, bot_token)
      computed_hash =
        :crypto.mac(:hmac, :sha256, secret_key, data_check_string)
        |> Base.encode16(case: :lower)

      if Plug.Crypto.secure_compare(computed_hash, received_hash) do
        {:ok, build_user(params)}
      else
        {:error, :invalid_hash}
      end
    end
  end

  defp build_user(p) do
    tg_id = to_string(p["id"])
    {role, permissions} = resolve_access(tg_id)

    %{
      tg_id: tg_id,
      username: p["username"] || "user_#{tg_id}",
      name: String.trim("#{p["first_name"]} #{p["last_name"]}"),
      avatar_url: p["photo_url"] || "",
      role: role,
      permissions: permissions,
      saVerified: role in ["owner", "admin_qc_merch", "admin_qc", "admin_merch"]
    }
  end

  defp resolve_access(tg_id) do
    owners = parse_ids("OWNER_TELEGRAM_IDS")
    qc = parse_ids("ADMIN_QC_TELEGRAM_IDS")
    merch = parse_ids("ADMIN_MERCH_TELEGRAM_IDS")

    in_qc = tg_id in qc
    in_merch = tg_id in merch

    cond do
      tg_id in owners -> {"owner", ["all", "qc", "merch", "config"]}
      in_qc and in_merch -> {"admin_qc_merch", ["qc", "merch"]}
      in_qc -> {"admin_qc", ["qc"]}
      in_merch -> {"admin_merch", ["merch"]}
      true -> {"user", []}
    end
  end

  def worker_access(tg_id) do
    {role, permissions} = resolve_access(to_string(tg_id))

    case role do
      "owner" -> {"developer", permissions}
      "admin_qc" -> {"admin", permissions}
      "admin_qc_merch" -> {"admin", permissions}
      "admin_merch" -> {"merch", permissions}
      _ -> {"consumer", []}
    end
  end

  def worker_access_cn(cn_id) do
    if to_string(cn_id) in parse_ids("OWNER_CN_IDS") do
      {"developer", ["all", "qc", "merch", "config"]}
    else
      {"consumer", []}
    end
  end

  defp parse_ids(env_key) do
    (System.get_env(env_key) || "")
    |> String.split(",", trim: true)
    |> Enum.map(&String.trim/1)
  end
end
