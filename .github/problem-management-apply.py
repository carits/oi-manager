from pathlib import Path
import re

ROOT = Path('.')
def read(path): return (ROOT / path).read_text()
def write(path, text):
    assert '/prisma/' not in path and '/tests/' not in path and not re.search(r'\.(test|spec)\.', path), path
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text)
def replace(text, old, new, count=1):
    assert text.count(old) == count, (old[:160], text.count(old), count)
    return text.replace(old, new)
def between(text, start, end, new):
    a, b = text.index(start), text.index(end, text.index(start))
    return text[:a] + new + text[b:]

# Separate pure authorization from primary identity reads without changing any grants.
p = 'apps/server/src/modules/problem/problem.access.ts'
s = read(p)
a = s.index('export type ProblemAccessAction')
b = s.index('export async function findAccessibleProblem')
auth = "import type { JwtPayload, ProblemLibraryScope } from '@oi-manager/shared'\nimport { requestHasOrganizationCapability, requestOrganizationCapabilityScope } from '../authorization/capabilities'\n\n" + s[a:b]
write('apps/server/src/modules/problem/problem.authorization.ts', auth)
s = "import type { JwtPayload } from '@oi-manager/shared'\nimport type { NextFunction, Response } from 'express'\nimport { prisma } from '../../prisma'\nimport type { AuthRequest } from '../../middleware/auth'\nimport { requestHasOrganizationCapability } from '../authorization/capabilities'\nimport { canCopyProblemToSchool, canUseProblem, canViewProblem, canModifyProblem, type ProblemAccessAction } from './problem.authorization'\nimport { findPrimaryUsableProblem } from './problem.identity'\nexport * from './problem.authorization'\nconst isOrganizationContext = (user: JwtPayload) => Boolean(user.organizationId)\n\n" + s[b:]
s = between(s, 'export async function findUsableProblemByExternalId', 'export function requireSchoolStaff', "export async function findUsableProblemByExternalId(user: JwtPayload, platform: string, problemId: string) {\n  return findPrimaryUsableProblem(user, platform, problemId)\n}\n\n")
write(p, s)

# Explicit wire identity and optimistic editor version, with no Prisma/schema edits.
p = 'packages/contracts/src/problem.ts'
s = read(p)
s = replace(s, 'const ProblemEditorMutationShape = {', 'const ProblemEditorMutationShape = {\n  platform: z.string().trim().min(1).max(50).optional(),\n  problemId: z.string().trim().min(1).max(128).optional(),')
s = replace(s, 'export const ProblemCreateInputSchema = z.object(ProblemEditorMutationShape).extend({\n  title: z.string().min(1),\n});', 'export const ProblemCreateInputSchema = z.object(ProblemEditorMutationShape).extend({\n  title: z.string().min(1),\n  platform: z.string().trim().min(1).max(50),\n});')
s = replace(s, 'export const ProblemEditorMutationSchema = z.object(ProblemEditorMutationShape);', 'export const ProblemEditorMutationSchema = z.object(ProblemEditorMutationShape).extend({\n  expectedUpdatedAt: z.string().datetime(),\n}).refine(value => (value.platform === undefined) === (value.problemId === undefined), { message: "修改主身份时必须同时指定主 OJ 和主题号" });')
s = replace(s, 'export const ProblemEditorDetailSchema = z.object({', 'export const ProblemEditorDetailSchema = z.object({\n  updatedAt: DateTimeWireSchema,\n  readiness: z.object({ stable: z.boolean(), published: z.boolean() }),')
s = replace(s, '  permissions: z.object({\n    canEdit: z.boolean(),', '  permissions: z.object({\n    canEditIdentity: z.boolean(),\n    canEdit: z.boolean(),')
s = replace(s, 'export const ProblemMutationResultSchema = z.object({ id: z.string() }).passthrough();', 'export const ProblemMutationResultSchema = z.object({\n  id: z.string(), updatedAt: DateTimeWireSchema, platform: z.string(), problemId: z.string(),\n}).passthrough();')
write(p, s)

