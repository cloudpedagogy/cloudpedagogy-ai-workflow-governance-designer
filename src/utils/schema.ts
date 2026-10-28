import {
  calculateAIDependency,
  calculateCompleteness,
  type WorkflowStore,
  type WorkflowStep,
  type WorkflowMetadata,
  type Reflection,
  type StepType,
  type RelianceLevel,
  type OversightLevel
} from '../data/model';
import { generateUUID } from './uuid';

export const SCHEMA_VERSION = '1.0.0';
export const SCHEMA_DRAFT_URL = 'http://json-schema.org/draft-07/schema#';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  store?: WorkflowStore;
  detectedFormat?: 'schema' | 'legacy_store';
}

function extractUnknownProperties(
  source: Record<string, any> | undefined,
  knownKeys: string[]
): Record<string, any> {
  if (!source || typeof source !== 'object') return {};
  const knownSet = new Set(knownKeys);
  const unknown: Record<string, any> = {};
  for (const key of Object.keys(source)) {
    if (!knownSet.has(key)) {
      unknown[key] = source[key];
    }
  }
  return unknown;
}

/**
 * Validates and transforms an internal WorkflowStore into a schema-compliant
 * JSON structure matching WORKFLOW_SCHEMA.json.
 * Preserves all unknown meaningful fields at root, metadata, step, and nested levels.
 */
export function mapStoreToSchema(store: WorkflowStore): Record<string, any> {
  const metadataSource = store.metadata || {};
  const unknownMetadata = extractUnknownProperties(metadataSource, [
    'id',
    'title',
    'version',
    'created_at',
    'owner',
    'organisation',
    'purpose',
    'domain',
    'capabilityNotes',
    'governanceNotes',
    'workflow_id',
    'workflow_title',
    'workflow_owner',
    'capability_notes',
    'governance_notes'
  ]);

  const schemaMetadata: Record<string, any> = {
    workflow_id: metadataSource.id || generateUUID(),
    workflow_title: metadataSource.title || '',
    version: metadataSource.version || SCHEMA_VERSION,
    created_at: metadataSource.created_at || new Date().toISOString(),
    workflow_owner: metadataSource.owner || '',
    organisation: metadataSource.organisation || '',
    purpose: metadataSource.purpose || '',
    domain: metadataSource.domain || 'education',
    capability_notes: metadataSource.capabilityNotes ?? (metadataSource as any).capability_notes ?? '',
    governance_notes: metadataSource.governanceNotes ?? (metadataSource as any).governance_notes ?? '',
    ...unknownMetadata
  };

  const schemaSteps = (store.steps || []).map((step: WorkflowStep) => {
    const unknownStepProps = extractUnknownProperties(step, [
      'id',
      'name',
      'type',
      'description',
      'inputs',
      'outputs',
      'ai_involvement',
      'human_oversight',
      'risks',
      'controls',
      'step_id',
      'step_name',
      'step_type'
    ]);

    const unknownAi = extractUnknownProperties(step.ai_involvement, ['ai_role', 'reliance_level']);
    const unknownOversight = extractUnknownProperties(step.human_oversight, [
      'responsible_role',
      'oversight_level',
      'intervention_points'
    ]);
    const unknownRisks = extractUnknownProperties(step.risks, [
      'bias_risk',
      'operational_risk',
      'ethical_risk',
      'privacy_risk',
      'mitigation'
    ]);
    const unknownControls = extractUnknownProperties(step.controls, [
      'approval_required',
      'escalation_path',
      'review_cycle'
    ]);

    return {
      step_id: step.id || generateUUID(),
      step_name: step.name || '',
      step_type: step.type || 'human-only',
      description: step.description || '',
      inputs: Array.isArray(step.inputs) ? [...step.inputs] : [],
      outputs: Array.isArray(step.outputs) ? [...step.outputs] : [],
      ai_involvement: {
        ai_role: step.ai_involvement?.ai_role || '',
        reliance_level: step.ai_involvement?.reliance_level || 'low',
        ...unknownAi
      },
      human_oversight: {
        responsible_role: step.human_oversight?.responsible_role || '',
        oversight_level: step.human_oversight?.oversight_level || 'none',
        intervention_points: step.human_oversight?.intervention_points || '',
        ...unknownOversight
      },
      risks: {
        bias_risk: step.risks?.bias_risk || '',
        operational_risk: step.risks?.operational_risk || '',
        ethical_risk: step.risks?.ethical_risk || '',
        privacy_risk: step.risks?.privacy_risk || '',
        mitigation: step.risks?.mitigation || '',
        ...unknownRisks
      },
      controls: {
        approval_required: Boolean(step.controls?.approval_required),
        escalation_path: step.controls?.escalation_path || '',
        review_cycle: step.controls?.review_cycle || '',
        ...unknownControls
      },
      ...unknownStepProps
    };
  });

  const reflectionSource = store.reflection || {};
  const unknownReflection = extractUnknownProperties(reflectionSource, [
    'failure_modes',
    'essential_judgement',
    'over_reliance_risks',
    'embedded_assumptions'
  ]);

  const schemaReflection = {
    failure_modes: reflectionSource.failure_modes || '',
    essential_judgement: reflectionSource.essential_judgement || '',
    over_reliance_risks: reflectionSource.over_reliance_risks || '',
    embedded_assumptions: reflectionSource.embedded_assumptions || '',
    ...unknownReflection
  };

  const completeness = calculateCompleteness(store);
  const dependency = calculateAIDependency(store);

  const unknownRoot = extractUnknownProperties(store, [
    'metadata',
    'steps',
    'reflection',
    'governance_metrics',
    'design_time_metrics',
    '$schema'
  ]);

  return {
    $schema: (store as any).$schema || SCHEMA_DRAFT_URL,
    metadata: schemaMetadata,
    steps: schemaSteps,
    reflection: schemaReflection,
    governance_metrics: {
      completeness_score: completeness,
      ai_dependency_score: dependency
    },
    design_time_metrics: {
      _disclaimer:
        'These metrics are indicative design-time markers and must be recalculated by downstream authoritative audit tools (e.g. AI Governance Risk Scanner).',
      completeness_score: completeness,
      ai_dependency_score: dependency
    },
    ...unknownRoot
  };
}

