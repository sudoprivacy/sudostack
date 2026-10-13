# The Atlas broker needs the signed Vault plugin, Node for bootstrap, and kubectl
# for session exec. The upstream search-host image has a different runtime.
ARG NODE_IMAGE
FROM ${NODE_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY nexus/nexusd /app/bin/nexus/nexusd
COPY nexus/plugins/ /app/bin/nexus/plugins/
COPY kubectl /usr/local/bin/kubectl
RUN chmod 755 /app/bin/nexus/nexusd /usr/local/bin/kubectl \
    && /app/bin/nexus/nexusd --version \
    && kubectl version --client=true \
    && node --version
ENV PATH=/app/bin:/usr/local/bin:/usr/bin:/bin
ENTRYPOINT ["/app/bin/nexus/nexusd"]
