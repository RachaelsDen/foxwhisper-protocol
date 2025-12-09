# AGENTS Guide – Spec Editing and v0.9 Refinement

## Scope and Purpose

- This guide applies to agents modifying protocol specifications and related docs under `spec/` and `docs/`.
- The primary goal for v0.9 work is to:
  - Use real test vectors, validators, and reference implementations to **refine** `e2ee-protocol-specification-v0.8.1.md`.
  - Produce a v0.9 spec that is more concrete, better tested, and less ambiguous, without casually changing core design.

## Authoritative Files

Agents MUST treat these files as central when editing specs or protocol docs:

- `spec/e2ee-protocol-specification-v0.8.1.md` – current normative spec.
- `docs/v0.9-comprehensive-todo-list.md` – canonical plan for v0.9.
- `docs/v0.9-cbor-examples.md` – concrete encoding examples.
- Shared test vectors under `tests/common/`.
- Validation tools under `validation/` and the minimal client harness under `clients/minimal-js/`.

## Refinement Workflow (Spec ↔ Vectors ↔ Validators ↔ Harness)

When changing or clarifying protocol behavior, follow this loop:

1. **Spec proposal**
   - Identify ambiguity or needed change in v0.8.1 (e.g., nonce context, epoch skew tolerance, error codes).
   - Draft the intended behavior in spec language (preferably as a delta section or subsection for v0.9).

2. **Test vectors**
   - Add or update vectors in `tests/common/*` that concretely exercise the new or clarified behavior.
   - Ensure vectors are language-agnostic and well-documented.

3. **Validators**
   - Update validators in `validation/*` to enforce the new behavior:
     - CBOR shapes and required fields.
     - Crypto derivations and deterministic IV/AAD rules.
     - EARE/epoch/fork and adversarial simulation expectations.

4. **Minimal JS harness**
   - Update the Node test harness under `clients/minimal-js/` so it:
     - Produces outputs consistent with the updated spec and vectors.
     - Emits machine-readable summaries for cross-language comparison.

5. **Spec finalization**
   - Once vectors, validators, and harness all agree, update the v0.9 spec text to reflect the final behavior.
   - Only then treat the behavior as "locked" for v0.9.

## Crypto and Parameter Changes

- DO NOT change cryptographic primitives or parameters casually.
  - v0.8.1 currently specifies:
    - Hybrid X25519 + Kyber handshake.
    - HKDF-SHA256 (32-byte) with labeled info strings.
    - AES-256-GCM for messaging, DR, and media.
    - Deterministic 96-bit IV based on hashed context.
    - AAD based on canonical CBOR headers.
    - ed25519 signatures for group/EARE.
- Any change to these MUST:
  - Be justified in the spec (e.g., rationale, security/performance reasons).
  - Come with updated test vectors and validation checks.
  - Be called out in a "Changes from v0.8.1" section.

## v0.9 Spec Delta Outline (Draft)

When creating or editing a v0.9 spec, prefer structuring changes as deltas from v0.8.1, for example:

1. **Handshake and Key Schedule Refinements**
   - Clarify exact KEM/KDF/AEAD parameter sets.
   - Nail down HKDF labels and output lengths for each stage (handshake, DR, group, media).
   - Specify deterministic IV/AAD construction rules unambiguously.

2. **Group Messaging and EARE**
   - Clarify membership and admin semantics.
   - Define exact EARE hash-chain requirements and signature rules.
   - Align error codes with adversarial EARE/corruption tests.

3. **Media Encryption and Epoch Management**
   - Define media key schedule steps (callKey → streamKey → media_epoch_key → frame_key).
   - Clarify media epoch skew tolerance and rekeying triggers.
   - Explicitly define media frame header fields used in IV/AAD.

4. **Replay, DR Divergence, and Epoch Fork Handling**
   - Codify the behaviors observed in adversarial simulators:
     - Replay windows and drop policies.
     - DR rollback detection and recovery.
     - Fork detection and reconciliation policies.
   - Tie these behaviors to normative MUST/SHOULD language and error codes.

5. **SFU Auth and Abuse Guardrails**
   - Specify token structures, nonce/timestamp rules, and replay protections.
   - Clarify SFU’s logical untrusted role and required client-side checks.
   - Describe what "media transcript integrity" guarantees in terms of cryptographic binding.

6. **Conformance and Interoperability Requirements**
   - List required validators and test suites for an implementation to claim v0.9 compatibility.
   - Reference the crypto conformance validators and adversarial corpora.
   - Define pass/fail criteria for conformance.

## Drift Prevention Rules for Spec Work

- DO:
  - Use existing test vectors and validators as evidence when refining the spec.
  - Add "Notes" or "Implementation Guidance" sections when behavior is subtle but not strictly normative.
  - Keep a clear "Changes from v0.8.1" section for v0.9.
- DO NOT:
  - Rewrite core crypto or state machines without updating vectors, validators, and harness.
  - Introduce new fields or tags in spec examples without updating `tests/common/*` and `validation/*`.
  - Relax security properties to accommodate a single implementation’s limitations.

By following this guide, agents will help ensure that v0.9 is a well-evidenced refinement of v0.8.1, grounded in real tests and multi-language implementations rather than drifting away from the original design.
