# Personal macOS bootstrap assembly

The customer-operated Mac and optional GPU nodes form one **Sudo Private**
deployment. SudoEdge describes a complete environment delivered in one appliance;
GPU presence alone does not select Edge. Cloud can also contain GPU nodes.
The personal placement and component pins belong in
[`sudoprivate/profiles/personal-macos`](https://github.com/sudoprivacy/sudoprivate/tree/main/profiles/personal-macos).

`tools/deploy/macos-bootstrap.sh` composes the existing SudoCode release installer,
account wizard, runtime selection and doctor. The SudoCode service-host remains
the owner of Nexus discovery and lifetime. An existing Box is reused under its
original authority; a pending Agent credential does not permit a replacement CA.
The wrapper adds no identity store, session manager, scheduler or model routing.

The candidate stages per-deployment binaries, model configuration and a workspace
under `~/.local/share/sudoprivate/personal-macos`. It does not edit the user's
default SudoCode account files or shell startup. Native service ownership remains
shared with existing frontends. `SUDO_PRIVATE_HOME` can select another dedicated
absolute directory; it does not isolate the operating-system user's Nexus identity.

## Stage an engineering candidate

Python and Git are producer prerequisites only; the target Mac uses the bundled
shell files and macOS utilities. All three source revisions are explicit:

```sh
python tools/deploy/macos_candidate.py \
  --profile-repo ../sudoprivate --profile-commit PRIVATE_COMMIT \
  --scode-repo ../sudocode --stack-commit STACK_COMMIT \
  --output /absolute/fresh/personal-macos-candidate
```

The product profile pins the setup source and the immutable SudoCode release.
The producer reuses `artifacts.download` for the installer checksum and transport.
The SudoCode installer verifies its platform archive. Staging creates provenance
and file checksums, but does **not** create a signed/notarized release. Transfer
the complete candidate directory to an authorized test Mac, preserve executable
modes, verify `shasum -a 256 -c SHA256SUMS`, then run `bash Start.command`.
Do not bypass Gatekeeper or describe this candidate as the official download.

`configure`, `prepare`, `doctor` and `run` are separate resumable actions.
Preparation can install/start native services through the existing owner;
`doctor` does not install, start or enroll them. Repeated bootstrap retains the
account files and refuses a different installed CLI version. The setup wizard
asks explicitly before replacing existing configuration and preserves backups.
The launcher uses workspace-scoped permissions, without root or blanket approvals.
macOS privacy approvals and Xcode authorization remain operating-system actions.

## Acceptance boundary

Staging, configuration and `setup --check` are not product acceptance. The product
profile requires live tool use, two separate persistent Agent identities, restart
and offline delivery, authenticated access over a non-LAN path, and preservation
of an existing installation. These steps use SudoCode/Nexus's native admission
and A2A harnesses. No product two-Agent enrollment or OS autostart is supplied by
this wrapper yet. Model-list visibility is not funded inference acceptance.

The website and authenticated SudoCloud entry should eventually distribute the
same qualified package and checksum. Cloud pairing remains optional and separate
from a SudoRouter account. Signing, notarization, native Mac acceptance and both
download integrations are release gates; no current production deployment is
changed by this candidate implementation.
