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
  problemId: z.string(),
  title: z.string(),
  platform: z.string(),
  description: z.string().nullable(),
  statementType: z.string(),
  statementPdfUrl: z.string().nullable(),
  difficulty: z.string().nullable(),
  timeLimit: z.number().nullable(),
  memoryLimit: z.number().nullable(),
  visibility: z.string(),
  status: z.enum(["draft", "published", "archived"]),
  libraryScope: z.enum(["platform", "school"]),
  ownerId: z.string(),
  ownerType: z.string(),
  ownerName: z.string(),
  allowedLanguages: z.string().nullable(),
  ojBindings: z.string().nullable(),
  createdAt: DateTimeWireSchema,
  statements: z.array(ProblemContentVersionSchema.extend({
    id: z.string(), content: z.string().nullable(), fileUrl: z.string().nullable(), isVisible: z.boolean(),
  })),
  solutions: z.array(ProblemContentVersionSchema.extend({
    id: z.string(), content: z.string().nullable(), fileUrl: z.string().nullable(), isVisible: z.boolean(),
  })),
  permissions: z.object({
    canEdit: z.boolean(),
    canPublish: z.boolean(),
    canArchive: z.boolean(),
    canCopyToSchool: z.boolean(),
    canSubmit: z.boolean(),
  }).passthrough(),
  hack: z.object({
    enabled: z.boolean(),
    acceptedCount: z.number().int().nonnegative(),
    canHack: z.boolean(),
    mode: z.enum(["acm", "oi"]),
  }),
  legacyIoSuggestion: z.object({
    inputFilename: z.string().nullable(),
    outputFilename: z.string().nullable(),
  }).nullable(),
}).passthrough();

export const ProblemMutationResultSchema = z.object({ id: z.string() }).passthrough();
export const ProblemSchoolCopyResultSchema = z.object({
  problem: z.object({ id: z.string() }).passthrough(),
  skippedFiles: z.array(z.string()),
});

export const ProblemAttachmentSchema = z.object({
  id: z.string(),
  problemId: z.string(),
  fileName: z.string(),
  fileSize: z.number().int().nonnegative(),
  fileUrl: z.string(),
  description: z.string().nullable(),
  uploadedAt: DateTimeWireSchema,
});

export const ProblemSubmissionListItemSchema = z.object({
  id: z.number().int().positive(),
  username: z.string(),
  result: z.string(),
  timeUsed: z.number().nullable().optional(),
  memoryUsed: z.number().nullable().optional(),
  codeLength: z.number().int().nonnegative().nullable().optional(),
  language: z.string(),
  submittedAt: DateTimeWireSchema.nullable().optional(),
}).passthrough();

export const ProblemSubmissionListQuerySchema = PaginationQuerySchema;

