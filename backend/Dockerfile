FROM elixir:1.16-alpine
WORKDIR /app
ENV MIX_ENV=prod
RUN mix local.hex --force && mix local.rebar --force
COPY mix.exs ./
RUN mix deps.get --only prod && mix deps.compile
COPY lib ./lib
RUN mix compile
EXPOSE 4000
CMD ["mix", "run", "--no-halt"]
