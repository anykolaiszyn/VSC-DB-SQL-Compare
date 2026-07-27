# [PROJECT NAME] — Release Checklist

## Release identity

- **Version or artifact:** [VERSION OR NAME]
- **Candidate location:** [PATH OR URL]
- **Release owner:** [NAME OR ROLE]

## Fresh verification

- [ ] Focused tests completed with recorded commands and results.
- [ ] Full test suite completed with recorded commands and results.
- [ ] Static analysis, formatting, and build checks completed where applicable.
- [ ] A deterministic source-tree output is recorded and reproducible from the approved revision.
- [ ] A deterministic ZIP output is recorded and reproducible from the approved source-tree output.
- [ ] The release handbook is generated or updated from the approved source-tree output.
- [ ] Offline validation and offline packaging use standard-library-only tooling without network access.

## Security, dependencies, and licenses

- [ ] Security review covers secrets, authentication, authorization, input handling, and data exposure.
- [ ] Dependency inventory identifies direct and packaged dependencies with versions.
- [ ] License inventory covers application code, runtime components, and redistributed libraries.
- [ ] Package contains no unapproved secrets, personal data, source backups, or development-only credentials.

## Package contents and real-input validation

- [ ] Package contents match the approved artifact inventory; unexpected files are investigated.
- [ ] Real-input validation uses approved data and preserves read-only source systems.
- [ ] Source immutability evidence compares approved source snapshots before and after validation.
- [ ] Packaged application smoke test records startup, primary workflow, failure handling, and clean shutdown.

## Reconciliation and artifact evidence

- [ ] Reports reconcile with produced outputs, counts, and status values.
- [ ] Artifact hashes are recorded with algorithm, value, and file name.
- [ ] Known limitations and user-facing recovery guidance are documented.

## Independent release review

- **Independent reviewer:** [NAME OR ROLE]
- **Review report:** [PATH]
- **Approval decision:** [APPROVED/CHANGES REQUIRED/BLOCKED]
- **Approval date:** [DATE]
- **Release notes or conditions:** [NOTES]

## Final human release approval

Complete this record only after all fresh candidate evidence and the independent
release review above are recorded.

- **Decision:** [APPROVED/CHANGES REQUIRED/BLOCKED]
- **Approver:** [NAME OR ROLE]
- **Timestamp:** [ISO 8601 TIMESTAMP WITH TIME ZONE]
- **Evidence or hash identity:** [EVIDENCE PATH AND ARTIFACT HASH]
- **Conditions:** [NONE OR CONDITIONS]
