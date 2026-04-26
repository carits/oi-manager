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
    enrollmentYear: number | null | undefined;
    educationSystem?: string | null;
    schoolType?: string | null;
}
/**
 * 解析学制字符串
 * @param educationSystem 学制字符串（如 "6-3-3" 或 "5-4-3"）
 * @returns [小学年限, 初中年限, 高中年限]
 */
export declare function parseEducationSystem(educationSystem: string | null | undefined): [number, number, number];
/**
 * 统一的年级计算函数
 * 根据入学年份 + 学校类型 + 学制 计算年级
 */
export declare function calculateGrade(params: CalculateGradeParams): string;
/**
 * 简化版年级计算函数（向后兼容）
 * @deprecated 请使用 calculateGrade
 */
export declare function calculateGradeSimple(enrollmentYear: number | null | undefined, educationSystem?: string | null): string;
/**
 * 旧版年级计算函数（保留用于向后兼容）
 * @deprecated 请使用 calculateGrade
 */
export declare function calculateGradeByEducationSystem(enrollmentYear: number | null | undefined, enrollmentStage?: string | null | undefined, educationSystem?: string | null | undefined): string;
/**
 * 根据学校类型和学制生成所有可能的年级列表
 * 用于年级分布显示
 */
export declare function getAllGrades(schoolType: string | null | undefined, educationSystem: string | null | undefined): string[];
/**
 * 判断学生是否已毕业
 * @param params 学生信息参数
 * @returns 是否已毕业
 */
export declare function isStudentGraduated(params: CalculateGradeParams): boolean;
/**
 * 获取年级排序值（用于排序）
 * @param enrollmentYear 入学年份
 * @returns 排序值，数字越小年级越高
 */
export declare function getGradeSortValue(enrollmentYear: number | null | undefined): number;
