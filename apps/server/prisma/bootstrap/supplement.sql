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

ALTER TABLE "EvaluationCreditWallet"
  ADD CONSTRAINT "EvaluationCreditWallet_nonnegative_check"
  CHECK ("availableCredits" >= 0 AND "reservedCredits" >= 0 AND "consumedCredits" >= 0);
ALTER TABLE "EvaluationCreditReservation"
  ADD CONSTRAINT "EvaluationCreditReservation_shape_check"
  CHECK ("freeReserved" >= 0 AND "paidReserved" >= 0 AND "platformReserved" >= 0 AND "platformReserved" = "freeReserved" + "paidReserved");
ALTER TABLE "ContributionRewardDelivery"
  ADD CONSTRAINT "ContributionRewardDelivery_amount_check"
  CHECK ("userCarits" > 0 AND "organizationCarits" >= 0);
ALTER TABLE "ResourcePurchase"
  ADD CONSTRAINT "ResourcePurchase_amount_check"
  CHECK ("caritsAmount" > 0 AND "evaluationCredits" > 0);

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
CREATE UNIQUE INDEX "OrganizationJoinApplication_pending_unique"
  ON "OrganizationJoinApplication"("organizationId", "userId")
  WHERE "status" = 'pending';
CREATE UNIQUE INDEX "OrganizationInvitation_pending_unique"
  ON "OrganizationInvitation"("organizationId", "userId")
  WHERE "status" = 'pending';
CREATE UNIQUE INDEX "OrganizationCreationApplication_pending_user_unique"
  ON "OrganizationCreationApplication"("applicantUserId")
  WHERE "status" = 'pending';
CREATE UNIQUE INDEX "OrganizationCreationApplication_pending_name_unique"
  ON "OrganizationCreationApplication"("nameKey")
  WHERE "status" = 'pending';
ALTER TABLE "OrganizationCreationApplication"
  ADD CONSTRAINT "OrganizationCreationApplication_status_check"
  CHECK ("status" IN ('pending', 'approved', 'rejected', 'cancelled'));
ALTER TABLE "OrganizationCreationApplication"
  ADD CONSTRAINT "OrganizationCreationApplication_type_check"
  CHECK ("organizationType" = 'school');
ALTER TABLE "School"
  ADD CONSTRAINT "School_directoryStatus_check"
  CHECK ("directoryStatus" IN ('pending', 'verified', 'hidden', 'legacy'));

-- Constraints and partial indexes from historical migrations that Prisma's
-- schema language cannot express. Keeping them here makes a clean bootstrap
-- structurally identical to an upgraded production database.
ALTER TABLE "FriendRequest"
  ADD CONSTRAINT "FriendRequest_distinct_users" CHECK ("requesterId" <> "addresseeId");
CREATE UNIQUE INDEX "FriendRequest_pending_pair_key"
  ON "FriendRequest" (LEAST("requesterId", "addresseeId"), GREATEST("requesterId", "addresseeId"))
  WHERE "status" = 'pending';
ALTER TABLE "Friendship"
  ADD CONSTRAINT "Friendship_ordered_users" CHECK ("userLowId" < "userHighId");
ALTER TABLE "UserBlock"
  ADD CONSTRAINT "UserBlock_distinct_users" CHECK ("blockerId" <> "blockedId");
ALTER TABLE "DirectConversation"
  ADD CONSTRAINT "DirectConversation_ordered_users" CHECK ("userLowId" < "userHighId");
ALTER TABLE "DirectMessage"
  ADD CONSTRAINT "DirectMessage_type_check" CHECK (
    ("messageType" = 'text' AND "stickerId" IS NULL)
    OR ("messageType" = 'sticker' AND "stickerId" IS NOT NULL)
  );
CREATE UNIQUE INDEX "ChatReport_pending_reporter_message_key"
  ON "ChatReport"("messageId", "reporterUserId") WHERE "status" = 'pending';

ALTER TABLE "ChatStickerPack"
  ADD CONSTRAINT "ChatStickerPack_status_check" CHECK ("status" IN ('staged', 'active', 'retired'));
ALTER TABLE "ChatSticker"
  ADD CONSTRAINT "ChatSticker_status_check" CHECK ("status" IN ('active', 'retired'));
