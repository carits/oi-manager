import { Router } from 'express'
import { authenticate, getAccountRole, isAdmin, type AuthRequest } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import { createQueuedContestSubmission } from '../modules/contest/contest.submission.service'
import {
  countDemoSubmissions,
  demoSubmissionExists,
  findDemoTrainingProblems,
  findDemoTrainings,
  findDemoTrainingsByIds,
  findDemoUsers,
  normalizeDemoSubmission,
  prepareDemoContestRuntimes,
} from '../modules/maintenance/application/demo-scenario-persistence.service'

export const demoScenarioRouter = Router()
const PREFIX = '赛时演示 V2'
const TEAM_ID = 'live_contest_v2_team'
const USERNAMES = ['live_v2_01', 'live_v2_02', 'live_v2_03', 'live_v2_04', 'live_v2_05']
const full: Record<string, string> = {
  A: '#include <bits/stdc++.h>\nusing namespace std;int main(){long long a,b;if(cin>>a>>b)cout<<a+b<<"\\n";}',
  B: '#include <bits/stdc++.h>\nusing namespace std;int main(){long long a,b,c;if(cin>>a>>b>>c)cout<<max(a,max(b,c))<<"\\n";}',
  C: '#include <bits/stdc++.h>\nusing namespace std;int main(){long long n;if(cin>>n)cout<<(n%2?"odd":"even")<<"\\n";}',
  D: '#include <bits/stdc++.h>\nusing namespace std;int main(){long long n;if(cin>>n)cout<<n*(n+1)/2<<"\\n";}',
  E: '#include <bits/stdc++.h>\nusing namespace std;int main(){string s;if(cin>>s){int a=0;for(char c:s){c=tolower((unsigned char)c);if(string("aeiou").find(c)!=string::npos)++a;}cout<<a<<"\\n";}}',
}
const partial: Record<string, string> = {
  A: '#include <bits/stdc++.h>\nusing namespace std;int main(){long long a,b;if(cin>>a>>b)cout<<(a<0||b<0?0:a+b)<<"\\n";}',
  B: '#include <bits/stdc++.h>\nusing namespace std;int main(){long long a,b,c;if(cin>>a>>b>>c)cout<<max(0LL,max(a,max(b,c)))<<"\\n";}',
  C: '#include <bits/stdc++.h>\nusing namespace std;int main(){long long n;if(cin>>n)cout<<(n<0?"even":(n%2?"odd":"even"))<<"\\n";}',
  D: '#include <bits/stdc++.h>\nusing namespace std;int main(){int n;if(cin>>n)cout<<n*(n+1)/2<<"\\n";}',
  E: '#include <bits/stdc++.h>\nusing namespace std;int main(){string s;if(cin>>s){int a=0;for(char c:s)if(string("aeiou").find(c)!=string::npos)++a;cout<<a<<"\\n";}}',
}
const wrong = '#include <bits/stdc++.h>\nusing namespace std;int main(){cout<<0<<"\\n";}'
const V3_PREFIX = '赛时演示 V3'
const V3_TEAM_ID = 'live_contest_v3_team'
const V3_USERNAMES = Array.from({ length: 8 }, (_, index) => 'live_v3_' + String(index + 1).padStart(2, '0'))
const v3Full: Record<string, string> = {
  A: '#include <bits/stdc++.h>\nusing namespace std;int main(){long long a,b;if(cin>>a>>b)cout<<a+b<<"\\n";}',
  B: '#include <bits/stdc++.h>\nusing namespace std;int main(){long long a,b,c;if(cin>>a>>b>>c)cout<<max(a,max(b,c))<<"\\n";}',
  C: '#include <bits/stdc++.h>\nusing namespace std;int main(){long long n;if(cin>>n)cout<<(n%2?"odd":"even")<<"\\n";}',
  D: '#include <bits/stdc++.h>\nusing namespace std;int main(){long long n;if(cin>>n)cout<<n*(n+1)/2<<"\\n";}',
  E: '#include <bits/stdc++.h>\nusing namespace std;int main(){string s;if(cin>>s){int ans=0;for(char c:s){c=tolower((unsigned char)c);ans+=string("aeiou").find(c)!=string::npos;}cout<<ans<<"\\n";}}',
  F: '#include <bits/stdc++.h>\nusing namespace std;int main(){long long a,b;if(cin>>a>>b)cout<<llabs(a-b)<<"\\n";}',
  G: '#include <bits/stdc++.h>\nusing namespace std;int main(){int n,x,ans=0;if(cin>>n)while(n--&&cin>>x)ans+=x%2==0;cout<<ans<<"\\n";}',
  H: '#include <bits/stdc++.h>\nusing namespace std;int main(){string s;if(cin>>s){reverse(s.begin(),s.end());cout<<s<<"\\n";}}',
}
const v3Partial: Record<string, string> = {
  A: '#include <bits/stdc++.h>\nusing namespace std;int main(){long long a,b;if(cin>>a>>b)cout<<(a<0||b<0?0:a+b)<<"\\n";}',
  B: '#include <bits/stdc++.h>\nusing namespace std;int main(){long long a,b,c;if(cin>>a>>b>>c)cout<<max(0LL,max(a,max(b,c)))<<"\\n";}',
  C: '#include <bits/stdc++.h>\nusing namespace std;int main(){long long n;if(cin>>n)cout<<(n<0?"even":(n%2?"odd":"even"))<<"\\n";}',
  D: '#include <bits/stdc++.h>\nusing namespace std;int main(){int n;if(cin>>n)cout<<n*(n+1)/2<<"\\n";}',
  E: '#include <bits/stdc++.h>\nusing namespace std;int main(){string s;if(cin>>s){int ans=0;for(char c:s)ans+=string("aeiou").find(c)!=string::npos;cout<<ans<<"\\n";}}',
  F: '#include <bits/stdc++.h>\nusing namespace std;int main(){long long a,b;if(cin>>a>>b)cout<<(a>b?a-b:b-a)<<"\\n";}',
  G: '#include <bits/stdc++.h>\nusing namespace std;int main(){int n,x,ans=0;if(cin>>n)while(n--&&cin>>x)ans+=x>0&&x%2==0;cout<<ans<<"\\n";}',
  H: '#include <bits/stdc++.h>\nusing namespace std;int main(){string s;if(cin>>s){for(char& c:s)c=tolower((unsigned char)c);reverse(s.begin(),s.end());cout<<s<<"\\n";}}',
}
type Kind = 'full' | 'partial' | 'wrong'
type Event = { user: number; alias: string; minute: number; kind: Kind; id?: string }
function v3Events(): Event[] {
  const events: Event[] = []
  for (let user = 0; user < 8; user += 1) {
    for (let problem = 0; problem < 8; problem += 1) {
      const alias = String.fromCharCode(65 + problem)
      const minute = 32 + user * 34 + problem * 17
      const pattern = (user * 3 + problem * 5) % 8
      if (pattern === 0) events.push({ user, alias, minute, kind: 'wrong', id: String(user) + '-' + alias + '-wrong-only' })
      else if (pattern <= 2) {
        events.push({ user, alias, minute, kind: 'partial', id: String(user) + '-' + alias + '-partial' })
        events.push({ user, alias, minute: minute + 41, kind: 'full', id: String(user) + '-' + alias + '-upgrade' })
      } else if (pattern <= 4) {
        events.push({ user, alias, minute, kind: 'wrong', id: String(user) + '-' + alias + '-wrong' })
        events.push({ user, alias, minute: minute + 28, kind: 'full', id: String(user) + '-' + alias + '-accepted' })
      } else events.push({ user, alias, minute, kind: 'full', id: String(user) + '-' + alias + '-accepted' })
      if (pattern >= 5 && (user + problem) % 3 === 0) events.push({ user, alias, minute: minute + 67, kind: 'wrong', id: String(user) + '-' + alias + '-after-accepted' })
    }
  }
  return events
}
const scoreEvents: Event[] = [
  {user:0,alias:'A',minute:10,kind:'partial'},{user:0,alias:'A',minute:35,kind:'full'},{user:0,alias:'A',minute:50,kind:'wrong'},{user:0,alias:'B',minute:45,kind:'partial'},{user:0,alias:'D',minute:75,kind:'full'},
  {user:1,alias:'A',minute:15,kind:'wrong'},{user:1,alias:'A',minute:28,kind:'full'},{user:1,alias:'C',minute:40,kind:'partial'},{user:1,alias:'E',minute:80,kind:'full'},{user:1,alias:'C',minute:90,kind:'wrong'},
  {user:2,alias:'B',minute:20,kind:'partial'},{user:2,alias:'B',minute:60,kind:'full'},{user:2,alias:'C',minute:70,kind:'wrong'},{user:2,alias:'D',minute:95,kind:'partial'},
  {user:3,alias:'A',minute:12,kind:'wrong'},{user:3,alias:'C',minute:55,kind:'partial'},{user:3,alias:'E',minute:85,kind:'partial'},{user:3,alias:'B',minute:100,kind:'wrong'},
  {user:4,alias:'B',minute:30,kind:'full'},{user:4,alias:'D',minute:50,kind:'wrong'},{user:4,alias:'E',minute:65,kind:'partial'},{user:4,alias:'A',minute:110,kind:'wrong'},
]
const icpcEvents: Event[] = [
  {user:0,alias:'A',minute:5,kind:'wrong'},{user:0,alias:'A',minute:20,kind:'full'},{user:0,alias:'B',minute:32,kind:'full'},{user:0,alias:'A',minute:40,kind:'wrong'},{user:0,alias:'C',minute:45,kind:'wrong'},{user:0,alias:'D',minute:75,kind:'full'},
  {user:1,alias:'A',minute:28,kind:'full'},{user:1,alias:'B',minute:16,kind:'wrong'},{user:1,alias:'B',minute:44,kind:'full'},{user:1,alias:'C',minute:54,kind:'partial'},{user:1,alias:'E',minute:88,kind:'full'},{user:1,alias:'E',minute:100,kind:'wrong'},
  {user:2,alias:'A',minute:12,kind:'wrong'},{user:2,alias:'B',minute:50,kind:'full'},{user:2,alias:'C',minute:33,kind:'partial'},{user:2,alias:'D',minute:61,kind:'wrong'},{user:2,alias:'D',minute:95,kind:'full'},
  {user:3,alias:'A',minute:38,kind:'full'},{user:3,alias:'B',minute:24,kind:'wrong'},{user:3,alias:'C',minute:65,kind:'partial'},{user:3,alias:'E',minute:105,kind:'wrong'},
  {user:3,alias:'D',minute:70,kind:'partial',id:'extra-partial-d'},
  {user:4,alias:'A',minute:15,kind:'wrong'},{user:4,alias:'A',minute:65,kind:'full'},{user:4,alias:'B',minute:57,kind:'partial'},{user:4,alias:'D',minute:110,kind:'full'},{user:4,alias:'E',minute:125,kind:'full'},
]
function eventKey(event: Event, index: number) { return event.id || String(index) }
function allowed(req: AuthRequest, res: any) {
  if (process.env.APP_ENV !== 'development' || process.env.ENABLE_DEMO_SCENARIO_API !== 'true' || !process.env.DEMO_SCENARIO_KEY || req.header('x-demo-scenario-key') !== process.env.DEMO_SCENARIO_KEY) { res.status(404).json({success:false,message:'接口不存在'}); return false }
  if (!req.user || !isAdmin(getAccountRole(req.user)!)) { res.status(403).json({success:false,message:'仅平台管理员可执行演示场景'}); return false }
  return true
}
async function resources() {
  const users = await findDemoUsers(USERNAMES)
  const trainings = await findDemoTrainings(TEAM_ID, PREFIX)
  if (users.length !== 5 || trainings.length !== 9) throw new Error('赛时演示 V2 资源不完整，请先运行 API 创建脚本')
  return { users: USERNAMES.map(name => users.find(user => user.username === name)!), trainings }
}
demoScenarioRouter.post('/v2/prepare', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  if (!allowed(req,res)) return
  const { trainings } = await resources(); const now=Date.now()
  const active = trainings.filter(item => item.title.endsWith('进行中') || item.title.endsWith('已结束'))
  const existing = await countDemoSubmissions('demo-v2:')
  if (existing === 0) {
    await prepareDemoContestRuntimes(active.map(item => item.id), new Date(now - 130 * 60000), new Date(now + 130 * 60000))
  }
  // Existing V2 events are normalized from their immutable event definition.
  // This repairs an interrupted run without exposing a generic time-edit API.
  let normalized = 0
  for (const training of active) {
    const events = training.format === 'icpc' ? icpcEvents : scoreEvents
    for (const [index, event] of events.entries()) {
      const sourceId = 'demo-v2:'+training.id+':'+eventKey(event,index)
      const result = await normalizeDemoSubmission(sourceId, new Date(training.startTime.getTime()+event.minute*60000))
      normalized += result.count
    }
  }
  res.json({success:true,data:{prepared:active.length,normalized,prefix:PREFIX}})
}, '准备演示比赛失败'))
demoScenarioRouter.post('/v2/events', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  if (!allowed(req,res)) return
  const { users, trainings } = await resources(); let created=0, existing=0
  for (const training of trainings.filter(item => item.title.endsWith('进行中') || item.title.endsWith('已结束'))) {
    const problems = await findDemoTrainingProblems(training.id)
    if (problems.length !== 5) throw new Error(training.title+' 题目配置不完整')
    const aliases = new Map(problems.map(problem => [problem.alias!,problem]))
    for (const [index,event] of (training.format === 'icpc' ? icpcEvents : scoreEvents).entries()) {
      const sourceId = 'demo-v2:'+training.id+':'+eventKey(event,index)
      if (await demoSubmissionExists(sourceId)) { existing++; continue }
      const trainingProblem = aliases.get(event.alias); if (!trainingProblem) throw new Error(training.title+' 缺少题目 '+event.alias)
      await createQueuedContestSubmission({userId:users[event.user].id,training,trainingProblem,language:'cpp',code:event.kind==='full'?full[event.alias]:event.kind==='partial'?partial[event.alias]:wrong,submitMethod:'demo_scenario',createdAt:new Date(training.startTime.getTime()+event.minute*60000),sourceId})
      created++
    }
  }
  res.json({success:true,data:{created,existing,prefix:PREFIX}})
}, '写入演示提交失败'))

