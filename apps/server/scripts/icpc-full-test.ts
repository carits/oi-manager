/**
 * ICPC 全结果类型测试脚本
 *
 * 通过 API 提交覆盖 8 种评测结果：AC/WA/TLE/MLE/RE/CE/PE/OLE
 * 验证排名正确性和罚时计算
 */

import { prisma } from '../src/prisma'
import * as jwt from 'jsonwebtoken'
import { getJwtSecret } from '../src/lib/jwtSecret'

const API_BASE = 'http://localhost:3002/api'
const TRAINING_ID = 4

// 错误代码模板（不依赖特定题目）
const ERROR_CODES = {
  WA: `#include <iostream>
using namespace std;
int main() { cout << 0 << endl; return 0; }`,

  TLE: `#include <iostream>
using namespace std;
int main() { while(1); return 0; }`,

  MLE: `#include <iostream>
using namespace std;
int main() {
  const int size = 300 * 1024 * 1024;
  char* arr = new char[size];
  return 0;
}`,

  RE: `#include <iostream>
using namespace std;
int main() { int *p = nullptr; *p = 1; return 0; }`,

  CE: `int main() { this is not valid c++ }`,

  OLE: `#include <iostream>
using namespace std;
int main() { while(1) cout << "x"; return 0; }`
}

// AC 代码（针对每道题）
const AC_CODES: Record<string, string> = {
  '1005': `#include <iostream>
using namespace std;
int main() { int a, b; cin >> a >> b; cout << a + b << endl; return 0; }`,

  '1006': `#include <iostream>
using namespace std;
int main() {
  int n; cin >> n;
  long long sum = 0;
  for (int i = 0; i < n; i++) { int x; cin >> x; sum += x; }
  cout << sum << endl;
  return 0;
}`,

  '1007': `#include <iostream>
using namespace std;
int main() {
  int n; cin >> n;
  long long f[100] = {1, 1};
  for (int i = 2; i <= n; i++) f[i] = f[i-1] + f[i-2];
  cout << f[n] << endl;
  return 0;
}`,

  '1008': `#include <iostream>
#include <algorithm>
using namespace std;
int main() {
  int n; cin >> n;
  int a[1000];
  for (int i = 0; i < n; i++) cin >> a[i];
  sort(a, a + n);
  for (int i = 0; i < n; i++) cout << a[i] << (i < n-1 ? " " : "\n");
  return 0;
}`,

  '1009': `#include <iostream>
#include <algorithm>
using namespace std;
int main() {
  int n, x; cin >> n >> x;
  int a[1000];
  for (int i = 0; i < n; i++) cin >> a[i];
  int pos = lower_bound(a, a + n, x) - a;
  cout << pos << endl;
  return 0;
}`,

  '1010': `#include <iostream>
#include <string>
using namespace std;
int main() {
  string s, t; cin >> s >> t;
  size_t pos = s.find(t);
  cout << (pos == string::npos ? -1 : (int)pos) << endl;
  return 0;
}`,

  '1011': `#include <iostream>
using namespace std;
int main() {
  int n, m; cin >> n >> m;
  int w[100], v[100];
  for (int i = 0; i < n; i++) cin >> w[i] >> v[i];
  int dp[1000] = {0};
  for (int i = 0; i < n; i++)
    for (int j = m; j >= w[i]; j--)
      dp[j] = max(dp[j], dp[j-w[i]] + v[i]);
  cout << dp[m] << endl;
  return 0;
}`,

  '1012': `#include <iostream>
#include <queue>
#include <vector>
#include <climits>
using namespace std;
int main() {
  int n, m; cin >> n >> m;
  vector<vector<pair<int,int>>> adj(n);
  for (int i = 0; i < m; i++) {
    int u, v, w; cin >> u >> v >> w;
    adj[u].push_back({v, w});
  }
  vector<int> dist(n, INT_MAX);
  dist[0] = 0;
  priority_queue<pair<int,int>, vector<pair<int,int>>, greater<pair<int,int>>> pq;
  pq.push({0, 0});
  while (!pq.empty()) {
    auto [d, u] = pq.top(); pq.pop();
    if (d > dist[u]) continue;
    for (auto [v, w] : adj[u])
      if (dist[u] + w < dist[v]) {
        dist[v] = dist[u] + w;
        pq.push({dist[v], v});
      }
  }
  cout << dist[n-1] << endl;
  return 0;
}`,

  '1013': `#include <iostream>
using namespace std;
int gcd(int a, int b) { return b ? gcd(b, a % b) : a; }
int main() {
  int a, b; cin >> a >> b;
  cout << gcd(a, b) << endl;
  return 0;
}`,

  '1014': `#include <iostream>
#include <string>
#include <sstream>
#include <stack>
using namespace std;
int main() {
  string line; getline(cin, line);
  stringstream ss(line);
  stack<int> nums;
  stack<char> ops;
  string token;
  while (ss >> token) {
    if (token == "+" || token == "-" || token == "*" || token == "/") {
      ops.push(token[0]);
    } else {
      nums.push(stoi(token));
      if (nums.size() >= 2) {
        int b = nums.top(); nums.pop();
        int a = nums.top(); nums.pop();
        char op = ops.top(); ops.pop();
        int res;
        if (op == '+') res = a + b;
        else if (op == '-') res = a - b;
        else if (op == '*') res = a * b;
        else res = a / b;
        nums.push(res);
      }
    }
  }
  cout << nums.top() << endl;
  return 0;
}`
}

