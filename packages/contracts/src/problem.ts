import { z } from "zod";
import { DateTimeWireSchema, PaginationQuerySchema, defineApiEndpoint } from "./http";

export const ProblemContentVersionSchema = z.object({
  id: z.string().optional(),
  format: z.enum(["markdown", "pdf"]),
  language: z.enum(["zh", "en"]).nullable(),
  content: z.string().nullable().optional(),
  fileUrl: z.string().nullable().optional(),
  isVisible: z.boolean().optional(),
}).passthrough();

export const ProblemOjBindingSchema = z.object({
  platform: z.string(),
  problemId: z.string(),
  url: z.string().optional(),
});

const ProblemEditorMutationShape = {
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  statementType: z.string().optional(),
  solutionType: z.string().optional(),
  solutionMarkdown: z.string().nullable().optional(),
  solutionVisible: z.boolean().optional(),
  difficulty: z.string().nullable().optional(),
  timeLimit: z.number().nonnegative().nullable().optional(),
  memoryLimit: z.number().nonnegative().nullable().optional(),
  visibility: z.string().optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  ojBindings: z.array(ProblemOjBindingSchema).max(3).optional(),
  statements: z.array(ProblemContentVersionSchema).optional(),
  solutions: z.array(ProblemContentVersionSchema).optional(),
};

export const ProblemCreateInputSchema = z.object(ProblemEditorMutationShape).extend({
  title: z.string().min(1),
});
export const ProblemEditorMutationSchema = z.object(ProblemEditorMutationShape);

export const ProblemEditorDetailSchema = z.object({
  id: z.string(),
  title: z.string(),
  platform: z.string().nullable().optional(),
  difficulty: z.string().nullable().optional(),
  timeLimit: z.number().nullable().optional(),
  memoryLimit: z.number().nullable().optional(),
  visibility: z.string().nullable().optional(),
  status: z.enum(["draft", "published", "archived"]),
  ojBindings: z.string().nullable().optional(),
  statements: z.array(ProblemContentVersionSchema),
  solutions: z.array(ProblemContentVersionSchema),
  permissions: z.object({ canEdit: z.boolean().optional() }).passthrough(),
}).passthrough();

export const ProblemMutationResultSchema = z.object({ id: z.string() }).passthrough();

export const ProblemAttachmentSchema = z.object({
  id: z.string(),
  problemId: z.string(),
  fileName: z.string(),
  fileSize: z.number().int().nonnegative(),
  fileUrl: z.string(),
  description: z.string().nullable(),
  uploadedAt: DateTimeWireSchema,
});

export const ProblemAdminListItemSchema = z.object({
  id: z.string(),
  problemId: z.string(),
  platform: z.string(),
  title: z.string(),
  difficulty: z.string().nullable(),
  status: z.string(),
  ojBindings: z.string().nullable(),
  ownerName: z.string().optional(),
  createdAt: DateTimeWireSchema,
}).passthrough();

export const ProblemAdminListQuerySchema = PaginationQuerySchema.extend({
  library: z.enum(["platform", "school"]).optional(),
  visibility: z.enum(["public", "private"]).optional(),
  platform: z.string().optional(),
  keyword: z.string().optional(),
  ownerId: z.string().optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  // The service owns INVALID_PROBLEM_SOURCE_GROUP and its stable 400 code.
  sourceGroup: z.string().optional(),
});

