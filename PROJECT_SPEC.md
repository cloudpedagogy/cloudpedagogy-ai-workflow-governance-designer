# PROJECT_SPEC: cloudpedagogy-ai-workflow-governance-designer

## 1. Repo Name
`cloudpedagogy-ai-workflow-governance-designer`

## 2. One-Sentence Purpose
A design-time tool for building human-AI workflows with integrated governance, oversight, and risk controls.

## 3. Problem the App Solves
Ad-hoc or "silent" AI use in institutional processes creates invisible risks; this tool forces process owners to explicitly design human oversight, reliance levels, and escalation paths at the architectural stage.

## 4. Primary User / Audience
Process owners, institutional designers, and administrative leads.

## 5. Core Role in the CloudPedagogy Ecosystem
The "Design Engine"; produces the structured workflow artifacts (JSON) that serve as the input for risk scanning and operational implementation in other tools (e.g., Studio, Scanner).

## 6. Main Entities / Data Structures
- **WorkflowStep**: Individual task units classified by type (human-only, ai-supported, etc.) with specific reliance and oversight levels.
- **WorkflowMetadata**: Contextual data (Purpose, Domain, Version) defining the workflow's scope.
- **Reflection**: Captures deeper context such as embedded assumptions, failure modes, and required human judgment points.
- **WorkflowStore**: The unified data structure representing the full design session.

## 7. Main User Workflows
1. **Workflow Scoping**: Establish the metadata, purpose, and institutional domain.
2. **Step Definition**: Build a sequence of tasks, assigning AI roles and human oversight requirements to each.
3. **Risk/Control Mapping**: Identify potential biases and operational risks, then assign controls (e.g., sign-offs, escalations).
4. **Governance Reflection**: Document essential human judgment and identify over-reliance risks.
5. **Architectural Export**: Generate a JSON record of the design for audit and implementation.

## 8. Current Features
- Step-type classification (4 distinct human/AI interaction categories).
- Reliance-level and oversight-level mapping.
- Mitigation and control tracking.
- Embedded risk reflection engine.
- Shared schema support for Risk Scanner compatibility.

## 9. Stubbed / Partial / Incomplete Features
- Not explicitly defined in documentation.

## 10. Import / Export and Storage Model
- **Storage**: Persistent local storage (`localStorage`).
- **Import/Export**: Robust JSON export/import for cross-tool interoperability and session persistence.

## 11. Relationship to Other CloudPedagogy Apps
This is the "Upstream" design tool; its outputs are audited by the `governance-risk-scanner` and operationalised in the `ai-capability-studio`.

## 12. Potential Overlap or Duplication Risks
Overlaps with generic flowcharting or BPMN tools, but is unique in its focus on specialized AI-governance metadata (e.g., "Intervention Points").

## 13. Distinctive Value of This App
Only tool in the ecosystem that forces the explicit design of "Human Oversight Levels" as an architectural constraint of the workflow.

## 14. Recommended Future Enhancements
(Inferred) Automated alignment checker against institutional policy templates; visual "Risk Hotspot" identification within the workflow map.

## 15. Anything Unclear or Inferred from Repo Contents
"Decision-Point" is treated as a specialized StepType that triggers human-only sign-off logic in the export model.
