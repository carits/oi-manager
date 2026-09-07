export const JUDGE_PROGRAM_KINDS = ['standard', 'validator', 'classifier', 'generator'] as const
export type JudgeProgramKind = typeof JUDGE_PROGRAM_KINDS[number]
export type JudgeProgramLanguage = 'cpp17' | 'python3' | 'validator-dsl'
export type JudgeProgramProtocol = 'oj.standard/v1' | 'oj.validator/v1' | 'oj.classifier/v1' | 'oj.generator/v1' | 'legacy-args-v1'

export const GENERATOR_CONTEXT_V1_SCHEMA = {
  $id: 'oj.generator/v1', type: 'object', additionalProperties: false,
  required: ['protocol', 'seed', 'caseId', 'profile', 'params'],
  properties: {
    protocol: { const: 'oj.generator/v1' }, seed: { type: 'string', pattern: '^[0-9]+$' },
    caseId: { type: 'integer', minimum: 1 }, profile: { type: 'string', minLength: 1, maxLength: 80 },
    params: { type: 'object', additionalProperties: { type: ['string', 'number', 'integer', 'boolean'] } },
  },
} as const

export const CLASSIFIER_OUTPUT_V1_SCHEMA = {
  $id: 'oj.classifier/v1', type: 'object', additionalProperties: false, required: ['subtasks'],
  properties: { subtasks: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'integer', minimum: 1 } } },
} as const

export type JudgeProgramCapability = {
  languages: Partial<Record<JudgeProgramLanguage, readonly JudgeProgramProtocol[]>>
  defaultLanguage: JudgeProgramLanguage
  title: string
  description: string
  quickProtocol: readonly string[]
}

export const JUDGE_PROGRAM_CAPABILITIES: Record<JudgeProgramKind, JudgeProgramCapability> = {
  standard: {
    languages: { cpp17: ['oj.standard/v1'] }, defaultLanguage: 'cpp17',
    title: '标准程序 Standard Solution', description: '对合法测试输入运行，生成正式标准答案。',
    quickProtocol: ['stdin：完整测试输入', 'stdout：正式标准答案', 'exit 0：运行成功'],
  },
  generator: {
    languages: { cpp17: ['oj.generator/v1', 'legacy-args-v1'], python3: ['oj.generator/v1'] }, defaultLanguage: 'python3',
    title: '数据生成器 Generator', description: '根据系统提供的种子、数据类型和参数生成一份候选测试输入。',
    quickProtocol: ['stdin：oj.generator/v1 Context', 'stdout：只能输出一份测试输入', 'stderr：限长调试信息', '相同 Context 必须输出完全相同的数据'],
  },
  validator: {
    languages: { cpp17: ['oj.validator/v1'], python3: ['oj.validator/v1'], 'validator-dsl': ['oj.validator/v1'] }, defaultLanguage: 'validator-dsl',
    title: '输入校验器 Validator', description: '判断测试输入是否完全满足题目格式和约束；它不判断答案是否正确。',
    quickProtocol: ['stdin：完整测试输入', 'exit 0：输入合法', '非 0：拒绝输入', 'stderr：限长拒绝原因'],
  },
  classifier: {
    languages: { cpp17: ['oj.classifier/v1'], python3: ['oj.classifier/v1'] }, defaultLanguage: 'cpp17',
    title: '子任务分类器 Classifier', description: 'OI 题中返回数据满足的全部 Subtask，而不是只选择一个最合适的 Subtask。',
    quickProtocol: ['stdin：已经通过 Validator 的完整输入', 'stdout：严格 JSON {"subtasks":[1,2]}', '必须返回全部满足的 Subtask', '非 0：分类程序故障'],
  },
}

export type JudgeProgramTemplate = {
  id: string
  version: number
  kind: JudgeProgramKind
  language: JudgeProgramLanguage
  protocol: JudgeProgramProtocol
  title: string
  description: string
  recommended: boolean
  source: string
  protocolHelp: readonly string[]
  examples: readonly { name: string; stdin: string; expectedExitCode?: number; expectedStdout?: string }[]
}

const PY_GENERATOR = `import json
import random
import sys

def main():
    ctx = json.load(sys.stdin)
    seed = int(ctx["seed"])
    profile = ctx["profile"]
    params = ctx.get("params", {})
    rng = random.Random(seed)
    n_min = int(params.get("nMin", 1))
    n_max = int(params.get("nMax", 10))
    n = n_max if profile == "max" else rng.randint(n_min, n_max)
    print(n)
    print(*(rng.randint(-100, 100) for _ in range(n)))

if __name__ == "__main__":
    main()
`

