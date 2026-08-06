FROM criyle/go-judge:v1.12.1 AS gojudge

FROM debian:12-slim

RUN set -eux; \
    if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      sed -i 's|http://deb.debian.org/debian|http://mirrors.aliyun.com/debian|g; s|http://security.debian.org/debian-security|http://mirrors.aliyun.com/debian-security|g' /etc/apt/sources.list.d/debian.sources; \
    fi; \
    if [ -f /etc/apt/sources.list ]; then \
      sed -i 's|http://deb.debian.org/debian|http://mirrors.aliyun.com/debian|g; s|http://security.debian.org/debian-security|http://mirrors.aliyun.com/debian-security|g' /etc/apt/sources.list; \
    fi; \
    apt-get update -o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      gcc \
      g++ \
      libc6-dev; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /opt

COPY --from=gojudge /opt/go-judge /opt/go-judge
COPY --from=gojudge /opt/mount.yaml /opt/mount.yaml

EXPOSE 5050/tcp 5051/tcp 5052/tcp

ENTRYPOINT ["/opt/go-judge"]
