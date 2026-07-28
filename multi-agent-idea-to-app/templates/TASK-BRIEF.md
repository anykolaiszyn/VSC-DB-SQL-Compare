# [PROJECT NAME] — Task Brief [TASK ID]

## Objective

[SINGLE, VERIFIABLE TASK OUTCOME]

Note to whoever dispatches an implementer against this brief: when briefing
the implementer, quote this document's load-bearing requirements verbatim
rather than paraphrasing them. A paraphrase that loosens a requirement (for
example, turning a required field into an offhand "nice to have if there's
time") is a known failure mode — the implementer treats the paraphrase as
authoritative and a real requirement quietly drops. If a dispatch prompt
must summarize this brief for brevity, it should still point back to this
file as the sole authority wherever the two could be read to disagree.

## Dependencies

- **Required completed tasks:** [TASK IDS OR NONE]
- **Required decisions or approvals:** [REFERENCES OR NONE]

## Files owned

- [PATH OWNED BY THIS TASK]

## Interfaces

| Direction | Interface | Contract | Producer or consumer |
| --- | --- | --- | --- |
| Consumed | [INPUT] | [EXPECTED SHAPE OR BEHAVIOR] | [SOURCE] |
| Produced | [OUTPUT] | [GUARANTEED SHAPE OR BEHAVIOR] | [CONSUMER] |

## Prohibited changes

- Do not modify [OUT-OF-SCOPE FILES OR SYSTEMS].
- Do not alter [READ-ONLY INPUTS, EXTERNAL STATE, OR PROTECTED DATA].
- Do not expand scope without a revised task brief and ledger decision.

## Red-state evidence

- **Test or check to add:** [TEST NAME OR OBSERVATION]
- **Command:** [FOCUSED COMMAND]
- **Expected failure reason:** [MISSING OR INCORRECT BEHAVIOR]
- **Captured output:** [RESULT, EXIT STATUS, AND LOCATION]

## Green-state and full verification

- **Focused command:** [COMMAND]
- **Full command:** [COMMAND]
- **Expected evidence:** [PASS COUNTS, ARTIFACTS, OR OBSERVATIONS]

## Handoff

- **Implementation report location:** [PATH]
- **Independent reviewer:** [NAME OR ROLE]
- **Review report location:** [PATH]
- **Commit or patch checkpoint:** [IDENTITY]
