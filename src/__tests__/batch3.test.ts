import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { App } from '../main';
import { StorageManager } from '../utils/storage';
import {
  generatePrintableReportHTML,
  generateMarkdown,
  exportToPDF,
  GOVERNANCE_REPORT_DISCLAIMER
} from '../utils/export';
import type { WorkflowStore } from '../data/model';

function createTestDOM() {
  document.body.innerHTML = `
    <div id="app">
      <nav class="sidebar" aria-label="Primary navigation">
        <div class="nav-links">
          <button type="button" class="nav-item active" data-view="dashboard" aria-current="page">Dashboard</button>
          <button type="button" class="nav-item" data-view="workflow-context">Context</button>
          <button type="button" class="nav-item" data-view="workflow-builder">Step Builder</button>
          <button type="button" class="nav-item" data-view="governance-panel">Governance</button>
          <button type="button" class="nav-item" data-view="reflection-layer">Reflection</button>
          <button type="button" class="nav-item" data-view="export-panel">Export</button>
        </div>
        <div class="completeness-mini">
          <div class="progress" style="width: 0%"></div>
          <div class="value">0%</div>
        </div>
      </nav>
      <main class="content">
        <header class="top-bar">
          <h1 id="view-title">Dashboard</h1>
          <div id="save-status-container" role="status" aria-live="polite" aria-atomic="true">
            <span id="save-status">Saved</span>
          </div>
          <div class="top-actions">
            <button type="button" id="load-demo">Demo</button>
            <button type="button" id="new-workflow">New</button>
            <button type="button" id="save-workflow">Save</button>
            <button type="button" id="import-workflow">Import</button>
          </div>
        </header>
        <div id="view-container" class="view-container"></div>
        <section id="printable-governance-report" class="printable-report" aria-label="Printable Governance Specification Report"></section>
        <footer class="page-footer"></footer>
      </main>
    </div>
  `;
}

function createMemoryStorage(backingMap: Map<string, string> = new Map()): Storage {
  return {
    getItem: (k: string) => backingMap.get(k) ?? null,
    setItem: (k: string, v: string) => {
      backingMap.set(k, String(v));
    },
    removeItem: (k: string) => {
      backingMap.delete(k);
    },
    clear: () => {
      backingMap.clear();
    },
    key: (i: number) => Array.from(backingMap.keys())[i] ?? null,
    get length() {
      return backingMap.size;
    }
  };
}