export const ProblemSubmissionListSchema = z.object({
  submissions: z.array(ProblemSubmissionListItemSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export const ProblemContributionAssetStatusSchema = z.enum([
  "none", "draft", "verifying", "failed", "ready", "active",
]);

export const ProblemContributionAssetSchema = z.object({
  status: ProblemContributionAssetStatusSchema,
  versionId: z.string().optional(),
  source: z.enum(["dsl", "custom"]).optional(),
});

export const ProblemContributionReadinessSchema = z.object({
  canContribute: z.boolean(),
  canHack: z.boolean(),
  canManage: z.boolean(),
  mode: z.enum(["acm", "oi"]),
  standard: ProblemContributionAssetSchema,
  validator: ProblemContributionAssetSchema,
  classifier: ProblemContributionAssetSchema.extend({
    requiredForHack: z.boolean(),
    requiredForPromotion: z.boolean(),
  }),
  wrongCorpus: z.object({
    status: z.enum(["none", "bootstrap", "ready"]),
    mode: z.enum(["closed", "limited", "open"]),
  }),
  subtasks: z.array(z.object({
    subtaskId: z.number().int().positive(),
    caseCount: z.number().int().nonnegative(),
    caseLimit: z.number().int().positive(),
    wrongProgramCount: z.number().int().nonnegative(),
    wrongClusterCount: z.number().int().nonnegative(),
    contributionMode: z.enum(["closed", "limited", "open"]),
    autoSelection: z.boolean(),
    bootstrapAvailable: z.boolean(),
  })).optional(),
  blockers: z.array(z.object({ code: z.string(), message: z.string() })),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
});

export const ProblemContributionCaseSchema = z.object({
  caseId: z.string(),
  name: z.string(),
  status: z.string(),
  stage: z.string(),
  candidateId: z.string().optional(),
  candidateStatus: z.string().optional(),
  promotedRevisionId: z.string().optional(),
  message: z.string().nullable().optional(),
});

export const ProblemContributionTaskSchema = z.object({
  jobId: z.string(),
  status: z.string(),
  sourceMode: z.string(),
  contributionOrganizationId: z.string().nullable(),
  contributionOrganizationName: z.string().nullable(),
  stage: z.string(),
  createdAt: DateTimeWireSchema,
  updatedAt: DateTimeWireSchema,
  finishedAt: DateTimeWireSchema.nullable().optional(),
  errorCode: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
  cases: z.array(ProblemContributionCaseSchema),
});

export const ProblemCandidateDataInputSchema = z.object({
  name: z.string().trim().min(1).max(80).default("用户贡献"),
  inputData: z.string().min(1),
  contributionOrganizationId: z.string().min(1).optional(),
});

const ProblemGeneratorProfileSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  params: z.record(z.string(), z.unknown()).default({}),
});

export const ProblemCandidateGeneratorInputSchema = z.object({
  language: z.enum(["cpp17", "python3"]),
  source: z.string().min(1),
  contributionOrganizationId: z.string().min(1).optional(),
  manifest: z.object({
    apiVersion: z.string(),
    protocol: z.string(),
    language: z.string().optional(),
    entry: z.string().optional(),
    parameterSchema: z.record(z.string(), z.unknown()).default({}),
    profiles: z.array(ProblemGeneratorProfileSchema),
  }),
});

export const ProblemContributionJobResultSchema = z.object({
  jobId: z.string(),
  status: z.string(),
});

export const ProblemHackAttemptSchema = z.object({
  id: z.string(),
  problemId: z.string(),
  userId: z.string(),
  username: z.string().optional(),
  contributionOrganizationId: z.string().nullable(),
  contributionOrganizationName: z.string().nullable(),
  status: z.string(),
  inputMode: z.string(),
  generatorLanguage: z.string().nullable().optional(),
  hackLanguage: z.string(),
  baselineResult: z.string().nullable().optional(),
  baselineScore: z.number().nullable().optional(),
  candidateResult: z.string().nullable().optional(),
  candidateScore: z.number().nullable().optional(),
  scoreDelta: z.number().nullable().optional(),
  affectedSubtaskIds: z.array(z.number().int().positive()),
  acceptedTestcaseId: z.string().nullable().optional(),
  testGraphRevision: z.number().int().nullable().optional(),
  baseTestSetRevisionId: z.string().nullable().optional(),
  candidateTestcaseId: z.string().nullable().optional(),
  promotedRevisionId: z.string().nullable().optional(),
  canonicalStatus: z.string().nullable().optional(),
  testcaseCandidateId: z.string().nullable().optional(),
  testcaseCandidateStatus: z.string().nullable().optional(),
  promotionRetries: z.number().int().nonnegative().optional(),
  baseTestSetRevision: z.number().int().positive().nullable().optional(),
  promotedRevision: z.number().int().positive().nullable().optional(),
  failureStage: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
  acceptedInputFile: z.string().nullable().optional(),
  createdAt: DateTimeWireSchema,
  updatedAt: DateTimeWireSchema,
  finishedAt: DateTimeWireSchema.nullable().optional(),
  inputData: z.string().nullable().optional(),
  generatorSource: z.string().nullable().optional(),
  hackSource: z.string().nullable().optional(),
  inputFilename: z.string().nullable().optional(),
  outputFilename: z.string().nullable().optional(),
}).passthrough();

export const ProblemHackAttemptListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const ProblemHackAttemptListSchema = z.object({
  attempts: z.array(ProblemHackAttemptSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  acceptedCount: z.number().int().nonnegative(),
  canManage: z.boolean(),
});

export const ProblemHackAttemptInputSchema = z.object({
  inputMode: z.enum(["data", "generator"]),
  inputData: z.string().optional(),
  generatorSource: z.string().optional(),
  generatorLanguage: z.enum(["cpp17", "python3"]).optional(),
  hackSource: z.string().min(1),
  hackLanguage: z.string().min(1),
  inputFilename: z.string().nullable().optional(),
  outputFilename: z.string().nullable().optional(),
  contributionOrganizationId: z.string().nullable().optional(),
}).superRefine((value, context) => {
  if (value.inputMode === "data" && !value.inputData?.trim()) {
    context.addIssue({ code: "custom", path: ["inputData"], message: "候选输入不能为空" });
  }
  if (value.inputMode === "generator" && (!value.generatorSource?.trim() || !value.generatorLanguage)) {
    context.addIssue({ code: "custom", path: ["generatorSource"], message: "请提供生成器源码和语言" });
  }
});

export const ProblemHackConfigSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(["acm", "oi"]),
  standardSource: z.string(),
  standardLanguage: z.string().optional(),
  validatorSource: z.string(),
  validatorLanguage: z.string().optional(),
  classifierSource: z.string(),
  classifierLanguage: z.string().optional(),
  standardProgramVersionId: z.string().nullable().optional(),
  validatorProgramVersionId: z.string().nullable().optional(),
  classifierProgramVersionId: z.string().nullable().optional(),
  revision: z.number().int().nonnegative(),
});

