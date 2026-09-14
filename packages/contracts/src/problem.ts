import { z } from "zod";
import { DateTimeWireSchema, defineApiEndpoint } from "./http";

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

export const ProblemJudgeModeTransitionInputSchema = z.object({
  targetMode: z.enum(["acm", "oi"]),
  expectedLatestRevisionId: z.string().min(1),
});

export const ProblemContracts = {
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