async function v3Resources() {
  const users = await findDemoUsers(V3_USERNAMES)
  const trainings = await findDemoTrainings(V3_TEAM_ID, V3_PREFIX)
  if (users.length !== 8 || trainings.length !== 3) throw new Error('赛时演示 V3 资源不完整，请先运行 API 创建脚本')
  return { users: V3_USERNAMES.map(name => users.find(user => user.username === name)!), trainings }
}

demoScenarioRouter.post('/v3/prepare', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  if (!allowed(req, res)) return
  const { trainings } = await v3Resources()
  const now = Date.now()
  await prepareDemoContestRuntimes(
    trainings.map(item => item.id),
    new Date(now - 6 * 60 * 60 * 1000),
    new Date(now + 14 * 60 * 60 * 1000),
  )
  const refreshed = await findDemoTrainingsByIds(trainings.map(item => item.id))
  let normalized = 0
  for (const training of refreshed) {
    for (const event of v3Events()) {
      const sourceId = 'demo-v3:' + training.id + ':' + event.id
      const result = await normalizeDemoSubmission(sourceId, new Date(training.startTime.getTime() + event.minute * 60000))
      normalized += result.count
    }
  }
  res.json({ success: true, data: { prepared: refreshed.length, durationHours: 20, normalized, prefix: V3_PREFIX } })
}, '准备赛时演示 V3 失败'))

