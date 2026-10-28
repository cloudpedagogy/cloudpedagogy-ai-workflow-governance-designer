import {
  calculateCompleteness,
  calculateAIDependency,
  getHumanOversightIndicator,
  detectConsecutiveAISteps,
  getGovernanceSuggestions,
  type WorkflowStore
} from '../data/model';
import { mapRegistryToExportPayload, mapStoreToSchema, type WorkflowRegistry } from './schema';
import { escapeHtml } from './security';

export { mapStoreToSchema, mapRegistryToExportPayload };

const STEP_TYPE_DISPLAY: Record<string, string> = {
  'human-only': 'Human Only',
  'ai-supported': 'AI Supported',
  'ai-generated': 'AI Generated',
  'decision-point': 'Decision Point'
};

export const GOVERNANCE_REPORT_DISCLAIMER =
  'This governance specification and its calculated completeness and AI-dependency metrics are indicative design-time aids developed for structured reflection, capability development, and governance planning. They do not constitute formal certification, independent risk audit sign-off, or legal/regulatory compliance.';

export function validateForExport(store: WorkflowStore): string[] {
  const missing: string[] = [];
  const requiredMeta: Array<{ key: keyof typeof store.metadata; label: string }> = [
    { key: 'title', label: 'title' },
    { key: 'owner', label: 'owner' },
    { key: 'purpose', label: 'purpose' }
  ];

  for (const { key, label } of requiredMeta) {
    const val = store.metadata?.[key];
    if (typeof val !== 'string' || val.trim() === '') {
      missing.push(label);
    }
  }

  if (Array.isArray(store.steps)) {
    store.steps.forEach((step, index) => {
      if (!step || typeof step.name !== 'string' || step.name.trim() === '') {
        missing.push(`Step ${index + 1} name`);
      }
    });
  }

  return missing;
}

export function exportToJSON(store: WorkflowStore): boolean {
  const missing = validateForExport(store);

  if (missing.length > 0) {
    alert(
      `Critical Schema Failure: Missing required fields: ${missing.join(', ')}. Please complete these before exporting a formal specification, or use "Export Draft / Recovery JSON" to save your unfinished working draft.`
    );
    return false;
  }

  const schemaCompliant = mapStoreToSchema(store);
  const dataStr = JSON.stringify(schemaCompliant, null, 2);
  const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
  const rawTitle = store.metadata.title?.trim() || 'untitled';
  const cleanTitle = rawTitle.toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'untitled';
  const exportFileDefaultName = `workflow-${cleanTitle}.json`;

  const linkElement = document.createElement('a');
  linkElement.setAttribute('href', dataUri);
  linkElement.setAttribute('download', exportFileDefaultName);
  linkElement.click();
  return true;
}

/**
 * Lossless working-draft / recovery export path.
 * Exports the current in-memory workflow structure without blocking on incomplete metadata or unnamed steps.
 */
export function exportDraftToJSON(store: WorkflowStore): string {
  const draftPayload = {
    ...mapStoreToSchema(store),
    _draft_recovery: true
  };
  const dataStr = JSON.stringify(draftPayload, null, 2);
  const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
  const rawTitle = store.metadata?.title?.trim() || 'untitled-draft';
  const cleanTitle = rawTitle.toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'untitled-draft';
  const exportFileDefaultName = `workflow-draft-${cleanTitle}.json`;

  const linkElement = document.createElement('a');
  linkElement.setAttribute('href', dataUri);
  linkElement.setAttribute('download', exportFileDefaultName);
  linkElement.click();
  return dataStr;
}

/**
 * Exports a complete multi-workflow registry backup JSON containing all workflows,
 * drafts, workflow identities, step configurations, and extension properties.
 */
export function exportRegistryToJSON(registry: WorkflowRegistry): string {
  const payload = mapRegistryToExportPayload(registry);
  const dataStr = JSON.stringify(payload, null, 2);
  const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
  const exportFileDefaultName = 'workflow-registry-backup.json';

  const linkElement = document.createElement('a');
  linkElement.setAttribute('href', dataUri);
  linkElement.setAttribute('download', exportFileDefaultName);
  linkElement.click();
  return dataStr;
}

