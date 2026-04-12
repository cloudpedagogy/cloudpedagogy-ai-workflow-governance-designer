import { calculateAIDependency, calculateCompleteness, type WorkflowStore } from '../data/model';

export function mapStoreToSchema(store: WorkflowStore) {
  return {
    metadata: {
      workflow_id: store.metadata.id,
      workflow_title: store.metadata.title,
      version: store.metadata.version,
      created_at: store.metadata.created_at,
      workflow_owner: store.metadata.owner,
      organisation: store.metadata.organisation,
      purpose: store.metadata.purpose,
      domain: store.metadata.domain
    },
    steps: store.steps.map(step => ({
      step_id: step.id,
      step_name: step.name,
      step_type: step.type,
      description: step.description,
      inputs: step.inputs,
      outputs: step.outputs,
      ai_involvement: step.ai_involvement,
      human_oversight: step.human_oversight,
      risks: step.risks,
      controls: step.controls
    })),
    reflection: store.reflection,
    design_time_metrics: {
      _disclaimer: "These metrics are indicative design-time markers and must be recalculated by downstream authoritative audit tools (e.g. AI Governance Risk Scanner).",
      completeness_score: calculateCompleteness(store),
      ai_dependency_score: calculateAIDependency(store)
    }
  };
}

export function exportToJSON(store: WorkflowStore) {
  // Validation
  const required = ['title', 'owner', 'purpose'];
  const missing = required.filter(f => !store.metadata[f as keyof typeof store.metadata]);
  
  if (missing.length > 0) {
    alert(`Critical Schema Failure: Missing required fields: ${missing.join(', ')}. Please complete these before exporting.`);
    return;
  }

  const schemaCompliant = mapStoreToSchema(store);
  const dataStr = JSON.stringify(schemaCompliant, null, 2);
  const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
  const exportFileDefaultName = `workflow-${store.metadata.title.toLowerCase().replace(/\s+/g, '-') || 'untitled'}.json`;

  const linkElement = document.createElement('a');
  linkElement.setAttribute('href', dataUri);
  linkElement.setAttribute('download', exportFileDefaultName);
  linkElement.click();
}

export function generateMarkdown(store: WorkflowStore): string {
  let md = `# AI Workflow Governance Specification\n\n`;
  md += `## 1. Workflow Metadata\n`;
  md += `- **Title**: ${store.metadata.title}\n`;
  md += `- **Owner**: ${store.metadata.owner}\n`;
  md += `- **Organisation**: ${store.metadata.organisation}\n`;
  md += `- **Purpose**: ${store.metadata.purpose}\n`;
  md += `- **Domain**: ${store.metadata.domain}\n`;
  md += `- **Version**: ${store.metadata.version}\n`;
  md += `- **Created At**: ${store.metadata.created_at}\n\n`;

  md += `## 2. Workflow Steps\n\n`;
  store.steps.forEach((step, index) => {
    md += `### Step ${index + 1}: ${step.name}\n`;
    md += `- **Type**: ${step.type}\n`;
    md += `- **Description**: ${step.description}\n`;
    md += `- **Inputs**: ${step.inputs.join(', ')}\n`;
    md += `- **Outputs**: ${step.outputs.join(', ')}\n\n`;
    
    md += `#### Human-AI Boundary\n`;
    md += `- **Responsible Role**: ${step.human_oversight.responsible_role}\n`;
    md += `- **Oversight Level**: ${step.human_oversight.oversight_level}\n`;
    md += `- **Intervention Points**: ${step.human_oversight.intervention_points}\n\n`;

    md += `#### Risk & Controls\n`;
    md += `- **Bias Risk**: ${step.risks.bias_risk || 'None identified'}\n`;
    md += `- **Operational Risk**: ${step.risks.operational_risk || 'None identified'}\n`;
    md += `- **Mitigation**: ${step.risks.mitigation || 'N/A'}\n`;
    if (step.type === 'decision-point') {
      md += `- **Decision Record Required**: ${step.controls.approval_required ? 'YES' : 'No'}\n`;
    }
    md += `\n`;

    md += `---\n\n`;
  });

  md += `## 3. Critical Reflection\n`;
  md += `### Failure Modes\n${store.reflection.failure_modes}\n\n`;
  md += `### Essential Human Judgement\n${store.reflection.essential_judgement}\n\n`;
  md += `### AI Over-reliance Risks\n${store.reflection.over_reliance_risks}\n\n`;
  md += `### Embedded Assumptions\n${store.reflection.embedded_assumptions}\n\n`;

  return md;
}

export function exportToMarkdown(store: WorkflowStore) {
  const md = generateMarkdown(store);
  const dataUri = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(md);
  const filename = `workflow-${store.metadata.title.toLowerCase().replace(/\s+/g, '-') || 'untitled'}.md`;

  const linkElement = document.createElement('a');
  linkElement.setAttribute('href', dataUri);
  linkElement.setAttribute('download', filename);
  linkElement.click();
}

export function exportToPDF() {
  window.print();
}
