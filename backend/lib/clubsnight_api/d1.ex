defmodule ClubsnightApi.D1 do
  def query(sql, params \\ []) do
    account_id = System.fetch_env!("CF_ACCOUNT_ID")
    db_id = System.fetch_env!("CF_D1_DATABASE_ID")
    token = System.fetch_env!("CF_API_TOKEN")

    url = "https://api.cloudflare.com/client/v4/accounts/#{account_id}/d1/database/#{db_id}/query"

    case Req.post(url,
           headers: [{"authorization", "Bearer #{token}"}],
           json: %{sql: sql, params: params}
         ) do
      {:ok, %{status: 200, body: %{"success" => true, "result" => [first | _]}}} ->
        {:ok, first["results"] || []}

      {:ok, %{body: body}} ->
        {:error, body}

      {:error, reason} ->
        {:error, reason}
    end
  end
end
