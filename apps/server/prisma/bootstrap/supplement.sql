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

ALTER TABLE "Assignment"
  ADD CONSTRAINT "Assignment_timeline_check" CHECK (
    "openAt" < "dueAt" AND "dueAt" <= "closeAt"
    AND ("publishAt" IS NULL OR "publishAt" <= "openAt")
    AND ("correctionDueAt" IS NULL OR "correctionDueAt" >= "closeAt")
  );
ALTER TABLE "Assignment"
  ADD CONSTRAINT "Assignment_late_penalty_check" CHECK (
    ("latePolicy" = 'ALLOW_WITH_PENALTY' AND "latePenaltyPercent" BETWEEN 0 AND 100)
    OR ("latePolicy" <> 'ALLOW_WITH_PENALTY' AND "latePenaltyPercent" IS NULL)
  );
ALTER TABLE "Assignment"
  ADD CONSTRAINT "Assignment_grading_limits_check" CHECK (
    "gradingVersion" >= 1 AND "baseScoreMax" BETWEEN 1 AND 1000
    AND "optionalBonusMax" BETWEEN 0 AND 1000
    AND "challengeBonusMax" BETWEEN 0 AND 1000
    AND ("optionalBestCount" IS NULL OR "optionalBestCount" BETWEEN 1 AND 1000)
  );
ALTER TABLE "AssignmentProblem"
  ADD CONSTRAINT "AssignmentProblem_score_check" CHECK (
    "maxScore" > 0 AND "targetScore" BETWEEN 0 AND "maxScore" AND "weight" > 0
  );
ALTER TABLE "AssignmentProblem"
  ADD CONSTRAINT "AssignmentProblem_order_check" CHECK ("orderIndex" >= 0);
ALTER TABLE "AssignmentProblem"
  ADD CONSTRAINT "AssignmentProblem_judge_max_score_check" CHECK ("judgeMaxScore" > 0);
ALTER TABLE "AssignmentRecipient"
  ADD CONSTRAINT "AssignmentRecipient_timeline_check" CHECK ("dueAtEffective" <= "closeAtEffective");
ALTER TABLE "AssignmentRecipientOverride"
  ADD CONSTRAINT "AssignmentRecipientOverride_timeline_check"
  CHECK ("dueAt" IS NULL OR "closeAt" IS NULL OR "dueAt" <= "closeAt");
ALTER TABLE "AssignmentProblemProgress"
  ADD CONSTRAINT "AssignmentProblemProgress_attempts_check"
  CHECK ("attemptCount" >= 0 AND "originalAttemptCount" >= 0 AND "correctionAttemptCount" >= 0);
ALTER TABLE "AssignmentCorrection"
  ADD CONSTRAINT "AssignmentCorrection_required_score_check"
  CHECK ("requiredScore" IS NULL OR "requiredScore" >= 0);
ALTER TABLE "Submission"
  ADD CONSTRAINT "Submission_assignment_scope_check" CHECK (
    ("assignmentId" IS NULL AND "assignmentProblemId" IS NULL AND "assignmentRecipientId" IS NULL AND "submissionPhase" IS NULL)
    OR ("assignmentId" IS NOT NULL AND "assignmentProblemId" IS NOT NULL AND "assignmentRecipientId" IS NOT NULL
      AND "submissionPhase" IN ('ORIGINAL', 'LATE', 'CORRECTION'))
  );
ALTER TABLE "Submission"
  ADD CONSTRAINT "Submission_assignment_scope_requires_context"
  CHECK ("submitScope" <> 'assignment' OR "assignmentId" IS NOT NULL);

ALTER TABLE "TrainingRatingConfig"
  ADD CONSTRAINT "TrainingRatingConfig_weight_range"
  CHECK ("weightBasisPoints" BETWEEN 1000 AND 10000);
ALTER TABLE "TrainingRatingConfig"
  ADD CONSTRAINT "TrainingRatingConfig_participant_minimums"
  CHECK ("organizationMinParticipants" >= 2 AND "globalMinParticipants" >= 2);
ALTER TABLE "RatingPool"
  ADD CONSTRAINT "RatingPool_scope_shape" CHECK (
    ("scopeType" = 'GLOBAL' AND "organizationId" IS NULL)
    OR ("scopeType" = 'ORGANIZATION' AND "organizationId" IS NOT NULL)
  );
