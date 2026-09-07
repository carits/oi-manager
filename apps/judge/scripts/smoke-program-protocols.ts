async function main() {
  process.env.JUDGE_TOKEN ||= 'judge-program-protocol-smoke'
  const { JUDGE_PROGRAM_TEMPLATES, getJudgeProgramTemplate } = await import('@oi-manager/shared')
  const { generateTestdata } = await import('../src/data-generation')
  const { verifyJudgeProgram } = await import('../src/judge-program-verification')
  const { disposeCompiledProgramCache } = await import('../src/compiled-program-cache')
  const { initializeSandbox } = await import('../src/sandbox/client')
  await initializeSandbox()
  const result = await generateTestdata({
  taskType: 'data_generation', jobId: 'judge-program-protocol-smoke', problemId: 'protocol-smoke', fencingToken: 'smoke', sourceMode: 'generator',
  problemConfig: { mode: 'oi', checker_type: 'default', subtasks: [{ id: 1, score: 100, type: 'min' }] },
  generator: { language: 'python3', protocol: 'oj.generator/v1', source: `import json
import sys
context = json.load(sys.stdin)
print(int(context["seed"]) % 10, 2)
` },
  validator: { language: 'python3', protocol: 'oj.validator/v1', source: `import sys
tokens = sys.stdin.buffer.read().split()
raise SystemExit(0 if len(tokens) == 2 and all(token.lstrip(b"-").isdigit() for token in tokens) else 1)
` },
  classifier: { language: 'python3', protocol: 'oj.classifier/v1', source: `import json
import sys
sys.stdin.buffer.read()
print(json.dumps({"subtasks": [1]}))
` },
  standard: { language: 'cpp17', source: `#include <iostream>
int main() {
    long long a, b;
    if (std::cin >> a >> b) std::cout << a + b << '\\n';
}
` },
  cases: [{ id: 'case-1', name: 'smoke', args: [], seed: '123', profile: 'random', params: {} }],
  })

  const candidate = result.cases[0]
  if (candidate?.status !== 'validated' || candidate.classificationStatus !== 'classified' || candidate.outputData !== '5\n' || candidate.affectedSubtaskIds?.[0] !== 1) {
    console.error(JSON.stringify(result))
    process.exitCode = 1
    return
  }
  const validator = getJudgeProgramTemplate('validator-cpp17-v1')!
  const standard = getJudgeProgramTemplate('standard-cpp17-v1')!
  const verified: string[] = []
  try {
    for (const template of JUDGE_PROGRAM_TEMPLATES.filter(item => item.language !== 'validator-dsl')) {
      const verification = await verifyJudgeProgram({
        taskType: 'judge_program_verification',
        jobId: `template-smoke-${template.id}`,
        problemId: 'template-smoke',
        programId: template.id,
        versionId: `${template.id}-v${template.version}`,
        fixtureSetId: `${template.id}-fixtures`,
        fencingToken: 'template-smoke',
        mode: 'preflight',
        kind: template.kind,
        language: template.language,
        protocol: template.protocol,
        source: template.source,
        fixtures: template.examples.map(item => ({ ...item })),
        knownSubtaskIds: [1, 2, 3],
        problemConfig: {
          mode: 'oi', checker_type: 'default',
          subtasks: [1, 2, 3].map(id => ({ id, score: id === 3 ? 34 : 33, type: 'min', cases: [] })),
        },
        integration: {
          ...(template.kind === 'generator' || template.kind === 'classifier' ? { validator: { language: validator.language as 'cpp17', source: validator.source } } : {}),
          ...(template.kind === 'generator' ? { standard: { language: 'cpp17' as const, source: standard.source } } : {}),
        },
      })
      if (verification.outcome !== 'success') throw new Error(`${template.id}: ${verification.code} ${verification.message}`)
      verified.push(template.id)
    }
  } finally {
    await disposeCompiledProgramCache()
  }
  console.log(JSON.stringify({ status: candidate.status, classificationStatus: candidate.classificationStatus, subtasks: candidate.affectedSubtaskIds, output: candidate.outputData.trim(), verifiedTemplates: verified }))
}

main().catch(error => { console.error(error); process.exitCode = 1 })
