import { z } from 'zod';

const roundSummarySchema = z.object({
  missing_required_fields: z.array(z.string()).optional().default([]),
  critical_fields_below_pass_target: z.array(z.string()).optional().default([]),
  confidence: z.number().min(0).max(1).optional().default(0),
  validated: z.boolean().optional().default(false),
  sources_identity_matched: z.number().optional().default(0),
  provenance: z.record(z.string(), z.unknown()).optional().default({}),
  fieldRules: z.record(z.string(), z.unknown()).optional().default({}),
  fieldOrder: z.array(z.string()).optional().default([]),
  fieldReasoning: z.record(z.string(), z.unknown()).optional().default({}),
  constraint_analysis: z.object({
    contradiction_count: z.number().optional()
  }).passthrough().optional().default({}),
  identityContext: z.record(z.string(), z.unknown()).optional().default({})
});

export function validateRoundSummary(summary) {
  try {
    if (summary === null || summary === undefined || typeof summary !== 'object' || Array.isArray(summary)) {
      return {
        valid: false,
        warnings: ['summary is not a plain object']
      };
    }

    const result = roundSummarySchema.safeParse(summary);

    if (result.success) {
      return { valid: true, warnings: [] };
    }

    const warnings = result.error.issues.map((issue) => {
      const path = issue.path.join('.');
      return `${path || 'root'}: ${issue.message}`;
    });

    return { valid: true, warnings };
  } catch (err) {
    return {
      valid: false,
      warnings: [`unexpected error: ${String(err?.message || err)}`]
    };
  }
}