export const ProblemAdminListSchema = z.object({
  data: z.array(ProblemAdminListItemSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export const ProblemTestCasePairSchema = z.object({
  input: z.string().min(1),
  output: z.string().min(1),
  score: z.number().optional(),
});

export const ProblemJudgeSubtaskSchema = z.object({
  id: z.number().int(),
  score: z.number(),
  type: z.enum(["min", "max", "sum"]),
  if: z.array(z.number().int()).optional(),
  time: z.string().optional(),
  memory: z.string().optional(),
  cases: z.array(ProblemTestCasePairSchema).optional(),
});

const ProgramFileSchema = z.union([
  z.string(),
  z.object({ file: z.string(), lang: z.string().optional() }),
]);

export const ProblemJudgeConfigSchema = z.object({
  mode: z.enum(["acm", "oi"]).optional(),
  type: z.string().optional(),
  checker_type: z.string().optional(),
  ignore_trailing_space: z.boolean().optional(),
  filename: z.string().optional(),
  time: z.string().optional(),
  memory: z.string().optional(),
  checker: ProgramFileSchema.nullable().optional(),
  interactor: ProgramFileSchema.nullable().optional(),
  manager: ProgramFileSchema.nullable().optional(),
  num_processes: z.number().int().optional(),
  subType: z.string().optional(),
  user_extra_files: z.array(z.string()).optional(),
  judge_extra_files: z.array(z.string()).optional(),
  langs: z.array(z.string()).optional(),
  subtasks: z.array(ProblemJudgeSubtaskSchema).optional(),
});

export const ProblemJudgeSettingsSchema = z.object({
  problemType: z.string(),
  timeLimit: z.number().nullable(),
  memoryLimit: z.number().nullable(),
  config: ProblemJudgeConfigSchema.nullish(),
});

export const ProblemJudgeSettingsInputSchema = z.object({
  problemType: z.string().min(1).optional(),
  timeLimit: z.number().optional(),
  memoryLimit: z.number().optional(),
  config: ProblemJudgeConfigSchema.nullable().optional(),
});

export const ProblemSummaryAfterJudgeSaveSchema = z.object({
  id: z.string(),
  problemType: z.string(),
  timeLimit: z.number().nullable(),
  memoryLimit: z.number().nullable(),
});

export const ProblemCheckerFileSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  fileSize: z.number().int().nonnegative(),
  fileUrl: z.string(),
  uploadedAt: DateTimeWireSchema,
});

export const ProblemTestdataFileSchema = z.object({
  id: z.string(),
  filename: z.string(),
  size: z.number().int().nonnegative(),
  md5: z.string().nullable(),
  sha256: z.string().nullable().optional(),
  uploadedAt: DateTimeWireSchema,
});

export const ProblemTestdataSchema = z.object({
  files: z.array(ProblemTestdataFileSchema),
  pairs: z.array(ProblemTestCasePairSchema),
});

export const ProblemTestSetRevisionSummarySchema = z.object({
  id: z.string(),
  revisionNumber: z.number().int().positive(),
  parentRevisionId: z.string().nullable().optional(),
  mode: z.enum(["acm", "oi"]),
  source: z.string(),
  judgeConfigHash: z.string(),
  graphHash: z.string(),
  createdBy: z.string().nullable().optional(),
  hackAttemptId: z.string().nullable().optional(),
  createdAt: DateTimeWireSchema,
});

export const ProblemTestSetRevisionListSchema = z.object({
  latestTestSetRevisionId: z.string().nullable(),
  revisions: z.array(ProblemTestSetRevisionSummarySchema),
});

export const ProblemTestGraphCaseSchema = z.object({
  testcaseId: z.string(),
  input: z.string(),
  output: z.string(),
  source: z.string(),
  score: z.number().nullable().optional(),
  time: z.string().nullable().optional(),
  memory: z.string().nullable().optional(),
});

export const ProblemTestGraphGroupSchema = z.object({
  id: z.string().optional(),
  key: z.string().min(1),
  name: z.string(),
  kind: z.enum(["official", "hack_gate"]),
  score: z.number(),
  type: z.enum(["min", "max", "sum"]),
  cases: z.array(ProblemTestGraphCaseSchema),
});

export const ProblemTestGraphSubtaskSchema = z.object({
  dbId: z.string().optional(),
  id: z.number().int().positive(),
  score: z.number(),
  if: z.array(z.number().int().positive()),
  groups: z.array(ProblemTestGraphGroupSchema),
});

export const ProblemTestGraphFileSchema = z.object({
  id: z.string(),
  filename: z.string(),
  size: z.number().int().nonnegative(),
  sha256: z.string().nullable().optional(),
  uploadedAt: DateTimeWireSchema.optional(),
});

export const ProblemTestGraphPairSchema = z.object({
  inputFileId: z.string(),
  outputFileId: z.string(),
  input: z.string(),
  output: z.string(),
  testcaseId: z.string().nullable(),
});

export const ProblemTestGraphTestcaseSchema = z.object({
  id: z.string(),
  inputFileId: z.string(),
  outputFileId: z.string(),
  input: z.string(),
  output: z.string(),
  source: z.string(),
  enabled: z.boolean(),
  isProtected: z.boolean(),
  protectionReason: z.string().nullable().optional(),
  protectedUntil: DateTimeWireSchema.nullable().optional(),
  assignments: z.array(z.object({
    subtaskId: z.number().int().positive(),
    groupId: z.string(),
    groupKey: z.string(),
    groupName: z.string(),
    groupKind: z.string(),
  })),
});

export const ProblemTestGraphWorkspaceSchema = z.object({
  revision: z.number().int().nonnegative(),
  revisionId: z.string().optional(),
  source: z.string().optional(),
  createdAt: DateTimeWireSchema.optional(),
  migrated: z.boolean(),
  canMigrate: z.boolean().optional(),
  migrationIssues: z.array(z.string()).optional(),
  subtasks: z.array(ProblemTestGraphSubtaskSchema),
  files: z.array(ProblemTestGraphFileSchema),
  pairs: z.array(ProblemTestGraphPairSchema),
  unmatchedFiles: z.array(ProblemTestGraphFileSchema.pick({ id: true, filename: true, size: true })),
  testcases: z.array(ProblemTestGraphTestcaseSchema),
});

export const ProblemTestGraphSaveInputSchema = z.object({
  revision: z.number().int().nonnegative(),
  expectedLatestRevisionId: z.string().optional(),
  subtasks: z.array(ProblemTestGraphSubtaskSchema),
  overrideReason: z.string().optional(),
});

export const ProblemTestGraphPairInputSchema = z.object({
  inputFileId: z.string().min(1),
  outputFileId: z.string().min(1),
});

export const ProblemTestGraphRegisterInputSchema = z.object({
  pairs: z.array(ProblemTestGraphPairInputSchema).min(1),
});

export const ProblemTestcaseProtectionInputSchema = z.object({
  isProtected: z.boolean(),
  reason: z.string().optional(),
});

export const ProblemTestcaseProtectionResultSchema = z.object({
  id: z.string(),
  isProtected: z.boolean(),
  protectionReason: z.string().nullable().optional(),
  protectedUntil: DateTimeWireSchema.nullable().optional(),
}).passthrough();

const ProblemRevisionCaseSpecSchema = z.object({
  testcaseId: z.string().nullable().optional(),
  inputName: z.string(),
  outputName: z.string(),
  inputObjectId: z.string(),
  outputObjectId: z.string(),
  source: z.string(),
  score: z.number().nullable().optional(),
  time: z.string().nullable().optional(),
  memory: z.string().nullable().optional(),
});

export const ProblemTestSetRevisionSpecSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("acm"), cases: z.array(ProblemRevisionCaseSpecSchema) }),
  z.object({
    mode: z.literal("oi"),
    subtasks: z.array(z.object({
      id: z.number().int().positive(),
      score: z.number(),
      if: z.array(z.number().int().positive()),
      groups: z.array(z.object({
        key: z.string(),
        name: z.string(),
        kind: z.enum(["official", "hack_gate"]),
        score: z.number(),
        type: z.enum(["min", "max", "sum"]),
        cases: z.array(ProblemRevisionCaseSpecSchema),
      })),
    })),
  }),
]);