CREATE UNIQUE INDEX "RatingPool_global_track_key"
  ON "RatingPool"("track") WHERE "scopeType" = 'GLOBAL';

ALTER TABLE "BlogPostDraft"
  ADD CONSTRAINT "BlogPostDraft_revision_check" CHECK ("revision" > 0);
ALTER TABLE "BlogPostDraft"
  ADD CONSTRAINT "BlogPostDraft_references_array_check" CHECK (jsonb_typeof("references") = 'array');
ALTER TABLE "BlogPostDraft"
  ADD CONSTRAINT "BlogPostDraft_classification_object_check" CHECK (jsonb_typeof("classification") = 'object');
ALTER TABLE "BlogPostVersion"
  ADD CONSTRAINT "BlogPostVersion_version_check" CHECK ("version" > 0);
ALTER TABLE "BlogReference"
  ADD CONSTRAINT "BlogReference_ordinal_check" CHECK ("ordinal" >= 0);
ALTER TABLE "BlogReference"
  ADD CONSTRAINT "BlogReference_target_shape_check" CHECK (
    ("referenceType" = 'PROBLEM' AND "problemId" IS NOT NULL AND "problemRevisionId" IS NULL AND "solutionVersionId" IS NULL AND "standingSnapshotId" IS NULL AND "ratingChangeId" IS NULL)
    OR ("referenceType" = 'PROBLEM_REVISION' AND "problemId" IS NOT NULL AND "problemRevisionId" IS NOT NULL AND "solutionVersionId" IS NULL AND "standingSnapshotId" IS NULL AND "ratingChangeId" IS NULL)
    OR ("referenceType" = 'SOLUTION_VERSION' AND "problemId" IS NULL AND "problemRevisionId" IS NULL AND "solutionVersionId" IS NOT NULL AND "standingSnapshotId" IS NULL AND "ratingChangeId" IS NULL)
    OR ("referenceType" = 'CONTEST_STANDING' AND "problemId" IS NULL AND "problemRevisionId" IS NULL AND "solutionVersionId" IS NULL AND "trainingId" IS NOT NULL AND "standingSnapshotId" IS NOT NULL AND "ratingChangeId" IS NULL)
    OR ("referenceType" = 'RATING_CHANGE' AND "problemId" IS NULL AND "problemRevisionId" IS NULL AND "solutionVersionId" IS NULL AND "trainingId" IS NOT NULL AND "standingSnapshotId" IS NULL AND "ratingChangeId" IS NOT NULL)
  );
ALTER TABLE "BlogSeries"
  ADD CONSTRAINT "BlogSeries_revision_check" CHECK ("revision" > 0);
ALTER TABLE "BlogSeries"
  ADD CONSTRAINT "BlogSeries_scope_check" CHECK (
    ("organizationId" IS NULL AND "scopeKey" = 'user:' || "ownerUserId")
    OR ("organizationId" IS NOT NULL AND "scopeKey" = 'organization:' || "organizationId")
  );
ALTER TABLE "BlogSeriesEntry"
  ADD CONSTRAINT "BlogSeriesEntry_order_check" CHECK ("orderIndex" >= 0);
ALTER TABLE "BlogTag"
  ADD CONSTRAINT "BlogTag_owner_shape_check" CHECK (
    ("kind" = 'SYSTEM' AND "ownerUserId" IS NULL AND "scopeKey" = 'system')
    OR ("kind" = 'USER' AND "ownerUserId" IS NOT NULL AND "scopeKey" = 'user:' || "ownerUserId")
  );

ALTER TABLE "DataProduct"
  ADD CONSTRAINT "DataProduct_seller_scope_check" CHECK (
    ("sellerType" = 'USER' AND "sellerOrganizationId" IS NULL)
    OR ("sellerType" = 'ORGANIZATION' AND "sellerOrganizationId" IS NOT NULL)
  );
ALTER TABLE "DataProductPrice"
  ADD CONSTRAINT "DataProductPrice_positive_amount_check" CHECK ("amountCarits" > 0);
ALTER TABLE "DataPurchase"
  ADD CONSTRAINT "DataPurchase_positive_amount_check" CHECK ("amountCarits" > 0);