describe('Batch 3 — Accessibility, Printable Governance Report, Responsive Layout & Hardening', () => {
  let backingMap: Map<string, string>;
  let customStorage: Storage;

  beforeEach(() => {
    backingMap = new Map();
    customStorage = createMemoryStorage(backingMap);
    createTestDOM();
    window.confirm = () => true;
    window.alert = () => {};
  });

  it('1. associates every form label with its control via explicit for/id across Context, Step Builder, Governance, and Reflection views', () => {
    const app = new App(new StorageManager(customStorage));

    const assertAllLabelsAssociated = (viewName: string) => {
      const labels = document.querySelectorAll('#view-container label, #workflow-registry-bar label');
      expect(labels.length).toBeGreaterThan(0);
      labels.forEach(label => {
        const htmlFor = label.getAttribute('for');
        expect(htmlFor, `Missing "for" attribute on label "${label.textContent?.trim()}" in ${viewName}`).toBeTruthy();
        const targetControl = document.getElementById(htmlFor!);
        expect(
          targetControl,
          `No form control found with id="${htmlFor}" in ${viewName}`
        ).not.toBeNull();
      });
    };

    // 1. Context view
    (document.querySelector('[data-view="workflow-context"]') as HTMLElement).click();
    assertAllLabelsAssociated('workflow-context');

    // 2. Step Builder view (add a step and switch it to decision-point so all 16 step controls including Decision Record checkbox are rendered)
    (document.querySelector('[data-view="workflow-builder"]') as HTMLElement).click();
    document.getElementById('add-step')?.click();
    const typeSelect = document.querySelector('select.step-input[data-field="type"]') as HTMLSelectElement;
    typeSelect.value = 'decision-point';
    typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    assertAllLabelsAssociated('workflow-builder');

    // 3. Governance Panel view
    (document.querySelector('[data-view="governance-panel"]') as HTMLElement).click();
    assertAllLabelsAssociated('governance-panel');

    // 4. Reflection Layer view
    (document.querySelector('[data-view="reflection-layer"]') as HTMLElement).click();
    assertAllLabelsAssociated('reflection-layer');

    expect(app.getStore().steps.length).toBe(1);
  });

  it('2. maintains accurate aria-expanded/aria-controls on step expansion buttons, aria-current on navigation, and focus preservation on workflow switching', () => {
    const app = new App(new StorageManager(customStorage));

    // Check aria-current="page" updates across navigation buttons
    const dashBtn = document.querySelector('[data-view="dashboard"]') as HTMLButtonElement;
    const builderBtn = document.querySelector('[data-view="workflow-builder"]') as HTMLButtonElement;
    expect(dashBtn.getAttribute('aria-current')).toBe('page');
    expect(builderBtn.getAttribute('aria-current')).toBeNull();

    builderBtn.click();
    expect(builderBtn.getAttribute('aria-current')).toBe('page');
    expect(dashBtn.getAttribute('aria-current')).toBeNull();

    // Add a new step: opens expanded with aria-expanded="true" and valid aria-controls
    document.getElementById('add-step')?.click();
    const stepItem = document.querySelector('.step-item') as HTMLElement;
    const stepId = stepItem.getAttribute('data-id')!;
    const editBtn = stepItem.querySelector('.edit-step') as HTMLButtonElement;
    const stepContent = stepItem.querySelector('.step-content') as HTMLElement;

    expect(editBtn.getAttribute('aria-expanded')).toBe('true');
    expect(editBtn.getAttribute('aria-controls')).toBe(`step-content-${stepId}`);
    expect(stepContent.id).toBe(`step-content-${stepId}`);
    expect(stepContent.classList.contains('expanded')).toBe(true);

    // Click Edit to collapse -> aria-expanded updates to "false"
    editBtn.click();
    expect(editBtn.getAttribute('aria-expanded')).toBe('false');
    expect(stepContent.classList.contains('expanded')).toBe(false);

    // Click Edit again to expand -> aria-expanded updates to "true"
    editBtn.click();
    expect(editBtn.getAttribute('aria-expanded')).toBe('true');
    expect(stepContent.classList.contains('expanded')).toBe(true);

    // Create a second workflow and verify keyboard focus stays on #workflow-switcher when switching workflows
    const wf1Id = app.getStore().metadata.id;
    app.createWorkflowInRegistry('Second Workflow');
    const wf2Id = app.getStore().metadata.id;
    expect(wf2Id).not.toBe(wf1Id);

    const switcherBefore = document.getElementById('workflow-switcher') as HTMLSelectElement;
    switcherBefore.focus();
    expect(document.activeElement).toBe(switcherBefore);

    switcherBefore.value = wf1Id;
    switcherBefore.dispatchEvent(new Event('change', { bubbles: true }));

    const switcherAfter = document.getElementById('workflow-switcher') as HTMLSelectElement;
    expect(app.getStore().metadata.id).toBe(wf1Id);
    expect(document.activeElement).toBe(switcherAfter);
  });

  it('3. renders a complete, XSS-safe print/PDF governance report and updates #printable-governance-report on exportToPDF()', () => {
    const app = new App(new StorageManager(customStorage));
    const store: WorkflowStore = {
      metadata: {
        id: 'print-spec-001',
        title: 'Clinical AI Triage & Escalation',
        version: '3.0.0',
        created_at: '2026-04-10T12:00:00Z',
        owner: 'Dr. Jane Smith, CMIO',
        organisation: 'National Health Trust',
        purpose: 'Provide governed clinical urgency triage with mandatory clinician sign-off',
        domain: 'operations',
        capabilityNotes: 'Trains clinicians to verify model rationales',
        governanceNotes: 'Subject to quarterly clinical safety board review'
      },
      steps: [
        {
          id: 'step-print-1',
          name: 'Automated Intake Risk Scoring',
          type: 'ai-generated',
          description: 'Scores incoming referrals by clinical urgency',
          inputs: ['Referral Letter', 'Lab Results'],
          outputs: ['Urgency Score', 'Confidence Interval'],
          ai_involvement: {
            ai_role: 'Extracts clinical entities and predicts triage tier',
            reliance_level: 'high'
          },
          human_oversight: {
            responsible_role: 'Triage Nurse Specialist',
            oversight_level: 'active',
            intervention_points: 'Nurse can override tier or flag for senior review'
          },
          risks: {
            bias_risk: 'Under-estimation of atypical symptom presentations',
            operational_risk: 'EHR integration timeout during peak hours',
            ethical_risk: 'Inequitable queue prioritization across patient cohorts',
            privacy_risk: 'Processing of sensitive diagnostic histories',
            mitigation: 'Mandatory human review of all borderline confidence scores'
          },
          controls: {
            approval_required: true,
            escalation_path: 'On-Call Clinical Safety Officer',
            review_cycle: 'Monthly'
          }
        },
        {
          id: 'step-print-2',
          name: 'Final Triage Allocation Decision',
          type: 'decision-point',
          description: 'Clinician confirms final pathway allocation',
          inputs: ['Urgency Score', 'Nurse Assessment'],
          outputs: ['Confirmed Clinical Pathway'],
          ai_involvement: {
            ai_role: 'Displays explanation summary alongside clinical record',
            reliance_level: 'medium'
          },
          human_oversight: {
            responsible_role: 'Attending Consultant',
            oversight_level: 'full',
            intervention_points: 'Direct pathway reassignment before booking'
          },
          risks: {
            bias_risk: 'Automation complacency during high-volume shifts',
            operational_risk: 'Delayed sign-off queue',
            ethical_risk: 'Accountability diffusion between AI and clinician',
            privacy_risk: 'Audit log retention of patient identifiers',
            mitigation: 'Structured Decision Record required prior to pathway lock'
          },
          controls: {
            approval_required: true,
            escalation_path: 'Departmental Clinical Director',
            review_cycle: 'Quarterly'
          }
        }
      ],
      reflection: {
        failure_modes: 'Model misclassifies rare acute presentations as routine',
        essential_judgement: 'Holistic interpretation of patient comorbidities and social context',
        over_reliance_risks: 'Rubber-stamping high-confidence AI triage scores under time pressure',
        embedded_assumptions: 'Referral letters contain complete and accurate baseline clinical data'
      }
    };

    const reportHtml = generatePrintableReportHTML(store);

    // Verify all required report elements are present
    expect(reportHtml).toContain('Clinical AI Triage &amp; Escalation');
    expect(reportHtml).toContain('print-spec-001');
    expect(reportHtml).toContain('Dr. Jane Smith, CMIO');
    expect(reportHtml).toContain('National Health Trust');
    expect(reportHtml).toContain('Provide governed clinical urgency triage with mandatory clinician sign-off');
    expect(reportHtml).toContain('operations');
    expect(reportHtml).toContain('3.0.0');
    expect(reportHtml).toContain('Trains clinicians to verify model rationales');
    expect(reportHtml).toContain('Subject to quarterly clinical safety board review');

    // Completeness & AI-dependency metrics
    expect(reportHtml).toContain('Governance Completeness');
    expect(reportHtml).toContain('100%');
    expect(reportHtml).toContain('AI Dependency Ratio');
    expect(reportHtml).toContain('50%');

    // Ordered workflow steps, AI roles & reliance, human oversight & intervention points
    expect(reportHtml).toContain('Step 1: Automated Intake Risk Scoring');
    expect(reportHtml).toContain('Step 2: Final Triage Allocation Decision');
    expect(reportHtml).toContain('Extracts clinical entities and predicts triage tier');
    expect(reportHtml).toContain('high');
    expect(reportHtml).toContain('Triage Nurse Specialist');
    expect(reportHtml).toContain('Nurse can override tier or flag for senior review');

    // All 4 risk dimensions + mitigation
    expect(reportHtml).toContain('Under-estimation of atypical symptom presentations');
    expect(reportHtml).toContain('EHR integration timeout during peak hours');
    expect(reportHtml).toContain('Inequitable queue prioritization across patient cohorts');
    expect(reportHtml).toContain('Processing of sensitive diagnostic histories');
    expect(reportHtml).toContain('Mandatory human review of all borderline confidence scores');

    // Approval, decision-record requirement, escalation path, review cycle
    expect(reportHtml).toContain('Yes (Required)');
    expect(reportHtml).toContain('YES — Mandated (Human-AI Decision Record)');
    expect(reportHtml).toContain('On-Call Clinical Safety Officer');
    expect(reportHtml).toContain('Departmental Clinical Director');
    expect(reportHtml).toContain('Monthly');
    expect(reportHtml).toContain('Quarterly');

    // Critical reflection
    expect(reportHtml).toContain('Model misclassifies rare acute presentations as routine');
    expect(reportHtml).toContain('Holistic interpretation of patient comorbidities and social context');
    expect(reportHtml).toContain('Rubber-stamping high-confidence AI triage scores under time pressure');
    expect(reportHtml).toContain('Referral letters contain complete and accurate baseline clinical data');

    // Non-certification disclaimer
    expect(reportHtml).toContain(GOVERNANCE_REPORT_DISCLAIMER);
    expect(generateMarkdown(store)).toContain(GOVERNANCE_REPORT_DISCLAIMER);

    // Verify #export-pdf click updates #printable-governance-report and calls window.print()
    const printSpy = vi.fn();
    window.print = printSpy;
    app.importWorkflowContent(
      JSON.stringify({
        metadata: {
          workflow_id: store.metadata.id,
          workflow_title: store.metadata.title,
          workflow_owner: store.metadata.owner,
          purpose: store.metadata.purpose
        },
        steps: []
      })
    );
    (document.querySelector('[data-view="export-panel"]') as HTMLElement).click();
    document.getElementById('export-pdf')?.click();

    expect(printSpy).toHaveBeenCalledTimes(1);
    const domReport = document.getElementById('printable-governance-report');
    expect(domReport).not.toBeNull();
    expect(domReport!.innerHTML).toContain('Clinical AI Triage &amp; Escalation');

    // Verify XSS escaping in printable report
    const xssStore: WorkflowStore = JSON.parse(JSON.stringify(store));
    xssStore.metadata.title = '<script>alert("xss-title")</script>';
    xssStore.steps[0].name = '<img src=x onerror=alert("xss-step")>';
    xssStore.steps[0].risks.ethical_risk = '<svg onload=alert("xss-risk")>';
    xssStore.reflection.failure_modes = '<iframe src="javascript:alert(1)"></iframe>';

    const rawEscapedReport = generatePrintableReportHTML(xssStore);
    expect(rawEscapedReport).toContain('&lt;script&gt;alert(&quot;xss-title&quot;)&lt;/script&gt;');

    exportToPDF(xssStore);
    const reportEl = document.getElementById('printable-governance-report')!;
    expect(reportEl.querySelectorAll('script, img, svg, iframe').length).toBe(0);
    expect(reportEl.innerHTML).not.toContain('<script>');
    expect(reportEl.innerHTML).not.toContain('<img src=x');
    expect(reportEl.innerHTML).not.toContain('<svg onload=');
    expect(reportEl.innerHTML).not.toContain('<iframe');
  });

  it('4. includes focus-visible, responsive narrow-screen breakpoints, and dedicated print rules in style.css', () => {
    const cssSource = fs.readFileSync(path.resolve(__dirname, '../style.css'), 'utf-8');
    expect(cssSource).toContain('button:focus-visible');
    expect(cssSource).toContain('@media (max-width: 900px)');
    expect(cssSource).toContain('@media (max-width: 640px)');
    expect(cssSource).toContain('@media print');
    expect(cssSource).toContain('.printable-report');
    expect(cssSource).toContain('break-inside: avoid');
  });
});