p = 'apps/server/src/modules/problem/application/problem-crud.service.ts'
s = read(p)
s = "import { normalizeOjPlatformKey } from '@oi-manager/shared'\nimport { ProblemIdentityError, normalizePrimaryProblemIdentity, normalizeProblemOjBindings, assertPrimaryIdentityAvailable, canChangePrimaryIdentity } from '../problem.identity'\n" + s
start = s.index("  let platform = 'carits'", s.index('export async function createProblem'))
end = s.index('\n  let problem\n', start)
s = s[:start] + '''  const canonicalPlatform = typeof body?.platform === 'string' ? normalizeOjPlatformKey(body.platform) : null
  if (!canonicalPlatform) fail(400, 'INVALID_OJ_PLATFORM', '必须明确选择已注册的主 OJ')
  const identity = normalizePrimaryProblemIdentity(canonicalPlatform,
    canonicalPlatform === 'carits' && body?.problemId === undefined ? await generateCaritsProblemId() : body?.problemId)
  const { platform, problemId } = identity
  if (platform === 'carits' && !/^\\d+$/.test(problemId)) fail(400, 'INVALID_CARITS_PROBLEM_ID', 'Carits 题号必须是纯数字')
  const ojBindings = normalizeProblemOjBindings(body?.ojBindings)
''' + s[end:]
s = replace(s, '    problem = await prisma.$transaction(async tx => {\n      const duplicate', '    problem = await prisma.$transaction(async tx => {\n      await assertPrimaryIdentityAvailable(tx, libraryKey, identity)\n      const duplicate')
# Return identity-editability and readiness, not raw testset metadata.
s = replace(s, '      ProblemHackConfig: { select: { enabled: true } },', "      ProblemHackConfig: { select: { enabled: true } },\n      TestSetSlots: { select: { slot: true } },")
s = replace(s, '  const { ProblemStatement, ProblemHackConfig, Owner, ...data } = problem', '  const { ProblemStatement, ProblemHackConfig, Owner, TestSetSlots, ...data } = problem')
s = replace(s, '    legacyIoSuggestion: legacyIo ?', "    readiness: { stable: TestSetSlots.some(slot => slot.slot === 'STABLE'), published: data.status === 'published' },\n    legacyIoSuggestion: legacyIo ?")
s = replace(s, '      ...permissions,\n      canSubmit:', '      ...permissions,\n      canEditIdentity: canEdit && await canChangePrimaryIdentity(prisma, problem),\n      canSubmit:')
# A missing content kind is unchanged. An explicit empty array deletes that kind only.
s = replace(s, '  const versions = normalizeVersions(statements, solutions)\n  const existing = await client.problemStatement.findMany({ where: { problemId } })', "  const kinds = [statements !== undefined ? 'statement' : null, solutions !== undefined ? 'solution' : null].filter(Boolean)\n  if (!kinds.length) return\n  const versions = normalizeVersions(statements ?? [], solutions ?? [])\n  const existing = await client.problemStatement.findMany({ where: { problemId, type: { in: kinds } } })")
s = replace(s, '    where: { problemId, id: { notIn: Array.from(retained) } },', '    where: { problemId, type: { in: kinds }, id: { notIn: Array.from(retained) } },')
s = between(s, 'export async function updateProblem(', 'export async function archiveProblem(', '''export async function updateProblem(user: JwtPayload, problemId: string, body: any) {
  const expected = typeof body?.expectedUpdatedAt === 'string' ? new Date(body.expectedUpdatedAt) : null
  if (!expected || !Number.isFinite(expected.getTime())) fail(428, 'PROBLEM_VERSION_REQUIRED', '请刷新编辑器后保存，缺少题目版本')
  if (body?.status !== undefined && !['draft', 'published', 'archived'].includes(body.status)) fail(400, 'INVALID_PROBLEM_STATUS', '题目状态无效')
  if (body?.title !== undefined && !String(body.title).trim()) fail(400, 'PROBLEM_TITLE_REQUIRED', '题目标题不能为空')
  const identityRequested = body?.platform !== undefined || body?.problemId !== undefined
  const identity = identityRequested ? normalizePrimaryProblemIdentity(body.platform, body.problemId) : undefined
  const bindings = normalizeProblemOjBindings(body?.ojBindings)
  let problem
  try {
    problem = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Problem" WHERE id = ${problemId} FOR UPDATE`
      const existing = await tx.problem.findUnique({ where: { id: problemId } })
      if (!existing || !canModifyProblem(user, existing)) fail(404, 'PROBLEM_NOT_FOUND', '题目不存在')
      if (existing.updatedAt.getTime() !== expected.getTime()) fail(409, 'PROBLEM_STALE', '题目已被修改，当前草稿已保留，请重新加载并核对后保存')
      const changedIdentity = identity && (identity.platform !== existing.platform || identity.problemId !== existing.problemId)
      if (changedIdentity) {
        if (!await canChangePrimaryIdentity(tx, existing)) fail(409, 'PROBLEM_IDENTITY_LOCKED', '已发布或被业务引用的主身份不能在普通编辑中修改')
        if (identity.platform === 'carits' && !/^\\d+$/.test(identity.problemId)) fail(400, 'INVALID_CARITS_PROBLEM_ID', 'Carits 题号必须是纯数字')
        await assertPrimaryIdentityAvailable(tx, existing.libraryKey, identity, existing.id)
      }
      const updated = await tx.problem.update({ where: { id: existing.id }, data: {
        title: body?.title === undefined ? undefined : String(body.title).trim(),
        description: body?.description, statementType: body?.statementType, solutionType: body?.solutionType,
        solutionMarkdown: body?.solutionMarkdown, solutionVisible: body?.solutionVisible, difficulty: body?.difficulty,
        timeLimit: normalizeOptionalNumber(body?.timeLimit, '时间限制'),
        memoryLimit: normalizeOptionalNumber(body?.memoryLimit, '内存限制'),
        status: body?.status,
        // Preserve the fact that an identity has been published, including after archival.
        publishedAt: body?.status === 'published' ? existing.publishedAt || new Date() : existing.publishedAt,
        visibility: existing.libraryScope === 'school' ? 'private' : 'public',
        ...(changedIdentity ? identity : {}),
        ...(bindings !== undefined ? { ojBindings: JSON.stringify(bindings) } : {}),
        updatedAt: new Date(Math.max(Date.now(), existing.updatedAt.getTime() + 1)),
      } })
      await syncStatements(tx, existing.id, body?.statements, body?.solutions)
      return updated
    })
  } catch (error: any) {
    if (error?.code === 'P2002') fail(409, 'PROBLEM_EXISTS', '当前题库已存在相同平台题号')
    throw error
  }
  logger.audit('problem_updated', { userId: user.userId, action: 'update_problem', target: problem.id,
    metadata: { organizationId: problem.organizationId, status: problem.status, identityChanged: identityRequested } })
  return { ...problem, permissions: problemPermissions(user, problem) }
}

''')
# Canonicalize platform filters, but do not rewrite stored historical rows while reading.
s = replace(s, '    where.platform = platform\n', "    const canonicalPlatform = normalizeOjPlatformKey(platform)\n    if (!canonicalPlatform) fail(400, 'INVALID_OJ_PLATFORM', '平台名称未注册')\n    where.platform = canonicalPlatform\n")
write(p, s)
p = 'apps/server/src/modules/problem/problem.crud.routes.ts'
s = "import { ProblemIdentityError } from './problem.identity'\n" + read(p)
s = replace(s, 'if (!(error instanceof ProblemCrudError)) throw error', 'if (!(error instanceof ProblemCrudError) && !(error instanceof ProblemIdentityError)) throw error')
write(p, s)