ALTER TABLE "DataPurchase"
  ADD CONSTRAINT "DataPurchase_scope_check" CHECK (
    ("licenseType" = 'PERSONAL' AND "buyerOrganizationId" IS NULL AND "contestId" IS NULL)
    OR ("licenseType" = 'ORGANIZATION' AND "buyerOrganizationId" IS NOT NULL AND "contestId" IS NULL)
    OR ("licenseType" = 'CONTEST' AND "contestId" IS NOT NULL)
  );
ALTER TABLE "DataEntitlement"
  ADD CONSTRAINT "DataEntitlement_scope_check" CHECK (
    ("licenseType" = 'PERSONAL' AND "buyerOrganizationId" IS NULL AND "contestId" IS NULL)
    OR ("licenseType" = 'ORGANIZATION' AND "buyerOrganizationId" IS NOT NULL AND "contestId" IS NULL)
    OR ("licenseType" = 'CONTEST' AND "contestId" IS NOT NULL)
  );
ALTER TABLE "DataEntitlementRevision"
  ADD CONSTRAINT "DataEntitlementRevision_sequence_check" CHECK ("sequence" > 0);

ALTER TABLE "SolutionContribution"
  ADD CONSTRAINT "SolutionContribution_revision_check" CHECK ("currentRevision" >= 0);
ALTER TABLE "SolutionContribution"
  ADD CONSTRAINT "SolutionContribution_license_check" CHECK ("licenseDeclarationVersion" > 0);
ALTER TABLE "SolutionContributionRevision"
  ADD CONSTRAINT "SolutionContributionRevision_revision_check" CHECK ("revision" > 0);
ALTER TABLE "SolutionContributionRevision"
  ADD CONSTRAINT "SolutionContributionRevision_license_check" CHECK ("licenseDeclarationVersion" > 0);
ALTER TABLE "SolutionVerification"
  ADD CONSTRAINT "SolutionVerification_score_check"
  CHECK ("officialScore" IS NULL OR "officialScore" BETWEEN 0 AND 100);
ALTER TABLE "ProblemSolutionVersion"
  ADD CONSTRAINT "ProblemSolutionVersion_version_check" CHECK ("version" > 0);
ALTER TABLE "ProblemSolutionVersion"
  ADD CONSTRAINT "ProblemSolutionVersion_license_check" CHECK ("licenseDeclarationVersion" > 0);
ALTER TABLE "SolutionSimilarityCheck"
  ADD CONSTRAINT "SolutionSimilarityCheck_score_range_check" CHECK (
    "textSimilarityBasisPoints" BETWEEN 0 AND 10000
    AND "codeSimilarityBasisPoints" BETWEEN 0 AND 10000
    AND "maximumSimilarityBasisPoints" BETWEEN 0 AND 10000
    AND "comparisonCount" >= 0
  );

ALTER TABLE "QualityEvaluationJob"
  ADD CONSTRAINT "QualityEvaluationJob_attempts_check" CHECK ("attempts" >= 0);
ALTER TABLE "QualityEvaluationJob"
  ADD CONSTRAINT "QualityEvaluationJob_verification_attempts_check" CHECK ("verificationAttempts" >= 0);
ALTER TABLE "QualityEvaluationJob"
  ADD CONSTRAINT "QualityEvaluationJob_verification_status_check" CHECK (
    ("verificationStatus" = 'pending' AND "verificationReport" IS NULL AND "verificationJudgeId" IS NULL AND "verificationFencingToken" IS NULL AND "verificationLeaseExpiresAt" IS NULL) OR
    ("verificationStatus" = 'running' AND "verificationReport" IS NULL AND "verificationJudgeId" IS NOT NULL AND "verificationFencingToken" IS NOT NULL AND "verificationLeaseExpiresAt" IS NOT NULL) OR
    ("verificationStatus" = 'complete' AND "verificationReport" IS NOT NULL AND "verificationJudgeId" IS NULL AND "verificationFencingToken" IS NULL AND "verificationLeaseExpiresAt" IS NULL)
  );
ALTER TABLE "ProblemSolutionProfile"
  ADD CONSTRAINT "ProblemSolutionProfile_score_range_check" CHECK (
    "expectedScoreMin" BETWEEN 0 AND 100 AND
    "expectedScoreMax" BETWEEN 0 AND 100 AND
    "expectedScoreMin" <= "expectedScoreMax"
  );
