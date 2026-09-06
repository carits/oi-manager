process.env.JUDGE_TOKEN ||= 'judge-program-protocol-smoke'

const { generateTestdata } = await import('../src/data-generation')
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
  process.exit(1)
}
console.log(JSON.stringify({ status: candidate.status, classificationStatus: candidate.classificationStatus, subtasks: candidate.affectedSubtaskIds, output: candidate.outputData.trim() }))