// PE 代码（AC 代码输出后加空格）
function getPECode(problemId: string): string {
  const acCode = AC_CODES[problemId]
  if (!acCode) return ERROR_CODES.WA
  // 在 cout 末尾加空格（替换 endl 为 " "）
  return acCode.replace('endl', '" "')
}

interface StudentInfo {
  studentId: string
  userId: string
  name: string
  username: string
}

interface ProblemInfo {
  problemId: string
  alias: string
  internalId: string
}

async function main() {
  console.log('=== ICPC 全结果类型测试 ===\n')

  // 1. 获取训练数据
  const training = await prisma.training.findUnique({
    where: { id: TRAINING_ID },
    include: {
      TrainingProblem: { include: { Problem: true }, orderBy: { orderIndex: 'asc' } }
    }
  })

  if (!training) {
    console.error('Training 4 not found')
    return
  }

  console.log('训练:', training.name)

  // 2. 获取题目列表（internalId = TrainingProblem.id，用于提交 API）
  const problems: ProblemInfo[] = training.TrainingProblem.map(tp => ({
    problemId: tp.Problem.problemId,
    alias: tp.alias,
    internalId: tp.id
  }))
  console.log('题目:', problems.map(p => p.problemId).join(', '))

  // 3. 获取学生列表
  const members = await prisma.teamMember.findMany({
    where: { teamId: training.teamId, userType: 'student' }
  })

  const students = await prisma.student.findMany({
    where: { id: { in: members.map(m => m.userId) } }
  })

  const users = await prisma.user.findMany({
    where: { id: { in: students.map(s => s.userId) } }
  })

  const studentList: StudentInfo[] = students.map(s => ({
    studentId: s.id,
    userId: s.userId,
    name: s.name,
    username: users.find(u => u.id === s.userId)?.username || ''
  }))

  console.log('学生:', studentList.map(s => s.username).join(', '))
  console.log()

  // 4. 生成 token
  const jwtSecret = getJwtSecret()

  function generateToken(userId: string, studentId: string, username: string): string {
    return jwt.sign(
      { userId, role: 'student', studentId, schoolId: training.schoolId, username },
      jwtSecret,
      { expiresIn: '7d' }
    )
  }

  // 5. 提交函数（使用 trainingProblemId 即内部 Problem.id）
  const problemIdToInternalId = new Map(problems.map(p => [p.problemId, p.internalId]))

  async function submit(userId: string, token: string, problemId: string, code: string): Promise<number> {
    const trainingProblemId = problemIdToInternalId.get(problemId)
    if (!trainingProblemId) {
      console.error('  未找到内部ID:', problemId)
      return -1
    }
    const res = await fetch(API_BASE + '/trainings/' + TRAINING_ID + '/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ trainingProblemId, code, language: 'cpp' })
    })

    const data = await res.json()
    if (!data.success) {
      console.error('提交失败:', data.message)
      return -1
    }
    return data.data.submissionId
  }

  // 6. 等待评测结果（使用认证 token）
  async function waitForResult(token: string, submissionId: number, maxWait = 10000): Promise<{ result: string, time: number, memory: number }> {
    const start = Date.now()
    while (Date.now() - start < maxWait) {
      const res = await fetch(API_BASE + '/submissions/' + submissionId, {
        headers: { 'Authorization': 'Bearer ' + token }
      })
      const data = await res.json()
      if (!data.success) {
        // API 返回错误（如认证失败），跳过
        if (Date.now() - start > 3000) {
          console.log('    轮询失败: ' + (data.message || 'unknown'))
        }
      }
      if (data.success && data.data.result && data.data.result !== 'queuing' && data.data.result !== 'compiling') {
        return {
          result: data.data.result,
          time: data.data.timeUsed || 0,
          memory: data.data.memoryUsed || 0
        }
      }
      await new Promise(r => setTimeout(r, 500))
    }
    return { result: 'timeout', time: 0, memory: 0 }
  }

  // 7. 测试场景定义
  const scenarios = [
    // 1. 李同学 - 全 AC 一次过
    { student: studentList[0], submissions: problems.map(p => ({ problemId: p.problemId, codeType: 'AC' })) },

    // 2. 王同学 - 全 AC 但每题先 WA 再 AC
    { student: studentList[1], submissions: problems.flatMap(p => [
      { problemId: p.problemId, codeType: 'WA' },
      { problemId: p.problemId, codeType: 'AC' }
    ]) },

    // 3. 赵同学 - 7AC + TLE/RE/WA 各一
    { student: studentList[2], submissions: [
      ...problems.slice(0, 7).map(p => ({ problemId: p.problemId, codeType: 'AC' })),
      { problemId: problems[7].problemId, codeType: 'TLE' },
      { problemId: problems[8].problemId, codeType: 'RE' },
      { problemId: problems[9].problemId, codeType: 'WA' }
    ]},

    // 4. 刘同学 - 7AC + MLE/CE/PE 各一
    { student: studentList[3], submissions: [
      { problemId: problems[0].problemId, codeType: 'AC' },
      { problemId: problems[1].problemId, codeType: 'AC' },
      { problemId: problems[2].problemId, codeType: 'MLE' },
      { problemId: problems[3].problemId, codeType: 'AC' },
      { problemId: problems[4].problemId, codeType: 'AC' },
      { problemId: problems[5].problemId, codeType: 'AC' },
      { problemId: problems[6].problemId, codeType: 'CE' },
      { problemId: problems[7].problemId, codeType: 'AC' },
      { problemId: problems[8].problemId, codeType: 'PE' },
      { problemId: problems[9].problemId, codeType: 'AC' }
    ]},

    // 5. 陈同学 - 6AC + OLE/WA/RE/TLE
    { student: studentList[4], submissions: [
      ...problems.slice(0, 6).map(p => ({ problemId: p.problemId, codeType: 'AC' })),
      { problemId: problems[6].problemId, codeType: 'TLE' },
      { problemId: problems[7].problemId, codeType: 'OLE' },
      { problemId: problems[8].problemId, codeType: 'WA' },
      { problemId: problems[9].problemId, codeType: 'RE' }
    ]},

    // 6. 周同学 - 5AC + 先失败再AC
    { student: studentList[5], submissions: [
      ...problems.slice(0, 5).map(p => ({ problemId: p.problemId, codeType: 'AC' })),
      { problemId: problems[5].problemId, codeType: 'TLE' },
      { problemId: problems[5].problemId, codeType: 'AC' },
      { problemId: problems[6].problemId, codeType: 'WA' },
      { problemId: problems[6].problemId, codeType: 'AC' },
      { problemId: problems[7].problemId, codeType: 'RE' },
      { problemId: problems[8].problemId, codeType: 'MLE' },
      { problemId: problems[9].problemId, codeType: 'CE' }
    ]},

    // 7. 吴同学 - 4AC + 混合失败
    { student: studentList[6], submissions: [
      ...problems.slice(0, 4).map(p => ({ problemId: p.problemId, codeType: 'AC' })),
      { problemId: problems[4].problemId, codeType: 'TLE' },
      { problemId: problems[5].problemId, codeType: 'MLE' },
      { problemId: problems[6].problemId, codeType: 'RE' },
      { problemId: problems[7].problemId, codeType: 'CE' },
      { problemId: problems[8].problemId, codeType: 'PE' },
      { problemId: problems[9].problemId, codeType: 'OLE' }
    ]},

    // 8. 郑同学 - 3AC + 先 CE 再 AC
    { student: studentList[7], submissions: [
      ...problems.slice(0, 3).map(p => ({ problemId: p.problemId, codeType: 'AC' })),
      { problemId: problems[3].problemId, codeType: 'CE' },
      { problemId: problems[3].problemId, codeType: 'AC' },
      ...problems.slice(4).map(p => ({ problemId: p.problemId, codeType: 'WA' }))
    ]},

    // 9. 孙同学 - 2AC + 多种失败
    { student: studentList[8], submissions: [
      ...problems.slice(0, 2).map(p => ({ problemId: p.problemId, codeType: 'AC' })),
      { problemId: problems[2].problemId, codeType: 'TLE' },
      { problemId: problems[3].problemId, codeType: 'RE' },
      ...problems.slice(4).map(p => ({ problemId: p.problemId, codeType: 'WA' }))
    ]},

    // 10. 钱同学 - 1AC（多次WA后）
    { student: studentList[9], submissions: [
      { problemId: problems[0].problemId, codeType: 'WA' },
      { problemId: problems[0].problemId, codeType: 'WA' },
      { problemId: problems[0].problemId, codeType: 'WA' },
      { problemId: problems[0].problemId, codeType: 'WA' },
      { problemId: problems[0].problemId, codeType: 'WA' },
      { problemId: problems[0].problemId, codeType: 'AC' },
      ...problems.slice(1).map(p => ({ problemId: p.problemId, codeType: 'WA' }))
    ]},

    // 11. 测试同学 - 0AC 全 WA
    { student: studentList[10], submissions: problems.map(p => ({ problemId: p.problemId, codeType: 'WA' })) }
  ]

  // 8. 执行提交
  const results: { result: string, time: number, memory: number }[] = []

  for (const scenario of scenarios) {
    const { student, submissions } = scenario
    const token = generateToken(student.userId, student.studentId, student.username)

    console.log('\n处理 ' + student.name + ' (' + student.username + '):')

    for (const sub of submissions) {
      const code = sub.codeType === 'AC' ? AC_CODES[sub.problemId]
                  : sub.codeType === 'PE' ? getPECode(sub.problemId)
                  : ERROR_CODES[sub.codeType as keyof typeof ERROR_CODES]

      if (!code) {
        console.error('  未知代码类型:', sub.codeType)
        continue
      }

      console.log('  提交 ' + sub.problemId + ' (' + sub.codeType + ')...')
      const submissionId = await submit(student.userId, token, sub.problemId, code)

      if (submissionId > 0) {
        const result = await waitForResult(token, submissionId)
        console.log('    结果: ' + result.result + ', 时间: ' + result.time + 'ms, 内存: ' + result.memory + 'KB')
        results.push(result)
        await new Promise(r => setTimeout(r, 1000)) // 间隔 1s 避限流
      }
    }
  }

  // 9. 验证结果类型覆盖
  console.log('\n\n=== 结果类型覆盖 ===')
  const resultTypes = new Set(results.map(r => r.result))
  const expectedTypes = ['ac', 'wa', 'tle', 'mle', 're', 'ce', 'pe', 'ole']

  for (const type of expectedTypes) {
    const has = resultTypes.has(type)
    console.log('  ' + type.toUpperCase() + ': ' + (has ? '✓' : '✗'))
  }

  // 10. 验证排名
  console.log('\n=== 排名验证 ===')
  const rankingRes = await fetch(API_BASE + '/trainings/' + TRAINING_ID + '/ranking')
  const rankingData = await rankingRes.json()

  if (rankingData.success) {
    console.log('排名:')
    for (const entry of rankingData.data) {
      console.log('  ' + entry.rank + '. ' + entry.name + ': ' + entry.solved + ' AC, penalty=' + entry.penalty)
    }
  } else {
    console.error('排名获取失败:', rankingData.message)
  }

  console.log('\n总计: ' + results.length + ' 条提交')
  console.log('结果类型: ' + Array.from(resultTypes).join(', '))

  await prisma.$disconnect()
}

main().catch(console.error)