ALTER TABLE "ProblemSolutionProfile"
  ADD CONSTRAINT "ProblemSolutionProfile_source_check" CHECK ("sourceType" = 'submission');
ALTER TABLE "ProblemSolutionProfile"
  ADD CONSTRAINT "ProblemSolutionProfile_status_check" CHECK ("status" IN ('active', 'retired'));
ALTER TABLE "ProblemSolutionProfile"
  ADD CONSTRAINT "ProblemSolutionProfile_revision_check" CHECK ("revision" > 0);
ALTER TABLE "TestSetQualitySnapshot"
  ADD CONSTRAINT "TestSetQualitySnapshot_scores_check" CHECK (
    "correctnessScore" BETWEEN 0 AND 30 AND
    "discriminationScore" BETWEEN 0 AND 25 AND
    "coverageScore" BETWEEN 0 AND 15 AND
    "diversityScore" BETWEEN 0 AND 10 AND
    "subtaskQualityScore" BETWEEN 0 AND 10 AND
    "stabilityScore" BETWEEN 0 AND 10 AND
    ("overallScore" IS NULL OR "overallScore" BETWEEN 0 AND 100) AND
    ("overallScore" IS NULL OR "overallScore" = "correctnessScore" + "discriminationScore" + "coverageScore" + "diversityScore" + "subtaskQualityScore" + "stabilityScore") AND
    "confidenceScore" BETWEEN 0 AND 100
  );
ALTER TABLE "TestSetQualitySnapshot"
  ADD CONSTRAINT "TestSetQualitySnapshot_critical_gate_check" CHECK (
    ("qualityStatus" IN ('NOT_READY', 'CRITICAL') AND "overallScore" IS NULL) OR
    ("qualityStatus" = 'READY' AND "overallScore" IS NOT NULL) OR
    ("qualityStatus" = 'STALE')
  );
ALTER TABLE "TestSetQualitySnapshot"
  ADD CONSTRAINT "TestSetQualitySnapshot_evidence_counts_check" CHECK (
    "wrongProgramCount" >= 0 AND "behaviorClusterCount" >= 0 AND
    "evaluationClusterCount" >= 0 AND "holdoutClusterCount" >= 0 AND
    "realSubmissionCount" >= 0 AND "validHackCount" >= 0 AND
    "revisionAgeDays" >= 0 AND "criticalIssueCount" >= 0 AND "warningCount" >= 0
  );
ALTER TABLE "TestSetQualitySnapshot"
  ADD CONSTRAINT "TestSetQualitySnapshot_ratios_check" CHECK (
    "weightedKillCoverage" BETWEEN 0 AND 1 AND
    "evaluationCoverage" BETWEEN 0 AND 1 AND
    "holdoutCoverage" BETWEEN 0 AND 1 AND
    "featureCoverage" BETWEEN 0 AND 1 AND
    "criticalFeatureCoverage" BETWEEN 0 AND 1
  );
ALTER TABLE "ProblemQualityAssessment"
  ADD CONSTRAINT "ProblemQualityAssessment_scores_check" CHECK (
    "statementScore" BETWEEN 0 AND 20 AND
    "solutionCorrectnessScore" BETWEEN 0 AND 20 AND
    ("algorithmicValueScore" IS NULL OR "algorithmicValueScore" BETWEEN 0 AND 20) AND
    "difficultyDesignScore" BETWEEN 0 AND 15 AND
    "constraintDesignScore" BETWEEN 0 AND 10 AND
    "subtaskDesignScore" BETWEEN 0 AND 5 AND
    ("editorialScore" IS NULL OR "editorialScore" BETWEEN 0 AND 5) AND
    ("originalityScore" IS NULL OR "originalityScore" BETWEEN 0 AND 5) AND
    "automatedScore" BETWEEN 0 AND 70 AND
    ("expertScore" IS NULL OR "expertScore" BETWEEN 0 AND 30) AND
    ("overallScore" IS NULL OR "overallScore" BETWEEN 0 AND 100) AND
    "confidenceScore" BETWEEN 0 AND 100
  );
