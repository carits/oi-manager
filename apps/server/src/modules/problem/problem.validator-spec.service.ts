import crypto from 'node:crypto'
import { prisma } from '../../prisma'
import type { JwtPayload } from '@oi-manager/shared'
import { compileJudgeProgram, requireProgramProblem } from './problem.judge-program.service'
import { EVALUATION_LIMITS } from './problem.evaluation-budget.service'
import { refreshAdmittedCandidateStages } from './problem.contribution-readiness.service'

export class ValidatorSpecError extends Error { constructor(public statusCode: number, public code: string, message: string, public data?: unknown) { super(message) } }
function fail(status: number, code: string, message: string, data?: unknown): never { throw new ValidatorSpecError(status, code, message, data) }
const ident = (value: unknown) => { const name = String(value || ''); if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) fail(422, 'VALIDATOR_SPEC_INVALID', `变量名 ${name || '—'} 无效`); return name }
const number = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback
const signedLongLiteral = (value: unknown, fallback: number) => `${Math.trunc(number(value, fallback))}LL`
function ref(value: unknown, known: Set<string>) { if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return String(value); const name = ident(value); if (!known.has(name)) fail(422, 'VALIDATOR_SPEC_INVALID', `长度引用 ${name} 尚未定义`); return name }
function q(value: unknown) { return JSON.stringify(String(value)) }

