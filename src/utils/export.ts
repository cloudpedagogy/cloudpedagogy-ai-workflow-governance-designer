import type { WorkflowStore } from '../data/model';
import { mapStoreToSchema } from './schema';

export { mapStoreToSchema };

export function exportToJSON(store: WorkflowStore) {
  // Validation against required schema fields
  const required = ['title', 'owner', 'purpose'];
  const missing = required.filter(f => !store.metadata[f as keyof typeof store.metadata]);

  if (missing.length > 0) {
    alert(
      `Critical Schema Failure: Missing required fields: ${missing.join(', ')}. Please complete these before exporting.`
    );
    return;
  }

  const schemaCompliant = mapStoreToSchema(store);
  const dataStr = JSON.stringify(schemaCompliant, null, 2);
  const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
  const rawTitle = store.metadata.title || 'untitled';
  const cleanTitle = rawTitle.toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'untitled';
  const exportFileDefaultName = `workflow-${cleanTitle}.json`;

  const linkElement = document.createElement('a');
  linkElement.setAttribute('href', dataUri);
  linkElement.setAttribute('download', exportFileDefaultName);
  linkElement.click();
}

export function generateMarkdown(store: WorkflowStore): string {
  let md = `# AI Workflow Governance Specification\n\n`;
  md += `## 1. Workflow Metadata\n`;
  md += `- **Title**: ${store.metadata.title || 'Untitled'}\n`;
  md += `- **Owner**: ${store.metadata.owner || 'Not specified'}\n`;
  md += `- **Organisation**: ${store.metadata.organisation || 'Not specified'}\n`;
  md += `- **Purpose**: ${store.metadata.purpose || 'Not specified'}\n`;
  md += `- **Domain**: ${store.metadata.domain || 'Not specified'}\n`;
  md += `- **Version**: ${store.metadata.version || '1.0.0'}\n`;
  md += `- **Created At**: ${store.metadata.created_at || 'Not specified'}\n`;
  if (store.metadata.capabilityNotes) md += `- **AI Capability Notes**: ${store.metadata.capabilityNotes}\n`;
  if (store.metadata.governanceNotes) md += `- **AI Governance Notes**: ${store.metadata.governanceNotes}\n`;
  md += `\n`;

  md += `## 2. Workflow Steps\n\n`;
  store.steps.forEach((step, index) => {
    md += `### Step ${index + 1}: ${step.name || 'Untitled Step'}\n`;
    md += `- **Type**: ${step.type}\n`;
    md += `- **Description**: ${step.description || 'N/A'}\n`;
    md += `- **Inputs**: ${(step.inputs && step.inputs.length > 0) ? step.inputs.join(', ') : 'None'}\n`;
    md += `- **Outputs**: ${(step.outputs && step.outputs.length > 0) ? step.outputs.join(', ') : 'None'}\n\n`;

    md += `#### Human-AI Boundary\n`;
    md += `- **Responsible Role**: ${step.human_oversight?.responsible_role || 'Not specified'}\n`;
    md += `- **Oversight Level**: ${step.human_oversight?.oversight_level || 'none'}\n`;
    md += `- **Intervention Points**: ${step.human_oversight?.intervention_points || 'None'}\n\n`;

    md += `#### Risk & Controls\n`;
    md += `- **Bias Risk**: ${step.risks?.bias_risk || 'None identified'}\n`;
    md += `- **Operational Risk**: ${step.risks?.operational_risk || 'None identified'}\n`;
    md += `- **Mitigation**: ${step.risks?.mitigation || 'N/A'}\n`;
    if (step.type === 'decision-point') {
      md += `- **Decision Record Required**: ${step.controls?.approval_required ? 'YES' : 'No'}\n`;
    }
    md += `\n`;

    md += `---\n\n`;
  });

  md += `## 3. Critical Reflection\n`;
  md += `### Failure Modes\n${store.reflection?.failure_modes || 'None documented'}\n\n`;
  md += `### Essential Human Judgement\n${store.reflection?.essential_judgement || 'None documented'}\n\n`;
  md += `### AI Over-reliance Risks\n${store.reflection?.over_reliance_risks || 'None documented'}\n\n`;
  md += `### Embedded Assumptions\n${store.reflection?.embedded_assumptions || 'None documented'}\n\n`;

  return md;
}

export function exportToMarkdown(store: WorkflowStore) {
  const md = generateMarkdown(store);
  const dataUri = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(md);
  const rawTitle = store.metadata.title || 'untitled';
  const cleanTitle = rawTitle.toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'untitled';
  const filename = `workflow-${cleanTitle}.md`;

  const linkElement = document.createElement('a');
  linkElement.setAttribute('href', dataUri);
  linkElement.setAttribute('download', filename);
  linkElement.click();
}

export function exportToPDF() {
  window.print();
}
