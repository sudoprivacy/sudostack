# Presidio analyzer with Chinese NER — the contextual detector behind the
# egress content gate (nexus-vfs `egress_gate`, feature `presidio`). One
# image for every form: Sudo Cloud, Sudo Private and SudoEdge run the same
# analyzer, on loopback next to the daemon whose writes it classifies.
#
# Pinned to the multi-arch index digest it was built and accepted against
# (amd64 workstation, arm64 DGX); the index carries both, so the same line
# builds natively on either. Move the pin deliberately, and re-run
# ../acceptance when you do.
FROM mcr.microsoft.com/presidio-analyzer@sha256:286e3fa7f3a7426e775e8564fe1870f1ba8f999d3ab8bbb8cc46a44355d9d6e9

USER root
# ~600 MB. The large pipeline because NER quality is the whole reason this
# service exists; the gate's deterministic rules already cover the cheap
# cases.
RUN python -m spacy download zh_core_web_lg

COPY conf/ /app/conf-zh/
ENV NLP_CONF_FILE=/app/conf-zh/nlp.yaml \
    ANALYZER_CONF_FILE=/app/conf-zh/analyzer.yaml \
    RECOGNIZER_REGISTRY_CONF_FILE=/app/conf-zh/recognizers.yaml
USER 1001