# One serial editor save queue, explicit identity controls, and no implicit array clearing.
p = 'apps/web/src/features/problem/ui/ProblemForm.tsx'
s = read(p)
s = "import { useAuth } from '@/features/auth'\nimport { normalizeOjPlatformKey } from '@/lib/oj-platforms'\nimport { ProblemPrimaryIdentity, type ProblemPrimaryIdentityValue } from './ProblemPrimaryIdentity'\n" + s
# Keep use-client first.
s = s.replace("'use client'\n", '', 1)
s = "'use client'\n\n" + s
s = replace(s, 'ProblemAttachment, ProblemCreateInput', 'ProblemAttachment, ProblemEditorMutation')
s = replace(s, 'let problemDraftBootstrap: ReturnType<typeof createProblem> | null = null', 'const problemDraftBootstraps = new Map<string, ReturnType<typeof createProblem>>()\ntype EditorDraft = Omit<ProblemEditorMutation, "expectedUpdatedAt">')
s = replace(s, '  const router = useRouter()', '''  const { user, sessionKey } = useAuth()
  const editorVersionRef = useRef('')
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve())
  const contextRef = useRef('')
  const fingerprintRef = useRef('')
  const [primaryIdentity, setPrimaryIdentity] = useState<ProblemPrimaryIdentityValue>({ platform: '', problemId: '' })
  const [identityDraft, setIdentityDraft] = useState<ProblemPrimaryIdentityValue>({ platform: '', problemId: '' })
  const [editingIdentity, setEditingIdentity] = useState(false)
  const [identityEditable, setIdentityEditable] = useState(false)
  const [stableReady, setStableReady] = useState(false)
  const [editorError, setEditorError] = useState('')
  const router = useRouter()''')
