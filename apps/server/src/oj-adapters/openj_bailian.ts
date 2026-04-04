/**
 * OpenJudge 百炼 (bailian.openjudge.cn) 题目拉取适配器
 *
 * 百炼子站：http://bailian.openjudge.cn
 * URL 模板: /practice/{pid}/
 * 题号格式: 纯数字（如 1000, 1001）
 */

import { OjPlatform } from './types'
import { OpenjudgeBaseAdapter } from './openjudge'

export class OpenjBailianAdapter extends OpenjudgeBaseAdapter {
  name = 'OpenJudge 百炼'
  platform: OjPlatform = 'openj_bailian'
  baseUrl = 'http://bailian.openjudge.cn'
  urlTemplate = '/practice/{pid}/'

  isValidProblemId(problemId: string): boolean {
    return /^\d+$/.test(problemId.trim())
  }
}
