import type {
  ProblemCheckerFile,
  ProblemTestCasePair,
  ProblemTestdataFile,
} from "@oi-manager/contracts";

export type TestdataFile = ProblemTestdataFile;
export type CheckerFile = ProblemCheckerFile;
export type TestCasePair = ProblemTestCasePair;
export interface SubtaskConfig {
  id: number;
  score: number;
  type: "min" | "max" | "sum";
  if?: number[];
  time?: string;
  memory?: string;
  cases: TestCasePair[];
}

export interface JudgeConfig {
  mode?: "acm" | "oi";
  type?: string;
  checker_type?: string;
  ignore_trailing_space?: boolean;
  filename?: string;
  time?: string;
  memory?: string;
  checker?: string | { file: string; lang?: string } | null;
  interactor?: string | { file: string; lang?: string } | null;
  manager?: string | { file: string; lang?: string } | null;
  num_processes?: number;
  subType?: string;
  user_extra_files?: string[];
  judge_extra_files?: string[];
  langs?: string[];
  subtasks?: SubtaskConfig[];
}

export const PROBLEM_TYPES = [
  { value: "default", label: "传统题" },
  { value: "interactive", label: "交互题" },
  { value: "communication", label: "通信题" },
  { value: "submit_answer", label: "提交答案题" },
  { value: "objective", label: "客观题" },
] as const;

export const CHECKER_INTERFACES = [
  { value: "syzoj", label: "SYZOJ" },
  { value: "hustoj", label: "HUSTOJ" },
  { value: "lemon", label: "Lemon" },
  { value: "kattis", label: "Kattis" },
  { value: "qduoj", label: "QDUOJ" },
] as const;

export const SUBTASK_TYPES = [
  { value: "min", label: "Min（取最小）" },
  { value: "max", label: "Max（取最大）" },
  { value: "sum", label: "Sum（求和）" },
] as const;

export function formatJudgeAssetSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