s = replace(s, "  // New problem creation is materialized", "  const editorContext = `${sessionKey}:${pathPrefix}:${problemId || 'new'}`\n  contextRef.current = editorContext\n  useEffect(() => () => { contextRef.current = '' }, [editorContext])\n\n  // New problem creation is materialized")
s = replace(s, "    if (mode !== 'create') return", "    if (mode !== 'create' || !user) return")
s = replace(s, "      const request = problemDraftBootstrap ||= createProblem({ title: '未命名题目', status: 'draft', statements: [], solutions: [] })", "      const context = editorContext\n      const request = problemDraftBootstraps.get(context) || createProblem({ platform: 'carits', title: '未命名题目', status: 'draft', statements: [], solutions: [] })\n      problemDraftBootstraps.set(context, request)")
s = replace(s, "      window.setTimeout(() => { if (problemDraftBootstrap === request) problemDraftBootstrap = null }, 1000)", "      window.setTimeout(() => { if (problemDraftBootstraps.get(context) === request) problemDraftBootstraps.delete(context) }, 1000)\n      if (contextRef.current !== context) return")
s = replace(s, '  }, [mode, pathPrefix, router, toast])', '  }, [mode, pathPrefix, router, toast, editorContext, user?.userId])')
s = replace(s, '  const buildProblemPayload = (): ProblemCreateInput => {\n    const data: ProblemCreateInput = {', '  const buildProblemPayload = (): EditorDraft => {\n    const data: EditorDraft = {')
s = replace(s, '    const validBindings = ojBindings.filter(binding => binding.platform && binding.problemId.trim())\n    if (validBindings.length) data.ojBindings = validBindings', '''    data.ojBindings = ojBindings.filter(binding => binding.platform || binding.problemId.trim()).map(binding => ({
      ...binding, platform: normalizeOjPlatformKey(binding.platform) || binding.platform, problemId: binding.problemId.trim(),
    }))
    if (editingIdentity && (identityDraft.platform !== primaryIdentity.platform || identityDraft.problemId.trim() !== primaryIdentity.problemId)) {
      data.platform = identityDraft.platform
      data.problemId = identityDraft.problemId.trim()
    }''')