const CPP_GENERATOR = `#include "oj_generator.hpp"
#include <iostream>
#include <random>
using namespace std;

void generate(const oj::GeneratorContext &ctx) {
    mt19937_64 rng(ctx.seed());
    int nMin = ctx.paramInt("nMin", 1);
    int nMax = ctx.paramInt("nMax", 10);
    int n = ctx.profile() == "max" ? nMax : uniform_int_distribution<int>(nMin, nMax)(rng);
    cout << n << '\\n';
    for (int i = 0; i < n; ++i) cout << uniform_int_distribution<int>(-100, 100)(rng) << (i + 1 == n ? '\\n' : ' ');
}

OJ_GENERATOR_MAIN(generate)
`

const PY_VALIDATOR = `import sys

def reject(message: str):
    print(message, file=sys.stderr)
    raise SystemExit(1)

def main():
    tokens = sys.stdin.buffer.read().split()
    if not tokens:
        reject("empty input")
    try:
        n = int(tokens[0])
    except ValueError:
        reject("n is not an integer")
    if not 1 <= n <= 200000:
        reject("n out of range")
    if len(tokens) != n + 1:
        reject("array length mismatch or extra token")
    for index, token in enumerate(tokens[1:]):
        try:
            value = int(token)
        except ValueError:
            reject(f"a[{index}] is not an integer")
        if not -10**9 <= value <= 10**9:
            reject(f"a[{index}] out of range")

if __name__ == "__main__":
    main()
`

const CPP_VALIDATOR = `#include "testlib.h"
#include <vector>
using namespace std;

int main(int argc, char **argv) {
    registerValidation(argc, argv);
    int n = inf.readInt(1, 200000, "n");
    inf.readEoln();
    for (int i = 0; i < n; ++i) {
        inf.readLong(-1000000000LL, 1000000000LL, "a[i]");
        if (i + 1 < n) inf.readSpace();
    }
    inf.readEoln();
    inf.readEof();
}
`

const PY_CLASSIFIER = `import json
import sys

def main():
    data = list(map(int, sys.stdin.buffer.read().split()))
    n, values = data[0], data[1:]
    subtasks = []
    if n <= 100:
        subtasks.append(1)
    if values and all(value == 0 for value in values):
        subtasks.append(2)
    subtasks.append(3)  # 完整约束 Subtask；请按本题实际 ID 修改
    print(json.dumps({"subtasks": sorted(set(subtasks))}, separators=(",", ":")))

if __name__ == "__main__":
    main()
`

const CPP_CLASSIFIER = `#include <algorithm>
#include <iostream>
#include <vector>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    if (!(cin >> n)) { cerr << "invalid input\\n"; return 1; }
    vector<long long> values(n);
    for (auto &value : values) cin >> value;
    vector<int> subtasks;
    if (n <= 100) subtasks.push_back(1);
    if (all_of(values.begin(), values.end(), [](long long value) { return value == 0; })) subtasks.push_back(2);
    subtasks.push_back(3); // 完整约束 Subtask；请按本题实际 ID 修改
    sort(subtasks.begin(), subtasks.end());
    subtasks.erase(unique(subtasks.begin(), subtasks.end()), subtasks.end());
    cout << "{\\\"subtasks\\\":[";
    for (size_t i = 0; i < subtasks.size(); ++i) cout << (i ? "," : "") << subtasks[i];
    cout << "]}\\n";
}
`

const CPP_STANDARD = `#include <iostream>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    // 读取题目输入并输出标准答案。
    return 0;
}
`

