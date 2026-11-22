# FoxWhisper Protocol - Root Agent Guide

This guide applies to the entire repository. When working in subdirectories,
also follow any nested `AGENTS.md` files whose scope covers the files you
touch.

## Repository Context

- **Branch**: `feature/crypto-conformance-contract` (SHA `3ec8282` at time of
  generation). Do not push to `main`, `dev`, `epic/*`, or `release/*`.
- **Phase**: v0.9 conformance and tooling. The goal is to refine v0.8.1 into a
  concrete, well-tested v0.9 spec without casually changing core crypto design.
- **Normative spec**: `spec/e2ee-protocol-specification-v0.8.1.md`
- **Active draft**: `spec/e2ee-protocol-specification-v0.9.md`
- **Canonical plan**: `docs/v0.9-comprehensive-todo-list.md`

## Where to Look

| Area | Path | Notes |
|---|---|---|
| Protocol specs | `spec/` | v0.8.1 is normative; includes crypto conformance schemas |
| Spec editing guide | `docs/AGENTS-spec.md` | Read before touching `spec/` or protocol docs |
| v0.9 plan and status | `docs/v0.9-comprehensive-todo-list.md` | Tracks milestones across spec, validators, and harnesses |
| Repo layout rationale | `docs/repository-organization.md` | Full directory tree and placement rules |
| Validation tools | `validation/` | Multi-language validators; has its own `AGENTS.md` |
| Minimal JS client | `clients/minimal-js/` | Node test harness; has its own `AGENTS.md` |
| Minimal JS server | `servers/minimal-js/` | Metadata-only reference server; has its own `AGENTS.md` |
| Shared vectors | `tests/common/` | Cross-language handshake and adversarial JSON vectors |
| Test input rules | `tests/` | Shared vectors and local-only secrets templates; has its own `AGENTS.md` |
| Generators | `tools/generators/` | Test vector generation scripts |
| CI scripts | `scripts/`, `scripts/jobs/` | Validation and CI orchestration |
| Git workflow rules | `agent_git_workflow.md` | Branch protection, commit format, PR creation |

## Validation and CI Commands

Authoritative entrypoints, broadest to narrowest:

- `./scripts/validate-ci-nested.sh` - Replicates GitHub Actions workflow exactly
- `./scripts/validate-ci-simple.sh` - Core tests only, fast feedback
- `./scripts/validate-ci.sh` - Full local validation suite
- `./scripts/validate-node-minimal.sh` - Minimal JS client/server validation

Per-language jobs:

- `./scripts/jobs/validate-python.sh`
- `./scripts/jobs/validate-nodejs.sh`
- `./scripts/jobs/validate-go.sh`
- `./scripts/jobs/validate-rust.sh`
- `./scripts/jobs/validate-erlang.sh`

Additional CI jobs live in `scripts/jobs/`:

- `cross-language-compatibility.sh`
- `security-validation.sh`
- `performance-benchmarks.sh`
- `final-report.sh`

Direct invocations when you need finer control:

- Python: `cd validation/python/validators && python3 validate_cbor_python.py`
- Node.js: `cd validation/nodejs/validators && node validate_cbor_node.js`
- Go: `cd validation/go/validators && go run validate_cbor_go.go`
- Rust: `cargo run --bin validate_cbor_rust`

Run the relevant validators before every commit that touches validation logic,
shared vectors, or the minimal JS harnesses. Skipping is only acceptable for
documentation-only changes.

## Child AGENTS.md Files

Read the scoped guide before editing files in these trees:

- `docs/AGENTS-spec.md` - Spec editing workflow, v0.9 delta outline, crypto
  change rules, drift prevention
- `validation/AGENTS.md` - CBOR/schema validators, adversarial simulators,
  crypto conformance checks, cross-language diff harness
- `clients/minimal-js/AGENTS.md` - Node test harness constraints, vector usage,
  v0.9 milestone mapping
- `servers/minimal-js/AGENTS.md` - Metadata-only server, SFU handler, demo,
  auth/routing constraints
- `tests/AGENTS.md` - Shared vector contracts, adversarial manifests, local
  secrets boundary

Within a child guide's scope, the child guide wins.

## Conventions

- **CBOR**: Canonical (RFC 8949) everywhere. No non-canonical shortcuts.
- **Crypto ops**: Constant-time. No hardcoded secrets. No insecure RNG.
- **Wire format**: All protocol messages are CBOR-encoded binary. Field names,
  tags, and shapes follow the spec and shared vectors.
- **Crypto primitives**: X25519 + Kyber hybrid handshake, HKDF-SHA256 with
  labeled info strings, AES-256-GCM, Ed25519 signatures for group/EARE unless
  the spec explicitly changes.
- **Vectors**: Shared contract files live under `tests/common/`. Prefer those
  over language-specific fixtures.
- **Key storage**: Hardware-backed in production. Test harnesses may use
  in-memory or file-based storage only when clearly marked test-only.

## Anti-Patterns

- Do not relax validators to make tests pass without updating spec and vectors.
- Do not introduce new message fields, tags, or crypto parameters in one
  language without reflecting the change in validators, vectors, and spec.
- Do not commit directly to protected branches. Follow `agent_git_workflow.md`.
- Do not add browser-specific code or UI concerns to `clients/minimal-js/`.
- Do not change crypto primitives casually. Pair any such change with rationale,
  vectors, validator updates, and a spec delta.
- Do not depend on language-specific quirks such as alternate base64 variants
  unless the rule is explicitly documented.

## Key Reference Docs

- `docs/v0.9-comprehensive-todo-list.md` - Canonical task plan and milestone status
- `docs/repository-organization.md` - Directory layout and file purpose reference
- `agent_git_workflow.md` - Branch protection, naming, commit format, PR rules
- `docs/AGENTS-spec.md` - Spec editing rules and v0.9 refinement workflow

## Refinement Loop (Spec ↔ Vectors ↔ Validators ↔ Harness)

When changing protocol behavior, follow the cycle defined in
`docs/AGENTS-spec.md`:

1. Draft the spec change or clarification.
2. Add or update vectors in `tests/common/`.
3. Update validators in `validation/` to enforce the new behavior.
4. Update the minimal JS harnesses to match.
5. Lock the behavior into the v0.9 spec only after the above agree.

Steps 2-4 must stay consistent across Go, Python, Node.js, Erlang, and Rust.
