import { describe, it, expect } from 'vitest';
import {
  mapStoreToSchema,
  mapSchemaToStore,
  validateWorkflowImport
} from '../utils/schema';
import { DEMO_STATE, type WorkflowStore } from '../data/model';

describe('Schema Mapping & Import Validation', () => {
  describe('Round-Trip Fidelity', () => {
    it('achieves 100% round-trip fidelity for DEMO_STATE', () => {
      // Step 1: Export store to schema format
      const exportedSchema1 = mapStoreToSchema(DEMO_STATE);

      // Step 2: Import schema format back to store
      const reconstructedStore = mapSchemaToStore(exportedSchema1);

      // Step 3: Re-export to schema format
      const exportedSchema2 = mapStoreToSchema(reconstructedStore);

      // Verify workflow ID, step IDs, metadata, risks, controls, reflection are preserved
      expect(reconstructedStore.metadata.id).toBe(DEMO_STATE.metadata.id);
      expect(reconstructedStore.metadata.title).toBe(DEMO_STATE.metadata.title);
      expect(reconstructedStore.metadata.owner).toBe(DEMO_STATE.metadata.owner);
      expect(reconstructedStore.metadata.purpose).toBe(DEMO_STATE.metadata.purpose);
      expect(reconstructedStore.steps.length).toBe(DEMO_STATE.steps.length);

      for (let i = 0; i < DEMO_STATE.steps.length; i++) {
        expect(reconstructedStore.steps[i].id).toBe(DEMO_STATE.steps[i].id);
        expect(reconstructedStore.steps[i].name).toBe(DEMO_STATE.steps[i].name);
        expect(reconstructedStore.steps[i].type).toBe(DEMO_STATE.steps[i].type);
        expect(reconstructedStore.steps[i].ai_involvement).toEqual(DEMO_STATE.steps[i].ai_involvement);
        expect(reconstructedStore.steps[i].human_oversight).toEqual(DEMO_STATE.steps[i].human_oversight);
        expect(reconstructedStore.steps[i].risks).toEqual(DEMO_STATE.steps[i].risks);
        expect(reconstructedStore.steps[i].controls).toEqual(DEMO_STATE.steps[i].controls);
      }

      expect(reconstructedStore.reflection).toEqual(DEMO_STATE.reflection);

      // Verify exported schema fidelity
      expect(exportedSchema2).toEqual(exportedSchema1);
    });

    it('preserves unknown meaningful fields across round-trip transformations', () => {
      const customStore: WorkflowStore = {
        metadata: {
          id: 'custom-wf-100',
          title: 'Custom Workflow',
          version: '2.1.0',
          created_at: '2026-01-01T00:00:00.000Z',
          owner: 'Security Lead',
          organisation: 'EduTech Corp',
          purpose: 'Automated grading oversight',
          domain: 'education',
          capabilityNotes: 'Notes on capabilities',
          governanceNotes: 'Notes on governance',
          custom_meta_tag: 'flagship-project',
          institutional_code: 8842
        },
        steps: [
          {
            id: 'step-custom-1',
            name: 'Essay Analysis',
            type: 'ai-supported',
            description: 'Analyzes grammar and tone',
            inputs: ['Raw student submission'],
            outputs: ['Grammar score'],
            ai_involvement: {
              ai_role: 'NLP analyzer',
              reliance_level: 'medium',
              custom_model_ref: 'gpt-4o-custom'
            },
            human_oversight: {
              responsible_role: 'Senior Instructor',
              oversight_level: 'active',
              intervention_points: 'Can adjust grade band',
              escalation_tier: 2
            },
            risks: {
              bias_risk: 'Dialect penalization',
              operational_risk: 'Server timeout',
              ethical_risk: 'Unfair penalty',
              privacy_risk: 'Student work stored in model',
              mitigation: 'Strip personal identifiers',
              residual_risk_rating: 'Low'
            },
            controls: {
              approval_required: true,
              escalation_path: 'Academic Board',
              review_cycle: 'Bi-weekly',
              audit_sample_rate: 0.1
            },
            custom_step_metadata: { estimated_duration_seconds: 45 }
          }
        ],
        reflection: {
          failure_modes: 'Grammar model confuses regional idioms',
          essential_judgement: 'Final grade must be assigned by instructor',
          over_reliance_risks: 'Instructors deferring to suggested scores',
          embedded_assumptions: 'Standard English syntax expectations',
          unaddressed_queries: ['Impact on second language learners']
        },
        custom_root_field: 'audit-trace-2026'
      };

      const schema = mapStoreToSchema(customStore);
      expect(schema.custom_root_field).toBe('audit-trace-2026');
      expect(schema.metadata.custom_meta_tag).toBe('flagship-project');
      expect(schema.metadata.institutional_code).toBe(8842);
      expect(schema.steps[0].ai_involvement.custom_model_ref).toBe('gpt-4o-custom');
      expect(schema.steps[0].human_oversight.escalation_tier).toBe(2);
      expect(schema.steps[0].risks.residual_risk_rating).toBe('Low');
      expect(schema.steps[0].controls.audit_sample_rate).toBe(0.1);
      expect(schema.steps[0].custom_step_metadata).toEqual({ estimated_duration_seconds: 45 });
      expect(schema.reflection.unaddressed_queries).toEqual(['Impact on second language learners']);

      // Reverse mapping back to store
      const importedStore = mapSchemaToStore(schema);
      expect(importedStore.custom_root_field).toBe('audit-trace-2026');
      expect(importedStore.metadata.custom_meta_tag).toBe('flagship-project');
      expect(importedStore.steps[0].ai_involvement.custom_model_ref).toBe('gpt-4o-custom');
      expect(importedStore.steps[0].custom_step_metadata).toEqual({ estimated_duration_seconds: 45 });
      expect(importedStore.reflection.unaddressed_queries).toEqual(['Impact on second language learners']);
    });
  });

  describe('Legacy Record Compatibility', () => {
    it('correctly maps and normalizes legacy internal-storage format', () => {
      const legacyInternalStorage = {
        metadata: {
          id: 'legacy-wf-001',
          title: 'Legacy Student Support Workflow',
          version: '1.0.0',
          created_at: '2025-05-10T12:00:00Z',
          owner: 'Academic Dean',
          organisation: 'State University',
          purpose: 'Automated ticket triage for student enquiries',
          domain: 'education',
          capabilityNotes: 'Legacy capability',
          governanceNotes: 'Legacy governance'
        },
        steps: [
          {
            id: 'legacy-step-1',
            name: 'Ticket Ingestion',
            type: 'human-only',
            description: 'Receives ticket from portal',
            inputs: ['Email'],
            outputs: ['Ticket ID'],
            ai_involvement: { ai_role: 'None', reliance_level: 'low' },
            human_oversight: { responsible_role: 'Helpdesk Admin', oversight_level: 'full', intervention_points: 'Always' },
            risks: { bias_risk: 'None', operational_risk: 'Downtime', ethical_risk: 'None', privacy_risk: 'Low', mitigation: 'Backup queues' },
            controls: { approval_required: false, escalation_path: 'IT Ops', review_cycle: 'Annual' }
          }
        ],
        reflection: {
          failure_modes: 'Queue overflow',
          essential_judgement: 'Emergency escalation',
          over_reliance_risks: 'None',
          embedded_assumptions: 'Students use official portal'
        }
      };

      const validation = validateWorkflowImport(legacyInternalStorage);
      expect(validation.valid).toBe(true);
      expect(validation.detectedFormat).toBe('legacy_store');
      expect(validation.store?.metadata.title).toBe('Legacy Student Support Workflow');
      expect(validation.store?.steps[0].name).toBe('Ticket Ingestion');
      expect(validation.store?.steps[0].type).toBe('human-only');
    });

    it('populates sensible defaults for legacy records with missing optional fields', () => {
      const minimalLegacy = {
        metadata: {
          title: 'Minimal Workflow',
          owner: 'Lead Auditor',
          purpose: 'Compliance validation'
        },
        steps: [
          {
            name: 'Audit check',
            type: 'decision-point'
          }
        ]
      };

      const validation = validateWorkflowImport(minimalLegacy);
      expect(validation.valid).toBe(true);
      const store = validation.store!;
      expect(store.metadata.id).toBeDefined();
      expect(store.metadata.domain).toBe('education');
      expect(store.steps[0].id).toBeDefined();
      expect(store.steps[0].inputs).toEqual([]);
      expect(store.steps[0].outputs).toEqual([]);
      expect(store.steps[0].ai_involvement.reliance_level).toBe('low');
      expect(store.steps[0].human_oversight.oversight_level).toBe('none');
      expect(store.steps[0].controls.approval_required).toBe(false);
      expect(store.reflection.failure_modes).toBe('');
    });
  });

  describe('Invalid and Malicious Imports Rejection', () => {
    it('rejects unparseable non-JSON strings', () => {
      const result = validateWorkflowImport('{ not-valid-json ...');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Malformed JSON');
    });

    it('rejects primitive JSON values like arrays, numbers, and null', () => {
      expect(validateWorkflowImport(null).valid).toBe(false);
      expect(validateWorkflowImport([1, 2, 3]).valid).toBe(false);
      expect(validateWorkflowImport('12345').valid).toBe(false);
      expect(validateWorkflowImport('"plain string"').valid).toBe(false);
    });

    it('rejects imports missing required metadata fields', () => {
      const missingTitle = {
        metadata: { owner: 'Jane Doe', purpose: 'Testing' },
        steps: []
      };
      const result = validateWorkflowImport(missingTitle);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('workflow title'))).toBe(true);

      const missingOwner = {
        metadata: { workflow_title: 'Valid Title', purpose: 'Testing' },
        steps: []
      };
      const resultOwner = validateWorkflowImport(missingOwner);
      expect(resultOwner.valid).toBe(false);
      expect(resultOwner.errors.some(e => e.includes('workflow owner'))).toBe(true);

      const missingPurpose = {
        metadata: { workflow_title: 'Valid Title', workflow_owner: 'Valid Owner' },
        steps: []
      };
      const resultPurpose = validateWorkflowImport(missingPurpose);
      expect(resultPurpose.valid).toBe(false);
      expect(resultPurpose.errors.some(e => e.includes('purpose'))).toBe(true);
    });

    it('rejects steps with invalid step types', () => {
      const badStepType = {
        metadata: { workflow_title: 'T', workflow_owner: 'O', purpose: 'P' },
        steps: [
          {
            step_name: 'Invalid Step',
            step_type: 'magic-ai-vibe' // Invalid enum
          }
        ]
      };
      const result = validateWorkflowImport(badStepType);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('invalid step type "magic-ai-vibe"'))).toBe(true);
    });

    it('rejects steps with invalid reliance or oversight enum values', () => {
      const badReliance = {
        metadata: { workflow_title: 'T', workflow_owner: 'O', purpose: 'P' },
        steps: [
          {
            step_name: 'Step 1',
            step_type: 'ai-supported',
            ai_involvement: { reliance_level: 'hyper-critical' }
          }
        ]
      };
      const result = validateWorkflowImport(badReliance);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('invalid reliance_level'))).toBe(true);
    });

    it('warns on non-standard schema URIs without breaking valid imports', () => {
      const nonStandardSchema = {
        $schema: 'http://example.com/custom-schema.json',
        metadata: { workflow_title: 'Custom Schema Doc', workflow_owner: 'Owner', purpose: 'Testing' },
        steps: []
      };
      const result = validateWorkflowImport(nonStandardSchema);
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('Non-standard $schema URI');
    });
  });
});
