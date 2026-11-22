defmodule ClubsnightApi.MaintenanceWorker do
  @moduledoc "Background GenServer untuk pembersihan berkala cache ETS dan monitoring memori BEAM di Render."
  use GenServer
  require Logger

  @interval_ms :timer.minutes(5)

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, :ok, name: __MODULE__)
  end

  @impl true
  def init(:ok) do
    schedule_work()
    {:ok, %{started_at: System.monotonic_time(:second)}}
  end

  @impl true
  def handle_info(:work, state) do
    removed = sweep_expired_cache()
    mem_mb = Float.round(:erlang.memory(:total) / 1_048_576, 2)
    Logger.info("[MaintenanceWorker] Sweep selesai: #{removed} cache expired dihapus | RAM: #{mem_mb} MB")
    schedule_work()
    {:noreply, state}
  end

  defp schedule_work do
    Process.send_after(self(), :work, @interval_ms)
  end

  defp sweep_expired_cache do
    now = System.monotonic_time(:millisecond)
    try do
      :ets.select_delete(:clubsnight_cache, [
        {{:_, :_, :"$1"}, [{:<, :"$1", now}], [true]}
      ])
    rescue
      ArgumentError -> 0
    end
  end
end