export const ProblemTestSetRevisionDetailSchema = ProblemTestSetRevisionSummarySchema.extend({
  judgeConfig: z.string(),
  spec: ProblemTestSetRevisionSpecSchema.nullable(),
}).passthrough();

export const JudgeProgramKindSchema = z.enum(["standard", "validator", "classifier", "generator"]);
export const JudgeProgramFixtureSchema = z.object({
  name: z.string(),
  stdin: z.string(),
  expectedExitCode: z.number().int().optional(),
  expectedStdout: z.string().optional(),
  expectedSubtasks: z.array(z.number().int().positive()).optional(),
});
export const JudgeProgramParameterRuleSchema = z.object({
  type: z.enum(["integer", "number", "string", "boolean"]),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  enum: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export const JudgeProgramProtocolConfigSchema = z.object({
  profiles: z.array(z.object({
    id: z.string(),
    label: z.string(),
    params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  })),
  parameterSchema: z.record(z.string(), JudgeProgramParameterRuleSchema),
});
export const JudgeProgramTemplateSummarySchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  kind: JudgeProgramKindSchema,
  language: z.string(),
  protocol: z.string(),
  title: z.string(),
  description: z.string(),
  recommended: z.boolean(),
  protocolHelp: z.array(z.string()),
  fixtureCount: z.number().int().nonnegative(),
  profileCount: z.number().int().nonnegative(),
  hasProtocolConfig: z.boolean(),
  learningNoteCount: z.number().int().nonnegative(),
  requiredChangeCount: z.number().int().nonnegative(),
});
export const JudgeProgramTemplateSchema = JudgeProgramTemplateSummarySchema.omit({
  fixtureCount: true,
  profileCount: true,
  hasProtocolConfig: true,
  learningNoteCount: true,
  requiredChangeCount: true,
}).extend({
  source: z.string(),
  examples: z.array(JudgeProgramFixtureSchema),
  protocolConfig: JudgeProgramProtocolConfigSchema.optional(),
  learningNotes: z.array(z.string()),
  requiredChanges: z.array(z.string()),
});
export const JudgeProgramCatalogSchema = z.object({
  capabilities: z.record(JudgeProgramKindSchema, z.object({
    title: z.string(),
    description: z.string(),
    defaultLanguage: z.string(),
    languages: z.record(z.string(), z.array(z.string())),
    quickProtocol: z.array(z.string()),
  })),
  templates: z.array(JudgeProgramTemplateSummarySchema),
}).passthrough();

