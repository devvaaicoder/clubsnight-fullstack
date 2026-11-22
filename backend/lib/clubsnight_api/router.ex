defmodule ClubsnightApi.Router do
  use Plug.Router
  alias ClubsnightApi.{D1, TelegramAuth, LocalAuth}

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


  # Daftar Akun Pure Clubs' Night (Username + Password, Tanpa Email/No HP)
  post "/api/auth/register" do
    username = LocalAuth.normalize_username(Map.get(conn.body_params, "username", ""))
    password = Map.get(conn.body_params, "password", "")
    display_name = (Map.get(conn.body_params, "name", "") |> to_string() |> String.trim())
    name = if display_name == "", do: username, else: String.slice(display_name, 0, 40)

    cond do
      String.length(username) < 3 or String.length(username) > 24 ->
        send_json(conn, 422, %{error: "Username harus 3–24 karakter (huruf, angka, garis bawah)."})

      not is_binary(password) or String.length(password) < 6 ->
        send_json(conn, 422, %{error: "Password minimal 6 karakter."})

      true ->
        case D1.query("SELECT tg_id FROM users WHERE LOWER(username) = ? LIMIT 1", [username]) do
          {:ok, [_ | _]} ->
            send_json(conn, 409, %{error: "Username sudah dipakai. Silakan pilih username lain."})

          {:ok, []} ->
            cn_id = LocalAuth.generate_cn_id()
            pw_hash = LocalAuth.hash_password(password)

            case D1.query(
                   "INSERT INTO users (tg_id, username, name, role, avatar_url, password_hash, auth_provider) VALUES (?, ?, ?, 'user', '', ?, 'clubsnight')",
                   [cn_id, username, name, pw_hash]
                 ) do
              {:ok, _} ->
                user = %{
                  tg_id: cn_id,
                  username: username,
                  name: name,
                  avatar_url: "",
                  role: "user",
                  permissions: [],
                  saVerified: false
                }

                token = Plug.Crypto.sign(System.fetch_env!("SESSION_SECRET"), "cn_session", user)

                conn
                |> put_resp_cookie("cn_sess", token, http_only: true, secure: true, same_site: "None", max_age: 2_592_000)
                |> send_json(201, %{ok: true, user: Map.put(user, :provider, "clubsnight")})

              {:error, _} ->
                send_json(conn, 500, %{error: "Gagal mendaftarkan akun. Coba lagi."})
            end

          {:error, _} ->
            send_json(conn, 500, %{error: "Gangguan database."})
        end
    end
  end

  # Login Akun Pure Clubs' Night
  post "/api/auth/login" do
    username = LocalAuth.normalize_username(Map.get(conn.body_params, "username", ""))
    password = Map.get(conn.body_params, "password", "")

    case D1.query("SELECT tg_id, username, name, role, avatar_url, password_hash FROM users WHERE LOWER(username) = ? AND auth_provider = 'clubsnight' LIMIT 1", [username]) do
      {:ok, [row]} ->
        if LocalAuth.verify_password(password, row["password_hash"] || "") do
          role = row["role"] || "user"
          user = %{
            tg_id: row["tg_id"],
            username: row["username"],
            name: row["name"] || row["username"],
            avatar_url: row["avatar_url"] || "",
            role: role,
            permissions: [],
            saVerified: role in ["owner", "admin_qc_merch", "admin_qc", "admin_merch"]
          }

          token = Plug.Crypto.sign(System.fetch_env!("SESSION_SECRET"), "cn_session", user)

          conn
          |> put_resp_cookie("cn_sess", token, http_only: true, secure: true, same_site: "None", max_age: 2_592_000)
          |> send_json(200, %{ok: true, user: Map.put(user, :provider, "clubsnight")})
        else
          send_json(conn, 401, %{error: "Username atau password salah."})
        end

      {:ok, []} ->
        send_json(conn, 401, %{error: "Username atau password salah."})

      {:error, _} ->
        send_json(conn, 500, %{error: "Gangguan database."})
    end
  end

  # Logout (Hapus HttpOnly Cookie)
  post "/api/auth/logout" do
    conn
    |> delete_resp_cookie("cn_sess", http_only: true, secure: true, same_site: "None")
    |> send_json(200, %{ok: true})
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
        case ClubsnightApi.Cache.fetch_ok(:posts_feed, 30_000, fn -> D1.query("SELECT * FROM posts ORDER BY created_at DESC LIMIT 20") end) do
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

      with {:ok, _} <- D1.query(
             "INSERT INTO posts (id, author_tg_id, author_name, author_handle, author_role, content, image_url, allow_reply) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
             [id, user.tg_id, user.name, "@#{user.username}", String.upcase(user.role), String.trim(content), img, allow_reply]
           ),
           {:ok, _} <- D1.query("DELETE FROM posts WHERE id NOT IN (SELECT id FROM posts ORDER BY created_at DESC LIMIT 20)") do
        ClubsnightApi.Cache.delete(:posts_feed)
        send_json(conn, 201, %{ok: true, id: id})
      else
        {:error, _} -> send_json(conn, 500, %{error: "Gagal menyimpan post"})
      end
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
    allowed =
      (System.get_env("FRONTEND_ORIGIN") || "")
      |> String.split(",", trim: true)
      |> Enum.map(&String.trim/1)

    req_origin = Plug.Conn.get_req_header(conn, "origin") |> List.first()

    allow_origin =
      cond do
        req_origin in allowed -> req_origin
        allowed != [] -> hd(allowed)
        true -> "*"
      end

    conn
    |> put_resp_header("access-control-allow-origin", allow_origin)
    |> put_resp_header("vary", "Origin")
    |> put_resp_header("access-control-allow-credentials", "true")
    |> put_resp_header("access-control-allow-headers", "content-type")
    |> put_resp_header("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS")
  end
end
