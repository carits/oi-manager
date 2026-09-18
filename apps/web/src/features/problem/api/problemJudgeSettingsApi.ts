import {
  ProblemContracts,
  type ProblemJudgeSettingsInput,
} from "@oi-manager/contracts";
import { apiClient } from "@/lib/apiClient";

const problemPath = (problemId: string) =>
  `/api/problems/${encodeURIComponent(problemId)}`;

export const getProblemJudgeSettings = (problemId: string) =>
  apiClient.queryContract(
    ProblemContracts.getJudgeSettings,
    `${problemPath(problemId)}/judge-config`,
  );

export const saveProblemJudgeSettings = (
  problemId: string,
  body: ProblemJudgeSettingsInput,
) =>
  apiClient.mutateContract(
    ProblemContracts.saveJudgeSettings,
    `${problemPath(problemId)}/judge-config`,
    body,
  );

export const listProblemCheckers = (problemId: string) =>
  apiClient.queryContract(
    ProblemContracts.listCheckers,
    `${problemPath(problemId)}/checker`,
  );

export const uploadProblemChecker = (problemId: string, file: File) => {
  const form = new FormData(); form.append("file", file);
  return apiClient.postFile(`${problemPath(problemId)}/checker`, form, { timeout: 120_000 });
};

export const deleteProblemChecker = (problemId: string, checkerId: string) =>
  apiClient.mutateContract(
    ProblemContracts.deleteChecker,
    `${problemPath(problemId)}/checker/${encodeURIComponent(checkerId)}`,
    {},
  );

export const listProblemTestdata = (problemId: string) =>
  apiClient.queryContract(
    ProblemContracts.listTestdata,
    `${problemPath(problemId)}/testdata`,
  );

export const listProblemTestSetRevisions = (problemId: string) =>
  apiClient.queryContract(
    ProblemContracts.listTestSetRevisions,
    `${problemPath(problemId)}/test-set-revisions`,
  );

export const transitionProblemJudgeMode = (
  problemId: string,
  body: { targetMode: "acm" | "oi"; expectedLatestRevisionId: string },
) =>
  apiClient.mutateContract(
    ProblemContracts.transitionJudgeMode,
    `${problemPath(problemId)}/judge-mode-transition`,
    body,
  );
