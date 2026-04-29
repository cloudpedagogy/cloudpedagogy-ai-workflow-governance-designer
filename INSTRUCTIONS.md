# AI Workflow Governance Designer — User Instructions

---
### 2. What This Tool Does
This tool enables teams to formally design, document, and map risk controls for AI-supported processes (e.g., using AI in marking or admissions). It provides a structured environment to outline the human-in-the-loop oversight points, fallback plans, and data handling requirements.

---
### 3. Role in the Ecosystem
- **Phase:** Phase 2 — Governance Pipeline
- **Role:** Designing risk controls and oversight for AI-supported workflows.
- **Reference:** [../SYSTEM_OVERVIEW.md](../SYSTEM_OVERVIEW.md)

---
### 4. When to Use This Tool
- When proposing a new AI tool or automated process within the institution.
- When outlining where human judgement is required within a multi-step AI process.
- To produce an auditable design document before a workflow is deployed into production.

---
### 5. Inputs
- Manual entry: Teams use the drag-and-drop designer and form fields to assemble workflow steps, control points, and risk metrics.

---
### 6. How to Use (Step-by-Step)
1. Define the basic parameters and scope of your proposed AI workflow.
2. Add steps to your workflow map (e.g., Data Input, AI Generation, Human Review).
3. Attach specific AI roles and capabilities to the relevant steps.
4. Define explicit risk controls, oversight mechanisms, and human intervention points.
5. Review the generated visual map to ensure no automated actions occur without an accountability layer.
6. Export the completed workflow design for audit or review.

---
### 7. Key Outputs
- A structured visual map of the intended AI workflow.
- A highly detailed, auditable JSON specification of intended risk controls and responsibilities.

---
### 8. How It Connects to Other Tools
- **Upstream:** Acts as the primary design-time tool for AI operations.
- **Downstream:** Outputs from the Designer are aggressively audited by the **AI Governance Risk Scanner**.

---
### 9. Limitations
- Does not independently detect flaws in your logic while designing; it relies on your explicit inputs.
- It is a design/documentation tool; it does not directly execute or orchestrate the actual operational workflow.

---
### 10. Tips
- Be extremely explicit about the "Fallback mechanism" for any step where an AI system might fail or hallucinate.

---
### 11. Capability and Governance
- **What the tool does**: This tool enables teams to formally design, document, and map risk controls for AI-supported processes.
- **How capability is developed through use**: Capability is developed by forcing process owners to explicitly think through human-AI boundaries, reliance levels, and intervention points.
- **How governance is supported**: Governance is supported by creating a visible, auditable record of designed oversight and risk mitigation strategies.
- **Optional Fields**: The "Capability & Governance Notes" section allows for documenting specific capability development goals and high-level governance reflections that supplement the step-by-step risk mapping.
