/**
 * 年级计算工具函数
 * 重新导出共享模块，保持向后兼容
 */

import {
  calculateGrade as calculateGradeNew,
  calculateGradeSimple,
  calculateGradeByEducationSystem,
  getAllGrades,
  getGradeSortValue,
  parseEducationSystem,
  isStudentGraduated as isStudentGraduatedBase,
  type CalculateGradeParams
} from '@oi-manager/shared/utils/grade'

// 重新导出类型和其他函数
export {
  calculateGradeSimple,
  calculateGradeByEducationSystem,
  getAllGrades,
  getGradeSortValue,
  parseEducationSystem,
  type CalculateGradeParams
}

/**
 * 学生数据接口（用于统一计算年级）
 */
export interface StudentForGrade {
  enrollmentYear: number | null | undefined
  school?: {
    educationSystem?: string | null
    schoolType?: string | null
  } | null
}

/**
 * 统一的学生年级计算函数
 * 从学生对象自动提取所需参数，确保全校统一
 * 入学阶段由学校类型决定（学校最低学段）
 */
export function calculateStudentGrade(student: StudentForGrade): string {
  return calculateGradeNew({
    enrollmentYear: student.enrollmentYear,
    educationSystem: student.school?.educationSystem,
    schoolType: student.school?.schoolType
  })
}

/**
 * 年级计算函数（向后兼容）
 * 支持两种调用方式：
 * 1. calculateGrade(params: CalculateGradeParams) - 新方式
 * 2. calculateGrade(enrollmentYear, educationSystem?) - 旧方式
 */
export function calculateGrade(
  enrollmentYearOrParams: number | null | undefined | CalculateGradeParams,
  educationSystem?: string | null
): string {
  // 新方式：传入对象
  if (typeof enrollmentYearOrParams === 'object' && enrollmentYearOrParams !== null) {
    return calculateGradeNew(enrollmentYearOrParams as CalculateGradeParams)
  }

  // 旧方式：传入 enrollmentYear 和可选的 educationSystem
  return calculateGradeNew({
    enrollmentYear: enrollmentYearOrParams as number | null | undefined,
    educationSystem: educationSystem
  })
}

/**
 * 判断学生是否已毕业
 */
export function isStudentGraduated(student: StudentForGrade): boolean {
  return isStudentGraduatedBase({
    enrollmentYear: student.enrollmentYear,
    educationSystem: student.school?.educationSystem,
    schoolType: student.school?.schoolType
  })
}