demoScenarioRouter.post('/v3/events', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  if (!allowed(req, res)) return
  const { users, trainings } = await v3Resources()
  const events = v3Events()
  let created = 0
  let existing = 0
  for (const training of trainings) {
    const problems = await findDemoTrainingProblems(training.id)
    if (problems.length !== 8) throw new Error(training.title + ' 题目配置不完整')
    const aliases = new Map(problems.map(problem => [problem.alias!, problem]))
    for (const event of events) {
      const sourceId = 'demo-v3:' + training.id + ':' + event.id
      if (await demoSubmissionExists(sourceId)) { existing += 1; continue }
      const trainingProblem = aliases.get(event.alias)
      if (!trainingProblem) throw new Error(training.title + ' 缺少题目 ' + event.alias)
      const code = event.kind === 'full' ? v3Full[event.alias] : event.kind === 'partial' ? v3Partial[event.alias] : wrong
      await createQueuedContestSubmission({
        userId: users[event.user].id,
        training,
        trainingProblem,
        language: 'cpp',
        code,
        submitMethod: 'demo_scenario',
        createdAt: new Date(training.startTime.getTime() + event.minute * 60000),
        sourceId
      })
      created += 1
    }
  }
  res.json({ success: true, data: { created, existing, perContest: events.length, prefix: V3_PREFIX } })
}, '写入赛时演示 V3 提交失败'))