export function validateAndCompileSpec(raw: any) {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.input) || !raw.input.length || raw.input.length > 256) fail(422, 'VALIDATOR_SPEC_INVALID', 'Validator DSL 必须为 version 1，并包含 1～256 个输入节点')
  const known = new Set<string>(), vectors = new Set<string>(), graphs = new Map<string, { n: string; directed: boolean }>()
  const lines = ['#include "testlib.h"', '#include <bits/stdc++.h>', 'using namespace std;', 'int main(int argc,char** argv){', 'registerValidation(argc,argv);']
  for (const node of raw.input) {
    const type = String(node?.type || ''), name = ident(node?.name)
    if (known.has(name)) fail(422, 'VALIDATOR_SPEC_INVALID', `变量 ${name} 重复`)
    if (type === 'int') lines.push(`long long ${name}=inf.readLong(${signedLongLiteral(node.min, -9007199254740991)},${signedLongLiteral(node.max, 9007199254740991)},${q(name)});`)
    else if (type === 'float') lines.push(`double ${name}=inf.readDouble(${number(node.min, -1e100)},${number(node.max, 1e100)},${q(name)});`)
    else if (type === 'string') lines.push(`string ${name}=inf.readToken(${q(String(node.pattern || '[^\\s]+'))},${q(name)});`)
    else if (type === 'array') {
      const length = ref(node.length, known), min = signedLongLiteral(node.element?.min, -9007199254740991), max = signedLongLiteral(node.element?.max, 9007199254740991)
      lines.push(`vector<long long> ${name}; ${name}.reserve(${length}); for(long long i=0;i<${length};++i) ${name}.push_back(inf.readLong(${min},${max},${q(`${name}[i]`)}));`); vectors.add(name)
    } else if (type === 'matrix') {
      const rows = ref(node.rows, known), cols = ref(node.cols, known), min = signedLongLiteral(node.element?.min, -9007199254740991), max = signedLongLiteral(node.element?.max, 9007199254740991)
      lines.push(`vector<vector<long long>> ${name}(${rows},vector<long long>(${cols})); for(long long i=0;i<${rows};++i) for(long long j=0;j<${cols};++j) ${name}[i][j]=inf.readLong(${min},${max},${q(`${name}[i][j]`)});`)
    } else if (type === 'edgeList') {
      const count = ref(node.count, known), vertices = ref(node.vertices, known), directed = node.directed === true
      lines.push(`vector<pair<int,int>> ${name}; ${name}.reserve(${count}); for(long long i=0;i<${count};++i){int u=inf.readInt(1,${vertices},"u"),v=inf.readInt(1,${vertices},"v"); ${name}.push_back({u,v});}`); graphs.set(name, { n: vertices, directed })
    } else fail(422, 'VALIDATOR_SPEC_INVALID', `暂不支持输入节点 ${type}`)
    known.add(name)
  }
  for (const assertion of Array.isArray(raw.assertions) ? raw.assertions : []) {
    const builtin = String(assertion?.builtin || ''), args = Array.isArray(assertion?.args) ? assertion.args.map(String) : []
    if (['array.distinct', 'array.sorted', 'array.permutation', 'array.allEqual'].includes(builtin)) {
      const target = ident(args[0]); if (!vectors.has(target)) fail(422, 'VALIDATOR_SPEC_INVALID', `${builtin} 需要数组变量`)
      if (builtin === 'array.distinct') lines.push(`{auto t=${target};sort(t.begin(),t.end());ensuref(unique(t.begin(),t.end())==t.end(),"${target} must be distinct");}`)
      if (builtin === 'array.sorted') lines.push(`ensuref(is_sorted(${target}.begin(),${target}.end()),"${target} must be sorted");`)
      if (builtin === 'array.allEqual') lines.push(`ensuref(${target}.empty()||all_of(${target}.begin(),${target}.end(),[&](auto x){return x==${target}[0];}),"${target} must be all equal");`)
      if (builtin === 'array.permutation') lines.push(`{auto t=${target};sort(t.begin(),t.end());for(int i=0;i<(int)t.size();++i)ensuref(t[i]==i+1,"${target} must be a permutation");}`)
    } else if (builtin.startsWith('graph.')) {
      const target = ident(args[0]), graph = graphs.get(target); if (!graph) fail(422, 'VALIDATOR_SPEC_INVALID', `${builtin} 需要 edgeList 变量`)
      lines.push(`{int N=${graph.n};vector<vector<int>> g(N+1);for(auto [u,v]:${target}){g[u].push_back(v);${graph.directed ? '' : 'g[v].push_back(u);'}}`)
      if (builtin === 'graph.isConnected' || builtin === 'graph.isTree') lines.push(`vector<int> vis(N+1);queue<int>q;q.push(1);vis[1]=1;while(!q.empty()){int u=q.front();q.pop();for(int v:g[u])if(!vis[v])vis[v]=1,q.push(v);}ensuref(count(vis.begin()+1,vis.end(),1)==N,"graph must be connected");${builtin === 'graph.isTree' ? `ensuref((int)${target}.size()==N-1,"graph must be a tree");` : ''}}`)
      else if (builtin === 'graph.isBipartite') lines.push('vector<int> c(N+1,-1);for(int s=1;s<=N;++s)if(c[s]<0){queue<int>q;q.push(s);c[s]=0;while(!q.empty()){int u=q.front();q.pop();for(int v:g[u]){ensuref(c[v]<0||c[v]!=c[u],"graph must be bipartite");if(c[v]<0)c[v]=c[u]^1,q.push(v);}}}}')
      else if (builtin === 'graph.isDAG') lines.push('vector<int>d(N+1);for(int u=1;u<=N;++u)for(int v:g[u])++d[v];queue<int>q;for(int i=1;i<=N;++i)if(!d[i])q.push(i);int seen=0;while(!q.empty()){int u=q.front();q.pop();++seen;for(int v:g[u])if(!--d[v])q.push(v);}ensuref(seen==N,"graph must be a DAG");}')
      else fail(422, 'VALIDATOR_SPEC_INVALID', `不支持断言 ${builtin}`)
    } else fail(422, 'VALIDATOR_SPEC_INVALID', `不支持断言 ${builtin}`)
  }
  lines.push(raw.strictEof === false ? 'return 0;}' : 'inf.readEof();return 0;}')
  const source = lines.join('\n'), specHash = crypto.createHash('sha256').update(JSON.stringify(raw)).digest('hex')
  if (Buffer.byteLength(source) > 256 * 1024) fail(413, 'VALIDATOR_SPEC_TOO_LARGE', 'Validator DSL 编译结果超过上限')
  return { source, specHash }
}