export const ProblemHackConfigInputSchema = z.object({
  enabled: z.boolean(),
  standardSource: z.string(),
  validatorSource: z.string(),
  classifierSource: z.string(),
  standardProgramVersionId: z.string().nullable().optional(),
  validatorProgramVersionId: z.string().nullable().optional(),
  classifierProgramVersionId: z.string().nullable().optional(),
  expectedRevision: z.number().int().nonnegative(),
});

export const ProblemAiUsageSchema = z.object({
  isAdmin: z.boolean(),
  translations: z.object({ zh: z.boolean(), en: z.boolean() }),
  formattedStatementIds: z.array(z.string()),
  markdownStatements: z.array(z.object({
    id: z.string(),
    language: z.string().nullable(),
    createdAt: DateTimeWireSchema,
    maxReservedTokens: z.number().int().nonnegative(),
  })),
});

export const ProblemAiTranslateInputSchema = z.object({
  targetLang: z.enum(["zh", "en"]),
  statementId: z.string().nullable().optional(),
});

export const ProblemAiTranslateResultSchema = z.object({
  statementId: z.string(),
  content: z.string(),
  sourceLang: z.string(),
  targetLang: z.enum(["zh", "en"]),
  diagnostics: z.unknown().optional(),
});

export const ProblemAiFormatInputSchema = z.object({
  statementId: z.string().nullable().optional(),
});

export const ProblemAiFormatResultSchema = z.object({
  content: z.string(),
  diagnostics: z.unknown().optional(),
});

export const ProblemNoteSchema = z.object({
  content: z.string().nullable().optional(),
  updatedAt: DateTimeWireSchema.optional(),
});

export const ProblemNoteInputSchema = z.object({
  content: z.string().max(200_000),
});

export const ProblemPersonalContentKindSchema = z.enum(["statement", "solution"]);
export const ProblemPersonalContentFormatSchema = z.enum(["markdown", "pdf"]);
export const ProblemPersonalContentSchema = z.object({
  id: z.string(),
  kind: ProblemPersonalContentKindSchema,
  title: z.string().nullable(),
  format: ProblemPersonalContentFormatSchema,
  language: z.string().nullable(),
  content: z.string().nullable(),
  fileUrl: z.string().nullable(),
  revision: z.number().int().positive(),
  updatedAt: DateTimeWireSchema,
  shareKeys: z.array(z.string()),
});
export const ProblemMyContentSchema = z.object({
  contents: z.array(ProblemPersonalContentSchema),
  shareTargets: z.array(z.object({ key: z.string(), label: z.string() })),
});
export const ProblemPersonalContentInputSchema = z.object({
  title: z.string().max(300).nullable().optional(),
  language: z.string().max(20).nullable().optional(),
  content: z.string().min(1).max(1_048_576),
});
export const ProblemPersonalContentResultSchema = z.object({
  id: z.string(),
  revision: z.number().int().positive(),
});
export const ProblemPersonalContentSharesInputSchema = z.object({
  shareKeys: z.array(z.string()).max(100),
});