s = replace(s, '  const currentFingerprint = JSON.stringify(buildProblemPayload())', '  const currentFingerprint = JSON.stringify(buildProblemPayload())\n  fingerprintRef.current = currentFingerprint')
a = s.index('  useEffect(() => {\n    if (loading || !isAutoSaveDraft || !problemId)')
b = s.index('  const fetchProblem = async () => {', a)
s = s[:a] + '''  const persistEditorDraft = (draft: EditorDraft) => {
    const context = editorContext
    const fingerprint = JSON.stringify(draft)
    const task = saveQueueRef.current.catch(() => undefined).then(async () => {
      if (contextRef.current !== context || !problemId || !editorVersionRef.current) throw new Error('编辑上下文已改变，请重新打开题目')
      setAutoSaveStatus('saving')
      const result = await updateProblem(problemId, { ...draft, expectedUpdatedAt: editorVersionRef.current })
      if (contextRef.current !== context) return result
      if (!result.ok) {
        setAutoSaveStatus('failed')
        setEditorError(result.error.message || '保存失败，草稿已保留')
        return result
      }
      editorVersionRef.current = result.data.updatedAt
      savedFingerprintRef.current = fingerprint
      if (draft.platform !== undefined && fingerprintRef.current === fingerprint) {
        const identity = { platform: result.data.platform, problemId: result.data.problemId }
        setPrimaryIdentity(identity)
        setIdentityDraft(identity)
        setEditingIdentity(false)
        const { platform: _platform, problemId: _number, ...content } = draft
        savedFingerprintRef.current = JSON.stringify(content)
      }
      if (draft.status === 'published' || draft.status === 'archived') setIdentityEditable(false)
      setEditorError('')
      setAutoSaveStatus(fingerprintRef.current === fingerprint ? 'saved' : 'dirty')
      return result
    })
    saveQueueRef.current = task
    return task
  }

  useEffect(() => {
    if (loading || !isAutoSaveDraft || !problemId || editingIdentity || editorError) return
    if (savedFingerprintRef.current === null) {
      savedFingerprintRef.current = currentFingerprint
      setAutoSaveStatus('saved')
      return
    }
    if (savedFingerprintRef.current === currentFingerprint) return
    setAutoSaveStatus('dirty')
    const draft = buildProblemPayload()
    const timer = window.setTimeout(() => {
      void persistEditorDraft(draft).catch(error => {
        if (contextRef.current !== editorContext) return
        setAutoSaveStatus('failed')
        setEditorError(requestErrorMessage(error, '保存失败，草稿已保留'))
      })
    }, 800)
    return () => window.clearTimeout(timer)
    // Payload is represented by its fingerprint; identity changes require an explicit save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFingerprint, isAutoSaveDraft, loading, problemId, editorContext, editingIdentity, editorError])

''' + s[b:]
s = replace(s, '  const fetchProblem = async () => {\n    try {', "  const fetchProblem = async () => {\n    const context = editorContext\n    try {")
s = replace(s, "      const p = await getProblemEditorDetail(problemId || '')", "      const p = await getProblemEditorDetail(problemId || '')\n      if (contextRef.current !== context) return\n      editorVersionRef.current = p.updatedAt\n      const identity = { platform: p.platform, problemId: p.problemId }\n      setPrimaryIdentity(identity)\n      setIdentityDraft(identity)\n      setEditingIdentity(false)\n      setIdentityEditable(p.permissions.canEditIdentity)\n      setStableReady(p.readiness.stable)")
s = replace(s, '''        if (p.ojBindings) {
          setOjBindings(typeof p.ojBindings === 'string' ? JSON.parse(p.ojBindings) : p.ojBindings)
        }''', '''        try {
          const bindings: unknown = p.ojBindings ? JSON.parse(p.ojBindings) : []
          if (!Array.isArray(bindings) || bindings.some(item => !item || typeof item.platform !== 'string' || typeof item.problemId !== 'string')) throw new Error('invalid bindings')
          setOjBindings(bindings)
        } catch {
          setEditorError('历史附加来源格式无效，未自动清空；请联系管理员核对后再保存。')
        }''')
