defmodule ClubsnightApi.Application do
  use Application

  @impl true
  def start(_type, _args) do
    port = String.to_integer(System.get_env("PORT") || "4000")
    children = [
      ClubsnightApi.Cache,
      {Bandit, plug: ClubsnightApi.Router, port: port}
    ]
    Supervisor.start_link(children, strategy: :one_for_one, name: ClubsnightApi.Supervisor)
  end
end
