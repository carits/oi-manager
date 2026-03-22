/**
 * 年级计算工具函数
 * 支持 6-3-3 和 5-4-3 学制
 * 前后端共用
 *
 * 核心逻辑：
 * - 学生只有入学年份，入学阶段由学校类型决定
 * - 学校最低学段 = 学生入学阶段
 * - 年级 = 根据入学年份和学校类型计算
 */

/**
 * 统一的年级计算参数接口
 */
export interface CalculateGradeParams {
  enrollmentYear: number | null | undefined
  educationSystem?: string | null  // '6-3-3' | '5-4-3'
  schoolType?: string | null       // 学校类型，如 '小学'、'初中'、'初中+高中'
}

/**
 * 解析学制字符串
 * @param educationSystem 学制字符串（如 "6-3-3" 或 "5-4-3"）
 * @returns [小学年限, 初中年限, 高中年限]
 */
export function parseEducationSystem(educationSystem: string | null | undefined): [number, number, number] {
  if (!educationSystem) return [6, 3, 3]

  const parts = educationSystem.split('-').map(Number)
  if (parts.length === 3 && parts.every(n => !isNaN(n) && n > 0)) {
    return [parts[0], parts[1], parts[2]]
  }

  // 默认 6-3-3
  return [6, 3, 3]
}

/**
 * 数字转中文
 * @param num 数字（1-9）
 * @returns 中文数字
 */
function toChineseNumber(num: number): string {
  const chinese = ['一', '二', '三', '四', '五', '六', '七', '八', '九']
  return chinese[num - 1] || num.toString()
}

/**
 * 根据学校类型获取入学阶段
 * 入学阶段 = 学校的最低学段
 */
function getEnrollmentStage(schoolType: string | null | undefined): 'primary' | 'middle' | 'high' {
  if (!schoolType) return 'middle'

  const hasPrimary = schoolType.includes('小学')
  const hasMiddle = schoolType.includes('初中')
  const hasHigh = schoolType.includes('高中')

  // 入学阶段 = 学校最低学段
  if (hasPrimary) return 'primary'
  if (hasMiddle) return 'middle'
  if (hasHigh) return 'high'

  return 'middle'
}

/**
 * 统一的年级计算函数
 * 根据入学年份 + 学校类型 + 学制 计算年级
 */
export function calculateGrade(params: CalculateGradeParams): string {
  const {
    enrollmentYear,
    educationSystem = '6-3-3',
    schoolType = null
  } = params

  if (!enrollmentYear) return '未设置'

  // 解析学制
  const [primaryYears, middleYears, highYears] = parseEducationSystem(educationSystem)

  // 根据学校类型确定入学阶段
  const enrollmentStage = getEnrollmentStage(schoolType)

  // 计算当前学年（9月为分界点）
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1
  const schoolYear = currentMonth >= 9 ? currentYear : currentYear - 1

  // 计算从入学到现在经过了多少年（从1开始）
  const years = schoolYear - enrollmentYear + 1

  // 确定学校包含的学段
  const hasPrimary = schoolType?.includes('小学') ?? true
  const hasMiddle = schoolType?.includes('初中') ?? true
  const hasHigh = schoolType?.includes('高中') ?? true

  // 确定学校的学段范围
  let schoolMinLevel = 3, schoolMaxLevel = 0
  if (hasPrimary) { schoolMinLevel = 1; schoolMaxLevel = 1 }
  if (hasMiddle) { schoolMinLevel = Math.min(schoolMinLevel, 2); schoolMaxLevel = 2 }
  if (hasHigh) { schoolMinLevel = Math.min(schoolMinLevel, 3); schoolMaxLevel = 3 }

  // 根据入学阶段计算年级
  let result: { grade: string; level: string }

  if (enrollmentStage === 'primary') {
    // 小学入学
    if (years < 1) {
      // 入学前：幼儿园阶段
      const kindergartenYear = 3 + years
      if (kindergartenYear >= 1 && kindergartenYear <= 3) {
        result = { grade: `幼${toChineseNumber(kindergartenYear)}`, level: 'kindergarten' }
      } else {
        result = { grade: '未入学', level: 'kindergarten' }
      }
    } else if (years <= primaryYears) {
      // 小学阶段
      result = { grade: `小${toChineseNumber(years)}`, level: 'primary' }
    } else if (years <= primaryYears + middleYears) {
      // 初中阶段
      const middleYear = years - primaryYears
      result = { grade: `初${toChineseNumber(middleYear)}`, level: 'middle' }
    } else if (years <= primaryYears + middleYears + highYears) {
      // 高中阶段
      const highYear = years - primaryYears - middleYears
      result = { grade: `高${toChineseNumber(highYear)}`, level: 'high' }
    } else {
      // 已毕业
      const graduatedYears = years - primaryYears - middleYears - highYears
      result = { grade: `已毕业 ${graduatedYears} 年`, level: 'graduated' }
    }
  } else if (enrollmentStage === 'middle') {
    // 初中入学
    if (years < 1) {
      // 入学前：小学阶段（预备役）
      const primaryYear = primaryYears + years
      if (primaryYear >= 1 && primaryYear <= primaryYears) {
        result = { grade: `小${toChineseNumber(primaryYear)}`, level: 'primary' }
      } else {
        const kindergartenYear = primaryYear + 3
        if (kindergartenYear >= 1 && kindergartenYear <= 3) {
          result = { grade: `幼${toChineseNumber(kindergartenYear)}`, level: 'kindergarten' }
        } else {
          result = { grade: '未入学', level: 'kindergarten' }
        }
      }
    } else if (years <= middleYears) {
      // 初中阶段
      result = { grade: `初${toChineseNumber(years)}`, level: 'middle' }
    } else if (years <= middleYears + highYears) {
      // 高中阶段
      const highYear = years - middleYears
      result = { grade: `高${toChineseNumber(highYear)}`, level: 'high' }
    } else {
      // 已毕业
      const graduatedYears = years - middleYears - highYears
      result = { grade: `已毕业 ${graduatedYears} 年`, level: 'graduated' }
    }
  } else {
    // 高中入学
    if (years < 1) {
      // 入学前：初中阶段（预备役）
      const middleYear = middleYears + years
      if (middleYear >= 1 && middleYear <= middleYears) {
        result = { grade: `初${toChineseNumber(middleYear)}`, level: 'middle' }
      } else {
        result = { grade: '未入学', level: 'primary' }
      }
    } else if (years <= highYears) {
      // 高中阶段
      result = { grade: `高${toChineseNumber(years)}`, level: 'high' }
    } else {
      // 已毕业
      const graduatedYears = years - highYears
      result = { grade: `已毕业 ${graduatedYears} 年`, level: 'graduated' }
    }
  }

  // 如果当前学段超出学校范围，显示已毕业
  const levelOrder: Record<string, number> = { kindergarten: 0, primary: 1, middle: 2, high: 3 }
  const studentLevel = levelOrder[result.level] || 0

  if (studentLevel > schoolMaxLevel && result.level !== 'graduated') {
    let graduatedYears = 0
    if (enrollmentStage === 'primary') {
      if (schoolMaxLevel === 2) graduatedYears = years - primaryYears - middleYears
      else if (schoolMaxLevel === 1) graduatedYears = years - primaryYears
    } else if (enrollmentStage === 'middle') {
      if (schoolMaxLevel === 2) graduatedYears = years - middleYears
    }
    return graduatedYears > 0 ? `已毕业 ${graduatedYears} 年` : '已毕业'
  }

  return result.grade
}