export function generateMarkdown(store: WorkflowStore): string {
  const completeness = calculateCompleteness(store);
  const dependency = calculateAIDependency(store);
  const oversightIndicator = getHumanOversightIndicator(store);

  let md = `# AI Workflow Governance Specification\n\n`;
  md += `## 1. Workflow Metadata\n`;
  md += `- **Title**: ${store.metadata.title || 'Untitled'}\n`;
  md += `- **Workflow ID**: ${store.metadata.id || 'Not specified'}\n`;
  md += `- **Owner**: ${store.metadata.owner || 'Not specified'}\n`;
  md += `- **Organisation**: ${store.metadata.organisation || 'Not specified'}\n`;
  md += `- **Purpose**: ${store.metadata.purpose || 'Not specified'}\n`;
  md += `- **Domain**: ${store.metadata.domain || 'Not specified'}\n`;
  md += `- **Version**: ${store.metadata.version || '1.0.0'}\n`;
  md += `- **Created At**: ${store.metadata.created_at || 'Not specified'}\n`;
  if (store.metadata.capabilityNotes) md += `- **AI Capability Notes**: ${store.metadata.capabilityNotes}\n`;
  if (store.metadata.governanceNotes) md += `- **AI Governance Notes**: ${store.metadata.governanceNotes}\n`;
  md += `\n`;

  md += `### Governance & Risk Metrics Summary\n`;
  md += `- **Governance Completeness Index**: ${completeness}%\n`;
  md += `- **AI Dependency Ratio**: ${dependency}%\n`;
  md += `- **High-Risk Oversight Gaps**: ${oversightIndicator.count}\n\n`;

  md += `## 2. Workflow Steps\n\n`;
  store.steps.forEach((step, index) => {
    md += `### Step ${index + 1}: ${step.name || 'Untitled Step'}\n`;
    md += `- **Type**: ${step.type}\n`;
    md += `- **Description**: ${step.description || 'N/A'}\n`;
    md += `- **Inputs**: ${(step.inputs && step.inputs.length > 0) ? step.inputs.join(', ') : 'None'}\n`;
    md += `- **Outputs**: ${(step.outputs && step.outputs.length > 0) ? step.outputs.join(', ') : 'None'}\n\n`;

    md += `#### AI Involvement\n`;
    md += `- **AI Role**: ${step.ai_involvement?.ai_role || 'Not specified'}\n`;
    md += `- **AI Reliance Level**: ${step.ai_involvement?.reliance_level || 'low'}\n\n`;

    md += `#### Human-AI Boundary\n`;
    md += `- **Responsible Role**: ${step.human_oversight?.responsible_role || 'Not specified'}\n`;
    md += `- **Oversight Level**: ${step.human_oversight?.oversight_level || 'none'}\n`;
    md += `- **Intervention Points**: ${step.human_oversight?.intervention_points || 'None'}\n\n`;

    md += `#### Risk & Controls\n`;
    md += `- **Bias Risk**: ${step.risks?.bias_risk || 'None identified'}\n`;
    md += `- **Operational Risk**: ${step.risks?.operational_risk || 'None identified'}\n`;
    md += `- **Ethical Risk**: ${step.risks?.ethical_risk || 'None identified'}\n`;
    md += `- **Privacy Risk**: ${step.risks?.privacy_risk || 'None identified'}\n`;
    md += `- **Mitigation**: ${step.risks?.mitigation || 'N/A'}\n`;
    md += `- **Approval Required**: ${step.controls?.approval_required ? 'YES' : 'No'}\n`;
    if (step.type === 'decision-point') {
      md += `- **Decision Record Required**: ${step.controls?.approval_required ? 'YES' : 'No'}\n`;
    }
    md += `- **Escalation Path**: ${step.controls?.escalation_path || 'Not specified'}\n`;
    md += `- **Review Cycle**: ${step.controls?.review_cycle || 'Not specified'}\n`;
    md += `\n`;

    md += `---\n\n`;
  });

  md += `## 3. Critical Reflection\n`;
  md += `### Failure Modes\n${store.reflection?.failure_modes || 'None documented'}\n\n`;
  md += `### Essential Human Judgement\n${store.reflection?.essential_judgement || 'None documented'}\n\n`;
  md += `### AI Over-reliance Risks\n${store.reflection?.over_reliance_risks || 'None documented'}\n\n`;
  md += `### Embedded Assumptions\n${store.reflection?.embedded_assumptions || 'None documented'}\n\n`;

  md += `## 4. Non-Certification & Governance Scope Disclaimer\n`;
  md += `${GOVERNANCE_REPORT_DISCLAIMER}\n`;

  return md;
}