ALTER TABLE "ProblemQualityAssessment"
  ADD CONSTRAINT "ProblemQualityAssessment_score_composition_check" CHECK (
    "automatedScore" = "statementScore" + "solutionCorrectnessScore" +
      "difficultyDesignScore" + "constraintDesignScore" + "subtaskDesignScore" AND
    (
      ("status" = 'AUTOMATED_READY' AND "algorithmicValueScore" IS NULL AND
        "editorialScore" IS NULL AND "originalityScore" IS NULL AND
        "expertScore" IS NULL AND "overallScore" IS NULL AND
        "reviewedBy" IS NULL AND "reviewedAt" IS NULL AND "expertEvidence" IS NULL)
      OR
      ("status" = 'EXPERT_REVIEWED' AND "algorithmicValueScore" IS NOT NULL AND
        "editorialScore" IS NOT NULL AND "originalityScore" IS NOT NULL AND
        "expertScore" = "algorithmicValueScore" + "editorialScore" + "originalityScore" AND
        "overallScore" = "automatedScore" + "expertScore" AND
        "reviewedBy" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "expertEvidence" IS NOT NULL)
      OR "status" = 'STALE'
    )
  );

CREATE OR REPLACE FUNCTION "blog_version_content_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '已发布博客版本不可删除';
  END IF;
  IF NEW."postId" IS DISTINCT FROM OLD."postId"
    OR NEW."version" IS DISTINCT FROM OLD."version"
    OR NEW."title" IS DISTINCT FROM OLD."title"
    OR NEW."summary" IS DISTINCT FROM OLD."summary"
    OR NEW."contentMarkdown" IS DISTINCT FROM OLD."contentMarkdown"
    OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
    OR NEW."sourceVersionId" IS DISTINCT FROM OLD."sourceVersionId"
    OR NEW."visibility" IS DISTINCT FROM OLD."visibility"
    OR NEW."organizationIdSnapshot" IS DISTINCT FROM OLD."organizationIdSnapshot"
    OR NEW."classificationSnapshot" IS DISTINCT FROM OLD."classificationSnapshot"
    OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt" THEN
    RAISE EXCEPTION '已发布博客版本内容不可修改，只能创建新版本';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status"
    AND NOT (OLD."status" = 'CURRENT' AND NEW."status" = 'SUPERSEDED') THEN
    RAISE EXCEPTION '博客版本状态只能从 CURRENT 单向变为 SUPERSEDED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BlogPostVersion_prevent_content_mutation"
BEFORE UPDATE OR DELETE ON "BlogPostVersion"
FOR EACH ROW EXECUTE FUNCTION "blog_version_content_immutable"();

CREATE OR REPLACE FUNCTION "blog_reference_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '已发布博客引用不可修改或删除';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BlogReference_prevent_mutation"
BEFORE UPDATE OR DELETE ON "BlogReference"
FOR EACH ROW EXECUTE FUNCTION "blog_reference_immutable"();

CREATE OR REPLACE FUNCTION reject_blog_submission_snapshot_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'BlogSubmissionSnapshot is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BlogSubmissionSnapshot_no_update"
BEFORE UPDATE ON "BlogSubmissionSnapshot"
FOR EACH ROW EXECUTE FUNCTION reject_blog_submission_snapshot_mutation();

CREATE TRIGGER "BlogSubmissionSnapshot_no_delete"
BEFORE DELETE ON "BlogSubmissionSnapshot"
FOR EACH ROW EXECUTE FUNCTION reject_blog_submission_snapshot_mutation();

CREATE OR REPLACE FUNCTION reject_data_market_immutable_update()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_data_product_binding_immutable()
RETURNS trigger AS $$
BEGIN
  IF NEW."problemId" IS DISTINCT FROM OLD."problemId" OR NEW."revisionId" IS DISTINCT FROM OLD."revisionId"
     OR NEW."qualitySnapshotId" IS DISTINCT FROM OLD."qualitySnapshotId" OR NEW."grade" IS DISTINCT FROM OLD."grade"
     OR NEW."sellerType" IS DISTINCT FROM OLD."sellerType" OR NEW."sellerUserId" IS DISTINCT FROM OLD."sellerUserId"
     OR NEW."sellerOrganizationId" IS DISTINCT FROM OLD."sellerOrganizationId" OR NEW."updatePolicy" IS DISTINCT FROM OLD."updatePolicy"
     OR NEW."includes" IS DISTINCT FROM OLD."includes" OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt" THEN
    RAISE EXCEPTION 'DataProduct certificate binding is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_data_entitlement_identity_immutable()
