# [PROJECT NAME] — Design Specification

## Scope and non-goals

- **In scope:** [CAPABILITIES AND DELIVERABLES]
- **Non-goals:** [EXPLICITLY EXCLUDED CAPABILITIES]
- **Compatibility boundary:** [SUPPORTED ENVIRONMENTS AND VERSIONS]

## Options considered and decision

| Option | Benefits | Costs or risks | Decision |
| --- | --- | --- | --- |
| [OPTION] | [BENEFITS] | [COSTS] | [SELECTED/NOT SELECTED] |

**Chosen approach:** [APPROACH]

**Decision rationale:** [WHY THIS APPROACH MEETS THE BRIEF]

## Architecture and component contracts

| Component | Responsibility | Inputs | Outputs | Dependencies | Owner |
| --- | --- | --- | --- | --- | --- |
| [COMPONENT] | [RESPONSIBILITY] | [INPUT CONTRACT] | [OUTPUT CONTRACT] | [DEPENDENCIES] | [OWNER] |

## Data flow

1. [SOURCE OR USER ACTION] provides [INPUT].
2. [COMPONENT] validates and transforms [INPUT] into [INTERMEDIATE RESULT].
3. [COMPONENT] produces [OUTPUT] at [SAFE OUTPUT LOCATION].
4. [REPORTING OR UI] communicates [RESULT AND LIMITATIONS].

## Error and recovery behavior

| Condition | User-visible behavior | Recovery behavior | Recorded evidence |
| --- | --- | --- | --- |
| [ERROR CONDITION] | [MESSAGE OR STATE] | [RETRY, RESUME, OR SAFE STOP] | [LOG OR REPORT] |

## Security, privacy, and safety

- **Data classification:** [PUBLIC, INTERNAL, PERSONAL, OR SENSITIVE DATA]
- **Access controls:** [AUTHORIZATION AND SECRET-HANDLING RULES]
- **External actions:** [WHAT REQUIRES HUMAN APPROVAL]
- **Write safety:** [OUTPUT CONTAINMENT, ATOMICITY, OR ROLLBACK RULES]
- **Read-only systems:** [SYSTEMS THAT MUST NOT BE CHANGED]

## Testing and release strategy

- **Focused tests:** [UNIT OR COMPONENT COMMANDS]
- **Integration tests:** [END-TO-END OR REAL-INPUT COMMANDS]
- **Release checks:** [PACKAGE, LICENSE, SECURITY, AND SMOKE-TEST EVIDENCE]
- **Evidence location:** [REPORT OR ARTIFACT LOCATION]

## Acceptance criteria

1. [OBSERVABLE REQUIREMENT AND EVIDENCE]
2. [OBSERVABLE REQUIREMENT AND EVIDENCE]
3. [OBSERVABLE REQUIREMENT AND EVIDENCE]

## Human approval record

- **Design reviewed by:** [NAME OR ROLE]
- **Decision:** [APPROVED/CHANGES REQUESTED]
- **Date:** [DATE]
- **Conditions or rationale:** [NOTES]
