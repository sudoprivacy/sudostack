# Extend an already qualified owner runtime. Preserve its cohost entrypoint,
# identity issuer, PVC lifecycle and gVisor RuntimeClass selection.
ARG USER_RUNTIME_IMAGE
FROM ${USER_RUNTIME_IMAGE}
ARG USER_RUNTIME_IMAGE
USER root
RUN node -e 'if (!/^.+@sha256:[a-f0-9]{64}$/.test(process.argv[1])) throw Error("Pin the qualified base image digest")' "$USER_RUNTIME_IMAGE" \
    && node -e 'if (Number(process.versions.node.split(".")[0]) < 22) throw Error("Node 22+ required")' \
    && test ! -e /etc/claude-code/managed-settings.json
COPY runtimes/claude-agent/package.json runtimes/claude-agent/package-lock.json /opt/claude-runtime/
RUN npm ci --prefix /opt/claude-runtime --omit=dev --ignore-scripts
COPY runtimes/claude-agent/launch.mjs runtimes/claude-agent/prepare-adapter.mjs runtimes/claude-agent/adapter-policy.json runtimes/claude-agent/managed-settings.json /opt/claude-runtime/
COPY runtimes/claude-agent/patches /opt/claude-runtime/patches
RUN node /opt/claude-runtime/prepare-adapter.mjs
COPY runtimes/claude-agent/managed-settings.json /etc/claude-code/managed-settings.json
RUN node /opt/claude-runtime/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js --version \
    && node /opt/claude-runtime/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js --cli --version \
    && node --input-type=module -e 'import("/opt/claude-runtime/launch.mjs").then(m => m.adapterEntry())'
USER 1000:1000