RETURNS trigger AS $$
BEGIN
  IF NEW."purchaseId" IS DISTINCT FROM OLD."purchaseId" OR NEW."buyerUserId" IS DISTINCT FROM OLD."buyerUserId"
     OR NEW."buyerOrganizationId" IS DISTINCT FROM OLD."buyerOrganizationId" OR NEW."contestId" IS DISTINCT FROM OLD."contestId"
     OR NEW."licenseType" IS DISTINCT FROM OLD."licenseType" OR NEW."updatesUntil" IS DISTINCT FROM OLD."updatesUntil"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'DataEntitlement identity is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DataProduct_binding_immutable"
BEFORE UPDATE ON "DataProduct"
FOR EACH ROW EXECUTE FUNCTION enforce_data_product_binding_immutable();
CREATE TRIGGER "DataProductPrice_immutable"
BEFORE UPDATE OR DELETE ON "DataProductPrice"
FOR EACH ROW EXECUTE FUNCTION reject_data_market_immutable_update();
CREATE TRIGGER "DataPurchase_immutable"
BEFORE UPDATE OR DELETE ON "DataPurchase"
FOR EACH ROW EXECUTE FUNCTION reject_data_market_immutable_update();
CREATE TRIGGER "DataEntitlement_identity_immutable"
BEFORE UPDATE ON "DataEntitlement"
FOR EACH ROW EXECUTE FUNCTION enforce_data_entitlement_identity_immutable();
CREATE TRIGGER "DataEntitlementRevision_immutable"
BEFORE UPDATE OR DELETE ON "DataEntitlementRevision"
FOR EACH ROW EXECUTE FUNCTION reject_data_market_immutable_update();

CREATE OR REPLACE FUNCTION prevent_quality_job_input_mutation()
RETURNS trigger AS $$
BEGIN
  IF OLD."verificationStatus" = 'complete' AND (
    NEW."verificationStatus" IS DISTINCT FROM OLD."verificationStatus"
    OR NEW."verificationReport" IS DISTINCT FROM OLD."verificationReport"
  ) THEN
    RAISE EXCEPTION 'QualityEvaluationJob verification evidence is immutable';
  END IF;
  IF NEW."problemId" IS DISTINCT FROM OLD."problemId"
    OR NEW."revisionId" IS DISTINCT FROM OLD."revisionId"
    OR NEW."corpusRevisionId" IS DISTINCT FROM OLD."corpusRevisionId"
    OR NEW."qualityRuleVersion" IS DISTINCT FROM OLD."qualityRuleVersion"
    OR NEW."ruleConfig" IS DISTINCT FROM OLD."ruleConfig"
    OR NEW."inputSnapshot" IS DISTINCT FROM OLD."inputSnapshot"
    OR NEW."inputHash" IS DISTINCT FROM OLD."inputHash"
    OR NEW."featureSchemaHash" IS DISTINCT FROM OLD."featureSchemaHash"
    OR NEW."solutionProfileSchemaHash" IS DISTINCT FROM OLD."solutionProfileSchemaHash"
    OR NEW."standardVersionId" IS DISTINCT FROM OLD."standardVersionId"
    OR NEW."validatorVersionId" IS DISTINCT FROM OLD."validatorVersionId"
    OR NEW."classifierVersionId" IS DISTINCT FROM OLD."classifierVersionId"
    OR NEW."checkerHash" IS DISTINCT FROM OLD."checkerHash"
    OR NEW."judgeConfigHash" IS DISTINCT FROM OLD."judgeConfigHash"
    OR NEW."createdBy" IS DISTINCT FROM OLD."createdBy"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW."queuedAt" IS DISTINCT FROM OLD."queuedAt"
  THEN
    RAISE EXCEPTION 'QualityEvaluationJob pinned inputs are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "QualityEvaluationJob_immutable_inputs"
BEFORE UPDATE ON "QualityEvaluationJob"
FOR EACH ROW EXECUTE FUNCTION prevent_quality_job_input_mutation();

