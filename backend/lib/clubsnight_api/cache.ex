defmodule ClubsnightApi.Cache do
  @moduledoc "In-memory ETS cache dengan TTL untuk mempercepat endpoint API tanpa membebani D1."
  use GenServer

  @table :clubsnight_cache

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, :ok, name: __MODULE__)
  end

  def get(key) do
    now = System.monotonic_time(:millisecond)
    case :ets.lookup(@table, key) do
      [{^key, value, expires_at}] when expires_at > now -> {:ok, value}
      [{^key, _value, _expired}] ->
        :ets.delete(@table, key)
        :miss
      [] -> :miss
    end
  end

  def put(key, value, ttl_ms \\ 30_000) do
    expires_at = System.monotonic_time(:millisecond) + ttl_ms
    :ets.insert(@table, {key, value, expires_at})
    :ok
  end

  def delete(key) do
    :ets.delete(@table, key)
    :ok
  end

  def fetch_ok(key, ttl_ms \\ 30_000, fun) when is_function(fun, 0) do
    case get(key) do
      {:ok, val} -> {:ok, val}
      :miss ->
        case fun.() do
          {:ok, val} ->
            put(key, val, ttl_ms)
            {:ok, val}
          other -> other
        end
    end
  end

  @impl true
  def init(:ok) do
    :ets.new(@table, [:named_table, :public, :set, read_concurrency: true])
    {:ok, %{}}
  end
end
