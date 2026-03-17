import './style.css';
import { INITIAL_STATE, calculateCompleteness, calculateAIDependency, getHumanOversightIndicator, DEMO_STATE } from './data/model';
import type { WorkflowStore } from './data/model';
import { exportToJSON, exportToMarkdown, exportToPDF } from './utils/export';
import { generateUUID } from './utils/uuid';

class App {
  private store: WorkflowStore = INITIAL_STATE;
  private currentView: string = 'dashboard';

  constructor() {
    this.loadFromStorage();
    this.initEventListeners();
    this.render();
  }

  private loadFromStorage() {
    const saved = localStorage.getItem('cp_workflow_designer');
    if (saved) {
      try {
        this.store = JSON.parse(saved);
      } catch (e) {
        console.error('Failed to load saved workflow:', e);
      }
    }
  }

  private saveToStorage() {
    localStorage.setItem('cp_workflow_designer', JSON.stringify(this.store));
    this.updateCompletenessUI();
    this.hideDemoBanner();
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
      this.saveToStorage();
      alert('Workflow saved locally.');
    });

    document.getElementById('import-workflow')?.addEventListener('click', () => {
      this.importJSON();
    });

    document.getElementById('load-demo')?.addEventListener('click', () => {
      if (confirm('Load healthcare demo? This will show you a pre-filled example. Your saved work will NOT be overwritten unless you click "Save Local".')) {
        this.store = JSON.parse(JSON.stringify(DEMO_STATE)); // Deep clone
        this.render();
        this.showDemoBanner();
      }
    });

    document.getElementById('new-workflow')?.addEventListener('click', () => {
      if (confirm('Clear all data and start a new workflow? This will overwrite your current saved work.')) {
        this.store = JSON.parse(JSON.stringify(INITIAL_STATE));
        this.store.metadata.id = generateUUID(); // Fresh ID
        this.saveToStorage();
        this.render();
        this.hideDemoBanner();
      }
    });
  }

  private showDemoBanner() {
    let banner = document.getElementById('demo-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'demo-banner';
      banner.style.cssText = 'background: var(--warning-color); color: var(--bg-color); padding: 8px 40px; text-align: center; font-weight: 600; font-size: 0.9rem;';
      banner.innerHTML = 'Viewing Demo Example. <span style="font-weight: 400">Changes are temporary. To save this as your own, click "Save Local". To discard, refresh the page or click "New Workflow".</span>';
      document.querySelector('.content')?.prepend(banner);
    }
  }

  private hideDemoBanner() {
    document.getElementById('demo-banner')?.remove();
  }

  private switchView(view: string) {
    this.currentView = view;
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLButtonElement).dataset.view === view);
    });
    
    const titleMap: Record<string, string> = {
      'dashboard': 'Dashboard',
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
    
    return `
      <div class="dash-grid">
        <div class="metric-card highlight">
          <div class="metric-header">
            <span class="metric-title">Governance Completeness</span>
            <span class="icon">📈</span>
          </div>
          <div class="metric-value">${completeness}%</div>
          <div class="progress-bar">
            <div class="progress" style="width: ${completeness}%"></div>
          </div>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">AI Dependency Map</span>
            <span class="icon">🤖</span>
          </div>
          <div class="metric-value">${dependency}%</div>
          <p class="metric-title">${dependency > 50 ? 'High concentration of AI reliance detected.' : 'Balanced human-AI collaboration.'}</p>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Workflow Steps</span>
            <span class="icon">🔢</span>
          </div>
          <div class="metric-value">${this.store.steps.length}</div>
          <p class="metric-title">${this.store.metadata.title || 'Untitled Workflow'}</p>
        </div>

        <div class="metric-card ${getHumanOversightIndicator(this.store).count > 0 ? 'warning' : ''}" style="${getHumanOversightIndicator(this.store).count > 0 ? 'border-color: var(--warning-color)' : ''}">
          <div class="metric-header">
            <span class="metric-title">Oversight Gaps</span>
            <span class="icon">⚠️</span>
          </div>
          <div class="metric-value">${getHumanOversightIndicator(this.store).count}</div>
          <p class="metric-title">${getHumanOversightIndicator(this.store).count > 0 ? 'Steps requiring additional oversight.' : 'All high-risk steps governed.'}</p>
        </div>
      </div>

      <div class="section" style="margin-top: 32px">
        <h2>Capability Intent</h2>
        <p style="color: var(--text-secondary)">This workflow aims to operationalise governed AI involvement through explicit traceability and accountability.</p>
        <div class="cdd-pills" style="display: flex; gap: 12px; margin-top: 20px">
          <span class="step-type-pill type-human">Traceability</span>
          <span class="step-type-pill type-ai-support">Accountability</span>
          <span class="step-type-pill type-decision">Risk Awareness</span>
        </div>
      </div>
    `;
  }

  private renderContextForm() {
    const { metadata } = this.store;
    return `
      <div class="section section-hero">
        <h2>Workflow Context Definition</h2>
        <p style="color: var(--text-secondary); margin-bottom: 24px">Define the foundational purpose and organizational context for this automated workflow.</p>
        
        <form id="context-form">
          <div class="form-group">
            <label for="title">Workflow Title</label>
            <input type="text" id="title" value="${metadata.title}" placeholder="e.g. Automated Student Feedback Loop">
          </div>
          
          <div class="grid-2">
            <div class="form-group">
              <label for="owner">Workflow Owner</label>
              <input type="text" id="owner" value="${metadata.owner}" placeholder="e.g. Head of AI Governance">
            </div>
            <div class="form-group">
              <label for="organisation">Organisation</label>
              <input type="text" id="organisation" value="${metadata.organisation}" placeholder="e.g. Global Health Initiative">
            </div>
          </div>

          <div class="form-group">
            <label for="purpose">Primary Purpose</label>
            <textarea id="purpose" rows="3" placeholder="Describe what this workflow achieves...">${metadata.purpose}</textarea>
          </div>

          <div class="grid-2">
            <div class="form-group">
              <label for="domain">Domain</label>
              <select id="domain">
                <option value="education" ${metadata.domain === 'education' ? 'selected' : ''}>Education</option>
                <option value="research" ${metadata.domain === 'research' ? 'selected' : ''}>Research</option>
                <option value="policy" ${metadata.domain === 'policy' ? 'selected' : ''}>Policy</option>
                <option value="operations" ${metadata.domain === 'operations' ? 'selected' : ''}>Operations</option>
              </select>
            </div>
            <div class="form-group">
              <label for="version">Version</label>
              <input type="text" id="version" value="${metadata.version}">
            </div>
          </div>
        </form>
      </div>
    `;
  }

  private attachContextEvents() {
    const form = document.getElementById('context-form');
    form?.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      const key = target.id as keyof typeof this.store.metadata;
      if (key in this.store.metadata) {
        (this.store.metadata as any)[key] = target.value;
        this.saveToStorage();
      }
    });
  }

  private renderStepBuilder() {
    return `
      <div class="section-actions" style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center">
        <p style="color: var(--text-secondary)">Define the sequence of human and AI actions in this workflow.</p>
        <button id="add-step" class="btn btn-primary">+ Add New Step</button>
      </div>
      
      <div id="steps-list">
        ${this.store.steps.map((step, index) => this.renderStepItem(step, index)).join('')}
      </div>

      ${this.store.steps.length === 0 ? `
        <div class="section" style="text-align: center; padding: 60px">
          <p style="color: var(--text-secondary)">No steps defined yet. Start by adding your first workflow step.</p>
        </div>
      ` : ''}
    `;
  }

  private renderStepItem(step: any, index: number) {
    const types: Record<string, string> = {
      'human-only': 'Human Only',
      'ai-supported': 'AI Supported',
      'ai-generated': 'AI Generated',
      'decision-point': 'Decision Point'
    };

    return `
      <div class="step-item" data-id="${step.id}">
        <div class="step-header">
          <div style="display: flex; align-items: center; gap: 16px">
            <span class="step-number" style="font-weight: 700; color: var(--accent-color)">0${index + 1}</span>
            <span style="font-weight: 600">${step.name || 'Untitled Step'}</span>
            <span class="step-type-pill type-${step.type}">${types[step.type]}</span>
          </div>
          <div style="display: flex; gap: 8px">
            <button class="btn btn-secondary btn-sm edit-step">Edit / Expand</button>
            <button class="btn btn-secondary btn-sm delete-step" style="color: var(--danger-color)">Delete</button>
          </div>
        </div>
        <div class="step-content">
          <div class="grid-2">
            <div class="form-group">
              <label>Step Name</label>
              <input type="text" class="step-input" data-field="name" value="${step.name}">
            </div>
            <div class="form-group">
              <label>Step Type</label>
              <select class="step-input" data-field="type">
                <option value="human-only" ${step.type === 'human-only' ? 'selected' : ''}>Human Only</option>
                <option value="ai-supported" ${step.type === 'ai-supported' ? 'selected' : ''}>AI Supported</option>
                <option value="ai-generated" ${step.type === 'ai-generated' ? 'selected' : ''}>AI Generated</option>
                <option value="decision-point" ${step.type === 'decision-point' ? 'selected' : ''}>Decision Point</option>
              </select>
            </div>
          </div>
          
          <div class="form-group">
            <label>Description</label>
            <textarea class="step-input" data-field="description" rows="2">${step.description}</textarea>
          </div>

          <div class="grid-2">
            <div class="form-group">
              <label>Inputs</label>
              <input type="text" class="step-input" data-field="inputs" value="${step.inputs.join(', ')}" placeholder="Comma separated...">
            </div>
            <div class="form-group">
              <label>Outputs</label>
              <input type="text" class="step-input" data-field="outputs" value="${step.outputs.join(', ')}" placeholder="Comma separated...">
            </div>
          </div>

          <div class="human-ai-boundary" style="border-top: 1px solid var(--card-border); margin-top: 16px; padding-top: 16px">
            <h4 style="margin-bottom: 12px; font-size: 0.9rem; text-transform: uppercase; color: var(--accent-color)">Human-AI Boundary & Oversight</h4>
            <div class="grid-2">
              <div class="form-group">
                <label>Responsible Role</label>
                <input type="text" class="step-input-nested" data-parent="human_oversight" data-field="responsible_role" value="${step.human_oversight.responsible_role}" placeholder="e.g. Lead Researcher">
              </div>
              <div class="form-group">
                <label>Oversight Level</label>
                <select class="step-input-nested" data-parent="human_oversight" data-field="oversight_level">
                  <option value="none" ${step.human_oversight.oversight_level === 'none' ? 'selected' : ''}>None</option>
                  <option value="minimal" ${step.human_oversight.oversight_level === 'minimal' ? 'selected' : ''}>Minimal (Outcome only)</option>
                  <option value="active" ${step.human_oversight.oversight_level === 'active' ? 'selected' : ''}>Active (Process review)</option>
                  <option value="full" ${step.human_oversight.oversight_level === 'full' ? 'selected' : ''}>Full (Real-time)</option>
                </select>
              </div>
            </div>
            <div class="form-group">
              <label>Intervention Points</label>
              <input type="text" class="step-input-nested" data-parent="human_oversight" data-field="intervention_points" value="${step.human_oversight.intervention_points}" placeholder="Where can a human override?">
            </div>
          </div>

          <div class="risk-layer" style="border-top: 1px solid var(--card-border); margin-top: 16px; padding-top: 16px">
            <h4 style="margin-bottom: 12px; font-size: 0.9rem; text-transform: uppercase; color: var(--warning-color)">Risk Identification Layer</h4>
            <div class="grid-2">
              <div class="form-group">
                <label>Bias / Fairness Risk</label>
                <input type="text" class="step-input-nested" data-parent="risks" data-field="bias_risk" value="${step.risks.bias_risk}">
              </div>
              <div class="form-group">
                <label>Operational Risk</label>
                <input type="text" class="step-input-nested" data-parent="risks" data-field="operational_risk" value="${step.risks.operational_risk}">
              </div>
            </div>
             <div class="form-group">
              <label>Mitigation Strategy</label>
              <textarea class="step-input-nested" data-parent="risks" data-field="mitigation" rows="2">${step.risks.mitigation}</textarea>
            </div>
          </div>

          ${step.type === 'decision-point' ? `
            <div class="governance-controls" style="border-top: 1px solid var(--card-border); margin-top: 16px; padding-top: 16px">
              <h4 style="margin-bottom: 12px; font-size: 0.9rem; text-transform: uppercase; color: var(--danger-color)">Decision Point Controls</h4>
              <div class="form-group">
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer">
                  <input type="checkbox" class="step-checkbox-nested" data-parent="controls" data-field="approval_required" ${step.controls.approval_required ? 'checked' : ''} style="width: auto">
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
      const newStep: any = {
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
            (step as any)[field] = target.value.split(',').map(s => s.trim());
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
                <span style="font-weight: 600">${step.name || 'Untitled Step'}</span>
                <span class="step-type-pill type-${step.type}">${step.type}</span>
              </div>
              <div class="step-content expanded" style="border-top: 1px solid var(--card-border)">
                <div class="grid-2">
                  <div class="form-group">
                    <label>Approval Required</label>
                    <select class="gov-input" data-id="${step.id}" data-field="approval_required">
                      <option value="false" ${!step.controls.approval_required ? 'selected' : ''}>No</option>
                      <option value="true" ${step.controls.approval_required ? 'selected' : ''}>Yes</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Review Cycle</label>
                    <input type="text" class="gov-input" data-id="${step.id}" data-field="review_cycle" value="${step.controls.review_cycle}" placeholder="e.g. Quarterly">
                  </div>
                </div>
                <div class="form-group">
                  <label>Escalation Path</label>
                  <input type="text" class="gov-input" data-id="${step.id}" data-field="escalation_path" value="${step.controls.escalation_path}" placeholder="Who to contact if risks elevate?">
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
        <p style="color: var(--text-secondary); margin-bottom: 24px">Analyse the systemic risks and human accountability requirements of this workflow design.</p>
        
        <div class="form-group">
          <label>Where could this workflow fail? (Failure Modes)</label>
          <textarea class="reflection-input" data-field="failure_modes" rows="3">${reflection.failure_modes}</textarea>
        </div>

        <div class="form-group">
          <label>Where is human judgement essential?</label>
          <textarea class="reflection-input" data-field="essential_judgement" rows="3">${reflection.essential_judgement}</textarea>
        </div>

        <div class="form-group">
          <label>Where is AI over-relied upon?</label>
          <textarea class="reflection-input" data-field="over_reliance_risks" rows="3">${reflection.over_reliance_risks}</textarea>
        </div>

        <div class="form-group">
          <label>What assumptions are embedded in this design?</label>
          <textarea class="reflection-input" data-field="embedded_assumptions" rows="3">${reflection.embedded_assumptions}</textarea>
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
            <span class="icon">📄</span>
          </div>
          <p style="color: var(--text-secondary); margin-bottom: 20px">Export the full machine-readable workflow specification for integration or backup.</p>
          <button id="export-json" class="btn btn-primary">Export JSON</button>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Markdown Document</span>
            <span class="icon">📝</span>
          </div>
          <p style="color: var(--text-secondary); margin-bottom: 20px">Generate a structured governance report in Markdown format for documentation.</p>
          <button id="export-markdown" class="btn btn-primary">Export Markdown</button>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Printable Report (PDF)</span>
            <span class="icon">🖨️</span>
          </div>
          <p style="color: var(--text-secondary); margin-bottom: 20px">Generate a professional, human-readable PDF report of the workflow design.</p>
          <button id="export-pdf" class="btn btn-primary">Export PDF / Print</button>
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
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (re) => {
          try {
            const data = JSON.parse(re.target?.result as string);
            this.store = data;
            this.saveToStorage();
            this.render();
          } catch (err) {
            alert('Invalid JSON file.');
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  }

  private render() {
    this.updateCompletenessUI();
    this.renderView();
  }
}

new App();