CREATE OR REPLACE FUNCTION prevent_problem_quality_automatic_mutation()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'EXPERT_REVIEWED' THEN
    RAISE EXCEPTION 'ProblemQualityAssessment expert conclusion is immutable';
  END IF;
  IF NEW."problemId" IS DISTINCT FROM OLD."problemId"
    OR NEW."ruleVersion" IS DISTINCT FROM OLD."ruleVersion"
    OR NEW."subjectVersionHash" IS DISTINCT FROM OLD."subjectVersionHash"
    OR NEW."statementScore" IS DISTINCT FROM OLD."statementScore"
    OR NEW."solutionCorrectnessScore" IS DISTINCT FROM OLD."solutionCorrectnessScore"
    OR NEW."difficultyDesignScore" IS DISTINCT FROM OLD."difficultyDesignScore"
    OR NEW."constraintDesignScore" IS DISTINCT FROM OLD."constraintDesignScore"
    OR NEW."subtaskDesignScore" IS DISTINCT FROM OLD."subtaskDesignScore"
    OR NEW."automatedScore" IS DISTINCT FROM OLD."automatedScore"
    OR NEW."confidenceScore" IS DISTINCT FROM OLD."confidenceScore"
    OR NEW."confidenceLevel" IS DISTINCT FROM OLD."confidenceLevel"
    OR NEW."automatedEvidence" IS DISTINCT FROM OLD."automatedEvidence"
    OR NEW."createdBy" IS DISTINCT FROM OLD."createdBy"
    OR NEW."evaluatedAt" IS DISTINCT FROM OLD."evaluatedAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'ProblemQualityAssessment automated evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ProblemQualityAssessment_immutable_automatic_evidence"
BEFORE UPDATE ON "ProblemQualityAssessment"
FOR EACH ROW EXECUTE FUNCTION prevent_problem_quality_automatic_mutation();

CREATE OR REPLACE FUNCTION prevent_quality_snapshot_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'TestSetQualitySnapshot is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TestSetQualitySnapshot_immutable_update"
BEFORE UPDATE ON "TestSetQualitySnapshot"
FOR EACH ROW EXECUTE FUNCTION prevent_quality_snapshot_mutation();

CREATE TRIGGER "TestSetQualitySnapshot_immutable_delete"
BEFORE DELETE ON "TestSetQualitySnapshot"
FOR EACH ROW EXECUTE FUNCTION prevent_quality_snapshot_mutation();

CREATE OR REPLACE FUNCTION "solution_snapshot_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '题解投稿快照与审核记录不可修改或删除';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SolutionContributionRevision_prevent_mutation"
BEFORE UPDATE OR DELETE ON "SolutionContributionRevision"
FOR EACH ROW EXECUTE FUNCTION "solution_snapshot_immutable"();

CREATE TRIGGER "SolutionReview_prevent_mutation"
BEFORE UPDATE OR DELETE ON "SolutionReview"
FOR EACH ROW EXECUTE FUNCTION "solution_snapshot_immutable"();

CREATE OR REPLACE FUNCTION "solution_version_content_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '已发布题解版本不可删除';
  END IF;
  IF NEW."solutionId" IS DISTINCT FROM OLD."solutionId"
    OR NEW."version" IS DISTINCT FROM OLD."version"
    OR NEW."title" IS DISTINCT FROM OLD."title"
    OR NEW."contentMarkdown" IS DISTINCT FROM OLD."contentMarkdown"
    OR NEW."algorithmTags" IS DISTINCT FROM OLD."algorithmTags"
    OR NEW."approachKey" IS DISTINCT FROM OLD."approachKey"
    OR NEW."complexityTime" IS DISTINCT FROM OLD."complexityTime"
    OR NEW."complexityMemory" IS DISTINCT FROM OLD."complexityMemory"
    OR NEW."language" IS DISTINCT FROM OLD."language"
    OR NEW."referenceCode" IS DISTINCT FROM OLD."referenceCode"
    OR NEW."sourceType" IS DISTINCT FROM OLD."sourceType"
    OR NEW."sourceUrl" IS DISTINCT FROM OLD."sourceUrl"
    OR NEW."citation" IS DISTINCT FROM OLD."citation"
    OR NEW."licenseDeclarationVersion" IS DISTINCT FROM OLD."licenseDeclarationVersion"
    OR NEW."statementSnapshot" IS DISTINCT FROM OLD."statementSnapshot"
    OR NEW."statementSnapshotHash" IS DISTINCT FROM OLD."statementSnapshotHash"
    OR NEW."verifiedTestSetRevisionId" IS DISTINCT FROM OLD."verifiedTestSetRevisionId"
    OR NEW."sourceContributionRevisionId" IS DISTINCT FROM OLD."sourceContributionRevisionId"
    OR NEW."verificationId" IS DISTINCT FROM OLD."verificationId"
    OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
    OR NEW."publishedByUserId" IS DISTINCT FROM OLD."publishedByUserId"
    OR NEW."visibilityPolicy" IS DISTINCT FROM OLD."visibilityPolicy"
    OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION '已发布题解版本内容不可修改，只能创建新版本';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ProblemSolutionVersion_prevent_content_mutation"
