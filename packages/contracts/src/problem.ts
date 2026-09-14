import { z } from "zod";
import { DateTimeWireSchema, defineApiEndpoint } from "./http";

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
