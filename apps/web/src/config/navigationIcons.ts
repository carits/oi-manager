import {
  Activity, BookOpen, CircleHelp, ClipboardList, Database, Dumbbell, GraduationCap,
  Home, Library, Link2, ListChecks, PenLine, School, ShieldCheck, Trophy, Users, UsersRound,
  WalletCards, type LucideIcon,
} from 'lucide-react'

const labelIcons: Record<string, LucideIcon> = {
  '首页': Home, '概览': Home, '校园': School, '学校信息': School, '学校管理': School,
  '教师管理': GraduationCap, '教师': GraduationCap, '教师与权限': GraduationCap,
  '学生管理': Users, '学生': Users, '管理': ShieldCheck, '成员与权限': ShieldCheck,
  '加入审批': ShieldCheck, '学校设置': ShieldCheck, '学校资产': WalletCards,
  '账号管理': Users, '团队': UsersRound, '我的团队': UsersRound, '组织': School, '学校': School,
  '作业': ClipboardList, '比赛': Trophy, '训练': Dumbbell, '题单': ListChecks, '题库': Library,
  '题库管理': Library, '排名': Activity, '评测记录': BookOpen, 'OJ账号': Link2, '平台绑定': Link2,
  '贡献': Activity, '钱包': WalletCards, '贡献审计': ShieldCheck, 'AI Token': WalletCards,
  '私信举报': ShieldCheck, '博客治理': ShieldCheck, '知识广场': BookOpen, '我的文章': PenLine, '数据市场': Database,
}

export function hasNavigationIcon(label: string) { return Boolean(labelIcons[label]) }
export function getNavigationIcon(label: string): LucideIcon { return labelIcons[label] || CircleHelp }
