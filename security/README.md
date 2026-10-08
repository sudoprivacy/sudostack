# Security assembly

Security controls that Sudo Cloud, Sudo Private and SudoEdge assemble the
same way. Behaviour lives in the component that owns it; this directory holds
what the forms share — build features, configuration contracts, shared
deployable components, and acceptance that asserts on real artifacts.
Form-specific wiring and acceptance records stay in each deployment
repository.

- [`egress-gate/`](egress-gate/README.md) — the egress content gate: what a
  write may carry off a node (identifiers, credentials, names), the Presidio
  analyzer image, and the acceptance harness.
