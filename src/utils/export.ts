import type { WorkflowStore } from '../data/model';

export function exportToJSON(store: WorkflowStore) {
  const dataStr = JSON.stringify(store, null, 2);
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