export const JUDGE_PROGRAM_TEMPLATES: readonly JudgeProgramTemplate[] = [
  { id: 'standard-cpp17-v1', version: 1, kind: 'standard', language: 'cpp17', protocol: 'oj.standard/v1', title: 'C++17 标准程序', description: JUDGE_PROGRAM_CAPABILITIES.standard.description, recommended: true, source: CPP_STANDARD, protocolHelp: JUDGE_PROGRAM_CAPABILITIES.standard.quickProtocol, examples: [] },
  { id: 'generator-python3-v1', version: 1, kind: 'generator', language: 'python3', protocol: 'oj.generator/v1', title: 'Python3 数据生成器', description: JUDGE_PROGRAM_CAPABILITIES.generator.description, recommended: true, source: PY_GENERATOR, protocolHelp: JUDGE_PROGRAM_CAPABILITIES.generator.quickProtocol, examples: [{ name: '随机小数据', stdin: '{"protocol":"oj.generator/v1","seed":"1","caseId":1,"profile":"random","params":{"nMin":1,"nMax":5}}' }] },
  { id: 'generator-cpp17-v1', version: 1, kind: 'generator', language: 'cpp17', protocol: 'oj.generator/v1', title: 'C++17 数据生成器', description: JUDGE_PROGRAM_CAPABILITIES.generator.description, recommended: false, source: CPP_GENERATOR, protocolHelp: JUDGE_PROGRAM_CAPABILITIES.generator.quickProtocol, examples: [{ name: '随机小数据', stdin: '{"protocol":"oj.generator/v1","seed":"1","caseId":1,"profile":"random","params":{"nMin":1,"nMax":5}}' }] },
  { id: 'validator-python3-v1', version: 1, kind: 'validator', language: 'python3', protocol: 'oj.validator/v1', title: 'Python3 输入校验器', description: JUDGE_PROGRAM_CAPABILITIES.validator.description, recommended: false, source: PY_VALIDATOR, protocolHelp: JUDGE_PROGRAM_CAPABILITIES.validator.quickProtocol, examples: [{ name: '应通过', stdin: '3\n1 2 3\n', expectedExitCode: 0 }, { name: '应拒绝', stdin: '0\n', expectedExitCode: 1 }] },
  { id: 'validator-dsl-v1', version: 1, kind: 'validator', language: 'cpp17', protocol: 'oj.validator/v1', title: 'Validator DSL 编译产物', description: '由平台可信 DSL 编译器生成的 C++17 + testlib Validator。', recommended: false, source: CPP_VALIDATOR, protocolHelp: JUDGE_PROGRAM_CAPABILITIES.validator.quickProtocol, examples: [{ name: '应通过', stdin: '3\n1 2 3\n', expectedExitCode: 0 }, { name: '应拒绝', stdin: '0\n', expectedExitCode: 1 }] },
  { id: 'validator-cpp17-v1', version: 1, kind: 'validator', language: 'cpp17', protocol: 'oj.validator/v1', title: 'C++17 + testlib 输入校验器', description: JUDGE_PROGRAM_CAPABILITIES.validator.description, recommended: false, source: CPP_VALIDATOR, protocolHelp: JUDGE_PROGRAM_CAPABILITIES.validator.quickProtocol, examples: [{ name: '应通过', stdin: '3\n1 2 3\n', expectedExitCode: 0 }, { name: '应拒绝', stdin: '0\n', expectedExitCode: 1 }] },
  { id: 'classifier-python3-v1', version: 1, kind: 'classifier', language: 'python3', protocol: 'oj.classifier/v1', title: 'Python3 子任务分类器', description: JUDGE_PROGRAM_CAPABILITIES.classifier.description, recommended: false, source: PY_CLASSIFIER, protocolHelp: JUDGE_PROGRAM_CAPABILITIES.classifier.quickProtocol, examples: [] },
  { id: 'classifier-cpp17-v1', version: 1, kind: 'classifier', language: 'cpp17', protocol: 'oj.classifier/v1', title: 'C++17 子任务分类器', description: JUDGE_PROGRAM_CAPABILITIES.classifier.description, recommended: true, source: CPP_CLASSIFIER, protocolHelp: JUDGE_PROGRAM_CAPABILITIES.classifier.quickProtocol, examples: [] },
]

export function getJudgeProgramTemplate(id: string) {
  return JUDGE_PROGRAM_TEMPLATES.find(template => template.id === id) || null
}

export function defaultProtocolFor(kind: JudgeProgramKind, language: JudgeProgramLanguage): JudgeProgramProtocol | null {
  const protocols = JUDGE_PROGRAM_CAPABILITIES[kind].languages[language]
  return protocols?.find(protocol => protocol !== 'legacy-args-v1') || null
}

export function isJudgeProgramCombinationAllowed(kind: string, language: string, protocol: string, allowLegacy = true): boolean {
  if (!JUDGE_PROGRAM_KINDS.includes(kind as JudgeProgramKind)) return false
  const protocols = JUDGE_PROGRAM_CAPABILITIES[kind as JudgeProgramKind].languages[language as JudgeProgramLanguage]
  return Boolean(protocols?.includes(protocol as JudgeProgramProtocol) && (allowLegacy || protocol !== 'legacy-args-v1'))
}

