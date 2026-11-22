# ---- Stage 1: Build Release ----
FROM elixir:1.17-alpine AS build

RUN apk add --no-cache build-base git

WORKDIR /app
ENV MIX_ENV=prod

RUN mix local.hex --force && mix local.rebar --force

COPY mix.exs mix.lock* ./
RUN mix deps.get --only $MIX_ENV
RUN mix deps.compile

COPY lib ./lib
RUN mix compile
RUN mix release

# ---- Stage 2: Minimal Runtime ----
FROM alpine:3.20 AS app

RUN apk add --no-cache libstdc++ openssl ncurses-libs ca-certificates

WORKDIR /app
ENV MIX_ENV=prod

COPY --from=build /app/_build/prod/rel/clubsnight_api ./

EXPOSE 4000
CMD ["/app/bin/clubsnight_api", "start"]
