/**
 * OpenJudge POJ (poj.openjudge.cn) 题目拉取适配器
 *
 * POJ 子站：http://poj.openjudge.cn
 * URL 模板: /practice/{pid}/
 * 题号格式: 纯数字（如 1000, 1001）
 */

import { OjPlatform } from './types'
import { OpenjudgeBaseAdapter } from './openjudge'

export class OpenjPojAdapter extends OpenjudgeBaseAdapter {
  name = 'OpenJudge POJ'
  platform: OjPlatform = 'openj_poj'
  baseUrl = 'http://poj.openjudge.cn'
  urlTemplate = '/practice/{pid}/'

  isValidProblemId(problemId: string): boolean {
    return /^\d+$/.test(problemId.trim())
  }
}