/**
 * Maps a schema-compliant or legacy internal-storage JSON structure into an internal WorkflowStore.
 * Normalizes field names while preserving IDs, user inputs, and unknown meaningful fields.
 */
export function mapSchemaToStore(raw: any): WorkflowStore {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid workflow object: root must be a non-null object');
  }

  const rawMetadata = raw.metadata || {};
  const unknownMetadata = extractUnknownProperties(rawMetadata, [
    'workflow_id',
    'id',
    'workflow_title',
    'title',
    'workflow_owner',
    'owner',
    'capability_notes',
    'capabilityNotes',
    'governance_notes',
    'governanceNotes',
    'version',
    'created_at',
    'organisation',
    'purpose',
    'domain'
  ]);

  const storeMetadata: WorkflowMetadata = {
    id: String(rawMetadata.workflow_id ?? rawMetadata.id ?? generateUUID()),
    title: String(rawMetadata.workflow_title ?? rawMetadata.title ?? ''),
    version: String(rawMetadata.version || SCHEMA_VERSION),
    created_at: String(rawMetadata.created_at || new Date().toISOString()),
    owner: String(rawMetadata.workflow_owner ?? rawMetadata.owner ?? ''),
    organisation: String(rawMetadata.organisation || ''),
    purpose: String(rawMetadata.purpose || ''),
    domain: String(rawMetadata.domain || 'education'),
    capabilityNotes: String(rawMetadata.capability_notes ?? rawMetadata.capabilityNotes ?? ''),
    governanceNotes: String(rawMetadata.governance_notes ?? rawMetadata.governanceNotes ?? ''),
    ...unknownMetadata
  };

  const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
  const storeSteps: WorkflowStep[] = rawSteps.map((step: any) => {
    if (!step || typeof step !== 'object') {
      return {
        id: generateUUID(),
        name: 'Untitled Step',
        type: 'human-only',
        description: '',
        inputs: [],
        outputs: [],
        ai_involvement: { ai_role: '', reliance_level: 'low' },
        human_oversight: { responsible_role: '', oversight_level: 'none', intervention_points: '' },
        risks: { bias_risk: '', operational_risk: '', ethical_risk: '', privacy_risk: '', mitigation: '' },
        controls: { approval_required: false, escalation_path: '', review_cycle: '' }
      };
    }

    const unknownStepProps = extractUnknownProperties(step, [
      'step_id',
      'id',
      'step_name',
      'name',
      'step_type',
      'type',
      'description',
      'inputs',
      'outputs',
      'ai_involvement',
      'human_oversight',
      'risks',
      'controls'
    ]);

    const stepTypeRaw = step.step_type ?? step.type;
    const validStepTypes: StepType[] = ['human-only', 'ai-supported', 'ai-generated', 'decision-point'];
    const resolvedType: StepType = validStepTypes.includes(stepTypeRaw) ? stepTypeRaw : 'human-only';

    const aiInvolvementRaw = step.ai_involvement || {};
    const validReliance: RelianceLevel[] = ['low', 'medium', 'high', 'critical'];
    const resolvedReliance: RelianceLevel = validReliance.includes(aiInvolvementRaw.reliance_level)
      ? aiInvolvementRaw.reliance_level
      : 'low';
    const unknownAi = extractUnknownProperties(aiInvolvementRaw, ['ai_role', 'reliance_level']);

    const oversightRaw = step.human_oversight || {};
    const validOversight: OversightLevel[] = ['none', 'minimal', 'active', 'full'];
    const resolvedOversight: OversightLevel = validOversight.includes(oversightRaw.oversight_level)
      ? oversightRaw.oversight_level
      : 'none';
    const unknownOversight = extractUnknownProperties(oversightRaw, [
      'responsible_role',
      'oversight_level',
      'intervention_points'
    ]);

    const risksRaw = step.risks || {};
    const unknownRisks = extractUnknownProperties(risksRaw, [
      'bias_risk',
      'operational_risk',
      'ethical_risk',
      'privacy_risk',
      'mitigation'
    ]);

    const controlsRaw = step.controls || {};
    const unknownControls = extractUnknownProperties(controlsRaw, [
      'approval_required',
      'escalation_path',
      'review_cycle'
    ]);

    return {
      id: String(step.step_id ?? step.id ?? generateUUID()),
      name: String(step.step_name ?? step.name ?? ''),
      type: resolvedType,
      description: String(step.description || ''),
      inputs: Array.isArray(step.inputs) ? step.inputs.map(String) : [],
      outputs: Array.isArray(step.outputs) ? step.outputs.map(String) : [],
      ai_involvement: {
        ai_role: String(aiInvolvementRaw.ai_role || ''),
        reliance_level: resolvedReliance,
        ...unknownAi
      },
      human_oversight: {
        responsible_role: String(oversightRaw.responsible_role || ''),
        oversight_level: resolvedOversight,
        intervention_points: String(oversightRaw.intervention_points || ''),
        ...unknownOversight
      },
      risks: {
        bias_risk: String(risksRaw.bias_risk || ''),
        operational_risk: String(risksRaw.operational_risk || ''),
        ethical_risk: String(risksRaw.ethical_risk || ''),
        privacy_risk: String(risksRaw.privacy_risk || ''),
        mitigation: String(risksRaw.mitigation || ''),
        ...unknownRisks
      },
      controls: {
        approval_required: Boolean(controlsRaw.approval_required),
        escalation_path: String(controlsRaw.escalation_path || ''),
        review_cycle: String(controlsRaw.review_cycle || ''),
        ...unknownControls
      },
      ...unknownStepProps
    };
  });

  const rawReflection = raw.reflection || {};
  const unknownReflection = extractUnknownProperties(rawReflection, [
    'failure_modes',
    'essential_judgement',
    'over_reliance_risks',
    'embedded_assumptions'
  ]);

  const storeReflection: Reflection = {
    failure_modes: String(rawReflection.failure_modes || ''),
    essential_judgement: String(rawReflection.essential_judgement || ''),
    over_reliance_risks: String(rawReflection.over_reliance_risks || ''),
    embedded_assumptions: String(rawReflection.embedded_assumptions || ''),
    ...unknownReflection
  };

  const unknownRoot = extractUnknownProperties(raw, [
    'metadata',
    'steps',
    'reflection',
    'governance_metrics',
    'design_time_metrics',
    '$schema'
  ]);

  return {
    metadata: storeMetadata,
    steps: storeSteps,
    reflection: storeReflection,
    ...unknownRoot
  };
}

