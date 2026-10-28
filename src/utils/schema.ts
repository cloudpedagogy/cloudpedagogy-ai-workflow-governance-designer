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
export const REGISTRY_VERSION = '1.0.0';
export const REGISTRY_FORMAT = 'cloudpedagogy_workflow_registry';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  store?: WorkflowStore;
  detectedFormat?: 'schema' | 'legacy_store';
}

export interface ValidationOptions {
  allowDraft?: boolean;
}

export interface WorkflowRegistry {
  format: string;
  registry_version: string;
  updated_at: string;
  active_workflow_id: string;
  workflow_order: string[];
  workflows: Record<string, WorkflowStore>;
}

export interface RegistryValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  registry?: WorkflowRegistry;
}

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(val: unknown): val is Record<string, any> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function safeString(val: unknown, fallback: string = ''): string {
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return fallback;
}

function sanitizeExtensionValue(val: unknown): any {
  if (Array.isArray(val)) {
    return val.map(item => sanitizeExtensionValue(item));
  }
  if (isPlainObject(val)) {
    const clean: Record<string, any> = {};
    for (const key of Object.keys(val)) {
      if (!DANGEROUS_KEYS.has(key) && Object.prototype.hasOwnProperty.call(val, key)) {
        clean[key] = sanitizeExtensionValue(val[key]);
      }
    }
    return clean;
  }
  return val;
}

