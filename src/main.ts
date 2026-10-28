import './style.css';
import {
  INITIAL_STATE,
  calculateCompleteness,
  calculateAIDependency,
  getHumanOversightIndicator,
  DEMO_STATE,
  getGovernanceSuggestions,
  detectOversightGaps,
  detectConsecutiveAISteps,
  isHighRiskStep,
  type WorkflowStore,
  type WorkflowStep
} from './data/model';
import { exportToJSON, exportToMarkdown, exportToPDF } from './utils/export';
import { generateUUID } from './utils/uuid';
import { escapeHtml, escapeAttr } from './utils/security';
import { validateWorkflowImport } from './utils/schema';
import { StorageManager } from './utils/storage';

export class App {
  private store: WorkflowStore = INITIAL_STATE;
  private currentView: string = 'dashboard';
  private storageManager: StorageManager;
  private isDemoMode: boolean = false;
  private hasUnsavedChanges: boolean = false;

  constructor(storageManager?: StorageManager) {
    this.storageManager = storageManager || new StorageManager();
    this.loadFromStorage();
    this.initEventListeners();
    this.render();
  }

  public getStore(): WorkflowStore {
    return this.store;
  }

  public getIsDemoMode(): boolean {
    return this.isDemoMode;
  }

  private loadFromStorage() {
    const result = this.storageManager.loadWorkflow();
    this.store = result.data;
    if (result.success) {
      this.hasUnsavedChanges = false;
      this.updateSaveStatus('saved');
    } else {
      if (result.rawCorrupted) {
        this.updateSaveStatus('error', 'Saved workflow corrupted. A new workflow has been initialized.');
        console.warn('Storage load corrupted:', result.error);
      } else {
        this.updateSaveStatus('error', result.error);
      }
    }
  }

  private saveToStorage(isExplicitUserSave: boolean = false): boolean {
    if (this.isDemoMode) {
      this.hasUnsavedChanges = true;
      this.updateCompletenessUI();
      this.updateSaveStatus('demo');
      return true;
    }

    const result = this.storageManager.saveWorkflow(this.store);
    this.updateCompletenessUI();

    if (result.success) {
      this.hasUnsavedChanges = false;
      this.updateSaveStatus('saved');
      return true;
    } else {
      this.hasUnsavedChanges = true;
      this.updateSaveStatus('error', result.error);
      if (isExplicitUserSave) {
        alert(
          `${result.error}\n\nRecovery Guidance: Click "Export JSON" from the top bar or Export tab to save your workflow safely.`
        );
      }
      return false;
    }
  }

  private updateSaveStatus(status: 'saved' | 'unsaved' | 'demo' | 'error', customMsg?: string) {
    const el = document.getElementById('save-status');
    if (!el) return;

    el.className = 'save-status-badge';

    if (this.isDemoMode) {
      el.classList.add('status-demo');
      el.textContent = 'Demo Mode (In-Memory Only)';
      el.title = 'Changes exist in memory only and will not overwrite your saved workflow.';
      return;
    }

    switch (status) {
      case 'saved':
        el.classList.add('status-saved');
        el.textContent = '✓ Saved';
        el.title = 'All changes saved to local storage.';
        break;
      case 'unsaved':
        el.classList.add('status-unsaved');
        el.textContent = '● Unsaved changes';
        el.title = 'You have unsaved changes in memory.';
        break;
      case 'demo':
        el.classList.add('status-demo');
        el.textContent = 'Demo Mode (In-Memory Only)';
        el.title = 'Changes exist in memory only and will not overwrite your saved workflow.';
        break;
      case 'error':
        el.classList.add('status-error');
        el.textContent = '⚠️ Storage Error (Export JSON recommended)';
        el.title = customMsg || 'Storage failure. Export JSON to save your workflow.';
        break;
    }
  }

