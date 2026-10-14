# Editorial repair and recovery — 13 October 2026

The failure in run `9753bc11c88f4142b5d3186be831b50c` was an editorial refusal, not a source-tool connection failure. The editor received a hardcoded two-publisher requirement alongside the current conditional single-primary-source policy. Repair also filtered an already-pruned dossier against the original draft/check, and persisted the resulting empty refusal as the working draft.

## Runtime changes

The fanpage bot lives in `C:\Users\LENOVO\kim-tuyen-ai`.

- Research, collection, synthesis, editor and verifier use the same versioned policy renderer. Templates and synthesis examples no longer impose conflicting freshness, source-count or article-length requirements. Missing policy versions retain legacy rules.
- Repair filters the original research/draft/check once. The runtime provides `evidence_decision`, retained claim IDs and explicit instructions to remove dropped claims from prose and metadata. Obsolete evidence-count errors stay in audit history.
- Checkpoint v3 keeps the latest nonempty working draft, hashes, attempt outcomes and repair reservations; v1/v2 remain readable. Empty/refused results produce one editorial error rather than cascading caption/SEO/length errors.
- Repair calls reserve their allowance before dispatch. Automatic restart cannot reissue an already reserved repair. A manual continuation opens a new bounded round and retains previous-round history.
- Image controls use the same availability check as upload/prompt handlers. Existing five-call image limits and owner-upload exemption remain unchanged.
- No SQLite column or Hermes API changes were needed.

## Recovery and verification

Recovery cross-checks the recorded editor-1 result, editor-2 request's `previous_draft`, verifier request and caption digest. Artifact paths are restricted to their exact recorded request files under the bot data directory. SQLite, run/checkpoint and artifact files are backed up with a SHA-256 manifest before recovery.

The stable recovery event is `editor-repair-v3:9753bc11c88f4142b5d3186be831b50c`. Recovery retains C1/C2, excludes C3, rereads sources and runs a fresh verifier. The old verdict cannot authorize approval or publication.

Regression coverage includes the actual incident fixture, source-exception failures, unknown claims, unavailable evidence, empty-result preservation, repair reservation, legacy/current prompt consistency, image-control gating and a complete mocked repair→fresh-verifier→review flow.

Website verification: 449 tests passed, 32 database-dependent tests skipped; lint/build passed. Production deployment `dpl_BEQDaa3eSj4rQxvKnKjTH6phgLGw` is READY and aliased to `www.vanghomnay.online`. `/`, `/nhip-vang`, `/bien-tap` returned HTTP 200; signed rejection probes confirmed image-origin compatibility and digest protection without writing or publishing content.

Public publication still requires the owner's existing approval action.

## Actual acceptance result

The live recovery created a nonempty 185-word website draft (editor request `850607b6d31b465bae329e03ba0b3624`) and removed C3 and the incorrect allocation disclaimer. The initial fresh verifier omitted `primary_attributed`; its schema example was corrected, and a regression now identifies this as a verifier-schema error rather than insufficient evidence. Only verification was retried, without granting another editor repair.

Fresh verifier request `8d81b7e4759a45b89ca8985f3a143b27` confirmed C1 but rejected C2: WGC supports investment demand responding to real rates, but does not establish the draft's opportunity-cost interpretation. This is a new content-evidence blocker. The run remains `blocked_content`; the repaired draft and history are retained. The next manual repair context permits C1 and requires removing/correcting C2. The one permitted content repair has been consumed; no extra repair was automatically granted.

There were no image calls, no pending-review package and no public publication in this recovery. Telegram progress message 823 was updated with the specific blocker and the Continue button; image controls remain hidden until verification succeeds. This is not a completed end-to-end acceptance to pending review.

Final checks: the full bot suite completed 620 tests (4 skipped); later bounded-resume/idempotency changes passed 66 targeted tests. The actual result is recorded at `C:\Users\LENOVO\kim-tuyen-ai\outputs\editor-repair-20261013\acceptance.json`. The SQLite/artifact recovery backup is under `backups\editor-recovery-v3-9753bc11c88f4142b5d3186be831b50c` in the bot directory.
