/**
 * OpenJudge NOI (noi.openjudge.cn) 题目拉取适配器
 *
 * NOI 子站：http://noi.openjudge.cn
 * URL 模板: /{pid}/  (pid 包含分组路径，如 ch0101/01)
 * 题号格式: section/number（如 ch0101/01, ch0201/01）
 *
 * 注意：NOI 子站的题号包含分组前缀，格式为 "分组路径/题号"
 */

import { OjPlatform } from './types'
import { OpenjudgeBaseAdapter } from './openjudge'

export class OpenjNoiAdapter extends OpenjudgeBaseAdapter {
  name = 'OpenJudge NOI'
  platform: OjPlatform = 'openj_noi'
  baseUrl = 'http://noi.openjudge.cn'
  urlTemplate = '/{pid}/'

  isValidProblemId(problemId: string): boolean {
    // NOI 题号格式: section/number 或纯数字
    return /^[\w/]+$/.test(problemId.trim()) && problemId.trim().length > 0
  }
}