export const ProblemJudgeModeTransitionInputSchema = z.object({
  targetMode: z.enum(["acm", "oi"]),
  expectedLatestRevisionId: z.string().min(1),
});

export const ProblemContracts = {
  listAdmin: defineApiEndpoint({
    key: "problem.admin-list.get",
    method: "GET",
    scope: "platform",
    query: ProblemAdminListQuerySchema,
    data: ProblemAdminListSchema,
  }),
  create: defineApiEndpoint({
    key: "problem.create",
    method: "POST",
    scope: "context",
    body: ProblemCreateInputSchema,
    data: ProblemMutationResultSchema,
  }),
  getEditorDetail: defineApiEndpoint({
    key: "problem.editor-detail.get",
    method: "GET",
    scope: "context",
    data: ProblemEditorDetailSchema,
  }),
  update: defineApiEndpoint({
    key: "problem.update",
    method: "PUT",
    scope: "context",
    body: ProblemEditorMutationSchema,
    data: ProblemMutationResultSchema,
  }),
  archive: defineApiEndpoint({
    key: "problem.archive",
    method: "DELETE",
    scope: "platform",
    body: z.object({}),
    data: z.object({}),
  }),
  listAttachments: defineApiEndpoint({
    key: "problem.attachments.list", method: "GET", scope: "context",
    data: z.array(ProblemAttachmentSchema),
  }),
  deleteAttachment: defineApiEndpoint({
    key: "problem.attachment.delete", method: "DELETE", scope: "context",
    body: z.object({}), data: z.object({}),
  }),
  deleteStatement: defineApiEndpoint({
    key: "problem.statement.delete", method: "DELETE", scope: "context",
    body: z.object({}), data: z.object({}),
  }),
  getJudgeSettings: defineApiEndpoint({
    key: "problem.judge-settings.get",
    method: "GET",
    scope: "context",
    data: ProblemJudgeSettingsSchema,
  }),
  saveJudgeSettings: defineApiEndpoint({
    key: "problem.judge-settings.save",
    method: "PUT",
    scope: "context",
    body: ProblemJudgeSettingsInputSchema,
    data: ProblemSummaryAfterJudgeSaveSchema,
  }),
  listCheckers: defineApiEndpoint({
    key: "problem.checkers.list",
    method: "GET",
    scope: "context",
    data: z.array(ProblemCheckerFileSchema),
  }),
  listTestdata: defineApiEndpoint({
    key: "problem.testdata.list",
    method: "GET",
    scope: "context",
    data: ProblemTestdataSchema,
  }),
  listTestSetRevisions: defineApiEndpoint({
    key: "problem.test-set-revisions.list",
    method: "GET",
    scope: "context",
    data: ProblemTestSetRevisionListSchema,
  }),
  getTestSetRevision: defineApiEndpoint({
    key: "problem.test-set-revision.get",
    method: "GET",
    scope: "context",
    data: ProblemTestSetRevisionDetailSchema,
  }),
  getTestGraph: defineApiEndpoint({
    key: "problem.test-graph.get",
    method: "GET",
    scope: "context",
    data: ProblemTestGraphWorkspaceSchema,
  }),
  migrateTestGraph: defineApiEndpoint({
    key: "problem.test-graph.migrate",
    method: "POST",
    scope: "context",
    body: z.object({}),
    data: ProblemTestGraphWorkspaceSchema,
  }),
  saveTestGraph: defineApiEndpoint({
    key: "problem.test-graph.save",
    method: "PUT",
    scope: "context",
    body: ProblemTestGraphSaveInputSchema,
    data: ProblemTestGraphWorkspaceSchema,
  }),
  registerTestGraphTestcases: defineApiEndpoint({
    key: "problem.test-graph.testcases.register",
    method: "POST",
    scope: "context",
    body: ProblemTestGraphRegisterInputSchema,
    data: ProblemTestGraphWorkspaceSchema,
  }),
  setTestcaseProtection: defineApiEndpoint({
    key: "problem.test-graph.testcase.protection",
    method: "PATCH",
    scope: "context",
    body: ProblemTestcaseProtectionInputSchema,
    data: ProblemTestcaseProtectionResultSchema,
  }),
  listJudgeProgramTemplates: defineApiEndpoint({
    key: "judge-program.templates.list",
    method: "GET",
    scope: "account",
    data: JudgeProgramCatalogSchema,
  }),
  getJudgeProgramTemplate: defineApiEndpoint({
    key: "judge-program.template.get",
    method: "GET",
    scope: "account",
    data: JudgeProgramTemplateSchema,
  }),
  transitionJudgeMode: defineApiEndpoint({
    key: "problem.judge-mode.transition",
    method: "POST",
    scope: "context",
    body: ProblemJudgeModeTransitionInputSchema,
    data: ProblemTestSetRevisionSummarySchema,
  }),
} as const;

