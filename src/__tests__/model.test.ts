import { describe, it, expect } from 'vitest';
import {
  calculateCompleteness,
  calculateAIDependency,
  isHighRiskStep,
  detectOversightGaps,
  detectConsecutiveAISteps,
  getGovernanceSuggestions,
  getHumanOversightIndicator,
  INITIAL_STATE,
  DEMO_STATE,
  type WorkflowStore,
  type WorkflowStep
} from '../data/model';

describe('Model Metrics & Governance Advisory Rules', () => {
  describe('Completeness Calculations', () => {
    it('returns 0% for empty initial state', () => {
      const emptyState = JSON.parse(JSON.stringify(INITIAL_STATE));
      expect(calculateCompleteness(emptyState)).toBe(0);
    });

    it('calculates proportional score as required sections are completed', () => {
      const store: WorkflowStore = {
        metadata: {
          id: 'test-1',
          title: 'Test Workflow',
          owner: 'Process Owner',
          purpose: 'Testing Completeness',
          organisation: 'Org',
          domain: 'education',
          version: '1.0.0',
          created_at: new Date().toISOString()
        },
        steps: [],
        reflection: {
          failure_modes: '',
          essential_judgement: '',
          over_reliance_risks: '',
          embedded_assumptions: ''
        }
      };

      // Metadata completed (1 out of 7 categories)
      expect(calculateCompleteness(store)).toBe(Math.round((1 / 7) * 100)); // 14%

      // Add a step with type and oversight
      store.steps.push({
        id: 's1',
        name: 'Step 1',
        type: 'human-only',
        description: 'First step',
        inputs: ['A'],
        outputs: ['B'],
        ai_involvement: { ai_role: 'None', reliance_level: 'low' },
        human_oversight: { responsible_role: 'Auditor', oversight_level: 'full', intervention_points: 'All' },
        risks: { bias_risk: '', operational_risk: '', ethical_risk: '', privacy_risk: '', mitigation: '' },
        controls: { approval_required: false, escalation_path: '', review_cycle: '' }
      });

      // Steps present (+1), all steps have type (+1), all steps have responsible role (+1) -> 4 out of 7
      expect(calculateCompleteness(store)).toBe(Math.round((4 / 7) * 100)); // 57%
    });

    it('returns 100% for fully populated DEMO_STATE', () => {
      expect(calculateCompleteness(DEMO_STATE)).toBe(100);
    });

    it('12. ignores unknown extension properties on reflection when calculating completeness', () => {
      const storeWithExtensions: WorkflowStore = JSON.parse(JSON.stringify(DEMO_STATE));
      storeWithExtensions.reflection.custom_boolean_flag = true;
      storeWithExtensions.reflection.custom_numeric_score = 3;
      storeWithExtensions.reflection.short_tag = 'ok';
      storeWithExtensions.reflection.nested_notes = { reviewed: true };

      expect(calculateCompleteness(storeWithExtensions)).toBe(100);
    });
  });

  describe('AI Dependency Calculations', () => {
    it('returns 0% when no steps exist', () => {
      const store: WorkflowStore = {
        ...INITIAL_STATE,
        steps: []
      };
      expect(calculateAIDependency(store)).toBe(0);
    });

    it('returns 0% when all steps are human-only or decision-point', () => {
      const store: WorkflowStore = {
        ...INITIAL_STATE,
        steps: [
          {
            id: 's1',
            name: 'Manual Entry',
            type: 'human-only',
            description: '',
            inputs: [],
            outputs: [],
            ai_involvement: { ai_role: '', reliance_level: 'low' },
            human_oversight: { responsible_role: 'Staff', oversight_level: 'full', intervention_points: '' },
            risks: { bias_risk: '', operational_risk: '', ethical_risk: '', privacy_risk: '', mitigation: '' },
            controls: { approval_required: false, escalation_path: '', review_cycle: '' }
          },
          {
            id: 's2',
            name: 'Sign-off',
            type: 'decision-point',
            description: '',
            inputs: [],
            outputs: [],
            ai_involvement: { ai_role: '', reliance_level: 'low' },
            human_oversight: { responsible_role: 'Manager', oversight_level: 'full', intervention_points: '' },
            risks: { bias_risk: '', operational_risk: '', ethical_risk: '', privacy_risk: '', mitigation: '' },
            controls: { approval_required: true, escalation_path: '', review_cycle: '' }
          }
        ]
      };
      expect(calculateAIDependency(store)).toBe(0);
    });

    it('returns 50% when half the steps involve AI', () => {
      const store: WorkflowStore = {
        ...INITIAL_STATE,
        steps: [
          {
            id: 's1',
            name: 'Human Ingestion',
            type: 'human-only',
            description: '',
            inputs: [],
            outputs: [],
            ai_involvement: { ai_role: '', reliance_level: 'low' },
            human_oversight: { responsible_role: '', oversight_level: 'none', intervention_points: '' },
            risks: { bias_risk: '', operational_risk: '', ethical_risk: '', privacy_risk: '', mitigation: '' },
            controls: { approval_required: false, escalation_path: '', review_cycle: '' }
          },
          {
            id: 's2',
            name: 'AI Extraction',
            type: 'ai-generated',
            description: '',
            inputs: [],
            outputs: [],
            ai_involvement: { ai_role: 'LLM', reliance_level: 'high' },
            human_oversight: { responsible_role: '', oversight_level: 'none', intervention_points: '' },
            risks: { bias_risk: '', operational_risk: '', ethical_risk: '', privacy_risk: '', mitigation: '' },
            controls: { approval_required: false, escalation_path: '', review_cycle: '' }
          }
        ]
      };
      expect(calculateAIDependency(store)).toBe(50);
    });

    it('returns 100% when all steps are AI-supported or AI-generated', () => {
      const store: WorkflowStore = {
        ...INITIAL_STATE,
        steps: [
          {
            id: 's1',
            name: 'AI Drafting',
            type: 'ai-generated',
            description: '',
            inputs: [],
            outputs: [],
            ai_involvement: { ai_role: '', reliance_level: 'high' },
            human_oversight: { responsible_role: '', oversight_level: 'none', intervention_points: '' },
            risks: { bias_risk: '', operational_risk: '', ethical_risk: '', privacy_risk: '', mitigation: '' },
            controls: { approval_required: false, escalation_path: '', review_cycle: '' }
          },
          {
            id: 's2',
            name: 'AI Review',
            type: 'ai-supported',
            description: '',
            inputs: [],
            outputs: [],
            ai_involvement: { ai_role: '', reliance_level: 'medium' },
            human_oversight: { responsible_role: '', oversight_level: 'none', intervention_points: '' },
            risks: { bias_risk: '', operational_risk: '', ethical_risk: '', privacy_risk: '', mitigation: '' },
            controls: { approval_required: false, escalation_path: '', review_cycle: '' }
          }
        ]
      };
      expect(calculateAIDependency(store)).toBe(100);
    });
  });

  describe('Governance Advisory & Risk Rules', () => {
    it('flags high risk when reliance level is high or critical', () => {
      const step: WorkflowStep = {
        id: 's1',
        name: 'Critical AI Diagnostic',
        type: 'ai-supported',
        description: '',
        inputs: [],
        outputs: [],
        ai_involvement: { ai_role: 'Triage', reliance_level: 'high' },
        human_oversight: { responsible_role: 'Doctor', oversight_level: 'full', intervention_points: '' },
        risks: { bias_risk: '', operational_risk: '', ethical_risk: '', privacy_risk: '', mitigation: '' },
        controls: { approval_required: false, escalation_path: '', review_cycle: '' }
      };
      expect(isHighRiskStep(step)).toBe(true);

      step.ai_involvement.reliance_level = 'critical';
      expect(isHighRiskStep(step)).toBe(true);

      step.ai_involvement.reliance_level = 'low';
      expect(isHighRiskStep(step)).toBe(false);
    });

    it('flags high risk when step is ai-generated without full oversight', () => {
      const step: WorkflowStep = {
        id: 's1',
        name: 'Auto-generation',
        type: 'ai-generated',
        description: '',
        inputs: [],
        outputs: [],
        ai_involvement: { ai_role: 'Generator', reliance_level: 'medium' },
        human_oversight: { responsible_role: 'Editor', oversight_level: 'minimal', intervention_points: '' },
        risks: { bias_risk: '', operational_risk: '', ethical_risk: '', privacy_risk: '', mitigation: '' },
        controls: { approval_required: false, escalation_path: '', review_cycle: '' }
      };
      expect(isHighRiskStep(step)).toBe(true);

      step.human_oversight.oversight_level = 'full';
      expect(isHighRiskStep(step)).toBe(false);
    });

    it('detects oversight gaps in AI steps with zero human oversight', () => {
      const store: WorkflowStore = {
        ...INITIAL_STATE,
        steps: [
          {
            id: 's1',
            name: 'Ungoverned AI Step',
            type: 'ai-generated',
            description: '',
            inputs: [],
            outputs: [],
            ai_involvement: { ai_role: '', reliance_level: 'medium' },
            human_oversight: { responsible_role: '', oversight_level: 'none', intervention_points: '' },
            risks: { bias_risk: '', operational_risk: '', ethical_risk: '', privacy_risk: '', mitigation: '' },
            controls: { approval_required: false, escalation_path: '', review_cycle: '' }
          }
        ]
      };
      const gaps = detectOversightGaps(store);
      expect(gaps.length).toBe(1);
      expect(gaps[0].name).toBe('Ungoverned AI Step');

      const indicator = getHumanOversightIndicator(store);
      expect(indicator.count).toBe(1);
      expect(indicator.steps).toEqual(['Ungoverned AI Step']);
    });

    it('detects consecutive sequences of 2 or more AI steps', () => {
      const store: WorkflowStore = {
        ...INITIAL_STATE,
        steps: [
          {
            id: 's1',
            name: 'AI 1',
            type: 'ai-generated',
            description: '',
            inputs: [],
            outputs: [],
            ai_involvement: { ai_role: '', reliance_level: 'low' },
            human_oversight: { responsible_role: '', oversight_level: 'full', intervention_points: '' },
            risks: { bias_risk: '', operational_risk: '', ethical_risk: '', privacy_risk: '', mitigation: '' },
            controls: { approval_required: false, escalation_path: '', review_cycle: '' }
          },
          {
            id: 's2',
            name: 'AI 2',
            type: 'ai-supported',
            description: '',
            inputs: [],
            outputs: [],
            ai_involvement: { ai_role: '', reliance_level: 'low' },
            human_oversight: { responsible_role: '', oversight_level: 'full', intervention_points: '' },
            risks: { bias_risk: '', operational_risk: '', ethical_risk: '', privacy_risk: '', mitigation: '' },
            controls: { approval_required: false, escalation_path: '', review_cycle: '' }
          },
          {
            id: 's3',
            name: 'Human Review',
            type: 'human-only',
            description: '',
            inputs: [],
            outputs: [],
            ai_involvement: { ai_role: '', reliance_level: 'low' },
            human_oversight: { responsible_role: '', oversight_level: 'full', intervention_points: '' },
            risks: { bias_risk: '', operational_risk: '', ethical_risk: '', privacy_risk: '', mitigation: '' },
            controls: { approval_required: false, escalation_path: '', review_cycle: '' }
          }
        ]
      };

      const clusters = detectConsecutiveAISteps(store);
      expect(clusters.length).toBe(1);
      expect(clusters[0]).toEqual([0, 1]);

      const suggestions = getGovernanceSuggestions(store);
      expect(suggestions.some(s => s.message.includes('consecutive AI-only sequence'))).toBe(true);
    });

    it('generates governance suggestion when decision-point lacks required approval', () => {
      const store: WorkflowStore = {
        ...INITIAL_STATE,
        steps: [
          {
            id: 'dp1',
            name: 'Critical Gate',
            type: 'decision-point',
            description: '',
            inputs: [],
            outputs: [],
            ai_involvement: { ai_role: '', reliance_level: 'low' },
            human_oversight: { responsible_role: 'Lead', oversight_level: 'active', intervention_points: '' },
            risks: { bias_risk: '', operational_risk: '', ethical_risk: '', privacy_risk: '', mitigation: '' },
            controls: { approval_required: false, escalation_path: '', review_cycle: '' }
          }
        ]
      };

      const suggestions = getGovernanceSuggestions(store);
      expect(suggestions.some(s => s.message.includes('Decision Point') && s.message.includes('Approval Required'))).toBe(true);
    });
  });
});
