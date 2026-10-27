FROM docker.io/library/caddy:2.10.2-alpine

# Both relay ports are above 1024. File capabilities prevent exec when the
# runtime drops every capability, even though Caddy does not need one here.
RUN setcap -r /usr/bin/caddy && test -z "$(getcap /usr/bin/caddy)"