export const ProblemStatementVersionSchema = z.object({
  id: z.string(),
  key: z.string().optional(),
  name: z.string(),
  title: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  format: z.enum(["markdown", "pdf"]),
  visibility: z.enum(["private", "public"]),
  sourceType: z.string().nullable().optional(),
  sourceId: z.string().nullable().optional(),
  sourceNameSnapshot: z.string().nullable().optional(),
  sourceAuthorSnapshot: z.string().nullable().optional(),
  authorUserId: z.string().optional(),
  authorUsername: z.string().nullable().optional(),
  isOfficial: z.boolean().optional(),
  isMine: z.boolean().optional(),
  content: z.string().nullable().optional(),
  fileUrl: z.string().nullable().optional(),
  createdAt: DateTimeWireSchema.optional(),
  updatedAt: DateTimeWireSchema.optional(),
});
export const ProblemStatementVersionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});
export const ProblemStatementVersionListSchema = z.object({
  official: z.array(ProblemStatementVersionSchema),
  mine: z.array(ProblemStatementVersionSchema),
  public: z.array(ProblemStatementVersionSchema),
  publicPagination: z.object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(50),
    total: z.number().int().min(0),
  }),
});
export const ProblemStatementVersionCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  language: z.string().max(20).nullable().optional(),
  visibility: z.enum(["private", "public"]),
  format: z.enum(["markdown", "pdf"]).optional(),
  source: z.discriminatedUnion("type", [
    z.object({ type: z.literal("canonical"), id: z.string().min(1) }),
    z.object({ type: z.literal("user"), id: z.string().min(1) }),
    z.object({ type: z.literal("blank") }),
  ]),
});
export const ProblemStatementVersionContentInputSchema = z.object({
  content: z.string().max(1_048_576)
    .refine(value => value.trim().length > 0, "题面内容不能为空"),
  title: z.string().max(300).nullable().optional(),
});
export const ProblemStatementVersionMetadataInputSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  language: z.string().max(20).nullable().optional(),
  visibility: z.enum(["private", "public"]).optional(),
}).refine(value => Object.keys(value).length > 0, "至少提供一个修改字段");

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

export const JudgeProgramDraftSchema = z.object({
  id: z.string(),
  problemId: z.string(),
  programId: z.string().nullable(),
  userId: z.string(),
  kind: JudgeProgramKindSchema,
  name: z.string(),
  language: z.string(),
  protocol: z.string(),
  templateId: z.string().nullable(),
  templateVersion: z.number().int().positive().nullable(),
  source: z.string(),
  protocolConfig: JudgeProgramProtocolConfigSchema.nullable(),
  fixtures: z.array(JudgeProgramFixtureSchema),
  revision: z.number().int().positive(),
  createdAt: DateTimeWireSchema,
  updatedAt: DateTimeWireSchema,
});

export const JudgeProgramVersionSchema = z.object({
  id: z.string(),
  programId: z.string(),
  problemId: z.string(),
  versionNumber: z.number().int().positive(),
  language: z.string(),
  source: z.string(),
  sourceSha256: z.string(),
  origin: z.string(),
  aiRequestId: z.string().nullable(),
  compileStatus: z.string(),
  compileMessage: z.string().nullable(),
  protocol: z.string(),
  protocolVersion: z.number().int().positive(),
  templateId: z.string().nullable(),
  templateVersion: z.number().int().positive().nullable(),
  lifecycleStatus: z.string(),
  runtimeMetadata: z.unknown().nullable(),
  protocolConfig: z.unknown().nullable(),
  preflightReport: z.unknown().nullable(),
  fixtureSetId: z.string().nullable(),
  verifiedAt: DateTimeWireSchema.nullable(),
  activatedAt: DateTimeWireSchema.nullable(),
  createdBy: z.string(),
  createdAt: DateTimeWireSchema,
});

export const JudgeProgramSchema = z.object({
  id: z.string(),
  problemId: z.string(),
  kind: JudgeProgramKindSchema,
  name: z.string(),
  language: z.string(),
  currentVersionId: z.string().nullable(),
  status: z.string(),
  createdBy: z.string(),
  createdAt: DateTimeWireSchema,
  updatedAt: DateTimeWireSchema,
  versions: z.array(JudgeProgramVersionSchema).optional(),
});

export const JudgeProgramFixtureSetSchema = z.object({
  id: z.string(),
  problemId: z.string(),
  programId: z.string(),
  revision: z.number().int().positive(),
  fixtures: z.array(JudgeProgramFixtureSchema),
  fixtureHash: z.string(),
  createdBy: z.string(),
  createdAt: DateTimeWireSchema,
});

