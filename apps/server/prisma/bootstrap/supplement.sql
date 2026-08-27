-- PostgreSQL objects intentionally absent from Prisma's data model language.
-- Keep this file synchronized with the active historical migrations and the
-- public-schema comparison in scripts/verify-database-install-paths.sh.

ALTER TABLE "CaritsAccount"
  ADD CONSTRAINT "CaritsAccount_owner_shape_check" CHECK (
    ("ownerType" = 'USER' AND "userId" IS NOT NULL AND "organizationId" IS NULL AND "systemKey" IS NULL)
    OR ("ownerType" = 'ORGANIZATION' AND "userId" IS NULL AND "organizationId" IS NOT NULL AND "systemKey" IS NULL)
    OR ("ownerType" = 'SYSTEM' AND "userId" IS NULL AND "organizationId" IS NULL AND "systemKey" IS NOT NULL)
  );

ALTER TABLE "ContributionEvent"
  ADD CONSTRAINT "ContributionEvent_score_positive_check" CHECK ("score" > 0);

CREATE UNIQUE INDEX "ProblemHackAttempt_one_judging_per_problem"
  ON "ProblemHackAttempt"("problemId") WHERE "status" IN ('judging', 'finalizing');
CREATE UNIQUE INDEX "ProblemHackAttempt_one_active_user_problem"
  ON "ProblemHackAttempt"("userId", "problemId") WHERE "status" IN ('queuing', 'judging', 'finalizing');
CREATE UNIQUE INDEX "UserProblemContent_active_statement_name_key"
  ON "UserProblemContent"("problemId", "userId", "kind", "nameKey")
  WHERE "kind" = 'statement' AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX "UserProblemContent_active_solution_owner_key"
  ON "UserProblemContent"("problemId", "userId", "kind")
  WHERE "kind" = 'solution' AND "deletedAt" IS NULL;

CREATE OR REPLACE FUNCTION "carits_prevent_posted_transaction_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" = 'posted' THEN
    RAISE EXCEPTION '已入账交易不可修改或删除，只能创建冲正交易';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CaritsTransaction_prevent_posted_update"
BEFORE UPDATE OR DELETE ON "CaritsTransaction"
FOR EACH ROW EXECUTE FUNCTION "carits_prevent_posted_transaction_mutation"();

CREATE OR REPLACE FUNCTION "carits_prevent_ledger_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '账本分录不可修改或删除';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CaritsLedgerEntry_prevent_mutation"
BEFORE UPDATE OR DELETE ON "CaritsLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION "carits_prevent_ledger_mutation"();

CREATE OR REPLACE FUNCTION "carits_validate_posted_transaction"()
RETURNS TRIGGER AS $$
DECLARE
  entry_total BIGINT;
BEGIN
  IF NEW."status" = 'posted' THEN
    SELECT COALESCE(SUM("amount"), 0) INTO entry_total
    FROM "CaritsLedgerEntry"
    WHERE "transactionId" = NEW."id";
    IF entry_total <> 0 THEN
      RAISE EXCEPTION '已入账交易的账本分录金额之和必须为 0';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CaritsTransaction_validate_posted"
BEFORE INSERT OR UPDATE OF "status" ON "CaritsTransaction"
FOR EACH ROW EXECUTE FUNCTION "carits_validate_posted_transaction"();