export class ClassifierProtocolError extends Error {
  constructor(public readonly code: 'CLASSIFIER_INVALID_JSON' | 'CLASSIFIER_SCHEMA_INVALID' | 'CLASSIFIER_EMPTY_SUBTASKS' | 'CLASSIFIER_UNKNOWN_SUBTASK', message: string) { super(message) }
}

export class GeneratorProtocolError extends Error {
  constructor(public readonly code: 'GENERATOR_INVALID_JSON' | 'GENERATOR_SCHEMA_INVALID', message: string) { super(message) }
}

export type GeneratorContextV1 = {
  protocol: 'oj.generator/v1'
  seed: string
  caseId: number
  profile: string
  params: Record<string, string | number | boolean>
}

function duplicateTopLevelKeys(source: string) {
  const keys: string[] = []
  let depth = 0, index = 0, inString = false, escaped = false, current = '', stringDepth = 0
  while (index < source.length) {
    const character = source[index++]
    if (inString) {
      if (escaped) { escaped = false; continue }
      if (character === '\\') { escaped = true; continue }
      if (character === '"') {
        inString = false
        let cursor = index
        while (/\s/.test(source[cursor] || '')) cursor++
        if (stringDepth === 1 && source[cursor] === ':') keys.push(current)
      } else current += character
      continue
    }
    if (character === '"') { inString = true; current = ''; stringDepth = depth; continue }
    if (character === '{' || character === '[') depth++
    if (character === '}' || character === ']') depth--
  }
  return keys.filter((key, position) => keys.indexOf(key) !== position)
}

