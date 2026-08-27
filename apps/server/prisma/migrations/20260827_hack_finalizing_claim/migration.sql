DROP INDEX IF EXISTS "ProblemHackAttempt_one_judging_per_problem";
DROP INDEX IF EXISTS "ProblemHackAttempt_one_active_user_problem";

CREATE UNIQUE INDEX "ProblemHackAttempt_one_judging_per_problem"
  ON "ProblemHackAttempt"("problemId")
  WHERE "status" IN ('judging', 'finalizing');

CREATE UNIQUE INDEX "ProblemHackAttempt_one_active_user_problem"
  ON "ProblemHackAttempt"("userId", "problemId")
  WHERE "status" IN ('queuing', 'judging', 'finalizing');
