defmodule ClubsnightApi.Router do
  use Plug.Router
  alias ClubsnightApi.{D1, TelegramAuth}

  plug :cors
  plug Plug.Parsers, parsers: [:json], pass: ["application/json"], json_decoder: Jason
  plug :fetch_cookies
  plug :match
  plug :dispatch

  get "/api/health" do
    send_json(conn, 200, %{status: "ok", service: "clubsnight-api"})
  end

  post "/api/auth/telegram" do
    case TelegramAuth.verify(conn.body_params) do
      {:ok, user} ->
        D1.query(
          "INSERT INTO users (tg_id, username, name, role, avatar_url) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(tg_id) DO UPDATE SET username=excluded.username, name=excluded.name, role=excluded.role, avatar_url=excluded.avatar_url",
          [user.tg_id, user.username, user.name, user.role, user.avatar_url]
        )

        token = Plug.Crypto.sign(System.fetch_env!("SESSION_SECRET"), "cn_session", user)

        conn
        |> put_resp_cookie("cn_sess", token, http_only: true, secure: true, same_site: "None", max_age: 2_592_000)
        |> send_json(200, %{ok: true, user: Map.put(user, :provider, "telegram")})

      {:error, reason} ->
        send_json(conn, 401, %{error: "Auth failed", reason: reason})
    end
  end

  get "/api/me" do
    case verify_session(conn) do
      {:ok, user} -> send_json(conn, 200, %{user: user})
      _ -> send_json(conn, 401, %{error: "Unauthorized"})
    end
  end

  get "/api/posts" do
    case verify_session(conn) do
      {:ok, _user} ->
        case D1.query("SELECT * FROM posts ORDER BY created_at DESC LIMIT 20") do
          {:ok, rows} -> send_json(conn, 200, %{posts: rows})
          {:error, _} -> send_json(conn, 500, %{error: "DB error"})
        end
      _ ->
        send_json(conn, 401, %{error: "Unauthorized"})
    end
  end

  post "/api/posts" do
    with {:ok, user} <- verify_session(conn),
         content when is_binary(content) <- Map.get(conn.body_params, "content", ""),
         true <- String.length(String.trim(content)) >= 10 do
      id = "post_#{System.system_time(:millisecond)}"
      img = Map.get(conn.body_params, "image_url", "")
      allow_reply = if Map.get(conn.body_params, "allow_reply", true), do: 1, else: 0

      D1.query(
        "INSERT INTO posts (id, author_tg_id, author_name, author_handle, author_role, content, image_url, allow_reply) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [id, user.tg_id, user.name, "@#{user.username}", String.upcase(user.role), String.trim(content), img, allow_reply]
      )

      D1.query("DELETE FROM posts WHERE id NOT IN (SELECT id FROM posts ORDER BY created_at DESC LIMIT 20)")

      send_json(conn, 201, %{ok: true, id: id})
    else
      {:error, _} -> send_json(conn, 401, %{error: "Unauthorized"})
      _ -> send_json(conn, 422, %{error: "Konten tidak valid"})
    end
  end

  options _ do
    send_resp(conn, 204, "")
  end

  match _ do
    send_json(conn, 404, %{error: "Not found"})
  end

  defp verify_session(conn) do
    case conn.cookies["cn_sess"] do
      nil -> {:error, :no_cookie}
      token -> Plug.Crypto.verify(System.fetch_env!("SESSION_SECRET"), "cn_session", token, max_age: 2_592_000)
    end
  end

  defp send_json(conn, status, data) do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(status, Jason.encode!(data))
  end

  defp cors(conn, _opts) do
    origin = System.get_env("FRONTEND_ORIGIN") || "*"
    conn
    |> put_resp_header("access-control-allow-origin", origin)
    |> put_resp_header("access-control-allow-credentials", "true")
    |> put_resp_header("access-control-allow-headers", "content-type")
    |> put_resp_header("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS")
  end
end