# Local content removals are saved atomically with the editor payload, not pre-deleted.
s = between(s, '  const removeStatement = async (index: number) => {', '  // 上传 PDF', '''  const removeStatement = async (index: number) => setStatements(current => current.filter((_, i) => i !== index))
  const removeSolution = async (index: number) => setSolutions(current => current.filter((_, i) => i !== index))

''')
s = replace(s, '''      let result
      if (mode === 'create') {
        result = await createProblem(data)
      } else {
        result = await updateProblem(problemId || '', data)
      }
''', '''      if (mode === 'create' || !problemId) throw new Error('草稿尚未创建完成，请稍候')
      if (ojBindings.some(binding => Boolean(binding.platform) !== Boolean(binding.problemId.trim()))) throw new Error('附加来源必须同时填写平台和题号')
      const savedFingerprint = JSON.stringify(data)
      const result = await persistEditorDraft(data)
      if (!result.ok) { toast.error(result.error.message || '保存失败，草稿已保留'); return }
      if (contextRef.current !== editorContext) return
      if (fingerprintRef.current !== savedFingerprint) { toast.success('当前版本已保存，后续修改仍在草稿中'); return }
''')
s = replace(s, '        savedFingerprintRef.current = JSON.stringify(data)\n', '')
s = replace(s, "        if (mode === 'create') {\n          const stagedFiles", "        if (!loadedProblemIdRef.current) {\n          const stagedFiles")
s = replace(s, "      toast.error('保存失败')", "      setAutoSaveStatus('failed')\n      setEditorError(requestErrorMessage(error, '保存失败，草稿已保留'))\n      toast.error(requestErrorMessage(error, '保存失败，草稿已保留'))")
s = replace(s, '''    } catch (e) {
      console.error('Failed to save judge config:', e)
    }
    setShowJudgeConfigConfirm(false)''', '''    } catch (e) {
      toast.error(requestErrorMessage(e, '评测配置保存失败，题目内容已保存；配置草稿仍保留'))
      return
    }
    setShowJudgeConfigConfirm(false)''')
s = replace(s, '            {isAutoSaveDraft && <p', '            {<p')
s = replace(s, "'已自动保存为不可见草稿'", "'当前版本已保存'")
s = replace(s, '            <div className={unifiedStyles.u7}>', '''            {editorError && <p role="alert" className={unifiedStyles.u32}>{editorError}</p>}
            <ProblemPrimaryIdentity current={primaryIdentity} value={identityDraft} editing={editingIdentity}
              editable={identityEditable} disabled={saving || autoSaveStatus === 'saving'} stable={stableReady}
              published={form.status === 'published'} onEditing={setEditingIdentity} onChange={setIdentityDraft} />
            <div className={unifiedStyles.u7}>''')
write(p, s)
p = 'apps/web/src/features/problem/ui/ProblemPublishingSettings.tsx'
s = read(p).replace('OJ 题目绑定', '附加来源').replace('绑定外部 OJ 题目，最多可添加 3 个', '仅记录来源，最多 3 项；不参与题号检索，不决定主 OJ 或主题号。拉取是独立的管理操作。')
s = replace(s, 'key={`${binding.platform}-${binding.problemId}-${index}`}', 'key={index}')
s = replace(s, '<option value="published">已发布</option>', '<option value="published">已发布</option>\n          {status === "archived" && <option value="archived">已归档</option>}')
write(p, s)

# Preserve explicit domain error codes when an old entry delegates to the common identity reader.
p = 'apps/server/src/modules/submission/application/submission-command.service.ts'
s = "import { ProblemIdentityError } from '../../problem/problem.identity'\n" + read(p)
s = replace(s, '  const problem = await findUsableProblemByExternalId(context.authUser, oj, problemId)', '''  const problem = await findUsableProblemByExternalId(context.authUser, oj, problemId).catch(error => {
    if (error instanceof ProblemIdentityError) throw new SubmissionCommandError(error.statusCode, error.code, error.message)
    throw error
  })''')
s = replace(s, 'requestFingerprint({ problemId, oj, language, code,', 'requestFingerprint({ problemId: problem.problemId, oj: problem.platform, language, code,')
write(p, s)
print('Applied explicit identity/editor changes; no database, tests or migrations executed.')