export const JudgeProgramVerificationReportSchema = z.object({
  fixtures: z.array(z.object({
    name: z.string(),
    passed: z.boolean(),
    message: z.string(),
    timeMs: z.number(),
    memoryKb: z.number(),
    stdoutPreview: z.string().optional(),
    stderrPreview: z.string().optional(),
  })).optional(),
  warnings: z.array(z.string()).optional(),
}).passthrough();

export const JudgeProgramVerificationSchema = z.object({
  id: z.string(),
  problemId: z.string(),
  programId: z.string(),
  versionId: z.string(),
  fixtureSetId: z.string(),
  mode: z.enum(["compile", "preflight"]),
  status: z.string(),
  judgeId: z.string().nullable(),
  fencingToken: z.string().nullable(),
  leaseExpiresAt: DateTimeWireSchema.nullable(),
  attemptCount: z.number().int().nonnegative(),
  report: JudgeProgramVerificationReportSchema.nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdBy: z.string(),
  startedAt: DateTimeWireSchema.nullable(),
  finishedAt: DateTimeWireSchema.nullable(),
  createdAt: DateTimeWireSchema,
  updatedAt: DateTimeWireSchema,
});

export const JudgeProgramAuditLogSchema = z.object({
  id: z.string(),
  programId: z.string(),
  versionId: z.string().nullable(),
  actorUserId: z.string(),
  action: z.string(),
  metadata: z.unknown().nullable(),
  createdAt: DateTimeWireSchema,
});

export const ValidatorSpecSchema = z.object({
  id: z.string(),
  problemId: z.string(),
  versionNumber: z.number().int().positive(),
  spec: z.unknown(),
  specHash: z.string(),
  generatedSource: z.string(),
  templateVersion: z.string(),
  compileStatus: z.string(),
  compileMessage: z.string().nullable(),
  verification: z.unknown().nullable(),
  origin: z.string(),
  aiRequestId: z.string().nullable(),
  programVersionId: z.string().nullable(),
  status: z.string(),
  createdBy: z.string(),
  createdAt: DateTimeWireSchema,
  activatedAt: DateTimeWireSchema.nullable(),
});