export function parseGeneratorContext(source: string): GeneratorContextV1 {
  let parsed: unknown
  try { parsed = JSON.parse(source) }
  catch { throw new GeneratorProtocolError('GENERATOR_INVALID_JSON', 'Generator Context 必须是合法 JSON') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new GeneratorProtocolError('GENERATOR_SCHEMA_INVALID', 'Generator Context 必须是对象')
  const record = parsed as Record<string, unknown>
  const expected = ['protocol', 'seed', 'caseId', 'profile', 'params']
  if (Object.keys(record).sort().join('\0') !== [...expected].sort().join('\0') || duplicateTopLevelKeys(source).length) throw new GeneratorProtocolError('GENERATOR_SCHEMA_INVALID', 'Generator Context 字段缺失、重复或包含额外字段')
  if (record.protocol !== 'oj.generator/v1') throw new GeneratorProtocolError('GENERATOR_SCHEMA_INVALID', 'Generator Context 协议必须是 oj.generator/v1')
  const normalizedSeed = typeof record.seed === 'string' ? record.seed.replace(/^0+(?=\d)/, '') : ''
  if (
    typeof record.seed !== 'string'
    || !/^[0-9]+$/.test(record.seed)
    || normalizedSeed.length > 20
    || (normalizedSeed.length === 20 && normalizedSeed > '18446744073709551615')
  ) throw new GeneratorProtocolError('GENERATOR_SCHEMA_INVALID', 'seed 必须是 uint64 十进制字符串')
  if (typeof record.caseId !== 'number' || !Number.isSafeInteger(record.caseId) || record.caseId < 1) throw new GeneratorProtocolError('GENERATOR_SCHEMA_INVALID', 'caseId 必须是正整数')
  if (typeof record.profile !== 'string' || !record.profile.trim() || record.profile.length > 80) throw new GeneratorProtocolError('GENERATOR_SCHEMA_INVALID', 'profile 长度必须为 1～80')
  if (!record.params || typeof record.params !== 'object' || Array.isArray(record.params)) throw new GeneratorProtocolError('GENERATOR_SCHEMA_INVALID', 'params 必须是对象')
  for (const [key, value] of Object.entries(record.params as Record<string, unknown>)) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(key) || !['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) throw new GeneratorProtocolError('GENERATOR_SCHEMA_INVALID', `参数 ${key || '—'} 类型或名称无效`)
  }
  return record as GeneratorContextV1
}

export function parseClassifierOutput(output: string, knownSubtaskIds: readonly number[]): number[] {
  let parsed: unknown
  try { parsed = JSON.parse(output) } catch { throw new ClassifierProtocolError('CLASSIFIER_INVALID_JSON', 'Classifier 必须输出严格 JSON') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ClassifierProtocolError('CLASSIFIER_SCHEMA_INVALID', 'Classifier 输出必须是对象')
  const record = parsed as Record<string, unknown>
  if (Object.keys(record).length !== 1 || !Array.isArray(record.subtasks)) throw new ClassifierProtocolError('CLASSIFIER_SCHEMA_INVALID', 'Classifier 输出只允许包含 subtasks 数组')
  if (record.subtasks.length === 0) throw new ClassifierProtocolError('CLASSIFIER_EMPTY_SUBTASKS', 'Classifier 必须返回至少一个 Subtask')
  const ids = record.subtasks
  if (ids.some(id => typeof id !== 'number' || !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length) throw new ClassifierProtocolError('CLASSIFIER_SCHEMA_INVALID', 'Subtask ID 必须是互不重复的正整数')
  const known = new Set(knownSubtaskIds)
  const unknown = (ids as number[]).filter(id => !known.has(id))
  if (unknown.length) throw new ClassifierProtocolError('CLASSIFIER_UNKNOWN_SUBTASK', `Classifier 返回未知 Subtask：${unknown.join(', ')}`)
  return [...ids as number[]].sort((left, right) => left - right)
}

export const OJ_GENERATOR_CPP_HEADER = String.raw`#pragma once
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <limits>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
namespace oj {
struct JsonValue {
  enum Type { String, Number, Boolean, Object } type;
  std::string text;
  double number = 0;
  bool boolean = false;
  std::map<std::string, JsonValue> object;
};
class JsonParser {
  const std::string &source_; std::size_t position_ = 0;
  [[noreturn]] void fail(const std::string &message) const { throw std::runtime_error("invalid oj.generator/v1 context: " + message); }
  void whitespace() { while (position_ < source_.size() && (source_[position_] == ' ' || source_[position_] == '\n' || source_[position_] == '\r' || source_[position_] == '\t')) ++position_; }
  char take() { if (position_ >= source_.size()) fail("unexpected end"); return source_[position_++]; }
  std::string string() {
    if (take() != '"') fail("string expected"); std::string result;
    while (position_ < source_.size()) {
      char c = take(); if (c == '"') return result;
      if (static_cast<unsigned char>(c) < 0x20) fail("control character in string");
      if (c != '\\') { result += c; continue; }
      char e = take();
      if (e == '"' || e == '\\' || e == '/') result += e;
      else if (e == 'b') result += '\b'; else if (e == 'f') result += '\f'; else if (e == 'n') result += '\n'; else if (e == 'r') result += '\r'; else if (e == 't') result += '\t';
      else fail("unsupported string escape");
    }
    fail("unterminated string");
  }
  JsonValue number() {
    std::size_t start = position_;
    if (source_[position_] == '-') ++position_;
    if (position_ >= source_.size() || source_[position_] < '0' || source_[position_] > '9') fail("number expected");
    if (source_[position_] == '0') ++position_; else while (position_ < source_.size() && source_[position_] >= '0' && source_[position_] <= '9') ++position_;
    if (position_ < source_.size() && source_[position_] == '.') { ++position_; if (position_ >= source_.size() || !std::isdigit(static_cast<unsigned char>(source_[position_]))) fail("fraction expected"); while (position_ < source_.size() && std::isdigit(static_cast<unsigned char>(source_[position_]))) ++position_; }
    if (position_ < source_.size() && (source_[position_] == 'e' || source_[position_] == 'E')) { ++position_; if (position_ < source_.size() && (source_[position_] == '+' || source_[position_] == '-')) ++position_; if (position_ >= source_.size() || !std::isdigit(static_cast<unsigned char>(source_[position_]))) fail("exponent expected"); while (position_ < source_.size() && std::isdigit(static_cast<unsigned char>(source_[position_]))) ++position_; }
    std::string text = source_.substr(start, position_ - start); char *end = nullptr; double value = std::strtod(text.c_str(), &end);
    if (!end || *end || !std::isfinite(value)) fail("finite number required"); JsonValue result{JsonValue::Number}; result.text = text; result.number = value; return result;
  }
  JsonValue object() {
    if (take() != '{') fail("object expected"); JsonValue result{JsonValue::Object}; whitespace(); if (position_ < source_.size() && source_[position_] == '}') { ++position_; return result; }
    while (true) {
      whitespace(); if (position_ >= source_.size() || source_[position_] != '"') fail("object key expected"); std::string key = string(); whitespace(); if (take() != ':') fail("colon expected"); whitespace();
      if (result.object.count(key)) fail("duplicate key: " + key); result.object.emplace(key, value()); whitespace(); char delimiter = take(); if (delimiter == '}') return result; if (delimiter != ',') fail("comma expected");
    }
  }
public:
  explicit JsonParser(const std::string &source): source_(source) {}
  JsonValue value() {
    whitespace(); if (position_ >= source_.size()) fail("value expected"); char c = source_[position_];
    if (c == '"') { JsonValue result{JsonValue::String}; result.text = string(); return result; }
    if (c == '{') return object();
    if (source_.compare(position_, 4, "true") == 0) { position_ += 4; JsonValue result{JsonValue::Boolean}; result.boolean = true; return result; }
    if (source_.compare(position_, 5, "false") == 0) { position_ += 5; JsonValue result{JsonValue::Boolean}; return result; }
    if (c == '-' || (c >= '0' && c <= '9')) return number();
    fail("unsupported value type");
  }
  JsonValue parse() { JsonValue result = value(); whitespace(); if (position_ != source_.size()) fail("trailing content"); return result; }
};
class GeneratorContext {
  std::uint64_t seed_; std::uint64_t caseId_; std::string profile_; std::map<std::string, JsonValue> params_;
  static const JsonValue &required(const std::map<std::string, JsonValue> &object, const std::string &key, JsonValue::Type type) { auto it = object.find(key); if (it == object.end() || it->second.type != type) throw std::runtime_error("invalid oj.generator/v1 context field: " + key); return it->second; }
public:
  explicit GeneratorContext(const std::string &raw) {
    JsonValue root = JsonParser(raw).parse(); if (root.type != JsonValue::Object || root.object.size() != 5) throw std::runtime_error("oj.generator/v1 context must contain exactly protocol, seed, caseId, profile and params");
    if (required(root.object, "protocol", JsonValue::String).text != "oj.generator/v1") throw std::runtime_error("unsupported generator protocol");
    const std::string &seed = required(root.object, "seed", JsonValue::String).text; if (seed.empty() || seed.find_first_not_of("0123456789") != std::string::npos) throw std::runtime_error("seed must be uint64 decimal string");
    std::size_t used = 0; try { seed_ = std::stoull(seed, &used); } catch (...) { throw std::runtime_error("seed out of uint64 range"); } if (used != seed.size()) throw std::runtime_error("seed out of uint64 range");
    const JsonValue &caseId = required(root.object, "caseId", JsonValue::Number); if (caseId.number < 1 || caseId.number > 9007199254740991.0 || std::floor(caseId.number) != caseId.number) throw std::runtime_error("caseId must be a positive safe integer"); caseId_ = static_cast<std::uint64_t>(caseId.number);
    profile_ = required(root.object, "profile", JsonValue::String).text; if (profile_.empty() || profile_.size() > 80) throw std::runtime_error("profile length must be 1..80");
    params_ = required(root.object, "params", JsonValue::Object).object;
    for (const auto &entry : params_) if (entry.second.type == JsonValue::Object) throw std::runtime_error("generator params must be primitive values");
  }
  std::uint64_t seed() const { return seed_; }
  std::uint64_t caseId() const { return caseId_; }
  const std::string &profile() const { return profile_; }
  long long paramInt(const std::string &key, long long fallback = 0) const { auto it = params_.find(key); if (it == params_.end()) return fallback; if (it->second.type != JsonValue::Number || std::floor(it->second.number) != it->second.number || it->second.number < static_cast<double>(std::numeric_limits<long long>::min()) || it->second.number > static_cast<double>(std::numeric_limits<long long>::max())) throw std::runtime_error("integer parameter required: " + key); return static_cast<long long>(it->second.number); }
  double paramNumber(const std::string &key, double fallback = 0) const { auto it = params_.find(key); if (it == params_.end()) return fallback; if (it->second.type != JsonValue::Number) throw std::runtime_error("number parameter required: " + key); return it->second.number; }
  bool paramBool(const std::string &key, bool fallback = false) const { auto it = params_.find(key); if (it == params_.end()) return fallback; if (it->second.type != JsonValue::Boolean) throw std::runtime_error("boolean parameter required: " + key); return it->second.boolean; }
  std::string paramString(const std::string &key, const std::string &fallback = "") const { auto it = params_.find(key); if (it == params_.end()) return fallback; if (it->second.type != JsonValue::String) throw std::runtime_error("string parameter required: " + key); return it->second.text; }
};
}
#define OJ_GENERATOR_MAIN(functionName) int main() { try { std::ostringstream input; input << std::cin.rdbuf(); oj::GeneratorContext context(input.str()); functionName(context); return 0; } catch (const std::exception &error) { std::cerr << error.what() << '\n'; return 1; } }
`