BEFORE UPDATE OR DELETE ON "ProblemSolutionVersion"
FOR EACH ROW EXECUTE FUNCTION "solution_version_content_immutable"();

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

-- Contest owns the durable Rating identity while Training remains the numeric
-- route/runtime projection. These triggers keep old blue/green binaries and
-- clean-bootstrap databases on the same dual-write contract.
CREATE OR REPLACE FUNCTION "set_canonical_contest_id_from_runtime"()
RETURNS trigger AS $$
DECLARE
  expected_contest_id TEXT;
BEGIN
  SELECT "id" INTO expected_contest_id
  FROM "Contest"
  WHERE "runtimeTrainingId" = NEW."trainingId";

  IF expected_contest_id IS NULL THEN
    IF NEW."contestId" IS NOT NULL THEN
      RAISE EXCEPTION 'rating row references an unmapped contest runtime: %', NEW."trainingId";
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."contestId" IS NOT NULL AND NEW."contestId" <> expected_contest_id THEN
    RAISE EXCEPTION 'rating row contest identity does not match runtime: %', NEW."trainingId";
  END IF;
  NEW."contestId" := expected_contest_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TrainingRatingConfig_canonical_contest_identity"
BEFORE INSERT OR UPDATE OF "trainingId", "contestId" ON "TrainingRatingConfig"
FOR EACH ROW EXECUTE FUNCTION "set_canonical_contest_id_from_runtime"();
CREATE TRIGGER "ContestStandingSnapshot_canonical_contest_identity"
BEFORE INSERT OR UPDATE OF "trainingId", "contestId" ON "ContestStandingSnapshot"
FOR EACH ROW EXECUTE FUNCTION "set_canonical_contest_id_from_runtime"();
CREATE TRIGGER "RatingBatch_canonical_contest_identity"
BEFORE INSERT OR UPDATE OF "trainingId", "contestId" ON "RatingBatch"
FOR EACH ROW EXECUTE FUNCTION "set_canonical_contest_id_from_runtime"();

CREATE OR REPLACE FUNCTION "backfill_contest_rating_identity_from_aggregate"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."runtimeTrainingId" IS DISTINCT FROM NEW."runtimeTrainingId"
     AND (
       EXISTS (SELECT 1 FROM "TrainingRatingConfig" WHERE "contestId" = NEW."id")
       OR EXISTS (SELECT 1 FROM "ContestStandingSnapshot" WHERE "contestId" = NEW."id")
       OR EXISTS (SELECT 1 FROM "RatingBatch" WHERE "contestId" = NEW."id")
     ) THEN
    RAISE EXCEPTION 'cannot remap canonical contest with rating history: %', NEW."id";
  END IF;
  IF NEW."runtimeTrainingId" IS NOT NULL THEN
    UPDATE "TrainingRatingConfig" SET "contestId" = NEW."id"
      WHERE "trainingId" = NEW."runtimeTrainingId" AND "contestId" IS NULL;
    UPDATE "ContestStandingSnapshot" SET "contestId" = NEW."id"
      WHERE "trainingId" = NEW."runtimeTrainingId" AND "contestId" IS NULL;
    UPDATE "RatingBatch" SET "contestId" = NEW."id"
      WHERE "trainingId" = NEW."runtimeTrainingId" AND "contestId" IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Contest_backfill_rating_identity"
AFTER INSERT OR UPDATE OF "runtimeTrainingId" ON "Contest"
FOR EACH ROW EXECUTE FUNCTION "backfill_contest_rating_identity_from_aggregate"();
