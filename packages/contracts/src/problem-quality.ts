import { z } from 'zod'
import { DateTimeWireSchema, defineApiEndpoint } from './http'

const EvidenceIssueSchema = z.object({ code: z.string(), message: z.string() })
const QualityEvidenceSchema = z.object({
  pinnedInputs: z.record(z.string(), z.unknown()).optional(),
  gates: z.object({
    standardReady: z.boolean().optional(), validatorReady: z.boolean().optional(), checkerReady: z.boolean().optional(),
    testSetComplete: z.boolean().optional(), classifierReady: z.boolean().optional(), corpusReady: z.boolean().optional(),
    acceptedReplayPassed: z.boolean().optional(), semanticVerification: z.string().optional(),
  }).passthrough().optional(),
  criticalIssues: z.array(EvidenceIssueSchema).optional(),
  warnings: z.array(EvidenceIssueSchema).optional(),
  scoring: z.object({
    solutionProfileAlignment: z.number().nullable().optional(),
    evaluatedSolutionProfileCount: z.number().int().nonnegative().optional(),
    solutionProfileCount: z.number().int().nonnegative().optional(),
  }).optional(),
}).passthrough()

export const TestSetQualitySnapshotSchema = z.object({
  id: z.string(), slot: z.enum(['STABLE', 'EVOLVING']), graphHash: z.string(), qualityRuleVersion: z.string(),
  correctnessScore: z.number(), discriminationScore: z.number(), coverageScore: z.number(),
  diversityScore: z.number(), subtaskQualityScore: z.number(), stabilityScore: z.number(),
  overallScore: z.number().nullable(), confidenceScore: z.number(), confidenceLevel: z.string(),
  maturityLevel: z.string(), wrongProgramCount: z.number().int().nonnegative().optional(),
  behaviorClusterCount: z.number().int().nonnegative().optional(), evaluationClusterCount: z.number().int().nonnegative().optional(),
  holdoutClusterCount: z.number().int().nonnegative().optional(), weightedKillCoverage: z.number().optional(),
  evaluationCoverage: z.number().optional(), holdoutCoverage: z.number().optional(), featureCoverage: z.number().optional(),
  criticalFeatureCoverage: z.number().optional(), realSubmissionCount: z.number().int().nonnegative().optional(),
  validHackCount: z.number().int().nonnegative().optional(), criticalIssueCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(), qualityStatus: z.string(), createdAt: DateTimeWireSchema,
  isStale: z.boolean().optional(), reasons: z.array(z.string()).optional(), evidence: QualityEvidenceSchema.optional(),

})

export const ProblemQualityAssessmentSchema = z.object({
  id: z.string(), status: z.string(), statementScore: z.number(), solutionCorrectnessScore: z.number(),
  algorithmicValueScore: z.number().nullable().optional(), difficultyDesignScore: z.number(),
  constraintDesignScore: z.number(), subtaskDesignScore: z.number(), editorialScore: z.number().nullable().optional(),
  originalityScore: z.number().nullable().optional(), automatedScore: z.number(), expertScore: z.number().nullable().optional(),
  overallScore: z.number().nullable().optional(), confidenceScore: z.number(), confidenceLevel: z.string(),
  automatedEvidence: z.record(z.string(), z.unknown()).optional(), expertEvidence: z.record(z.string(), z.unknown()).nullable().optional(),
  evaluatedAt: DateTimeWireSchema, reviewedAt: DateTimeWireSchema.nullable().optional(),
  isStale: z.boolean().optional(), staleReasons: z.array(z.string()).optional(),
})

export const ProblemQualityJobSchema = z.object({
  id: z.string(), slot: z.enum(['STABLE', 'EVOLVING']), graphHash: z.string(), corpusRevisionId: z.string(), qualityRuleVersion: z.string(),
  status: z.string(), attempts: z.number().int().nonnegative(), errorCode: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(), queuedAt: DateTimeWireSchema,
  startedAt: DateTimeWireSchema.nullable().optional(), finishedAt: DateTimeWireSchema.nullable().optional(),
})