  private showDemoBanner() {
    let banner = document.getElementById('demo-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'demo-banner';
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'polite');
      banner.innerHTML = `
        <div class="demo-banner-content">
          <strong>Demo Example (In-Memory Only):</strong> You are exploring pre-filled workflow data. Your saved workflows are not overwritten.
        </div>
        <div class="demo-banner-actions">
          <button id="save-demo-copy" class="btn btn-sm btn-primary-light" aria-label="Save copy as your own workflow">Save Copy as My Workflow</button>
          <button id="exit-demo" class="btn btn-sm btn-secondary-light" aria-label="Exit demo mode and return to your saved workflow">Exit Demo</button>
        </div>
      `;
      document.querySelector('.content')?.prepend(banner);

      document.getElementById('save-demo-copy')?.addEventListener('click', () => {
        this.saveDemoAsMyWorkflow();
      });

      document.getElementById('exit-demo')?.addEventListener('click', () => {
        this.exitDemoMode();
      });
    }
  }

  private hideDemoBanner() {
    document.getElementById('demo-banner')?.remove();
  }

  private saveDemoAsMyWorkflow() {
    // Generate fresh workflow ID so it's saved as the user's own workflow
    this.store.metadata.id = generateUUID();
    this.store.metadata.created_at = new Date().toISOString();
    this.isDemoMode = false;
    this.hideDemoBanner();

    const saveResult = this.storageManager.saveWorkflow(this.store);
    this.render();

    if (saveResult.success) {
      this.hasUnsavedChanges = false;
      this.updateSaveStatus('saved');
      alert(`Workflow "${this.store.metadata.title}" saved as your own workflow.`);
    } else {
      this.updateSaveStatus('error', saveResult.error);
      alert(`Workflow copied to memory, but failed to write to local storage:\n${saveResult.error}\n\nPlease export as JSON.`);
    }
  }

  private exitDemoMode() {
    if (this.hasUnsavedChanges) {
      if (!confirm('Exit demo mode? Any in-memory demo edits will be discarded, and your previously saved workflow will be restored.')) {
        return;
      }
    }
    this.isDemoMode = false;
    this.hideDemoBanner();
    this.loadFromStorage();
    this.render();
  }

  private initEventListeners() {
    // Navigation
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLButtonElement;
        const view = target.dataset.view;
        if (view) {
          this.switchView(view);
        }
      });
    });

    // Top Actions
    document.getElementById('save-workflow')?.addEventListener('click', () => {
      if (this.isDemoMode) {
        if (confirm('You are in Demo Mode. Would you like to save this demo as your own workflow?')) {
          this.saveDemoAsMyWorkflow();
        }
        return;
      }

      const success = this.saveToStorage(true);
      if (success) {
        alert('Workflow saved locally.');
      }
    });

    document.getElementById('import-workflow')?.addEventListener('click', () => {
      this.importJSON();
    });

    document.getElementById('load-demo')?.addEventListener('click', () => {
      if (
        confirm(
          'Load healthcare demo? This will load a pre-filled example in memory. Your saved work will NOT be overwritten unless you click "Save Copy as My Workflow".'
        )
      ) {
        this.store = JSON.parse(JSON.stringify(DEMO_STATE));
        this.isDemoMode = true;
        this.hasUnsavedChanges = false;
        this.render();
        this.showDemoBanner();
        this.updateSaveStatus('demo');
      }
    });

    document.getElementById('new-workflow')?.addEventListener('click', () => {
      // Protective backup before clearing
      const backupResult = this.storageManager.createProtectiveBackup();
      if (!backupResult.success) {
        alert(
          `Cannot create new workflow: Protective backup failed (${backupResult.error}).\n\nPlease export your current workflow as JSON first to prevent data loss.`
        );
        return;
      }

      if (
        confirm(
          'Clear all data and start a new workflow? A protective backup of your previous workflow has been saved.'
        )
      ) {
        this.store = JSON.parse(JSON.stringify(INITIAL_STATE));
        this.store.metadata.id = generateUUID();
        this.store.metadata.created_at = new Date().toISOString();
        this.isDemoMode = false;
        this.hideDemoBanner();
        this.saveToStorage(true);
        this.render();
      }
    });
  }

  private switchView(view: string) {
    this.currentView = view;
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLButtonElement).dataset.view === view);
    });

    const titleMap: Record<string, string> = {
      dashboard: 'Dashboard',
      'workflow-context': 'Workflow Context',
      'workflow-builder': 'Step Builder',
      'governance-panel': 'Governance Controls',
      'reflection-layer': 'Reflection Layer',
      'export-panel': 'Export & Artifacts'
    };

    const titleEl = document.getElementById('view-title');
    if (titleEl) titleEl.textContent = titleMap[view] || 'Designer';

    this.renderView();
  }

  private updateCompletenessUI() {
    const completeness = calculateCompleteness(this.store);
    const progressEl = document.querySelector('.progress') as HTMLElement;
    const valueEl = document.querySelector('.completeness-mini .value') as HTMLElement;

    if (progressEl) progressEl.style.width = `${completeness}%`;
    if (valueEl) valueEl.textContent = `${completeness}%`;
  }

  private renderView() {
    const container = document.getElementById('view-container');
    if (!container) return;

    container.innerHTML = '';

    switch (this.currentView) {
      case 'dashboard':
        container.innerHTML = this.renderDashboard();
        break;
      case 'workflow-context':
        container.innerHTML = this.renderContextForm();
        this.attachContextEvents();
        break;
      case 'workflow-builder':
        container.innerHTML = this.renderStepBuilder();
        this.attachStepEvents();
        break;
      case 'governance-panel':
        container.innerHTML = this.renderGovernancePanel();
        this.attachGovernanceEvents();
        break;
      case 'reflection-layer':
        container.innerHTML = this.renderReflectionLayer();
        this.attachReflectionEvents();
        break;
      case 'export-panel':
        container.innerHTML = this.renderExportPanel();
        this.attachExportEvents();
        break;
    }
  }

  private renderDashboard() {
    const completeness = calculateCompleteness(this.store);
    const dependency = calculateAIDependency(this.store);
    const suggestions = getGovernanceSuggestions(this.store);
    const consecutiveClusters = detectConsecutiveAISteps(this.store);
    const gaps = detectOversightGaps(this.store);

    return `
      <div class="dash-grid">
        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Governance Completeness</span>
          </div>
          <div class="metric-value">${completeness}%</div>
          <div class="progress-bar">
            <div class="progress" style="width: ${completeness}%"></div>
          </div>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">AI Dependency Map</span>
          </div>
          <div class="metric-value">${dependency}%</div>
          <p class="metric-title">${dependency > 50 ? 'High concentration of AI reliance detected.' : 'Balanced human-AI collaboration.'}</p>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Workflow Steps</span>
          </div>
          <div class="metric-value">${this.store.steps.length}</div>
          <p class="metric-title">${escapeHtml(this.store.metadata.title) || 'Untitled Workflow'}</p>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Oversight Gaps</span>
          </div>
          <div class="metric-value">${getHumanOversightIndicator(this.store).count}</div>
          <p class="metric-title">${getHumanOversightIndicator(this.store).count > 0 ? 'Steps requiring additional oversight.' : 'All high-risk steps governed.'}</p>
        </div>
      </div>

      <div class="section" style="margin-top: 32px">
        <h2>Governance Insights</h2>
        <div class="insights-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 16px">
          <div class="insight-group">
            <h3 style="font-size: 14px; margin-bottom: 12px; color: var(--text-primary)">Design-Time Suggestions</h3>
            <ul style="list-style: none; padding: 0; margin: 0; font-size: 13px">
              ${suggestions.length > 0 ? suggestions.map(s => `
                <li style="padding: 10px; background: ${s.type === 'warning' ? '#FFFBEB' : '#F0F9FF'}; border-left: 3px solid ${s.type === 'warning' ? '#F59E0B' : '#0EA5E9'}; margin-bottom: 8px; border-radius: 4px; color: ${s.type === 'warning' ? '#92400E' : '#0369A1'}">
                  <strong>${escapeHtml(s.type.toUpperCase())}:</strong> ${escapeHtml(s.message)}
                </li>
              `).join('') : '<li style="color: var(--text-muted); font-style: italic">No immediate suggestions.</li>'}
            </ul>
          </div>
          <div class="insight-group">
            <h3 style="font-size: 14px; margin-bottom: 12px; color: var(--text-primary)">Workflow Pattern Analysis</h3>
            <div class="pattern-item" style="font-size: 13px; margin-bottom: 16px">
              <span style="display: block; font-weight: 600; margin-bottom: 4px">Consecutive AI Steps:</span>
              <span style="color: ${consecutiveClusters.length > 0 ? '#B91C1C' : '#059669'}">
                ${consecutiveClusters.length > 0 ? `Detected ${consecutiveClusters.length} sequence(s) of consecutive AI reliance.` : 'No excessive AI reliance clusters detected.'}
              </span>
            </div>
            <div class="pattern-item" style="font-size: 13px">
              <span style="display: block; font-weight: 600; margin-bottom: 4px">Oversight Completeness:</span>
              <span style="color: ${gaps.length > 0 ? '#B91C1C' : '#059669'}">
                ${gaps.length > 0 ? `Found ${gaps.length} AI steps with zero human oversight.` : 'All AI steps have defined oversight levels.'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div class="section" style="margin-top: 32px">
        <h2>Capability Intent</h2>
        <p>This workflow aims to operationalise governed AI involvement through explicit traceability and accountability.</p>
        <div class="cdd-pills" style="display: flex; gap: 8px; margin-top: 16px">
          <span class="step-type-pill">Traceability</span>
          <span class="step-type-pill">Accountability</span>
          <span class="step-type-pill">Risk Awareness</span>
        </div>
      </div>
    `;
  }

  private renderContextForm() {
    const { metadata } = this.store;
    return `
      <div class="section section-hero">
        <h2>Workflow Context Definition</h2>
        <p>Define the foundational purpose and organizational context for this automated workflow.</p>
        
        <form id="context-form">
          <div class="form-group">
            <label for="title">Workflow Title</label>
            <input type="text" id="title" aria-label="Workflow Title" value="${escapeAttr(metadata.title)}" placeholder="e.g. Automated Student Feedback Loop">
          </div>
          
          <div class="grid-2">
            <div class="form-group">
              <label for="owner">Workflow Owner</label>
              <input type="text" id="owner" aria-label="Workflow Owner" value="${escapeAttr(metadata.owner)}" placeholder="e.g. Head of AI Governance">
            </div>
            <div class="form-group">
              <label for="organisation">Organisation</label>
              <input type="text" id="organisation" aria-label="Organisation" value="${escapeAttr(metadata.organisation)}" placeholder="e.g. Global Health Initiative">
            </div>
          </div>

          <div class="form-group">
            <label for="purpose">Primary Purpose</label>
            <textarea id="purpose" aria-label="Primary Purpose" rows="3" placeholder="Describe what this workflow achieves...">${escapeHtml(metadata.purpose)}</textarea>
          </div>

          <div class="grid-2">
            <div class="form-group">
              <label for="domain">Domain</label>
              <select id="domain" aria-label="Domain">
                <option value="education" ${metadata.domain === 'education' ? 'selected' : ''}>Education</option>
                <option value="research" ${metadata.domain === 'research' ? 'selected' : ''}>Research</option>
                <option value="policy" ${metadata.domain === 'policy' ? 'selected' : ''}>Policy</option>
                <option value="operations" ${metadata.domain === 'operations' ? 'selected' : ''}>Operations</option>
              </select>
            </div>
            <div class="form-group">
              <label for="version">Version</label>
              <input type="text" id="version" aria-label="Version" value="${escapeAttr(metadata.version)}">
            </div>
          </div>
        </form>

        <details class="section" style="margin-top: 32px; border: 1px solid var(--border-color); border-radius: 8px; padding: 0;">
          <summary style="padding: 16px; cursor: pointer; font-weight: 600; font-size: 14px; color: var(--text-secondary);">
            Capability & Governance Notes (Optional)
          </summary>
          <div style="padding: 16px; border-top: 1px solid var(--border-color); background: #fafafa;">
            <div class="form-group">
              <label for="capabilityNotes" style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted);">AI Capability Notes</label>
              <textarea id="capabilityNotes" aria-label="AI Capability Notes" rows="2" style="font-size: 13px; font-family: inherit;" placeholder="How does this workflow develop AI capability?">${escapeHtml(metadata.capabilityNotes || '')}</textarea>
            </div>
            <div class="form-group" style="margin-bottom: 0;">
              <label for="governanceNotes" style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted);">AI Governance Notes</label>
              <textarea id="governanceNotes" aria-label="AI Governance Notes" rows="2" style="font-size: 13px; font-family: inherit;" placeholder="Key governance considerations for this workflow...">${escapeHtml(metadata.governanceNotes || '')}</textarea>
            </div>
          </div>
        </details>
      </div>
    `;
  }

  private attachContextEvents() {
    const form = document.getElementById('context-form');
    form?.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      const key = target.id as keyof typeof this.store.metadata;
      if (key in this.store.metadata || key === 'capabilityNotes' || key === 'governanceNotes') {
        (this.store.metadata as any)[key] = target.value;
        this.saveToStorage();
      }
    });

    document.getElementById('capabilityNotes')?.addEventListener('input', (e) => {
      this.store.metadata.capabilityNotes = (e.target as HTMLTextAreaElement).value;
      this.saveToStorage();
    });

    document.getElementById('governanceNotes')?.addEventListener('input', (e) => {
      this.store.metadata.governanceNotes = (e.target as HTMLTextAreaElement).value;
      this.saveToStorage();
    });
  }

  private renderStepBuilder() {
    return `
      <div class="section-actions" style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center">
        <p style="color: var(--text-secondary)">Define the sequence of human and AI actions in this workflow.</p>
        <button id="add-step" class="btn btn-primary" aria-label="Add new workflow step">+ Add New Step</button>
      </div>
      
      <div id="steps-list">
        ${this.store.steps.map((step, index) => {
          const isHighRisk = isHighRiskStep(step);
          const hasGaps = (step.type === 'ai-generated' || step.type === 'ai-supported') && step.human_oversight.oversight_level === 'none';
          
          return this.renderStepItem(step, index, isHighRisk, hasGaps);
        }).join('')}
      </div>

      ${this.store.steps.length === 0 ? `
        <div class="section" style="text-align: center; padding: 60px">
          <p style="color: var(--text-secondary)">No steps defined yet. Start by adding your first workflow step.</p>
        </div>
      ` : ''}
    `;
  }

  private renderStepItem(step: WorkflowStep, index: number, isHighRisk: boolean = false, hasGaps: boolean = false) {
    const types: Record<string, string> = {
      'human-only': 'Human Only',
      'ai-supported': 'AI Supported',
      'ai-generated': 'AI Generated',
      'decision-point': 'Decision Point'
    };

    return `
      <div class="step-item" data-id="${escapeAttr(step.id)}">
        <div class="step-header">
          <div style="display: flex; align-items: center; gap: 16px">
            <span class="step-number" style="font-weight: 700; color: var(--text-muted)">${index + 1}</span>
            <span style="font-weight: 600">${escapeHtml(step.name || 'Untitled Step')}</span>
            <span class="step-type-pill">${escapeHtml(types[step.type] || step.type)}</span>
            ${isHighRisk ? '<span class="step-type-pill" style="background: #FEE2E2; color: #991B1B; border: 1px solid #FECACA">⚠️ High Risk</span>' : ''}
            ${step.human_oversight.intervention_points ? '<span class="step-type-pill" style="background: #E0F2FE; color: #075985; border: 1px solid #BAE6FD">🔗 Intervention Pt</span>' : ''}
            ${hasGaps ? '<span class="step-type-pill" style="background: #FFFBEB; color: #92400E; border: 1px solid #FDE68A">❗ Missing Oversight</span>' : ''}
          </div>
          <div style="display: flex; gap: 8px">
            <button class="btn btn-secondary btn-sm edit-step" aria-label="Edit step ${index + 1}: ${escapeAttr(step.name || 'Untitled')}">Edit</button>
            <button class="btn btn-secondary btn-sm delete-step" aria-label="Delete step ${index + 1}: ${escapeAttr(step.name || 'Untitled')}">Delete</button>
          </div>
        </div>
        <div class="step-content">
          <div class="grid-2">
            <div class="form-group">
              <label>Step Name</label>
              <input type="text" class="step-input" data-field="name" aria-label="Step Name" value="${escapeAttr(step.name)}">
            </div>
            <div class="form-group">
              <label>Step Type</label>
              <select class="step-input" data-field="type" aria-label="Step Type">
                <option value="human-only" ${step.type === 'human-only' ? 'selected' : ''}>Human Only</option>
                <option value="ai-supported" ${step.type === 'ai-supported' ? 'selected' : ''}>AI Supported</option>
                <option value="ai-generated" ${step.type === 'ai-generated' ? 'selected' : ''}>AI Generated</option>
                <option value="decision-point" ${step.type === 'decision-point' ? 'selected' : ''}>Decision Point</option>
              </select>
            </div>
          </div>
          
          <div class="form-group">
            <label>Description</label>
            <textarea class="step-input" data-field="description" aria-label="Description" rows="2">${escapeHtml(step.description)}</textarea>
          </div>

          <div class="grid-2">
            <div class="form-group">
              <label>Inputs</label>
              <input type="text" class="step-input" data-field="inputs" aria-label="Inputs" value="${escapeAttr(step.inputs.join(', '))}" placeholder="Comma separated...">
            </div>
            <div class="form-group">
              <label>Outputs</label>
              <input type="text" class="step-input" data-field="outputs" aria-label="Outputs" value="${escapeAttr(step.outputs.join(', '))}" placeholder="Comma separated...">
            </div>
          </div>

          <div class="human-ai-boundary" style="border-top: 1px solid var(--border-color); margin-top: 16px; padding-top: 16px">
            <h4>Human-AI Boundary & Oversight</h4>
            <div class="grid-2">
              <div class="form-group">
                <label>Responsible Role</label>
                <input type="text" class="step-input-nested" data-parent="human_oversight" data-field="responsible_role" aria-label="Responsible Role" value="${escapeAttr(step.human_oversight.responsible_role)}" placeholder="e.g. Lead Researcher">
              </div>
              <div class="form-group">
                <label>Oversight Level</label>
                <select class="step-input-nested" data-parent="human_oversight" data-field="oversight_level" aria-label="Oversight Level">
                  <option value="none" ${step.human_oversight.oversight_level === 'none' ? 'selected' : ''}>None</option>
                  <option value="minimal" ${step.human_oversight.oversight_level === 'minimal' ? 'selected' : ''}>Minimal (Outcome only)</option>
                  <option value="active" ${step.human_oversight.oversight_level === 'active' ? 'selected' : ''}>Active (Process review)</option>
                  <option value="full" ${step.human_oversight.oversight_level === 'full' ? 'selected' : ''}>Full (Real-time)</option>
                </select>
              </div>
            </div>
            <div class="form-group">
              <label>Intervention Points</label>
              <input type="text" class="step-input-nested" data-parent="human_oversight" data-field="intervention_points" aria-label="Intervention Points" value="${escapeAttr(step.human_oversight.intervention_points)}" placeholder="Where can a human override?">
            </div>
          </div>

          <div class="risk-layer" style="border-top: 1px solid var(--border-color); margin-top: 16px; padding-top: 16px">
            <h4>Risk Identification Layer</h4>
            <div class="grid-2">
              <div class="form-group">
                <label>Bias / Fairness Risk</label>
                <input type="text" class="step-input-nested" data-parent="risks" data-field="bias_risk" aria-label="Bias / Fairness Risk" value="${escapeAttr(step.risks.bias_risk)}">
              </div>
              <div class="form-group">
                <label>Operational Risk</label>
                <input type="text" class="step-input-nested" data-parent="risks" data-field="operational_risk" aria-label="Operational Risk" value="${escapeAttr(step.risks.operational_risk)}">
              </div>
            </div>
             <div class="form-group">
              <label>Mitigation Strategy</label>
              <textarea class="step-input-nested" data-parent="risks" data-field="mitigation" aria-label="Mitigation Strategy" rows="2">${escapeHtml(step.risks.mitigation)}</textarea>
            </div>
          </div>

          ${step.type === 'decision-point' ? `
            <div class="governance-controls" style="border-top: 1px solid var(--border-color); margin-top: 16px; padding-top: 16px">
              <h4>Decision Point Controls</h4>
              <div class="form-group">
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer">
                  <input type="checkbox" class="step-checkbox-nested" data-parent="controls" data-field="approval_required" aria-label="Decision Record Required" ${step.controls.approval_required ? 'checked' : ''} style="width: auto">
                  Decision Record Required (Human-AI Decision Record Tool)
                </label>
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  private attachStepEvents() {
    document.getElementById('add-step')?.addEventListener('click', () => {
      const newStep: WorkflowStep = {
        id: generateUUID(),
        name: '',
        type: 'human-only',
        description: '',
        inputs: [],
        outputs: [],
        ai_involvement: { ai_role: '', reliance_level: 'low' },
        human_oversight: { responsible_role: '', oversight_level: 'none', intervention_points: '' },
        risks: { bias_risk: '', operational_risk: '', ethical_risk: '', privacy_risk: '', mitigation: '' },
        controls: { approval_required: false, escalation_path: '', review_cycle: '' }
      };
      this.store.steps.push(newStep);
      this.saveToStorage();
      this.render();
    });

    document.querySelectorAll('.edit-step').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const item = (e.currentTarget as HTMLElement).closest('.step-item');
        item?.querySelector('.step-content')?.classList.toggle('expanded');
      });
    });

    document.querySelectorAll('.delete-step').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = (e.currentTarget as HTMLElement).closest('.step-item')?.getAttribute('data-id');
        if (confirm('Delete this step?')) {
          this.store.steps = this.store.steps.filter(s => s.id !== id);
          this.saveToStorage();
          this.render();
        }
      });
    });

    document.querySelectorAll('.step-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        const id = target.closest('.step-item')?.getAttribute('data-id');
        const field = target.dataset.field as any;
        const step = this.store.steps.find(s => s.id === id);

        if (step) {
          if (field === 'inputs' || field === 'outputs') {
            (step as any)[field] = target.value.split(',').map(s => s.trim()).filter(Boolean);
          } else {
            (step as any)[field] = target.value;
          }
          this.saveToStorage();
        }
      });
    });

    document.querySelectorAll('.step-input-nested').forEach(input => {
      input.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        const id = target.closest('.step-item')?.getAttribute('data-id');
        const parent = target.dataset.parent as any;
        const field = target.dataset.field as any;
        const step = this.store.steps.find(s => s.id === id);

        if (step && (step as any)[parent]) {
          (step as any)[parent][field] = target.value;
          this.saveToStorage();
        }
      });
    });

    document.querySelectorAll('.step-checkbox-nested').forEach(input => {
      input.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        const id = target.closest('.step-item')?.getAttribute('data-id');
        const parent = target.dataset.parent as any;
        const field = target.dataset.field as any;
        const step = this.store.steps.find(s => s.id === id);

        if (step && (step as any)[parent]) {
          (step as any)[parent][field] = target.checked;
          this.saveToStorage();
        }
      });
    });
  }

  private renderGovernancePanel() {
    return `
      <div class="section">
        <h2>Governance Controls</h2>
        <p style="color: var(--text-secondary); margin-bottom: 24px">Define global governance parameters and step-specific controls.</p>
        
        <div id="governance-steps">
          ${this.store.steps.map(step => `
            <div class="step-item">
              <div class="step-header">
                <span style="font-weight: 600">${escapeHtml(step.name || 'Untitled Step')}</span>
                <span class="step-type-pill">${escapeHtml(step.type)}</span>
              </div>
              <div class="step-content expanded" style="border-top: 1px solid var(--border-color)">
                <div class="grid-2">
                  <div class="form-group">
                    <label>Approval Required</label>
                    <select class="gov-input" data-id="${escapeAttr(step.id)}" data-field="approval_required" aria-label="Approval Required">
                      <option value="false" ${!step.controls.approval_required ? 'selected' : ''}>No</option>
                      <option value="true" ${step.controls.approval_required ? 'selected' : ''}>Yes</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Review Cycle</label>
                    <input type="text" class="gov-input" data-id="${escapeAttr(step.id)}" data-field="review_cycle" aria-label="Review Cycle" value="${escapeAttr(step.controls.review_cycle)}" placeholder="e.g. Quarterly">
                  </div>
                </div>
                <div class="form-group">
                  <label>Escalation Path</label>
                  <input type="text" class="gov-input" data-id="${escapeAttr(step.id)}" data-field="escalation_path" aria-label="Escalation Path" value="${escapeAttr(step.controls.escalation_path)}" placeholder="Who to contact if risks elevate?">
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  private attachGovernanceEvents() {
    document.querySelectorAll('.gov-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement | HTMLSelectElement;
        const id = target.dataset.id;
        const field = target.dataset.field;
        const step = this.store.steps.find(s => s.id === id);
        if (step) {
          if (field === 'approval_required') {
            step.controls.approval_required = target.value === 'true';
          } else {
            (step.controls as any)[field!] = target.value;
          }
          this.saveToStorage();
        }
      });
    });
  }

  private renderReflectionLayer() {
    const { reflection } = this.store;
    return `
      <div class="section section-hero">
        <h2>Critical Reflection Layer</h2>
        <p>Analyse the systemic risks and human accountability requirements of this workflow design.</p>
        
        <div class="form-group">
          <label for="failure_modes">Where could this workflow fail? (Failure Modes)</label>
          <textarea id="failure_modes" class="reflection-input" data-field="failure_modes" aria-label="Failure Modes" rows="3">${escapeHtml(reflection.failure_modes)}</textarea>
        </div>

        <div class="form-group">
          <label for="essential_judgement">Where is human judgement essential?</label>
          <textarea id="essential_judgement" class="reflection-input" data-field="essential_judgement" aria-label="Essential Human Judgement" rows="3">${escapeHtml(reflection.essential_judgement)}</textarea>
        </div>

        <div class="form-group">
          <label for="over_reliance_risks">Where is AI over-relied upon?</label>
          <textarea id="over_reliance_risks" class="reflection-input" data-field="over_reliance_risks" aria-label="AI Over-reliance Risks" rows="3">${escapeHtml(reflection.over_reliance_risks)}</textarea>
        </div>

        <div class="form-group">
          <label for="embedded_assumptions">What assumptions are embedded in this design?</label>
          <textarea id="embedded_assumptions" class="reflection-input" data-field="embedded_assumptions" aria-label="Embedded Assumptions" rows="3">${escapeHtml(reflection.embedded_assumptions)}</textarea>
        </div>
      </div>
    `;
  }

  private attachReflectionEvents() {
    document.querySelectorAll('.reflection-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const target = e.target as HTMLTextAreaElement;
        const field = target.dataset.field as keyof typeof this.store.reflection;
        this.store.reflection[field] = target.value;
        this.saveToStorage();
      });
    });
  }

  private renderExportPanel() {
    return `
      <div class="dash-grid">
        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">JSON Specification</span>
          </div>
          <p>Export the full machine-readable workflow specification for integration or backup.</p>
          <button id="export-json" class="btn btn-primary" aria-label="Export workflow as JSON specification">Export JSON</button>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Markdown Document</span>
          </div>
          <p>Generate a structured governance report in Markdown format for documentation.</p>
          <button id="export-markdown" class="btn btn-primary" aria-label="Export workflow as Markdown document">Export Markdown</button>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Printable Report (PDF)</span>
          </div>
          <p>Generate a professional, human-readable PDF report of the workflow design.</p>
          <button id="export-pdf" class="btn btn-primary" aria-label="Export workflow as printable PDF">Export PDF / Print</button>
        </div>
      </div>

      <div class="section" style="margin-top: 32px">
        <h2>Governance Schema</h2>
        <p style="color: var(--text-secondary)">This tool adheres to the AI Workflow Governance Schema. You can find the full schema in the <code>WORKFLOW_SCHEMA.json</code> file in the project root.</p>
      </div>
    `;
  }

  private attachExportEvents() {
    document.getElementById('export-json')?.addEventListener('click', () => {
      exportToJSON(this.store);
    });

    document.getElementById('export-markdown')?.addEventListener('click', () => {
      exportToMarkdown(this.store);
    });

    document.getElementById('export-pdf')?.addEventListener('click', () => {
      exportToPDF();
    });
  }

  private importJSON() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (re) => {
        const content = re.target?.result as string;

        // 1. Validate file content before modifying any state
        const validation = validateWorkflowImport(content);
        if (!validation.valid || !validation.store) {
          alert(
            `Import Rejected — Malformed or Incompatible JSON:\n\n• ${validation.errors.join('\n• ')}\n\nYour active workflow has NOT been modified.`
          );
          return;
        }

        // 2. Warn about non-blocking warnings if any
        if (validation.warnings.length > 0) {
          const proceed = confirm(
            `Import Warnings:\n• ${validation.warnings.join('\n• ')}\n\nDo you want to proceed with this import?`
          );
          if (!proceed) return;
        }

        // 3. Create protective backup before replacing current work
        const backupResult = this.storageManager.createProtectiveBackup();
        if (!backupResult.success) {
          alert(
            `Import Aborted: Protective backup failed (${backupResult.error}).\n\nYour existing workflow could not be safely backed up. To protect your data, please click "Export JSON" first.`
          );
          return;
        }

        // 4. Safely apply imported workflow
        this.store = validation.store;
        this.isDemoMode = false;
        this.hideDemoBanner();

        const saveResult = this.storageManager.saveWorkflow(this.store);
        this.render();

        if (!saveResult.success) {
          alert(
            `Workflow imported into memory, but local storage could not be updated:\n${saveResult.error}\n\nPlease export your workflow as JSON to preserve it.`
          );
        } else {
          alert(`Workflow "${this.store.metadata.title}" successfully imported.`);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  private render() {
    this.updateCompletenessUI();
    this.renderView();
  }
}

// Instantiate application in browser environment
if (typeof document !== 'undefined') {
  new App();
}