/**
 * Validates a workflow JSON string or object against WORKFLOW_SCHEMA.json rules.
 * Supports both valid exported JSON and legacy internal-storage records.
 * Rejects invalid or malicious structures before state or storage can be mutated.
 */
export function validateWorkflowImport(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let data: any = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (e: any) {
      return {
        valid: false,
        errors: [`Malformed JSON: ${e?.message || 'Syntax error'}`],
        warnings: []
      };
    }
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {
      valid: false,
      errors: ['Invalid root format: JSON payload must be an object'],
      warnings: []
    };
  }

  // Schema-version and compatibility checks
  if (data.$schema !== undefined) {
    if (typeof data.$schema !== 'string') {
      errors.push('$schema field must be a valid URI string');
    } else if (
      !data.$schema.includes('json-schema.org') &&
      !data.$schema.includes('cloudpedagogy')
    ) {
      warnings.push(`Non-standard $schema URI: ${data.$schema}. Compatibility cannot be guaranteed.`);
    }
  }

  // Metadata validation
  if (!data.metadata || typeof data.metadata !== 'object' || Array.isArray(data.metadata)) {
    errors.push('Missing required "metadata" object');
  } else {
    const meta = data.metadata;
    const title = meta.workflow_title ?? meta.title;
    const owner = meta.workflow_owner ?? meta.owner;
    const purpose = meta.purpose;

    if (!title || typeof title !== 'string' || title.trim() === '') {
      errors.push('Metadata error: missing or empty workflow title ("workflow_title" or "title")');
    }
    if (!owner || typeof owner !== 'string' || owner.trim() === '') {
      errors.push('Metadata error: missing or empty workflow owner ("workflow_owner" or "owner")');
    }
    if (!purpose || typeof purpose !== 'string' || purpose.trim() === '') {
      errors.push('Metadata error: missing or empty purpose');
    }

    if (meta.version !== undefined && typeof meta.version !== 'string') {
      errors.push('Metadata error: "version" must be a string');
    }
    if (meta.created_at !== undefined && typeof meta.created_at !== 'string') {
      errors.push('Metadata error: "created_at" must be a string');
    }
  }

  // Steps validation
  if (data.steps === undefined) {
    errors.push('Missing required "steps" array');
  } else if (!Array.isArray(data.steps)) {
    errors.push('"steps" must be an array');
  } else {
    data.steps.forEach((step: any, index: number) => {
      const stepLabel = `Step ${index + 1}`;
      if (!step || typeof step !== 'object' || Array.isArray(step)) {
        errors.push(`${stepLabel}: step entry must be an object`);
        return;
      }

      const name = step.step_name ?? step.name;
      if (!name || typeof name !== 'string' || name.trim() === '') {
        errors.push(`${stepLabel}: missing or empty step name ("step_name" or "name")`);
      }

      const type = step.step_type ?? step.type;
      const validTypes = ['human-only', 'ai-supported', 'ai-generated', 'decision-point'];
      if (!type || typeof type !== 'string' || !validTypes.includes(type)) {
        errors.push(
          `${stepLabel}: invalid step type "${type}". Must be one of: ${validTypes.join(', ')}`
        );
      }

      if (step.inputs !== undefined && !Array.isArray(step.inputs)) {
        errors.push(`${stepLabel}: "inputs" must be an array of strings`);
      }
      if (step.outputs !== undefined && !Array.isArray(step.outputs)) {
        errors.push(`${stepLabel}: "outputs" must be an array of strings`);
      }

      if (step.ai_involvement !== undefined) {
        if (typeof step.ai_involvement !== 'object' || Array.isArray(step.ai_involvement)) {
          errors.push(`${stepLabel}: "ai_involvement" must be an object`);
        } else {
          const reliance = step.ai_involvement.reliance_level;
          const validReliance = ['low', 'medium', 'high', 'critical'];
          if (reliance !== undefined && !validReliance.includes(reliance)) {
            errors.push(
              `${stepLabel}: invalid reliance_level "${reliance}". Must be one of: ${validReliance.join(', ')}`
            );
          }
        }
      }

      if (step.human_oversight !== undefined) {
        if (typeof step.human_oversight !== 'object' || Array.isArray(step.human_oversight)) {
          errors.push(`${stepLabel}: "human_oversight" must be an object`);
        } else {
          const oversight = step.human_oversight.oversight_level;
          const validOversight = ['none', 'minimal', 'active', 'full'];
          if (oversight !== undefined && !validOversight.includes(oversight)) {
            errors.push(
              `${stepLabel}: invalid oversight_level "${oversight}". Must be one of: ${validOversight.join(', ')}`
            );
          }
        }
      }

      if (step.controls !== undefined) {
        if (typeof step.controls !== 'object' || Array.isArray(step.controls)) {
          errors.push(`${stepLabel}: "controls" must be an object`);
        } else if (
          step.controls.approval_required !== undefined &&
          typeof step.controls.approval_required !== 'boolean'
        ) {
          errors.push(`${stepLabel}: "controls.approval_required" must be a boolean`);
        }
      }

      if (step.risks !== undefined) {
        if (typeof step.risks !== 'object' || Array.isArray(step.risks)) {
          errors.push(`${stepLabel}: "risks" must be an object`);
        }
      }
    });
  }

  // Reflection validation if present
  if (
    data.reflection !== undefined &&
    (typeof data.reflection !== 'object' || Array.isArray(data.reflection))
  ) {
    errors.push('"reflection" must be an object if provided');
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      warnings
    };
  }

  const isSchemaFormat = Boolean(
    data.metadata?.workflow_title || (data.steps?.[0] && 'step_name' in data.steps[0])
  );
  const store = mapSchemaToStore(data);

  return {
    valid: true,
    errors: [],
    warnings,
    store,
    detectedFormat: isSchemaFormat ? 'schema' : 'legacy_store'
  };
}