/**
 * Generates a dedicated, XSS-safe, print/PDF-ready HTML governance specification report
 * containing all workflow metadata, completeness/dependency metrics, ordered steps,
 * AI roles & reliance levels, human oversight & intervention points, all 4 risk dimensions,
 * mitigations, approval & decision-record requirements, escalation paths, review cycles,
 * critical reflection, and the non-certification disclaimer.
 */
export function generatePrintableReportHTML(store: WorkflowStore): string {
  const completeness = calculateCompleteness(store);
  const dependency = calculateAIDependency(store);
  const oversightIndicator = getHumanOversightIndicator(store);
  const consecutiveClusters = detectConsecutiveAISteps(store);
  const suggestions = getGovernanceSuggestions(store);

  const meta = store.metadata || ({} as WorkflowStore['metadata']);
  const reflection = store.reflection || ({} as WorkflowStore['reflection']);
  const steps = Array.isArray(store.steps) ? store.steps : [];

  const stepsHtml =
    steps.length === 0
      ? `<p class="print-empty">No workflow steps have been defined yet.</p>`
      : steps
          .map((step, index) => {
            const typeLabel = STEP_TYPE_DISPLAY[step.type] || step.type;
            const inputsText =
              Array.isArray(step.inputs) && step.inputs.length > 0
                ? step.inputs.map(i => escapeHtml(i)).join(', ')
                : 'None';
            const outputsText =
              Array.isArray(step.outputs) && step.outputs.length > 0
                ? step.outputs.map(o => escapeHtml(o)).join(', ')
                : 'None';
            const isDecisionPoint = step.type === 'decision-point';
            const approvalText = step.controls?.approval_required ? 'Yes (Required)' : 'No';
            const decisionRecordRow = isDecisionPoint
              ? `<div class="print-kv"><span class="print-k">Decision Record Required:</span> <span class="print-v">${
                  step.controls?.approval_required
                    ? 'YES — Mandated (Human-AI Decision Record)'
                    : 'No (Unset for Decision Point)'
                }</span></div>`
              : '';

            return `
              <article class="print-step-card">
                <header class="print-step-header">
                  <div class="print-step-title">
                    <strong>Step ${index + 1}: ${escapeHtml(step.name || 'Untitled Step')}</strong>
                  </div>
                  <div class="print-step-badges">
                    <span class="print-badge">${escapeHtml(typeLabel)} (${escapeHtml(step.type)})</span>
                  </div>
                </header>

                <div class="print-step-body">
                  <div class="print-kv-block">
                    <div class="print-kv"><span class="print-k">Description:</span> <span class="print-v">${escapeHtml(step.description || 'Not specified')}</span></div>
                    <div class="print-kv"><span class="print-k">Inputs:</span> <span class="print-v">${inputsText}</span></div>
                    <div class="print-kv"><span class="print-k">Outputs:</span> <span class="print-v">${outputsText}</span></div>
                  </div>

                  <div class="print-step-grid">
                    <div class="print-subcard">
                      <h4>AI Involvement &amp; Reliance</h4>
                      <div class="print-kv"><span class="print-k">AI Role / Function:</span> <span class="print-v">${escapeHtml(step.ai_involvement?.ai_role || 'Not specified')}</span></div>
                      <div class="print-kv"><span class="print-k">AI Reliance Level:</span> <span class="print-v">${escapeHtml(step.ai_involvement?.reliance_level || 'low')}</span></div>
                    </div>

                    <div class="print-subcard">
                      <h4>Human-AI Boundary &amp; Oversight</h4>
                      <div class="print-kv"><span class="print-k">Responsible Role:</span> <span class="print-v">${escapeHtml(step.human_oversight?.responsible_role || 'Not specified')}</span></div>
                      <div class="print-kv"><span class="print-k">Oversight Level:</span> <span class="print-v">${escapeHtml(step.human_oversight?.oversight_level || 'none')}</span></div>
                      <div class="print-kv"><span class="print-k">Intervention Points:</span> <span class="print-v">${escapeHtml(step.human_oversight?.intervention_points || 'None')}</span></div>
                    </div>
                  </div>

                  <div class="print-step-grid">
                    <div class="print-subcard">
                      <h4>Risk Identification</h4>
                      <div class="print-kv"><span class="print-k">Ethical Risk:</span> <span class="print-v">${escapeHtml(step.risks?.ethical_risk || 'None identified')}</span></div>
                      <div class="print-kv"><span class="print-k">Privacy / Data Risk:</span> <span class="print-v">${escapeHtml(step.risks?.privacy_risk || 'None identified')}</span></div>
                      <div class="print-kv"><span class="print-k">Bias / Fairness Risk:</span> <span class="print-v">${escapeHtml(step.risks?.bias_risk || 'None identified')}</span></div>
                      <div class="print-kv"><span class="print-k">Operational Risk:</span> <span class="print-v">${escapeHtml(step.risks?.operational_risk || 'None identified')}</span></div>
                      <div class="print-kv"><span class="print-k">Mitigation Measures:</span> <span class="print-v">${escapeHtml(step.risks?.mitigation || 'Not specified')}</span></div>
                    </div>

                    <div class="print-subcard">
                      <h4>Governance Controls &amp; Approvals</h4>
                      <div class="print-kv"><span class="print-k">Approval Required:</span> <span class="print-v">${approvalText}</span></div>
                      ${decisionRecordRow}
                      <div class="print-kv"><span class="print-k">Escalation Path:</span> <span class="print-v">${escapeHtml(step.controls?.escalation_path || 'Not specified')}</span></div>
                      <div class="print-kv"><span class="print-k">Review Cycle:</span> <span class="print-v">${escapeHtml(step.controls?.review_cycle || 'Not specified')}</span></div>
                    </div>
                  </div>
                </div>
              </article>
            `;
          })
          .join('');

  const capabilityGovernanceNotesHtml =
    meta.capabilityNotes || meta.governanceNotes
      ? `
        <div class="print-notes-block">
          ${
            meta.capabilityNotes
              ? `<div class="print-kv"><span class="print-k">AI Capability Notes:</span> <span class="print-v">${escapeHtml(meta.capabilityNotes)}</span></div>`
              : ''
          }
          ${
            meta.governanceNotes
              ? `<div class="print-kv"><span class="print-k">AI Governance Notes:</span> <span class="print-v">${escapeHtml(meta.governanceNotes)}</span></div>`
              : ''
          }
        </div>
      `
      : '';

  const suggestionsHtml =
    suggestions.length > 0
      ? `<ul class="print-suggestions-list">${suggestions
          .map(
            s =>
              `<li><strong>${escapeHtml(s.type.toUpperCase())}:</strong> ${escapeHtml(s.message)}</li>`
          )
          .join('')}</ul>`
      : `<p class="print-empty">No immediate design-time governance warnings flagged.</p>`;

  return `
    <div class="print-report-wrapper">
      <header class="print-report-header">
        <div class="print-brand">CloudPedagogy · AI Workflow Governance Designer</div>
        <h1 class="print-report-title">${escapeHtml(meta.title || 'Untitled Workflow')}</h1>
        <p class="print-report-subtitle">AI Workflow Governance Specification Report</p>
      </header>

      <section class="print-section" aria-label="Workflow Context and Metadata">
        <h2>1. Workflow Context &amp; Ownership</h2>
        <div class="print-meta-grid">
          <div class="print-kv"><span class="print-k">Workflow Title:</span> <span class="print-v">${escapeHtml(meta.title || 'Untitled Workflow')}</span></div>
          <div class="print-kv"><span class="print-k">Workflow ID:</span> <span class="print-v">${escapeHtml(meta.id || 'Not specified')}</span></div>
          <div class="print-kv"><span class="print-k">Owner:</span> <span class="print-v">${escapeHtml(meta.owner || 'Not specified')}</span></div>
          <div class="print-kv"><span class="print-k">Organisation:</span> <span class="print-v">${escapeHtml(meta.organisation || 'Not specified')}</span></div>
          <div class="print-kv"><span class="print-k">Domain:</span> <span class="print-v">${escapeHtml(meta.domain || 'Not specified')}</span></div>
          <div class="print-kv"><span class="print-k">Version:</span> <span class="print-v">${escapeHtml(meta.version || '1.0.0')}</span></div>
          <div class="print-kv"><span class="print-k">Created At:</span> <span class="print-v">${escapeHtml(meta.created_at || 'Not specified')}</span></div>
        </div>
        <div class="print-kv-block">
          <div class="print-kv"><span class="print-k">Primary Purpose:</span> <span class="print-v">${escapeHtml(meta.purpose || 'Not specified')}</span></div>
        </div>
        ${capabilityGovernanceNotesHtml}
      </section>

      <section class="print-section" aria-label="Governance Completeness and AI Dependency Metrics">
        <h2>2. Governance &amp; AI-Dependency Metrics</h2>
        <div class="print-metrics-grid">
          <div class="print-metric-box">
            <div class="print-metric-label">Governance Completeness</div>
            <div class="print-metric-value">${completeness}%</div>
          </div>
          <div class="print-metric-box">
            <div class="print-metric-label">AI Dependency Ratio</div>
            <div class="print-metric-value">${dependency}%</div>
          </div>
          <div class="print-metric-box">
            <div class="print-metric-label">Total Workflow Steps</div>
            <div class="print-metric-value">${steps.length}</div>
          </div>
          <div class="print-metric-box">
            <div class="print-metric-label">High-Risk Oversight Gaps</div>
            <div class="print-metric-value">${oversightIndicator.count}</div>
          </div>
        </div>
        <div class="print-pattern-summary">
          <div class="print-kv"><span class="print-k">Consecutive AI Reliance Clusters:</span> <span class="print-v">${
            consecutiveClusters.length > 0
              ? `Detected ${consecutiveClusters.length} consecutive AI step sequence(s)`
              : 'None detected'
          }</span></div>
          <div class="print-kv"><span class="print-k">Design-Time Suggestions:</span></div>
          ${suggestionsHtml}
        </div>
      </section>

      <section class="print-section" aria-label="Ordered Workflow Steps and Governance Controls">
        <h2>3. Ordered Workflow Steps (${steps.length})</h2>
        <div class="print-steps-container">
          ${stepsHtml}
        </div>
      </section>

      <section class="print-section" aria-label="Critical Reflection Layer">
        <h2>4. Critical Reflection Layer</h2>
        <div class="print-reflection-grid">
          <div class="print-subcard">
            <h4>Failure Modes (Where could this workflow fail?)</h4>
            <p>${escapeHtml(reflection.failure_modes || 'None documented')}</p>
          </div>
          <div class="print-subcard">
            <h4>Essential Human Judgement (Where is human judgement essential?)</h4>
            <p>${escapeHtml(reflection.essential_judgement || 'None documented')}</p>
          </div>
          <div class="print-subcard">
            <h4>AI Over-Reliance Risks (Where is AI over-relied upon?)</h4>
            <p>${escapeHtml(reflection.over_reliance_risks || 'None documented')}</p>
          </div>
          <div class="print-subcard">
            <h4>Embedded Assumptions (What assumptions are embedded in this design?)</h4>
            <p>${escapeHtml(reflection.embedded_assumptions || 'None documented')}</p>
          </div>
        </div>
      </section>

      <footer class="print-disclaimer" aria-label="Non-Certification Disclaimer">
        <h3>5. Governance Scope &amp; Non-Certification Disclaimer</h3>
        <p>${escapeHtml(GOVERNANCE_REPORT_DISCLAIMER)}</p>
      </footer>
    </div>
  `;
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

export function exportToPDF(store?: WorkflowStore) {
  if (store && typeof document !== 'undefined') {
    let reportContainer = document.getElementById('printable-governance-report');
    if (!reportContainer) {
      reportContainer = document.createElement('section');
      reportContainer.id = 'printable-governance-report';
      reportContainer.className = 'printable-report';
      reportContainer.setAttribute('aria-label', 'Printable Governance Specification Report');
      (document.querySelector('.content') || document.body).appendChild(reportContainer);
    }
    reportContainer.innerHTML = generatePrintableReportHTML(store);
  }
  window.print();
}