export type ProblemJudgeConfig = z.infer<typeof ProblemJudgeConfigSchema>;
export type ProblemJudgeSubtask = z.infer<typeof ProblemJudgeSubtaskSchema>;
export type ProblemJudgeSettingsInput = z.infer<
  typeof ProblemJudgeSettingsInputSchema
>;
export type ProblemCheckerFile = z.infer<typeof ProblemCheckerFileSchema>;
export type ProblemTestdataFile = z.infer<typeof ProblemTestdataFileSchema>;
export type ProblemTestCasePair = z.infer<typeof ProblemTestCasePairSchema>;
export type ProblemEditorMutation = z.infer<typeof ProblemEditorMutationSchema>;
export type ProblemCreateInput = z.infer<typeof ProblemCreateInputSchema>;
export type ProblemEditorDetail = z.infer<typeof ProblemEditorDetailSchema>;
export type ProblemAdminListItem = z.infer<typeof ProblemAdminListItemSchema>;
export type ProblemAttachment = z.infer<typeof ProblemAttachmentSchema>;
export type ProblemTestGraphWorkspace = z.infer<typeof ProblemTestGraphWorkspaceSchema>;
export type ProblemTestGraphSubtask = z.infer<typeof ProblemTestGraphSubtaskSchema>;
export type ProblemTestGraphSaveInput = z.infer<typeof ProblemTestGraphSaveInputSchema>;
export type ProblemTestGraphPairInput = z.infer<typeof ProblemTestGraphPairInputSchema>;
export type ProblemTestSetRevisionDetail = z.infer<typeof ProblemTestSetRevisionDetailSchema>;
export type ProblemTestSetRevisionSummary = z.infer<typeof ProblemTestSetRevisionSummarySchema>;
export type JudgeProgramKind = z.infer<typeof JudgeProgramKindSchema>;
export type JudgeProgramFixture = z.infer<typeof JudgeProgramFixtureSchema>;
export type JudgeProgramParameterRule = z.infer<typeof JudgeProgramParameterRuleSchema>;
export type JudgeProgramProtocolConfig = z.infer<typeof JudgeProgramProtocolConfigSchema>;
export type JudgeProgramTemplateSummary = z.infer<typeof JudgeProgramTemplateSummarySchema>;
export type JudgeProgramTemplate = z.infer<typeof JudgeProgramTemplateSchema>;
export type JudgeProgramCatalog = z.infer<typeof JudgeProgramCatalogSchema>;
