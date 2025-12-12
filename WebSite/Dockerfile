FROM golang:1.20 AS builder
WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -o vulnshop main.go

FROM debian:bookworm-slim
WORKDIR /app
COPY --from=builder /app/vulnshop .
COPY --from=builder /app/static ./static
EXPOSE 8080
CMD ["./vulnshop"]