const SubtaskScoreSchema = z.object({ subtaskId: z.number().int().positive(), min: z.number(), max: z.number() })
export const ProblemSolutionProfileSchema = z.object({
  id: z.string(), key: z.string(), name: z.string(), expectedClass: z.string(),
  expectedComplexity: z.string().nullable().optional(), expectedScoreMin: z.number(), expectedScoreMax: z.number(),
  expectedSubtaskScores: z.array(SubtaskScoreSchema), submissionId: z.number().int().positive(),
  revision: z.number().int().positive(), status: z.enum(['active', 'retired']),
  observed: z.object({
    evaluatedSlot: z.enum(['STABLE', 'EVOLVING']).nullable().optional(), evaluatedGraphHash: z.string().nullable().optional(), result: z.string().nullable().optional(), score: z.number().nullable().optional(),
    subtasks: z.array(z.object({ subtaskId: z.number().int().positive(), score: z.number() })),
  }).nullable().optional(),
})

export const ProblemQualityDashboardSchema = z.object({
  permissions: z.object({ canManage: z.boolean(), canExpertReview: z.boolean() }),
  stableTestSet: z.object({ graphHash: z.string(), fencingToken: z.number().int(), updatedAt: DateTimeWireSchema }).nullable().optional(),
  testSetQuality: TestSetQualitySnapshotSchema.nullable().optional(),
  problemQuality: ProblemQualityAssessmentSchema.nullable().optional(),
  jobs: z.array(ProblemQualityJobSchema).optional(),
  qualityHistory: z.array(TestSetQualitySnapshotSchema).optional(),
  solutionProfiles: z.array(ProblemSolutionProfileSchema).optional(),
})

export const SolutionProfileCreateInputSchema = z.object({
  key: z.string().trim().min(1).max(80), name: z.string().trim().min(1).max(200),
  expectedClass: z.string().trim().min(1).max(200), expectedComplexity: z.string().trim().max(200).nullable().optional(),
  expectedScoreMin: z.number().min(0).max(100), expectedScoreMax: z.number().min(0).max(100),
  expectedSubtaskScores: z.array(SubtaskScoreSchema), submissionId: z.number().int().positive(),
})

export const ProblemQualityContracts = {
  dashboard: defineApiEndpoint({ key: 'problem-quality.dashboard', method: 'GET', scope: 'context', data: ProblemQualityDashboardSchema }),
  requestEvaluation: defineApiEndpoint({
    key: 'problem-quality.evaluation.request', method: 'POST', scope: 'context',
    body: z.object({ slot: z.enum(['STABLE', 'EVOLVING']).default('STABLE'), corpusRevisionId: z.string().optional() }),
    data: z.object({ queued: z.boolean(), jobId: z.string(), snapshotId: z.string().optional(), status: z.string() }),
  }),
  runAutomated: defineApiEndpoint({
    key: 'problem-quality.automated.run', method: 'POST', scope: 'context', body: z.object({}), data: ProblemQualityAssessmentSchema,
  }),
  submitExpert: defineApiEndpoint({
    key: 'problem-quality.expert.submit', method: 'POST', scope: 'platform',
    body: z.object({
      algorithmicValueScore: z.number().int().min(0).max(20), editorialScore: z.number().int().min(0).max(5),
      originalityScore: z.number().int().min(0).max(5), comment: z.string().trim().min(20).max(4000),
    }), data: ProblemQualityAssessmentSchema,
  }),
  createSolutionProfile: defineApiEndpoint({
    key: 'problem-quality.solution-profile.create', method: 'POST', scope: 'context',
    body: SolutionProfileCreateInputSchema, data: ProblemSolutionProfileSchema,
  }),
  updateSolutionProfile: defineApiEndpoint({
    key: 'problem-quality.solution-profile.update', method: 'PATCH', scope: 'context',
    body: z.object({ expectedRevision: z.number().int().positive(), status: z.enum(['active', 'retired']) }),
    data: ProblemSolutionProfileSchema,
  }),
} as const

export type ProblemQualityDashboard = z.infer<typeof ProblemQualityDashboardSchema>
export type ProblemSolutionProfile = z.infer<typeof ProblemSolutionProfileSchema>
export type SolutionProfileCreateInput = z.infer<typeof SolutionProfileCreateInputSchema>
