# Build the Chinese analyzer

The image uses the pinned Presidio base and `zh_core_web_lg` 3.8.0. The wheel
must match the SHA-256 in the [official model release](https://github.com/explosion/spacy-models/releases/tag/zh_core_web_lg-3.8.0).
Ordinary builds download and verify that exact wheel:

```sh
docker build -t sudo-presidio-zh:reviewed-commit security/egress-gate/presidio
```

For a slow or interrupted connection, stage the same wheel in the ignored
build-context cache. Rerun the download command to resume it after an interruption:

```sh
cd security/egress-gate/presidio
mkdir -p model-cache
curl --fail --location --retry 5 --continue-at - \
  --output model-cache/zh_core_web_lg-3.8.0-py3-none-any.whl \
  https://github.com/explosion/spacy-models/releases/download/zh_core_web_lg-3.8.0/zh_core_web_lg-3.8.0-py3-none-any.whl
echo 'eb39f5deb382752d3faef4052fb61570b7f45441076082b2a1fdbe50a8848e7c  model-cache/zh_core_web_lg-3.8.0-py3-none-any.whl' | sha256sum --check --strict
docker build --build-arg ZH_MODEL_WHEEL=model-cache/zh_core_web_lg-3.8.0-py3-none-any.whl \
  -t sudo-presidio-zh:reviewed-commit .
```

The Dockerfile verifies the checksum again before installing either source.
A truncated or altered file fails the build. The cached wheel stays outside Git;
keep the failed download/build receipt until the replacement build and real
analyzer regression pass. Hosting repositories select the reviewed image digest.
