import { routeOwner, routePatterns, type RouteOwner, type RoutePattern } from './routes'

export type UxPageType = 'public' | 'dashboard' | 'list' | 'detail' | 'form' | 'settings' | 'wizard' | 'workbench'
export type UxMode = 'public' | 'platform' | 'campus' | 'personal'

export interface UxRouteEntry {
  route: RoutePattern
  owner: RouteOwner
  mode: UxMode
  pageType: UxPageType
  userGoal: string
  primaryAction: string
  filters: string[]
  states: readonly ['pending', 'ready', 'empty', 'error']
  interactions: string[]
}

function pageType(route: RoutePattern): UxPageType {
  if (route === '/' || route === '/login' || route === '/super_admin') return 'public'
  if (['/admin', '/platform-admin', '/teacher', '/student'].includes(route)) return 'dashboard'
  if (route.includes('/import')) return 'wizard'
  if (route.endsWith('/profile') || route.endsWith('/security') || route.endsWith('/platform-bindings')) return 'settings'
  if (route.endsWith('/new') || route.endsWith('/edit') || route.endsWith('/note')) return 'form'
  if (route.includes('/trainings/') || route.includes('/homeworks/[cid]') || route.includes('/contests/[cid]') || route.includes('/submissions/[id]') || route.includes('/problems/[id]')) return 'workbench'
  if (route.includes('[id]')) return 'detail'
  return 'list'
}

function mode(owner: RouteOwner): UxMode {
  if (owner === 'public') return 'public'
  if (owner === 'personalStudent') return 'personal'
  if (owner === 'campusStudent' || owner === 'principal') return 'campus'
  return 'platform'
}

function domain(route: RoutePattern): string {
  if (route.includes('problem-lists')) return '题单'
  if (route.includes('problems')) return '题目'
  if (route.includes('submissions')) return '提交'
  if (route.includes('homeworks')) return '作业'
  if (route.includes('contests')) return '比赛'
  if (route.includes('teams') || route.includes('/team')) return '团队'
  if (route.includes('students')) return '学生'
  if (route.includes('teachers')) return '教师'
  if (route.includes('schools') || route.includes('/school')) return '学校'
  if (route.includes('rating') || route.includes('rankings') || route.includes('scores')) return '排名与成绩'
  if (route.includes('security')) return '账号安全'
  if (route.includes('profile')) return '个人资料'
  if (route.includes('platform-bindings') || route.includes('oj-accounts')) return '外部平台'
  return '工作概览'
}

function goal(route: RoutePattern, type: UxPageType): string {
  const subject = domain(route)
  const verb: Record<UxPageType, string> = {
    public: '进入正确的系统入口', dashboard: '判断当前最重要的工作', list: `查找和比较${subject}`,
    detail: `理解并操作当前${subject}`, form: `创建或修改${subject}`, settings: `维护${subject}`,
    wizard: `按步骤完成${subject}导入`, workbench: `在同一上下文中完成${subject}任务`,
  }
  return verb[type]
}

function primaryAction(route: RoutePattern, type: UxPageType): string {
  if (route === '/login') return '登录'
  if (type === 'dashboard') return '进入待处理工作'
  if (type === 'form') return '保存'
  if (type === 'wizard') return '继续下一步'
  if (type === 'workbench') return '完成当前业务操作'
  if (route.endsWith('/new')) return '创建'
  return type === 'list' ? '打开或创建条目' : '查看详情'
}

function filters(route: RoutePattern): string[] {
  const result: string[] = []
  if (route.includes('submissions')) result.push('用户', '平台', '题目', '结果', '语言', '分页')
  else if (route.includes('problems')) result.push('范围', '平台', '关键词', '分页')
  else if (route.includes('problem-lists')) result.push('范围', '关键词')
  else if (route.includes('homeworks') || route.includes('contests')) result.push('状态', '团队或学校范围')
  else if (route.includes('rating') || route.includes('rankings')) result.push('排名指标', '成员范围', '分页')
  else if (route.includes('team') && !route.includes('[id]')) result.push('我的团队', '浏览团队', '分页')
  return result
}

export const uxRouteMatrix: UxRouteEntry[] = routePatterns.map(route => {
  const type = pageType(route)
  return {
    route,
    owner: routeOwner(route),
    mode: mode(routeOwner(route)),
    pageType: type,
    userGoal: goal(route, type),
    primaryAction: primaryAction(route, type),
    filters: filters(route),
    states: ['pending', 'ready', 'empty', 'error'],
    interactions: ['键盘导航', '返回与恢复', '错误重试', ...(filters(route).length ? ['筛选恢复'] : [])],
  }
})

export const uxRouteMap = new Map(uxRouteMatrix.map(entry => [entry.route, entry]))

if (uxRouteMatrix.length !== routePatterns.length || uxRouteMap.size !== routePatterns.length) {
  throw new Error('UX route matrix must contain every application route exactly once')
}