ALTER TABLE "ChatSticker"
  ADD CONSTRAINT "ChatSticker_dimensions_check" CHECK ("width" BETWEEN 1 AND 512 AND "height" BETWEEN 1 AND 512);
ALTER TABLE "ChatSticker"
  ADD CONSTRAINT "ChatSticker_animation_check" CHECK ("frameCount" BETWEEN 1 AND 120 AND "durationMs" BETWEEN 0 AND 8000);
ALTER TABLE "ChatStickerImport"
  ADD CONSTRAINT "ChatStickerImport_status_check" CHECK ("status" IN ('staged', 'published', 'failed', 'expired'));

ALTER TABLE "ProblemJudgeProgramDraft"
  ADD CONSTRAINT "ProblemJudgeProgramDraft_kind_check" CHECK ("kind" IN ('standard', 'validator', 'classifier', 'generator'));
ALTER TABLE "ProblemJudgeProgramDraft"
  ADD CONSTRAINT "ProblemJudgeProgramDraft_revision_check" CHECK ("revision" > 0);
ALTER TABLE "ProblemJudgeProgramFixtureSet"
  ADD CONSTRAINT "ProblemJudgeProgramFixtureSet_revision_check" CHECK ("revision" > 0);
ALTER TABLE "ProblemJudgeProgramVerificationJob"
  ADD CONSTRAINT "ProblemJudgeProgramVerificationJob_mode_check" CHECK ("mode" IN ('compile', 'preflight'));
ALTER TABLE "ProblemJudgeProgramVerificationJob"
  ADD CONSTRAINT "ProblemJudgeProgramVerificationJob_status_check" CHECK ("status" IN ('queued', 'running', 'completed', 'failed', 'cancelled'));
ALTER TABLE "ProblemJudgeProgramVerificationJob"
  ADD CONSTRAINT "ProblemJudgeProgramVerificationJob_attempt_check" CHECK ("attemptCount" BETWEEN 0 AND 10);

ALTER TABLE "TrainingSession"
  ADD CONSTRAINT "TrainingSession_exactly_one_scope" CHECK (
    (("organizationId" IS NOT NULL)::int + ("teamId" IS NOT NULL)::int) = 1
  );

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
  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1 FROM "CaritsTransaction" WHERE "id" = NEW."transactionId" AND "status" = 'posted'
  ) THEN
    RAISE EXCEPTION '已入账交易不可追加账本分录';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION '账本分录不可修改或删除';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CaritsLedgerEntry_prevent_mutation"
BEFORE INSERT OR UPDATE OR DELETE ON "CaritsLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION "carits_prevent_ledger_mutation"();

CREATE OR REPLACE FUNCTION "carits_validate_posted_transaction"()
RETURNS TRIGGER AS $$
DECLARE
  entry_total BIGINT;
  entry_count INTEGER;
BEGIN
  IF NEW."status" = 'posted' THEN
    SELECT COALESCE(SUM("amount"), 0), COUNT(*) INTO entry_total, entry_count
    FROM "CaritsLedgerEntry"
    WHERE "transactionId" = NEW."id";
    IF entry_count < 2 OR entry_total <> 0 THEN
      RAISE EXCEPTION '已入账交易必须至少有两条分录且金额总和为 0';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CaritsTransaction_validate_posted"
BEFORE INSERT OR UPDATE OF "status" ON "CaritsTransaction"
FOR EACH ROW EXECUTE FUNCTION "carits_validate_posted_transaction"();

CREATE OR REPLACE FUNCTION "evaluation_credit_wallet_entry_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Evaluation Credit 钱包流水不可修改或删除';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "EvaluationCreditWalletEntry_prevent_mutation"
BEFORE UPDATE OR DELETE ON "EvaluationCreditWalletEntry"
FOR EACH ROW EXECUTE FUNCTION "evaluation_credit_wallet_entry_immutable"();

CREATE OR REPLACE FUNCTION "evaluation_credit_ledger_entry_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Evaluation Credit 日额度流水不可修改或删除';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "EvaluationCreditLedgerEntry_prevent_mutation"
BEFORE UPDATE OR DELETE ON "EvaluationCreditLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION "evaluation_credit_ledger_entry_immutable"();