function extractUnknownProperties(
  source: Record<string, any> | undefined,
  knownKeys: string[]
): Record<string, any> {
  if (!isPlainObject(source)) return {};
  const knownSet = new Set(knownKeys);
  const unknown: Record<string, any> = {};
  for (const key of Object.keys(source)) {
    if (
      !knownSet.has(key) &&
      !DANGEROUS_KEYS.has(key) &&
      Object.prototype.hasOwnProperty.call(source, key)
    ) {
      unknown[key] = sanitizeExtensionValue(source[key]);
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
      inputs: Array.isArray(step.inputs)
        ? step.inputs.map(s => safeString(s).trim()).filter(s => s.length > 0)
        : [],
      outputs: Array.isArray(step.outputs)
        ? step.outputs.map(s => safeString(s).trim()).filter(s => s.length > 0)
        : [],
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
  if (!isPlainObject(raw)) {
    throw new Error('Invalid workflow object: root must be a non-null object');
  }

  const rawMetadata = isPlainObject(raw.metadata) ? raw.metadata : {};
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
    id: safeString(rawMetadata.workflow_id ?? rawMetadata.id, generateUUID()) || generateUUID(),
    title: safeString(rawMetadata.workflow_title ?? rawMetadata.title, ''),
    version: safeString(rawMetadata.version, SCHEMA_VERSION) || SCHEMA_VERSION,
    created_at: safeString(rawMetadata.created_at, new Date().toISOString()) || new Date().toISOString(),
    owner: safeString(rawMetadata.workflow_owner ?? rawMetadata.owner, ''),
    organisation: safeString(rawMetadata.organisation, ''),
    purpose: safeString(rawMetadata.purpose, ''),
    domain: safeString(rawMetadata.domain, 'education') || 'education',
    capabilityNotes: safeString(rawMetadata.capability_notes ?? rawMetadata.capabilityNotes, ''),
    governanceNotes: safeString(rawMetadata.governance_notes ?? rawMetadata.governanceNotes, ''),
    ...unknownMetadata
  };

  const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
  const storeSteps: WorkflowStep[] = rawSteps.map((step: any) => {
    if (!isPlainObject(step)) {
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

    const aiInvolvementRaw = isPlainObject(step.ai_involvement) ? step.ai_involvement : {};
    const validReliance: RelianceLevel[] = ['low', 'medium', 'high', 'critical'];
    const resolvedReliance: RelianceLevel = validReliance.includes(aiInvolvementRaw.reliance_level)
      ? aiInvolvementRaw.reliance_level
      : 'low';
    const unknownAi = extractUnknownProperties(aiInvolvementRaw, ['ai_role', 'reliance_level']);

    const oversightRaw = isPlainObject(step.human_oversight) ? step.human_oversight : {};
    const validOversight: OversightLevel[] = ['none', 'minimal', 'active', 'full'];
    const resolvedOversight: OversightLevel = validOversight.includes(oversightRaw.oversight_level)
      ? oversightRaw.oversight_level
      : 'none';
    const unknownOversight = extractUnknownProperties(oversightRaw, [
      'responsible_role',
      'oversight_level',
      'intervention_points'
    ]);

    const risksRaw = isPlainObject(step.risks) ? step.risks : {};
    const unknownRisks = extractUnknownProperties(risksRaw, [
      'bias_risk',
      'operational_risk',
      'ethical_risk',
      'privacy_risk',
      'mitigation'
    ]);

    const controlsRaw = isPlainObject(step.controls) ? step.controls : {};
    const unknownControls = extractUnknownProperties(controlsRaw, [
      'approval_required',
      'escalation_path',
      'review_cycle'
    ]);

    return {
      id: safeString(step.step_id ?? step.id, generateUUID()) || generateUUID(),
      name: safeString(step.step_name ?? step.name, ''),
      type: resolvedType,
      description: safeString(step.description, ''),
      inputs: Array.isArray(step.inputs)
        ? step.inputs
            .filter((v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
            .map((v: unknown) => safeString(v).trim())
            .filter((s: string) => s.length > 0)
        : [],
      outputs: Array.isArray(step.outputs)
        ? step.outputs
            .filter((v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
            .map((v: unknown) => safeString(v).trim())
            .filter((s: string) => s.length > 0)
        : [],
      ai_involvement: {
        ai_role: safeString(aiInvolvementRaw.ai_role, ''),
        reliance_level: resolvedReliance,
        ...unknownAi
      },
      human_oversight: {
        responsible_role: safeString(oversightRaw.responsible_role, ''),
        oversight_level: resolvedOversight,
        intervention_points: safeString(oversightRaw.intervention_points, ''),
        ...unknownOversight
      },
      risks: {
        bias_risk: safeString(risksRaw.bias_risk, ''),
        operational_risk: safeString(risksRaw.operational_risk, ''),
        ethical_risk: safeString(risksRaw.ethical_risk, ''),
        privacy_risk: safeString(risksRaw.privacy_risk, ''),
        mitigation: safeString(risksRaw.mitigation, ''),
        ...unknownRisks
      },
      controls: {
        approval_required: Boolean(controlsRaw.approval_required),
        escalation_path: safeString(controlsRaw.escalation_path, ''),
        review_cycle: safeString(controlsRaw.review_cycle, ''),
        ...unknownControls
      },
      ...unknownStepProps
    };
  });

  const rawReflection = isPlainObject(raw.reflection) ? raw.reflection : {};
  const unknownReflection = extractUnknownProperties(rawReflection, [
    'failure_modes',
    'essential_judgement',
    'over_reliance_risks',
    'embedded_assumptions'
  ]);

  const storeReflection: Reflection = {
    failure_modes: safeString(rawReflection.failure_modes, ''),
    essential_judgement: safeString(rawReflection.essential_judgement, ''),
    over_reliance_risks: safeString(rawReflection.over_reliance_risks, ''),
    embedded_assumptions: safeString(rawReflection.embedded_assumptions, ''),
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
 * When options.allowDraft is true, allows incomplete working-draft strings (title, owner, purpose, step_name)
 * while still enforcing strict structural and type safety.
 */
export function validateWorkflowImport(
  input: unknown,
  options: ValidationOptions = {}
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const allowDraft = Boolean(options.allowDraft);

  try {
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

    if (!isPlainObject(data)) {
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
    if (!isPlainObject(data.metadata)) {
      errors.push('Missing required "metadata" object');
    } else {
      const meta = data.metadata;
      const title = meta.workflow_title ?? meta.title;
      const owner = meta.workflow_owner ?? meta.owner;
      const purpose = meta.purpose;

      if (meta.workflow_title !== undefined && typeof meta.workflow_title !== 'string') {
        errors.push('Metadata error: "workflow_title" must be a string');
      }
      if (meta.title !== undefined && typeof meta.title !== 'string') {
        errors.push('Metadata error: "title" must be a string');
      }
      if (meta.workflow_owner !== undefined && typeof meta.workflow_owner !== 'string') {
        errors.push('Metadata error: "workflow_owner" must be a string');
      }
      if (meta.owner !== undefined && typeof meta.owner !== 'string') {
        errors.push('Metadata error: "owner" must be a string');
      }
      if (meta.purpose !== undefined && typeof meta.purpose !== 'string') {
        errors.push('Metadata error: "purpose" must be a string');
      }

      if (!allowDraft) {
        if (!title || typeof title !== 'string' || title.trim() === '') {
          errors.push('Metadata error: missing or empty workflow title ("workflow_title" or "title")');
        }
        if (!owner || typeof owner !== 'string' || owner.trim() === '') {
          errors.push('Metadata error: missing or empty workflow owner ("workflow_owner" or "owner")');
        }
        if (!purpose || typeof purpose !== 'string' || purpose.trim() === '') {
          errors.push('Metadata error: missing or empty purpose');
        }
      }

      const optionalMetaStringFields = [
        'workflow_id',
        'id',
        'version',
        'created_at',
        'organisation',
        'domain',
        'capability_notes',
        'capabilityNotes',
        'governance_notes',
        'governanceNotes'
      ];
      for (const field of optionalMetaStringFields) {
        if (meta[field] !== undefined && typeof meta[field] !== 'string') {
          errors.push(`Metadata error: "${field}" must be a string`);
        }
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
        if (!isPlainObject(step)) {
          errors.push(`${stepLabel}: step entry must be an object`);
          return;
        }

        if (step.step_id !== undefined && typeof step.step_id !== 'string') {
          errors.push(`${stepLabel}: "step_id" must be a string`);
        }
        if (step.id !== undefined && typeof step.id !== 'string') {
          errors.push(`${stepLabel}: "id" must be a string`);
        }
        if (step.step_name !== undefined && typeof step.step_name !== 'string') {
          errors.push(`${stepLabel}: "step_name" must be a string`);
        }
        if (step.name !== undefined && typeof step.name !== 'string') {
          errors.push(`${stepLabel}: "name" must be a string`);
        }

        const name = step.step_name ?? step.name;
        if (!allowDraft && (!name || typeof name !== 'string' || name.trim() === '')) {
          errors.push(`${stepLabel}: missing or empty step name ("step_name" or "name")`);
        }

        const type = step.step_type ?? step.type;
        const validTypes = ['human-only', 'ai-supported', 'ai-generated', 'decision-point'];
        if (!type || typeof type !== 'string' || !validTypes.includes(type)) {
          errors.push(
            `${stepLabel}: invalid step type "${safeString(type, 'invalid')}". Must be one of: ${validTypes.join(', ')}`
          );
        }

        if (step.description !== undefined && typeof step.description !== 'string') {
          errors.push(`${stepLabel}: "description" must be a string`);
        }

        if (step.inputs !== undefined) {
          if (!Array.isArray(step.inputs) || !step.inputs.every((item: unknown) => typeof item === 'string')) {
            errors.push(`${stepLabel}: "inputs" must be an array of strings`);
          }
        }
        if (step.outputs !== undefined) {
          if (!Array.isArray(step.outputs) || !step.outputs.every((item: unknown) => typeof item === 'string')) {
            errors.push(`${stepLabel}: "outputs" must be an array of strings`);
          }
        }

        if (step.ai_involvement !== undefined) {
          if (!isPlainObject(step.ai_involvement)) {
            errors.push(`${stepLabel}: "ai_involvement" must be an object`);
          } else {
            if (
              step.ai_involvement.ai_role !== undefined &&
              typeof step.ai_involvement.ai_role !== 'string'
            ) {
              errors.push(`${stepLabel}: "ai_involvement.ai_role" must be a string`);
            }
            const reliance = step.ai_involvement.reliance_level;
            const validReliance = ['low', 'medium', 'high', 'critical'];
            if (
              reliance !== undefined &&
              (typeof reliance !== 'string' || !validReliance.includes(reliance))
            ) {
              errors.push(
                `${stepLabel}: invalid reliance_level "${safeString(reliance, 'invalid')}". Must be one of: ${validReliance.join(', ')}`
              );
            }
          }
        }

        if (step.human_oversight !== undefined) {
          if (!isPlainObject(step.human_oversight)) {
            errors.push(`${stepLabel}: "human_oversight" must be an object`);
          } else {
            if (
              step.human_oversight.responsible_role !== undefined &&
              typeof step.human_oversight.responsible_role !== 'string'
            ) {
              errors.push(`${stepLabel}: "human_oversight.responsible_role" must be a string`);
            }
            if (
              step.human_oversight.intervention_points !== undefined &&
              typeof step.human_oversight.intervention_points !== 'string'
            ) {
              errors.push(`${stepLabel}: "human_oversight.intervention_points" must be a string`);
            }
            const oversight = step.human_oversight.oversight_level;
            const validOversight = ['none', 'minimal', 'active', 'full'];
            if (
              oversight !== undefined &&
              (typeof oversight !== 'string' || !validOversight.includes(oversight))
            ) {
              errors.push(
                `${stepLabel}: invalid oversight_level "${safeString(oversight, 'invalid')}". Must be one of: ${validOversight.join(', ')}`
              );
            }
          }
        }

        if (step.controls !== undefined) {
          if (!isPlainObject(step.controls)) {
            errors.push(`${stepLabel}: "controls" must be an object`);
          } else {
            if (
              step.controls.approval_required !== undefined &&
              typeof step.controls.approval_required !== 'boolean'
            ) {
              errors.push(`${stepLabel}: "controls.approval_required" must be a boolean`);
            }
            if (
              step.controls.escalation_path !== undefined &&
              typeof step.controls.escalation_path !== 'string'
            ) {
              errors.push(`${stepLabel}: "controls.escalation_path" must be a string`);
            }
            if (
              step.controls.review_cycle !== undefined &&
              typeof step.controls.review_cycle !== 'string'
            ) {
              errors.push(`${stepLabel}: "controls.review_cycle" must be a string`);
            }
          }
        }

        if (step.risks !== undefined) {
          if (!isPlainObject(step.risks)) {
            errors.push(`${stepLabel}: "risks" must be an object`);
          } else {
            const riskFields = [
              'bias_risk',
              'operational_risk',
              'ethical_risk',
              'privacy_risk',
              'mitigation'
            ];
            for (const rf of riskFields) {
              if (step.risks[rf] !== undefined && typeof step.risks[rf] !== 'string') {
                errors.push(`${stepLabel}: "risks.${rf}" must be a string`);
              }
            }
          }
        }
      });
    }

    // Reflection validation if present
    if (data.reflection !== undefined) {
      if (!isPlainObject(data.reflection)) {
        errors.push('"reflection" must be an object if provided');
      } else {
        const reflectionFields = [
          'failure_modes',
          'essential_judgement',
          'over_reliance_risks',
          'embedded_assumptions'
        ];
        for (const rf of reflectionFields) {
          if (data.reflection[rf] !== undefined && typeof data.reflection[rf] !== 'string') {
            errors.push(`Reflection error: "${rf}" must be a string`);
          }
        }
      }
    }

    if (errors.length > 0) {
      return {
        valid: false,
        errors,
        warnings
      };
    }

    const isSchemaFormat = Boolean(
      'workflow_title' in (data.metadata || {}) ||
        'workflow_id' in (data.metadata || {}) ||
        (data.steps?.[0] && isPlainObject(data.steps[0]) && 'step_name' in data.steps[0])
    );
    const store = mapSchemaToStore(data);

    return {
      valid: true,
      errors: [],
      warnings,
      store,
      detectedFormat: isSchemaFormat ? 'schema' : 'legacy_store'
    };
  } catch (e: any) {
    return {
      valid: false,
      errors: [`Unexpected validation error: ${e?.message || 'Invalid workflow structure'}`],
      warnings
    };
  }
}

/**
 * Validates a working draft (stored in localStorage or exported as a draft recovery file).
 * Allows incomplete titles, owners, purposes, and step names while enforcing structural and type safety.
 */
export function validateWorkflowDraft(input: unknown): ValidationResult {
  return validateWorkflowImport(input, { allowDraft: true });
}

/**
 * Serializes a WorkflowRegistry into a schema-aware full-registry backup payload,
 * preserving workflow IDs, step IDs, drafts, and unknown extension properties.
 */
export function mapRegistryToExportPayload(registry: WorkflowRegistry): Record<string, any> {
  const exportedWorkflows: Record<string, any> = {};
  const order = Array.isArray(registry.workflow_order) ? [...registry.workflow_order] : [];

  for (const [id, wf] of Object.entries(registry.workflows || {})) {
    if (!DANGEROUS_KEYS.has(id) && wf) {
      const copy: WorkflowStore = JSON.parse(JSON.stringify(wf));
      if (!copy.metadata) {
        (copy as any).metadata = { id };
      } else if (!copy.metadata.id) {
        copy.metadata.id = id;
      }
      exportedWorkflows[id] = mapStoreToSchema(copy);
      if (!order.includes(id)) {
        order.push(id);
      }
    }
  }

  return {
    format: REGISTRY_FORMAT,
    registry_version: registry.registry_version || REGISTRY_VERSION,
    updated_at: registry.updated_at || new Date().toISOString(),
    active_workflow_id:
      registry.active_workflow_id && exportedWorkflows[registry.active_workflow_id]
        ? registry.active_workflow_id
        : order[0] || '',
    workflow_order: order.filter(id => Boolean(exportedWorkflows[id])),
    workflows: exportedWorkflows
  };
}

/**
 * Validates a full-registry JSON string or object for local storage or registry backup import.
 * Rejects malformed or incompatible registry payloads before any state mutation.
 */
export function validateRegistryImport(input: unknown): RegistryValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    let data: any = input;
    if (typeof input === 'string') {
      try {
        data = JSON.parse(input);
      } catch (e: any) {
        return {
          valid: false,
          errors: [`Malformed Registry JSON: ${e?.message || 'Syntax error'}`],
          warnings: []
        };
      }
    }

    if (!isPlainObject(data)) {
      return {
        valid: false,
        errors: ['Invalid registry payload: root must be a JSON object'],
        warnings: []
      };
    }

    if (data.format !== undefined) {
      if (typeof data.format !== 'string' || data.format !== REGISTRY_FORMAT) {
        errors.push(
          `Incompatible registry format: expected "${REGISTRY_FORMAT}", received "${safeString(data.format, 'invalid')}"`
        );
      }
    }

    if (
      data.registry_version === undefined ||
      typeof data.registry_version !== 'string' ||
      data.registry_version.trim() === ''
    ) {
      errors.push('Missing or invalid "registry_version" string');
    } else if (!data.registry_version.startsWith('1.')) {
      warnings.push(
        `Registry version "${data.registry_version}" differs from expected version "${REGISTRY_VERSION}".`
      );
    }

    if (!isPlainObject(data.workflows)) {
      errors.push('Missing or invalid "workflows" object map');
    }

    if (data.workflow_order !== undefined) {
      if (
        !Array.isArray(data.workflow_order) ||
        !data.workflow_order.every((id: unknown) => typeof id === 'string' && id.trim() !== '')
      ) {
        errors.push('"workflow_order" must be an array of non-empty workflow ID strings');
      }
    }

    if (data.active_workflow_id !== undefined && typeof data.active_workflow_id !== 'string') {
      errors.push('"active_workflow_id" must be a string');
    }

    const validatedWorkflows: Record<string, WorkflowStore> = {};
    if (isPlainObject(data.workflows)) {
      const entries = Object.entries(data.workflows).filter(
        ([key]) => !DANGEROUS_KEYS.has(key) && Object.prototype.hasOwnProperty.call(data.workflows, key)
      );

      if (entries.length === 0) {
        errors.push('Registry must contain at least one workflow in "workflows"');
      }

      for (const [key, rawWf] of entries) {
        if (!key || key.trim() === '') {
          errors.push('Workflow registry contains an empty workflow key');
          continue;
        }
        const wfResult = validateWorkflowDraft(rawWf);
        if (!wfResult.valid || !wfResult.store) {
          errors.push(`Workflow "${key}": ${wfResult.errors.join('; ')}`);
          continue;
        }
        const store = wfResult.store;
        // Preserve explicit workflow ID from metadata or key
        const rawMeta = isPlainObject((rawWf as any)?.metadata) ? (rawWf as any).metadata : {};
        const explicitId = safeString(rawMeta.workflow_id ?? rawMeta.id, key) || key;
        store.metadata.id = explicitId;
        validatedWorkflows[explicitId] = store;
        if (wfResult.warnings.length > 0) {
          warnings.push(...wfResult.warnings.map(w => `Workflow "${explicitId}": ${w}`));
        }
      }
    }

    if (errors.length > 0) {
      return {
        valid: false,
        errors,
        warnings
      };
    }

    const validIds = Object.keys(validatedWorkflows);
    const rawOrder: string[] = Array.isArray(data.workflow_order) ? data.workflow_order : [];
    const normalizedOrder: string[] = [];

    for (const id of rawOrder) {
      if (validatedWorkflows[id] && !normalizedOrder.includes(id)) {
        normalizedOrder.push(id);
      }
    }
    for (const id of validIds) {
      if (!normalizedOrder.includes(id)) {
        normalizedOrder.push(id);
      }
    }

    const requestedActiveId = safeString(data.active_workflow_id, '');
    const resolvedActiveId =
      requestedActiveId && validatedWorkflows[requestedActiveId]
        ? requestedActiveId
        : normalizedOrder[0];

    const registry: WorkflowRegistry = {
      format: REGISTRY_FORMAT,
      registry_version: safeString(data.registry_version, REGISTRY_VERSION) || REGISTRY_VERSION,
      updated_at: safeString(data.updated_at, new Date().toISOString()) || new Date().toISOString(),
      active_workflow_id: resolvedActiveId,
      workflow_order: normalizedOrder,
      workflows: validatedWorkflows
    };

    return {
      valid: true,
      errors: [],
      warnings,
      registry
    };
  } catch (e: any) {
    return {
      valid: false,
      errors: [`Unexpected registry validation error: ${e?.message || 'Invalid registry structure'}`],
      warnings
    };
  }
}
