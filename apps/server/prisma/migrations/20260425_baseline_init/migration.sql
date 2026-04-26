-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsageLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "sourceLang" TEXT,
    "targetLang" TEXT,
    "model" TEXT,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'success',
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statementId" TEXT,

    CONSTRAINT "AiUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contest" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "contestDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'upcoming',
    "type" TEXT NOT NULL DEFAULT 'mock',
    "teamId" TEXT,
    "countRating" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT NOT NULL DEFAULT 'public',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestProblem" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "ojName" TEXT,
    "problemId" TEXT,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "difficulty" TEXT,
    "points" INTEGER,
    "statementType" TEXT NOT NULL DEFAULT 'none',
    "statementMarkdown" TEXT,
    "solutionType" TEXT NOT NULL DEFAULT 'none',
    "solutionMarkdown" TEXT,
    "solutionVisible" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContestProblem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestProblemNote" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContestProblemNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestProblemScore" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContestProblemScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestResource" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "contestProblemId" TEXT,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileFormat" TEXT NOT NULL DEFAULT 'pdf',
    "fileUrl" TEXT NOT NULL,
    "visibleRoles" TEXT NOT NULL DEFAULT 'all',
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContestResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestResult" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "rank" INTEGER,
    "score" DOUBLE PRECISION,
    "ratingBefore" INTEGER NOT NULL,
    "ratingAfter" INTEGER NOT NULL,
    "ratingChange" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "File" (
    "id" TEXT NOT NULL,
    "storageType" TEXT NOT NULL DEFAULT 'local',
    "disk" TEXT NOT NULL DEFAULT 'default',
    "relativePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "md5Hash" TEXT,
    "sha256Hash" TEXT,
    "accessLevel" TEXT NOT NULL DEFAULT 'private',
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "deletedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "username" TEXT NOT NULL,
    "loginRole" TEXT NOT NULL,
    "userRole" TEXT,
    "result" TEXT NOT NULL,
    "failureReason" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "milestoneDate" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OjAccount" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT,
    "passwordIV" TEXT,
    "cookie" TEXT,
    "cookieRaw" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unverified',
    "lastVerifiedAt" TIMESTAMP(3),
    "lastErrorMessage" TEXT,
    "loginMethod" TEXT NOT NULL DEFAULT 'cookie',
    "addedBy" TEXT NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginFailureAt" TIMESTAMP(3),
    "lastSubmitAt" TIMESTAMP(3),
    "lastRateLimitAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "rateLimitCount" INTEGER NOT NULL DEFAULT 0,
    "totalSubmissions" INTEGER NOT NULL DEFAULT 0,
    "totalSubmissionErrors" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "maxConsecutiveFailures" INTEGER NOT NULL DEFAULT 3,
    "freezeDurationMinutes" INTEGER NOT NULL DEFAULT 30,
    "submitMaxRetries" INTEGER NOT NULL DEFAULT 1,
    "retryIntervalSeconds" INTEGER NOT NULL DEFAULT 10,
    "minSubmitIntervalSeconds" INTEGER NOT NULL DEFAULT 30,
    "minRequestIntervalSeconds" INTEGER NOT NULL DEFAULT 3,
    "maxConcurrentSubmissions" INTEGER NOT NULL DEFAULT 1,
    "maxConcurrentRequests" INTEGER NOT NULL DEFAULT 2,
    "loginFailureCooldownMinutes" INTEGER NOT NULL DEFAULT 15,
    "cookieValidMinutes" INTEGER NOT NULL DEFAULT 3600,
    "renewLoginThresholdMinutes" INTEGER NOT NULL DEFAULT 10,
    "reverifyIntervalMinutes" INTEGER NOT NULL DEFAULT 30,
    "autoVerifyIntervalMinutes" INTEGER NOT NULL DEFAULT 1440,
    "firstPollDelaySeconds" INTEGER NOT NULL DEFAULT 5,
    "pollIntervalSeconds" INTEGER NOT NULL DEFAULT 5,
    "maxWaitDurationMinutes" INTEGER NOT NULL DEFAULT 10,
    "rateLimitThreshold" INTEGER NOT NULL DEFAULT 2,
    "banSuspicionCooldownHours" INTEGER NOT NULL DEFAULT 6,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OjAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OjFetchJob" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "message" TEXT,
    "hasAttachment" BOOLEAN NOT NULL DEFAULT false,
    "attachmentStatus" TEXT,
    "createdProblemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OjFetchJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OjPlatformConfig" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "cookies" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OjPlatformConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetLog" (
    "id" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "operatorUserId" TEXT NOT NULL,
    "operatorRole" TEXT NOT NULL,
    "resetMethod" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrincipalTransferLog" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "oldPrincipalTeacherId" TEXT,
    "newPrincipalTeacherId" TEXT NOT NULL,
    "operatorUserId" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrincipalTransferLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Problem" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "statementType" TEXT NOT NULL DEFAULT 'none',
    "statementPdfUrl" TEXT,
    "solutionType" TEXT NOT NULL DEFAULT 'none',
    "solutionMarkdown" TEXT,
    "solutionPdfUrl" TEXT,
    "solutionVisible" BOOLEAN NOT NULL DEFAULT false,
    "difficulty" TEXT,
    "timeLimit" INTEGER,
    "memoryLimit" INTEGER,
    "judgeConfig" TEXT,
    "problemType" TEXT NOT NULL DEFAULT 'default',
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "ownerType" TEXT NOT NULL DEFAULT 'teacher',
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "allowedLanguages" TEXT,
    "ojBindings" TEXT,

    CONSTRAINT "Problem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemAttachment" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "description" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProblemAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemList" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "coverUrl" TEXT,
    "schoolId" TEXT,
    "ownerId" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL DEFAULT 'teacher',
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProblemList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemListEntry" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "alias" TEXT,
    "notes" TEXT,
    "ojName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProblemListEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemListSection" (
    "id" TEXT NOT NULL,
    "problemListId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProblemListSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemListShare" (
    "id" TEXT NOT NULL,
    "problemListId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "permission" TEXT NOT NULL DEFAULT 'view',
    "sharedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProblemListShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemNote" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userType" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProblemNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemStatement" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "language" TEXT,
    "content" TEXT,
    "fileUrl" TEXT,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProblemStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "School" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "announcement" TEXT,
    "region" TEXT,
    "schoolType" TEXT,
    "educationSystem" TEXT DEFAULT '6-3-3',
    "contactPerson" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "currentPrincipalTeacherId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "School_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolProblemList" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "problemListId" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "addedByRole" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolProblemList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gender" TEXT,
    "schoolId" TEXT NOT NULL,
    "enrollmentYear" INTEGER,
    "targetContest" TEXT,
    "headTeacherId" TEXT,
    "tags" TEXT,
    "notes" TEXT,
    "avatar" TEXT,
    "rating" INTEGER NOT NULL DEFAULT 1200,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "oj" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "codeLength" INTEGER NOT NULL,
    "result" TEXT NOT NULL DEFAULT 'queuing',
    "timeUsed" INTEGER,
    "memoryUsed" INTEGER,
    "submitMethod" TEXT NOT NULL,
    "ojAccountId" TEXT,
    "ojRemoteId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "problemInternalId" TEXT,
    "cases" TEXT,
    "score" INTEGER,
    "subtasks" TEXT,
    "isGlobalVisible" BOOLEAN NOT NULL DEFAULT true,
    "sourceId" TEXT,
    "submitSource" TEXT,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Teacher" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "avatar" TEXT,
    "bio" TEXT,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "schoolId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Teacher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar" TEXT,
    "description" TEXT,
    "announcement" TEXT,
    "schoolId" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamJoinRequest" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processedBy" TEXT,

    CONSTRAINT "TeamJoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userType" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invitedBy" TEXT,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMemberExternalAccount" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "studentId" TEXT,
    "platform" TEXT NOT NULL,
    "platformUsername" TEXT NOT NULL,
    "displayName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "inviteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamMemberExternalAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMemberImportBatch" (
    "id" TEXT NOT NULL,
    "teamId" TEXT,
    "operatorId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "totalCount" INTEGER NOT NULL,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "skipCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "rawInput" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "TeamMemberImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMemberImportItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "rawUsername" TEXT NOT NULL,
    "rawStudentName" TEXT,
    "parsedUsername" TEXT,
    "candidateDisplayName" TEXT,
    "matchType" TEXT NOT NULL,
    "matchStatus" TEXT NOT NULL DEFAULT 'pending',
    "matchedStudentId" TEXT,
    "matchedStudentName" TEXT,
    "createdStudentId" TEXT,
    "action" TEXT,
    "userChoice" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "TeamMemberImportItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamOperationLog" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "operatorType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "targetType" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamOperationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamProblemList" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "problemListId" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "addedByRole" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamProblemList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestdataFile" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "md5" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestdataFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Training" (
    "id" SERIAL NOT NULL,
    "teamId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "format" TEXT NOT NULL DEFAULT 'ioi',
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'upcoming',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "problemIdVisible" BOOLEAN NOT NULL DEFAULT false,
    "solutionVisible" BOOLEAN NOT NULL DEFAULT false,
    "includeAdminInRanking" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Training_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingAttachment" (
    "id" TEXT NOT NULL,
    "trainingProblemId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingParticipant" (
    "id" TEXT NOT NULL,
    "trainingId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "userType" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingProblem" (
    "id" TEXT NOT NULL,
    "trainingId" INTEGER NOT NULL,
    "problemId" TEXT NOT NULL,
    "alias" TEXT,
    "orderIndex" INTEGER NOT NULL,
    "points" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingProblem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingSolution" (
    "id" TEXT NOT NULL,
    "trainingProblemId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingSolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "avatar" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "bio" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPlatformBinding" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "platformUsername" TEXT,
    "bindingStatus" TEXT NOT NULL DEFAULT 'unbound',
    "bindingData" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "platformConfig" TEXT,
    "platformUid" TEXT,
    "statusMessage" TEXT,

    CONSTRAINT "UserPlatformBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserStatusLog" (
    "id" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "operatorUserId" TEXT NOT NULL,
    "operatorRole" TEXT NOT NULL,
    "oldStatus" TEXT NOT NULL,
    "newStatus" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserStatusLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carits_sequence" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "nextId" INTEGER NOT NULL DEFAULT 1000,

    CONSTRAINT "carits_sequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Admin_userId_key" ON "Admin"("userId");

-- CreateIndex
CREATE INDEX "AiUsageLog_userId_createdAt_idx" ON "AiUsageLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsageLog_userId_problemId_action_createdAt_idx" ON "AiUsageLog"("userId", "problemId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "Contest_contestDate_idx" ON "Contest"("contestDate");

-- CreateIndex
CREATE INDEX "Contest_scope_idx" ON "Contest"("scope");

-- CreateIndex
CREATE INDEX "Contest_status_idx" ON "Contest"("status");

-- CreateIndex
CREATE INDEX "Contest_teamId_idx" ON "Contest"("teamId");

-- CreateIndex
CREATE INDEX "Contest_teamId_status_idx" ON "Contest"("teamId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ContestProblem_contestId_orderIndex_key" ON "ContestProblem"("contestId", "orderIndex");

-- CreateIndex
CREATE INDEX "ContestProblemNote_studentId_idx" ON "ContestProblemNote"("studentId");

-- CreateIndex
CREATE INDEX "ContestProblemNote_updatedAt_idx" ON "ContestProblemNote"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContestProblemNote_contestId_problemId_studentId_key" ON "ContestProblemNote"("contestId", "problemId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ContestProblemScore_contestId_problemId_studentId_key" ON "ContestProblemScore"("contestId", "problemId", "studentId");

-- CreateIndex
CREATE INDEX "ContestResult_createdAt_idx" ON "ContestResult"("createdAt");

-- CreateIndex
CREATE INDEX "ContestResult_studentId_idx" ON "ContestResult"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ContestResult_contestId_studentId_key" ON "ContestResult"("contestId", "studentId");

-- CreateIndex
CREATE INDEX "File_category_idx" ON "File"("category");

-- CreateIndex
CREATE INDEX "File_md5Hash_idx" ON "File"("md5Hash");

-- CreateIndex
CREATE INDEX "File_ownerType_ownerId_idx" ON "File"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "File_status_deletedAt_idx" ON "File"("status", "deletedAt");

-- CreateIndex
CREATE INDEX "File_storageType_disk_idx" ON "File"("storageType", "disk");

-- CreateIndex
CREATE INDEX "LoginLog_createdAt_idx" ON "LoginLog"("createdAt");

-- CreateIndex
CREATE INDEX "LoginLog_result_idx" ON "LoginLog"("result");

-- CreateIndex
CREATE INDEX "LoginLog_username_idx" ON "LoginLog"("username");

-- CreateIndex
CREATE INDEX "Milestone_milestoneDate_idx" ON "Milestone"("milestoneDate");

-- CreateIndex
CREATE INDEX "Milestone_studentId_idx" ON "Milestone"("studentId");

-- CreateIndex
CREATE INDEX "Milestone_teacherId_idx" ON "Milestone"("teacherId");

-- CreateIndex
CREATE INDEX "OjAccount_platform_idx" ON "OjAccount"("platform");

-- CreateIndex
CREATE INDEX "OjAccount_status_idx" ON "OjAccount"("status");

-- CreateIndex
CREATE UNIQUE INDEX "OjAccount_platform_username_key" ON "OjAccount"("platform", "username");

-- CreateIndex
CREATE INDEX "OjFetchJob_createdAt_idx" ON "OjFetchJob"("createdAt");

-- CreateIndex
CREATE INDEX "OjFetchJob_status_idx" ON "OjFetchJob"("status");

-- CreateIndex
CREATE UNIQUE INDEX "OjFetchJob_platform_problemId_key" ON "OjFetchJob"("platform", "problemId");

-- CreateIndex
CREATE UNIQUE INDEX "OjPlatformConfig_platform_key" ON "OjPlatformConfig"("platform");

-- CreateIndex
CREATE INDEX "Problem_createdAt_idx" ON "Problem"("createdAt");

-- CreateIndex
CREATE INDEX "Problem_ownerId_ownerType_idx" ON "Problem"("ownerId", "ownerType");

-- CreateIndex
CREATE INDEX "Problem_visibility_idx" ON "Problem"("visibility");

-- CreateIndex
CREATE INDEX "Problem_visibility_status_idx" ON "Problem"("visibility", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Problem_platform_problemId_key" ON "Problem"("platform", "problemId");

-- CreateIndex
CREATE INDEX "ProblemAttachment_problemId_idx" ON "ProblemAttachment"("problemId");

-- CreateIndex
CREATE INDEX "ProblemList_createdAt_idx" ON "ProblemList"("createdAt");

-- CreateIndex
CREATE INDEX "ProblemList_ownerId_ownerType_idx" ON "ProblemList"("ownerId", "ownerType");

-- CreateIndex
CREATE INDEX "ProblemList_schoolId_idx" ON "ProblemList"("schoolId");

-- CreateIndex
CREATE INDEX "ProblemList_visibility_idx" ON "ProblemList"("visibility");

-- CreateIndex
CREATE INDEX "ProblemListEntry_problemId_idx" ON "ProblemListEntry"("problemId");

-- CreateIndex
CREATE INDEX "ProblemListEntry_sectionId_idx" ON "ProblemListEntry"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemListEntry_sectionId_problemId_key" ON "ProblemListEntry"("sectionId", "problemId");

-- CreateIndex
CREATE INDEX "ProblemListSection_problemListId_idx" ON "ProblemListSection"("problemListId");

-- CreateIndex
CREATE INDEX "ProblemListShare_sharedBy_idx" ON "ProblemListShare"("sharedBy");

-- CreateIndex
CREATE INDEX "ProblemListShare_targetType_targetId_idx" ON "ProblemListShare"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemListShare_problemListId_targetType_targetId_key" ON "ProblemListShare"("problemListId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "ProblemNote_updatedAt_idx" ON "ProblemNote"("updatedAt");

-- CreateIndex
CREATE INDEX "ProblemNote_userId_idx" ON "ProblemNote"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemNote_problemId_userId_userType_key" ON "ProblemNote"("problemId", "userId", "userType");

-- CreateIndex
CREATE INDEX "ProblemStatement_problemId_type_idx" ON "ProblemStatement"("problemId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemStatement_problemId_type_format_language_key" ON "ProblemStatement"("problemId", "type", "format", "language");

-- CreateIndex
CREATE INDEX "SchoolProblemList_addedBy_idx" ON "SchoolProblemList"("addedBy");

-- CreateIndex
CREATE INDEX "SchoolProblemList_problemListId_idx" ON "SchoolProblemList"("problemListId");

-- CreateIndex
CREATE INDEX "SchoolProblemList_schoolId_idx" ON "SchoolProblemList"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolProblemList_schoolId_problemListId_key" ON "SchoolProblemList"("schoolId", "problemListId");

-- CreateIndex
CREATE UNIQUE INDEX "Student_userId_key" ON "Student"("userId");

-- CreateIndex
CREATE INDEX "Student_enrollmentYear_idx" ON "Student"("enrollmentYear");

-- CreateIndex
CREATE INDEX "Student_headTeacherId_idx" ON "Student"("headTeacherId");

-- CreateIndex
CREATE INDEX "Student_rating_idx" ON "Student"("rating");

-- CreateIndex
CREATE INDEX "Student_schoolId_headTeacherId_idx" ON "Student"("schoolId", "headTeacherId");

-- CreateIndex
CREATE INDEX "Student_schoolId_idx" ON "Student"("schoolId");

-- CreateIndex
CREATE INDEX "Submission_createdAt_idx" ON "Submission"("createdAt");

-- CreateIndex
CREATE INDEX "Submission_createdAt_result_idx" ON "Submission"("createdAt", "result");

-- CreateIndex
CREATE INDEX "Submission_isGlobalVisible_idx" ON "Submission"("isGlobalVisible");

-- CreateIndex
CREATE INDEX "Submission_language_idx" ON "Submission"("language");

-- CreateIndex
CREATE INDEX "Submission_oj_idx" ON "Submission"("oj");

-- CreateIndex
CREATE INDEX "Submission_problemId_idx" ON "Submission"("problemId");

-- CreateIndex
CREATE INDEX "Submission_result_idx" ON "Submission"("result");

-- CreateIndex
CREATE INDEX "Submission_sourceId_idx" ON "Submission"("sourceId");

-- CreateIndex
CREATE INDEX "Submission_submitSource_idx" ON "Submission"("submitSource");

-- CreateIndex
CREATE INDEX "Submission_userId_idx" ON "Submission"("userId");

-- CreateIndex
CREATE INDEX "Submission_userId_oj_problemId_idx" ON "Submission"("userId", "oj", "problemId");

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_userId_key" ON "Teacher"("userId");

-- CreateIndex
CREATE INDEX "Teacher_createdAt_idx" ON "Teacher"("createdAt");

-- CreateIndex
CREATE INDEX "Teacher_schoolId_idx" ON "Teacher"("schoolId");

-- CreateIndex
CREATE INDEX "Teacher_status_idx" ON "Teacher"("status");

-- CreateIndex
CREATE INDEX "Team_createdAt_idx" ON "Team"("createdAt");

-- CreateIndex
CREATE INDEX "Team_isPublic_idx" ON "Team"("isPublic");

-- CreateIndex
CREATE INDEX "Team_schoolId_idx" ON "Team"("schoolId");

-- CreateIndex
CREATE INDEX "Team_schoolId_isPublic_idx" ON "Team"("schoolId", "isPublic");

-- CreateIndex
CREATE UNIQUE INDEX "TeamJoinRequest_teamId_studentId_key" ON "TeamJoinRequest"("teamId", "studentId");

-- CreateIndex
CREATE INDEX "TeamMember_status_idx" ON "TeamMember"("status");

-- CreateIndex
CREATE INDEX "TeamMember_teamId_role_idx" ON "TeamMember"("teamId", "role");

-- CreateIndex
CREATE INDEX "TeamMember_teamId_status_role_idx" ON "TeamMember"("teamId", "status", "role");

-- CreateIndex
CREATE INDEX "TeamMember_userId_userType_status_idx" ON "TeamMember"("userId", "userType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_teamId_userId_userType_key" ON "TeamMember"("teamId", "userId", "userType");

-- CreateIndex
CREATE INDEX "TeamMemberExternalAccount_platform_platformUsername_idx" ON "TeamMemberExternalAccount"("platform", "platformUsername");

-- CreateIndex
CREATE INDEX "TeamMemberExternalAccount_studentId_idx" ON "TeamMemberExternalAccount"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMemberExternalAccount_teamId_platform_platformUsername_key" ON "TeamMemberExternalAccount"("teamId", "platform", "platformUsername");

-- CreateIndex
CREATE INDEX "TeamMemberImportBatch_operatorId_idx" ON "TeamMemberImportBatch"("operatorId");

-- CreateIndex
CREATE INDEX "TeamMemberImportBatch_teamId_idx" ON "TeamMemberImportBatch"("teamId");

-- CreateIndex
CREATE INDEX "TeamMemberImportItem_batchId_idx" ON "TeamMemberImportItem"("batchId");

-- CreateIndex
CREATE INDEX "TeamMemberImportItem_matchType_idx" ON "TeamMemberImportItem"("matchType");

-- CreateIndex
CREATE INDEX "TeamOperationLog_action_idx" ON "TeamOperationLog"("action");

-- CreateIndex
CREATE INDEX "TeamOperationLog_createdAt_idx" ON "TeamOperationLog"("createdAt");

-- CreateIndex
CREATE INDEX "TeamOperationLog_operatorId_idx" ON "TeamOperationLog"("operatorId");

-- CreateIndex
CREATE INDEX "TeamOperationLog_teamId_idx" ON "TeamOperationLog"("teamId");

-- CreateIndex
CREATE INDEX "TeamProblemList_addedBy_idx" ON "TeamProblemList"("addedBy");

-- CreateIndex
CREATE INDEX "TeamProblemList_problemListId_idx" ON "TeamProblemList"("problemListId");

-- CreateIndex
CREATE INDEX "TeamProblemList_teamId_idx" ON "TeamProblemList"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamProblemList_teamId_problemListId_key" ON "TeamProblemList"("teamId", "problemListId");

-- CreateIndex
CREATE INDEX "TestdataFile_problemId_idx" ON "TestdataFile"("problemId");

-- CreateIndex
CREATE UNIQUE INDEX "TestdataFile_problemId_filename_key" ON "TestdataFile"("problemId", "filename");

-- CreateIndex
CREATE INDEX "Training_startTime_idx" ON "Training"("startTime");

-- CreateIndex
CREATE INDEX "Training_status_idx" ON "Training"("status");

-- CreateIndex
CREATE INDEX "Training_teamId_idx" ON "Training"("teamId");

-- CreateIndex
CREATE INDEX "Training_teamId_status_idx" ON "Training"("teamId", "status");

-- CreateIndex
CREATE INDEX "TrainingAttachment_trainingProblemId_idx" ON "TrainingAttachment"("trainingProblemId");

-- CreateIndex
CREATE INDEX "TrainingParticipant_trainingId_idx" ON "TrainingParticipant"("trainingId");

-- CreateIndex
CREATE INDEX "TrainingParticipant_userId_idx" ON "TrainingParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingParticipant_trainingId_userId_userType_key" ON "TrainingParticipant"("trainingId", "userId", "userType");

-- CreateIndex
CREATE INDEX "TrainingProblem_problemId_idx" ON "TrainingProblem"("problemId");

-- CreateIndex
CREATE INDEX "TrainingProblem_trainingId_idx" ON "TrainingProblem"("trainingId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingProblem_trainingId_alias_key" ON "TrainingProblem"("trainingId", "alias");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingProblem_trainingId_orderIndex_key" ON "TrainingProblem"("trainingId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingSolution_trainingProblemId_key" ON "TrainingSolution"("trainingProblemId");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_schoolId_idx" ON "User"("schoolId");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "UserPlatformBinding_platform_idx" ON "UserPlatformBinding"("platform");

-- CreateIndex
CREATE INDEX "UserPlatformBinding_userId_idx" ON "UserPlatformBinding"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPlatformBinding_userId_platform_key" ON "UserPlatformBinding"("userId", "platform");

-- AddForeignKey
ALTER TABLE "Admin" ADD CONSTRAINT "Admin_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admin" ADD CONSTRAINT "Admin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contest" ADD CONSTRAINT "Contest_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestProblem" ADD CONSTRAINT "ContestProblem_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestProblemNote" ADD CONSTRAINT "ContestProblemNote_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestProblemNote" ADD CONSTRAINT "ContestProblemNote_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "ContestProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestProblemNote" ADD CONSTRAINT "ContestProblemNote_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestProblemScore" ADD CONSTRAINT "ContestProblemScore_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestProblemScore" ADD CONSTRAINT "ContestProblemScore_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "ContestProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestProblemScore" ADD CONSTRAINT "ContestProblemScore_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestResource" ADD CONSTRAINT "ContestResource_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestResource" ADD CONSTRAINT "ContestResource_contestProblemId_fkey" FOREIGN KEY ("contestProblemId") REFERENCES "ContestProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestResult" ADD CONSTRAINT "ContestResult_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestResult" ADD CONSTRAINT "ContestResult_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrincipalTransferLog" ADD CONSTRAINT "PrincipalTransferLog_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemAttachment" ADD CONSTRAINT "ProblemAttachment_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemListEntry" ADD CONSTRAINT "ProblemListEntry_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemListEntry" ADD CONSTRAINT "ProblemListEntry_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ProblemListSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemListSection" ADD CONSTRAINT "ProblemListSection_problemListId_fkey" FOREIGN KEY ("problemListId") REFERENCES "ProblemList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemListShare" ADD CONSTRAINT "ProblemListShare_problemListId_fkey" FOREIGN KEY ("problemListId") REFERENCES "ProblemList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemNote" ADD CONSTRAINT "ProblemNote_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemStatement" ADD CONSTRAINT "ProblemStatement_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolProblemList" ADD CONSTRAINT "SchoolProblemList_problemListId_fkey" FOREIGN KEY ("problemListId") REFERENCES "ProblemList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolProblemList" ADD CONSTRAINT "SchoolProblemList_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_headTeacherId_fkey" FOREIGN KEY ("headTeacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_ojAccountId_fkey" FOREIGN KEY ("ojAccountId") REFERENCES "OjAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamJoinRequest" ADD CONSTRAINT "TeamJoinRequest_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamJoinRequest" ADD CONSTRAINT "TeamJoinRequest_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMemberExternalAccount" ADD CONSTRAINT "TeamMemberExternalAccount_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMemberExternalAccount" ADD CONSTRAINT "TeamMemberExternalAccount_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMemberImportBatch" ADD CONSTRAINT "TeamMemberImportBatch_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMemberImportItem" ADD CONSTRAINT "TeamMemberImportItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "TeamMemberImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamProblemList" ADD CONSTRAINT "TeamProblemList_problemListId_fkey" FOREIGN KEY ("problemListId") REFERENCES "ProblemList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamProblemList" ADD CONSTRAINT "TeamProblemList_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestdataFile" ADD CONSTRAINT "TestdataFile_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Training" ADD CONSTRAINT "Training_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingAttachment" ADD CONSTRAINT "TrainingAttachment_trainingProblemId_fkey" FOREIGN KEY ("trainingProblemId") REFERENCES "TrainingProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingParticipant" ADD CONSTRAINT "TrainingParticipant_trainingId_fkey" FOREIGN KEY ("trainingId") REFERENCES "Training"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingProblem" ADD CONSTRAINT "TrainingProblem_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingProblem" ADD CONSTRAINT "TrainingProblem_trainingId_fkey" FOREIGN KEY ("trainingId") REFERENCES "Training"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSolution" ADD CONSTRAINT "TrainingSolution_trainingProblemId_fkey" FOREIGN KEY ("trainingProblemId") REFERENCES "TrainingProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPlatformBinding" ADD CONSTRAINT "UserPlatformBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

