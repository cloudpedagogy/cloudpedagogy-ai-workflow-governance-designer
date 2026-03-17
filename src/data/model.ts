import { generateUUID } from '../utils/uuid';

export type StepType = 'human-only' | 'ai-supported' | 'ai-generated' | 'decision-point';
export type RelianceLevel = 'low' | 'medium' | 'high' | 'critical';
export type OversightLevel = 'none' | 'minimal' | 'active' | 'full';

export interface WorkflowStep {
  id: string;
  name: string;
  type: StepType;
  description: string;
  inputs: string[];
  outputs: string[];
  ai_involvement: {
    ai_role: string;
    reliance_level: RelianceLevel;
  };
  human_oversight: {
    responsible_role: string;
    oversight_level: OversightLevel;
    intervention_points: string;
  };
  risks: {
    bias_risk: string;
    operational_risk: string;
    ethical_risk: string;
    privacy_risk: string;
    mitigation: string;
  };
  controls: {
    approval_required: boolean;
    escalation_path: string;
    review_cycle: string;
  };
}

export interface WorkflowMetadata {
  id: string;
  title: string;
  version: string;
  created_at: string;
  owner: string;
  organisation: string;
  purpose: string;
  domain: string;
}

export interface Reflection {
  failure_modes: string;
  essential_judgement: string;
  over_reliance_risks: string;
  embedded_assumptions: string;
}

export interface WorkflowStore {
  metadata: WorkflowMetadata;
  steps: WorkflowStep[];
  reflection: Reflection;
}

export const INITIAL_STATE: WorkflowStore = {
  metadata: {
    id: generateUUID(),
    title: '',
    version: '1.0.0',
    created_at: new Date().toISOString(),
    owner: '',
    organisation: '',
    purpose: '',
    domain: 'education'
  },
  steps: [],
  reflection: {
    failure_modes: '',
    essential_judgement: '',
    over_reliance_risks: '',
    embedded_assumptions: ''
  }
};

export const DEMO_STATE: WorkflowStore = {
  metadata: {
    id: 'demo-healthcare-001',
    title: 'AI-Assisted Radiographic Screening',
    version: '1.2.0',
    created_at: new Date().toISOString(),
    owner: 'Dr. Sarah Chen, Chief of Radiology',
    organisation: 'Metro Health Alliance',
    purpose: 'To provide automated preliminary screening of chest X-rays to prioritise urgent cases for radiologist review.',
    domain: 'research'
  },
  steps: [
    {
      id: 'step-1',
      name: 'Image Acquisition & Anonymisation',
      type: 'human-only',
      description: 'Radiology technician captures X-ray and system automatically strips PII.',
      inputs: ['Raw DICOM image'],
      outputs: ['Anonymised image blob'],
      ai_involvement: { ai_role: 'None', reliance_level: 'low' },
      human_oversight: { responsible_role: 'Radiology Technician', oversight_level: 'full', intervention_points: 'Manual verification of PII removal' },
      risks: { bias_risk: 'None', operational_risk: 'Data corruption during anonymisation', ethical_risk: 'Privacy breach if PII persists', privacy_risk: 'High', mitigation: 'Audit logs for every anonymisation event' },
      controls: { approval_required: false, escalation_path: 'IT Security Office', review_cycle: 'Monthly' }
    },
    {
      id: 'step-2',
      name: 'AI Preliminary Feature Extraction',
      type: 'ai-generated',
      description: 'Deep learning model identifies potential anomalies and segments regions of interest.',
      inputs: ['Anonymised image'],
      outputs: ['Anomaly heatmap', 'Confidence scores'],
      ai_involvement: { ai_role: 'Automated diagnostic assistant', reliance_level: 'high' },
      human_oversight: { responsible_role: 'Radiologist (Retrospective)', oversight_level: 'minimal', intervention_points: 'Technical validation of model output if scores are anomalous' },
      risks: { bias_risk: 'Model trained on specific demographic (under-represents elderly)', operational_risk: 'False negatives in rare pathologies', ethical_risk: 'Over-reliance on automated heatmaps', privacy_risk: 'Low', mitigation: 'Regular model re-training on diverse edge cases' },
      controls: { approval_required: false, escalation_path: 'AI Safety Committee', review_cycle: 'Quarterly' }
    },
    {
      id: 'step-3',
      name: 'Criticality Triaging',
      type: 'decision-point',
      description: 'System-human decision on whether to escalate the scan to immediate priority.',
      inputs: ['AI confidence score', 'Clinical urgency flags'],
      outputs: ['Priority status'],
      ai_involvement: { ai_role: 'Priority suggestions', reliance_level: 'medium' },
      human_oversight: { responsible_role: 'Lead Radiologist', oversight_level: 'active', intervention_points: 'Human can override AI-suggested low priority' },
      risks: { bias_risk: 'Automation bias favoring AI suggestions', operational_risk: 'Triage failure resulting in delayed care', ethical_risk: 'Accountability for triage errors', privacy_risk: 'Low', mitigation: 'Mandatory human approval for all "Low Priority" AI flags' },
      controls: { approval_required: true, escalation_path: 'Chief Medical Officer', review_cycle: 'Continuous' }
    }
  ],
  reflection: {
    failure_modes: 'AI hallucinates anomalies in low-quality scans; Radiologists experience alert fatigue.',
    essential_judgement: 'The final diagnostic decision remains human-led; AI only provides triage priority.',
    over_reliance_risks: 'Junior radiologists blindly following AI heatmaps without critical analysis.',
    embedded_assumptions: 'Assumes the training distribution matches Metro Health’s current patient demographic.'
  }
};

export function calculateCompleteness(store: WorkflowStore): number {
  let score = 0;
  const total = 7;

  if (store.metadata.title && store.metadata.owner && store.metadata.purpose) score++;
  if (store.steps.length > 0) score++;
  
  const allStepsHaveType = store.steps.length > 0 && store.steps.every(s => s.type);
  if (allStepsHaveType) score++;

  const allStepsHaveResponsible = store.steps.length > 0 && store.steps.every(s => s.human_oversight && s.human_oversight.responsible_role);
  if (allStepsHaveResponsible) score++;

  const anyRisksDefined = store.steps.some(s => s.risks && (s.risks.bias_risk || s.risks.ethical_risk || s.risks.operational_risk));
  if (anyRisksDefined) score++;

  const anyControlsDefined = store.steps.some(s => s.controls && (s.controls.escalation_path || s.controls.review_cycle));
  if (anyControlsDefined) score++;

  const reflectionComplete = store.reflection && Object.values(store.reflection).every(v => v && v.length > 10);
  if (reflectionComplete) score++;

  return Math.round((score / total) * 100);
}

export function calculateAIDependency(store: WorkflowStore): number {
  if (store.steps.length === 0) return 0;
  
  const aiSteps = store.steps.filter(s => s.type === 'ai-supported' || s.type === 'ai-generated').length;
  return Math.round((aiSteps / store.steps.length) * 100);
}

export function getHumanOversightIndicator(store: WorkflowStore) {
  const lackingOversight = store.steps.filter(s => 
    (s.type === 'ai-generated' || s.type === 'ai-supported') && 
    (s.human_oversight.oversight_level === 'none' || s.human_oversight.oversight_level === 'minimal')
  );
  
  return {
    count: lackingOversight.length,
    percentage: store.steps.length > 0 ? Math.round((lackingOversight.length / store.steps.length) * 100) : 0,
    steps: lackingOversight.map(s => s.name)
  };
}