const JudgeProgramFixtureInputSchema = JudgeProgramFixtureSchema.extend({
  name: z.string().max(80).optional(),
});
const JudgeProgramSourceInputShape = {
  language: z.string().min(1),
  protocol: z.string().min(1),
  templateId: z.string().optional(),
  templateVersion: z.number().int().positive().optional(),
  source: z.string().min(1).max(262144),
  protocolConfig: JudgeProgramProtocolConfigSchema.optional(),
  fixtures: z.array(JudgeProgramFixtureInputSchema).max(50).optional(),
};
export const JudgeProgramDraftInputSchema = z.object({
  kind: JudgeProgramKindSchema,
  name: z.string().min(1).max(80).optional(),
  programId: z.string().optional(),
  expectedRevision: z.number().int().positive().optional(),
  ...JudgeProgramSourceInputShape,
});
export const JudgeProgramCreateInputSchema = z.object({
  kind: JudgeProgramKindSchema,
  name: z.string().min(1).max(80).optional(),
  ...JudgeProgramSourceInputShape,
});
export const JudgeProgramVersionCreateInputSchema = z.object(JudgeProgramSourceInputShape);
export const JudgeProgramFixtureSetInputSchema = z.object({
  fixtures: z.array(JudgeProgramFixtureInputSchema).min(1).max(50),
});
export const JudgeProgramPreflightInputSchema = z.object({
  fixtureSetId: z.string().optional(),
  fixtures: z.array(JudgeProgramFixtureInputSchema).min(1).max(50).optional(),
}).refine(value => Boolean(value.fixtureSetId || value.fixtures), {
  message: "fixtureSetId 或 fixtures 至少提供一项",
});
export const JudgeProgramUpdateInputSchema = z.object({
  currentVersionId: z.string().optional(),
  name: z.string().min(1).max(80).optional(),
  status: z.literal("archived").optional(),
}).refine(value => Object.keys(value).length > 0, { message: "至少提供一项更新" });
export const ValidatorSpecCreateInputSchema = z.object({ spec: z.unknown() }).refine(
  value => Object.prototype.hasOwnProperty.call(value, "spec"),
  { message: "spec 不能为空" },
);
export const JudgeProgramCreatedSchema = z.object({
  program: JudgeProgramSchema,
  version: JudgeProgramVersionSchema,
});
export const ValidatorSpecMaterializedSchema = JudgeProgramCreatedSchema.extend({
  spec: ValidatorSpecSchema,
  requiresVerification: z.boolean(),
});

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
  copyToSchool: defineApiEndpoint({
    key: "problem.copy-to-school",
    method: "POST",
    scope: "context",
    data: ProblemSchoolCopyResultSchema,
  }),
  getEditorDetail: defineApiEndpoint({
    key: "problem.editor-detail.get",
    method: "GET",
    scope: "context",
    data: ProblemEditorDetailSchema,
  }),
  listSubmissions: defineApiEndpoint({
    key: "problem.submissions.list",
    method: "GET",
    scope: "context",
    query: ProblemSubmissionListQuerySchema,
    data: ProblemSubmissionListSchema,
  }),
  getAiUsage: defineApiEndpoint({
    key: "problem.ai-usage.get",
    method: "GET",
    scope: "context",
    data: ProblemAiUsageSchema,
  }),
  translateStatement: defineApiEndpoint({
    key: "problem.statement.translate",
    method: "POST",
    scope: "context",
    body: ProblemAiTranslateInputSchema,
    data: ProblemAiTranslateResultSchema,
  }),
  formatStatement: defineApiEndpoint({
    key: "problem.statement.format",
    method: "POST",
    scope: "context",
    body: ProblemAiFormatInputSchema,
    data: ProblemAiFormatResultSchema,
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
  getHackConfig: defineApiEndpoint({
    key: "problem.hack-config.get", method: "GET", scope: "context",
    data: ProblemHackConfigSchema,
  }),
  saveHackConfig: defineApiEndpoint({
    key: "problem.hack-config.save", method: "PUT", scope: "context",
    body: ProblemHackConfigInputSchema, data: ProblemHackConfigSchema,
  }),
  getContributionReadiness: defineApiEndpoint({
    key: "problem.contribution-readiness.get", method: "GET", scope: "context",
    data: ProblemContributionReadinessSchema,
  }),
  listContributions: defineApiEndpoint({
    key: "problem.contributions.list", method: "GET", scope: "context",
    data: z.array(ProblemContributionTaskSchema),
  }),
  contributeCandidateData: defineApiEndpoint({
    key: "problem.candidate-data.create", method: "POST", scope: "context",
    body: ProblemCandidateDataInputSchema, data: ProblemContributionJobResultSchema,
  }),
  contributeCandidateGenerator: defineApiEndpoint({
    key: "problem.candidate-generator.create", method: "POST", scope: "context",
    body: ProblemCandidateGeneratorInputSchema, data: ProblemContributionJobResultSchema,
  }),
  listHackAttempts: defineApiEndpoint({
    key: "problem.hack-attempts.list", method: "GET", scope: "context",
    query: ProblemHackAttemptListQuerySchema, data: ProblemHackAttemptListSchema,
  }),
  createHackAttempt: defineApiEndpoint({
    key: "problem.hack-attempt.create", method: "POST", scope: "context",
    body: ProblemHackAttemptInputSchema, data: ProblemHackAttemptSchema,
  }),
  getHackAttempt: defineApiEndpoint({
    key: "problem.hack-attempt.get", method: "GET", scope: "context",
    data: ProblemHackAttemptSchema,
  }),
  retryHackAttempt: defineApiEndpoint({
    key: "problem.hack-attempt.retry", method: "POST", scope: "context",
    body: z.object({}), data: ProblemHackAttemptSchema,
  }),
  getNote: defineApiEndpoint({
    key: "problem.note.get", method: "GET", scope: "context",
    data: ProblemNoteSchema,
  }),
  saveNote: defineApiEndpoint({
    key: "problem.note.save", method: "PUT", scope: "context",
    body: ProblemNoteInputSchema, data: ProblemNoteSchema,
  }),
  getMyContent: defineApiEndpoint({
    key: "problem.my-content.get", method: "GET", scope: "context",
    data: ProblemMyContentSchema,
  }),
  saveMyContent: defineApiEndpoint({
    key: "problem.my-content.save", method: "PUT", scope: "context",
    body: ProblemPersonalContentInputSchema, data: ProblemPersonalContentResultSchema,
  }),
  updateMyContentShares: defineApiEndpoint({
    key: "problem.my-content.shares.update", method: "PUT", scope: "context",
    body: ProblemPersonalContentSharesInputSchema, data: z.object({}),
  }),
  deleteMyContent: defineApiEndpoint({
    key: "problem.my-content.delete", method: "DELETE", scope: "context",
    body: z.object({}), data: z.object({}),
  }),
  listStatementVersions: defineApiEndpoint({
    key: "problem.statement-versions.list", method: "GET", scope: "context",
    query: ProblemStatementVersionListQuerySchema, data: ProblemStatementVersionListSchema,
  }),
  getStatementVersion: defineApiEndpoint({
    key: "problem.statement-version.get", method: "GET", scope: "context",
    data: ProblemStatementVersionSchema,
  }),
  createStatementVersion: defineApiEndpoint({
    key: "problem.statement-version.create", method: "POST", scope: "context",
    body: ProblemStatementVersionCreateInputSchema, data: ProblemStatementVersionSchema,
  }),
  updateStatementVersionContent: defineApiEndpoint({
    key: "problem.statement-version.content.update", method: "PUT", scope: "context",
    body: ProblemStatementVersionContentInputSchema, data: ProblemStatementVersionSchema,
  }),
  updateStatementVersionMetadata: defineApiEndpoint({
    key: "problem.statement-version.metadata.update", method: "PATCH", scope: "context",
    body: ProblemStatementVersionMetadataInputSchema, data: ProblemStatementVersionSchema,
  }),
  deleteStatementVersion: defineApiEndpoint({
    key: "problem.statement-version.delete", method: "DELETE", scope: "context",
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
  deleteChecker: defineApiEndpoint({
    key: "problem.checker.delete", method: "DELETE", scope: "context",
    body: z.object({}), data: z.object({}),
  }),
  listTestdata: defineApiEndpoint({
    key: "problem.testdata.list",
    method: "GET",
    scope: "context",
    data: ProblemTestdataSchema,
  }),
  deleteTestdata: defineApiEndpoint({
    key: "problem.testdata.delete", method: "DELETE", scope: "context",
    body: z.object({}), data: z.object({}),
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
  listJudgeProgramDrafts: defineApiEndpoint({
    key: "judge-program.drafts.list", method: "GET", scope: "context",
    data: z.array(JudgeProgramDraftSchema),
  }),
  saveJudgeProgramDraft: defineApiEndpoint({
    key: "judge-program.draft.save", method: "POST", scope: "context",
    body: JudgeProgramDraftInputSchema, data: JudgeProgramDraftSchema,
  }),
  updateJudgeProgramDraft: defineApiEndpoint({
    key: "judge-program.draft.update", method: "PATCH", scope: "context",
    body: JudgeProgramDraftInputSchema, data: JudgeProgramDraftSchema,
  }),
  deleteJudgeProgramDraft: defineApiEndpoint({
    key: "judge-program.draft.delete", method: "DELETE", scope: "context",
    body: z.object({}), data: z.object({ deleted: z.literal(true) }),
  }),
  listJudgePrograms: defineApiEndpoint({
    key: "judge-program.list", method: "GET", scope: "context",
    data: z.array(JudgeProgramSchema.extend({ versions: z.array(JudgeProgramVersionSchema) })),
  }),
  listJudgeProgramAuditLogs: defineApiEndpoint({
    key: "judge-program.audit-logs.list", method: "GET", scope: "context",
    data: z.array(JudgeProgramAuditLogSchema),
  }),
  createJudgeProgram: defineApiEndpoint({
    key: "judge-program.create", method: "POST", scope: "context",
    body: JudgeProgramCreateInputSchema, data: JudgeProgramCreatedSchema,
  }),
  createJudgeProgramVersion: defineApiEndpoint({
    key: "judge-program.version.create", method: "POST", scope: "context",
    body: JudgeProgramVersionCreateInputSchema, data: JudgeProgramVersionSchema,
  }),
  createJudgeProgramFixtureSet: defineApiEndpoint({
    key: "judge-program.fixture-set.create", method: "POST", scope: "context",
    body: JudgeProgramFixtureSetInputSchema, data: JudgeProgramFixtureSetSchema,
  }),
  listJudgeProgramFixtureSets: defineApiEndpoint({
    key: "judge-program.fixture-sets.list", method: "GET", scope: "context",
    data: z.array(JudgeProgramFixtureSetSchema),
  }),
  compileJudgeProgramVersion: defineApiEndpoint({
    key: "judge-program.version.compile", method: "POST", scope: "context",
    body: z.object({}), data: JudgeProgramVerificationSchema,
  }),
  preflightJudgeProgramVersion: defineApiEndpoint({
    key: "judge-program.version.preflight", method: "POST", scope: "context",
    body: JudgeProgramPreflightInputSchema, data: JudgeProgramVerificationSchema,
  }),
  getJudgeProgramVerification: defineApiEndpoint({
    key: "judge-program.version.verification", method: "GET", scope: "context",
    data: z.array(JudgeProgramVerificationSchema),
  }),
  updateJudgeProgram: defineApiEndpoint({
    key: "judge-program.update", method: "PATCH", scope: "context",
    body: JudgeProgramUpdateInputSchema, data: JudgeProgramSchema,
  }),
  createValidatorSpec: defineApiEndpoint({
    key: "validator-spec.create", method: "POST", scope: "context",
    body: ValidatorSpecCreateInputSchema, data: ValidatorSpecSchema,
  }),
  listValidatorSpecs: defineApiEndpoint({
    key: "validator-spec.list", method: "GET", scope: "context",
    data: z.array(ValidatorSpecSchema),
  }),
  activateValidatorSpec: defineApiEndpoint({
    key: "validator-spec.activate", method: "POST", scope: "context",
    body: z.object({}), data: ValidatorSpecMaterializedSchema,
  }),
  materializeValidatorSpec: defineApiEndpoint({
    key: "validator-spec.materialize", method: "POST", scope: "context",
    body: z.object({}), data: ValidatorSpecMaterializedSchema,
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
export type ProblemSubmissionListItem = z.infer<typeof ProblemSubmissionListItemSchema>;
export type ProblemSubmissionList = z.infer<typeof ProblemSubmissionListSchema>;
export type ProblemAiUsage = z.infer<typeof ProblemAiUsageSchema>;
export type ProblemAiTranslateInput = z.infer<typeof ProblemAiTranslateInputSchema>;
export type ProblemAiFormatInput = z.infer<typeof ProblemAiFormatInputSchema>;
export type ProblemContributionReadiness = z.infer<typeof ProblemContributionReadinessSchema>;
export type ProblemContributionTask = z.infer<typeof ProblemContributionTaskSchema>;
export type ProblemCandidateDataInput = z.infer<typeof ProblemCandidateDataInputSchema>;
export type ProblemCandidateGeneratorInput = z.infer<typeof ProblemCandidateGeneratorInputSchema>;
export type ProblemHackAttempt = z.infer<typeof ProblemHackAttemptSchema>;
export type ProblemHackAttemptInput = z.infer<typeof ProblemHackAttemptInputSchema>;
export type ProblemHackConfig = z.infer<typeof ProblemHackConfigSchema>;
export type ProblemHackConfigInput = z.infer<typeof ProblemHackConfigInputSchema>;
export type ProblemPersonalContent = z.infer<typeof ProblemPersonalContentSchema>;
export type ProblemPersonalContentKind = z.infer<typeof ProblemPersonalContentKindSchema>;
export type ProblemPersonalContentInput = z.infer<typeof ProblemPersonalContentInputSchema>;
export type ProblemMyContent = z.infer<typeof ProblemMyContentSchema>;
export type ProblemStatementVersion = z.infer<typeof ProblemStatementVersionSchema>;
export type ProblemStatementVersionList = z.infer<typeof ProblemStatementVersionListSchema>;
export type ProblemStatementVersionCreateInput = z.infer<typeof ProblemStatementVersionCreateInputSchema>;
export type ProblemStatementVersionContentInput = z.infer<typeof ProblemStatementVersionContentInputSchema>;
export type ProblemStatementVersionMetadataInput = z.infer<typeof ProblemStatementVersionMetadataInputSchema>;
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
export type JudgeProgramDraft = z.infer<typeof JudgeProgramDraftSchema>;
export type JudgeProgramVersion = z.infer<typeof JudgeProgramVersionSchema>;
export type JudgeProgram = z.infer<typeof JudgeProgramSchema>;
export type JudgeProgramFixtureSet = z.infer<typeof JudgeProgramFixtureSetSchema>;
export type JudgeProgramVerification = z.infer<typeof JudgeProgramVerificationSchema>;
export type JudgeProgramAuditLog = z.infer<typeof JudgeProgramAuditLogSchema>;
export type ValidatorSpec = z.infer<typeof ValidatorSpecSchema>;
