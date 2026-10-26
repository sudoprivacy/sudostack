# Presidio analyzer with Chinese NER — the contextual detector behind the
# egress content gate (nexus-vfs `egress_gate`, feature `presidio`). One
# image for every form: Sudo Cloud, Sudo Private and SudoEdge run the same
# analyzer, on loopback next to the daemon whose writes it classifies.
#
# Pinned to the multi-arch index digest it was built and accepted against
# (amd64 workstation, arm64 DGX); the index carries both, so the same line
# builds natively on either. Move the pin deliberately, and re-run
# ../acceptance when you do.
FROM mcr.microsoft.com/presidio-analyzer@sha256:286e3fa7f3a7426e775e8564fe1870f1ba8f999d3ab8bbb8cc46a44355d9d6e9 AS chinese-model

USER root
# The default is the official wheel. A previously downloaded wheel can be
# supplied as a build-context path on hosts with unreliable GitHub downloads.
# Both paths must match the checksum published in the upstream release notes.
ARG ZH_MODEL_WHEEL=https://github.com/explosion/spacy-models/releases/download/zh_core_web_lg-3.8.0/zh_core_web_lg-3.8.0-py3-none-any.whl
ADD ${ZH_MODEL_WHEEL} /tmp/zh_core_web_lg-3.8.0-py3-none-any.whl
RUN echo 'eb39f5deb382752d3faef4052fb61570b7f45441076082b2a1fdbe50a8848e7c  /tmp/zh_core_web_lg-3.8.0-py3-none-any.whl' | sha256sum --check --strict \
    && python -m pip install --no-cache-dir --no-deps --target /opt/zh-model /tmp/zh_core_web_lg-3.8.0-py3-none-any.whl

FROM mcr.microsoft.com/presidio-analyzer@sha256:286e3fa7f3a7426e775e8564fe1870f1ba8f999d3ab8bbb8cc46a44355d9d6e9
USER root
# The pinned base uses Python 3.12. Copy only the installed model so the
# compressed wheel is absent from the runtime image's layers. Its one declared
# dependency is installed with the same constraint as the wheel metadata.
COPY --from=chinese-model /opt/zh-model/ /usr/local/lib/python3.12/site-packages/
RUN python -m pip install --no-cache-dir 'spacy-pkuseg>=1.0.0,<2.0.0'

COPY conf/ /app/conf-zh/
COPY business_policy.py sudo_analyzer.py /app/
ENV NLP_CONF_FILE=/app/conf-zh/nlp.yaml \
    ANALYZER_CONF_FILE=/app/conf-zh/analyzer.yaml \
    RECOGNIZER_REGISTRY_CONF_FILE=/app/conf-zh/recognizers.yaml \
    GUNICORN_CMD_ARGS=--no-control-socket
# Gunicorn 25.1.0 can deadlock while forking its first worker with the
# control thread enabled: https://github.com/benoitc/gunicorn/issues/3529.
# This analyzer uses HTTP health checks and container lifecycle management.
USER 1001
CMD ["gunicorn", "--workers", "1", "--bind", "0.0.0.0:3000", "--timeout", "60", "sudo_analyzer:create_app()"]