/**
 * 简化版年级计算函数（向后兼容）
 * @deprecated 请使用 calculateGrade
 */
export function calculateGradeSimple(
  enrollmentYear: number | null | undefined,
  educationSystem?: string | null
): string {
  return calculateGrade({
    enrollmentYear,
    educationSystem
  })
}

/**
 * 旧版年级计算函数（保留用于向后兼容）
 * @deprecated 请使用 calculateGrade
 */
export function calculateGradeByEducationSystem(
  enrollmentYear: number | null | undefined,
  enrollmentStage: string | null | undefined = 'middle',
  educationSystem: string | null | undefined = '6-3-3'
): string {
  return calculateGrade({
    enrollmentYear,
    educationSystem
  })
}

/**
 * 根据学校类型和学制生成所有可能的年级列表
 * 用于年级分布显示
 */
export function getAllGrades(
  schoolType: string | null | undefined,
  educationSystem: string | null | undefined
): string[] {
  const grades: string[] = []
  const [primaryYears, middleYears, highYears] = parseEducationSystem(educationSystem)

  // 确定要显示的学段（最高年级及之前都要显示）
  const showHigh = schoolType?.includes('高中')
  const showMiddle = schoolType?.includes('初中') || schoolType?.includes('高中')
  const showPrimary = schoolType?.includes('小学') || schoolType?.includes('初中') || schoolType?.includes('高中')

  // 高中（从高到低）
  if (showHigh) {
    for (let i = highYears; i >= 1; i--) {
      grades.push(`高${toChineseNumber(i)}`)
    }
  }

  // 初中（从高到低）
  if (showMiddle) {
    for (let i = middleYears; i >= 1; i--) {
      grades.push(`初${toChineseNumber(i)}`)
    }
  }

  // 小学（从高到低）
  if (showPrimary) {
    for (let i = primaryYears; i >= 1; i--) {
      grades.push(`小${toChineseNumber(i)}`)
    }
    // 幼儿园（预备役）
    grades.push('幼三')
    grades.push('幼二')
    grades.push('幼一')
  }

  // 最后加上"其他"（用于未设置入学年份的学生）
  grades.push('其他')

  return grades
}

/**
 * 判断学生是否已毕业
 * @param params 学生信息参数
 * @returns 是否已毕业
 */
export function isStudentGraduated(params: CalculateGradeParams): boolean {
  const grade = calculateGrade(params)
  return grade.includes('已毕业')
}

/**
 * 获取年级排序值（用于排序）
 * @param enrollmentYear 入学年份
 * @returns 排序值，数字越小年级越高
 */
export function getGradeSortValue(enrollmentYear: number | null | undefined): number {
  if (!enrollmentYear) return 999

  // 返回入学年份，越早入学排序值越小（年级越高）
  return enrollmentYear
}