export async function createValidatorSpec(input: { user: JwtPayload; problemId: string; spec: any; origin?: string; aiRequestId?: string; verification?: any }) {
  await requireProgramProblem(input.user, input.problemId)
  const existing = await prisma.validatorSpec.count({ where: { problemId: input.problemId } })
  if (existing >= EVALUATION_LIMITS.maxFeatures) fail(409, 'VALIDATOR_SPEC_LIMIT', 'Validator Spec 版本数量达到上限')
  const compiled = validateAndCompileSpec(input.spec); await compileJudgeProgram(compiled.source, 'cpp17', 'Validator DSL')
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`validator-spec:${input.problemId}`}, 0)) IS NULL AS locked`
    const max = await tx.validatorSpec.aggregate({ where: { problemId: input.problemId }, _max: { versionNumber: true } })
    return tx.validatorSpec.create({ data: { id: crypto.randomUUID(), problemId: input.problemId, versionNumber: (max._max.versionNumber || 0) + 1, spec: input.spec, specHash: compiled.specHash, generatedSource: compiled.source, templateVersion: 'validator-dsl-cpp-v1', compileStatus: 'passed', verification: input.verification || { status: 'compile_only' }, origin: input.origin || 'manual', aiRequestId: input.aiRequestId || null, createdBy: input.user.userId } })
  })
}

export async function listValidatorSpecs(user: JwtPayload, problemId: string) { await requireProgramProblem(user, problemId); return prisma.validatorSpec.findMany({ where: { problemId }, orderBy: { versionNumber: 'desc' } }) }
export async function activateValidatorSpec(input: { user: JwtPayload; problemId: string; specId: string }) {
  await requireProgramProblem(input.user, input.problemId)
  const spec = await prisma.validatorSpec.findFirst({ where: { id: input.specId, problemId: input.problemId, compileStatus: 'passed' } }); if (!spec) fail(404, 'VALIDATOR_SPEC_NOT_FOUND', 'Validator Spec 不存在或未通过编译')
  const activated = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`validator-spec:${input.problemId}`}, 0)) IS NULL AS locked`
    let program = await tx.problemJudgeProgram.findUnique({ where: { problemId_kind_name: { problemId: input.problemId, kind: 'validator', name: 'Validator DSL' } } })
    const versionId = crypto.randomUUID()
    if (!program) {
      program = await tx.problemJudgeProgram.create({ data: { id: crypto.randomUUID(), problemId: input.problemId, kind: 'validator', name: 'Validator DSL', language: 'cpp17', currentVersionId: versionId, createdBy: input.user.userId } })
    }
    const max = await tx.problemJudgeProgramVersion.aggregate({ where: { programId: program.id }, _max: { versionNumber: true } })
    await tx.problemJudgeProgramVersion.updateMany({ where: { programId: program.id, lifecycleStatus: 'active' }, data: { lifecycleStatus: 'retired' } })
    await tx.problemJudgeProgramVersion.create({ data: { id: versionId, programId: program.id, problemId: input.problemId, versionNumber: (max._max.versionNumber || 0) + 1, language: 'cpp17', source: spec.generatedSource, sourceSha256: crypto.createHash('sha256').update(spec.generatedSource).digest('hex'), origin: 'validator_dsl', aiRequestId: spec.aiRequestId, compileStatus: 'passed', protocol: 'oj.validator/v1', protocolVersion: 1, templateId: 'validator-dsl-v1', templateVersion: 1, lifecycleStatus: 'active', runtimeMetadata: { runtime: 'cpp17', usesTestlib: true, generatedFromDsl: true }, preflightReport: spec.verification as any, verifiedAt: new Date(), activatedAt: new Date(), createdBy: input.user.userId } })
    await tx.problemJudgeProgram.update({ where: { id: program.id }, data: { status: 'active', currentVersionId: versionId, language: 'cpp17' } })
    await tx.problemHackConfig.updateMany({ where: { problemId: input.problemId }, data: { validatorProgramVersionId: versionId, validatorSource: spec.generatedSource, validatorLanguage: 'cpp17', revision: { increment: 1 }, updatedBy: input.user.userId } })
    await tx.validatorSpec.updateMany({ where: { problemId: input.problemId, status: 'active' }, data: { status: 'archived' } })
    return tx.validatorSpec.update({ where: { id: spec.id }, data: { status: 'active', activatedAt: new Date() } })
  })
  await refreshAdmittedCandidateStages(input.problemId)
  return activated
}
