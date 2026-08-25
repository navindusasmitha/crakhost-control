FROM golang:1.23-alpine AS builder
WORKDIR /src

COPY services/craknode/go.mod ./
COPY services/craknode/*.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/craknode .

FROM alpine:3.20 AS runner
RUN apk add --no-cache ca-certificates docker-cli \
    && addgroup -S crakhost \
    && adduser -S -G crakhost crakhost

COPY --from=builder /out/craknode /usr/local/bin/craknode

# Docker socket access currently requires the host/root security boundary, so
# the service stays root at runtime while dropping the entire Go toolchain.
EXPOSE 8088 8089
ENTRYPOINT ["/usr/local/bin/craknode"]
