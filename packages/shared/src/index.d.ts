export type UserRole = 'super_admin' | 'platform_admin' | 'school_principal' | 'teacher' | 'student';
export type SimpleRole = 'super_admin' | 'platform_admin' | 'school_principal' | 'teacher' | 'student';
export type SchoolStatus = 'active' | 'disabled';
export type TeacherStatus = 'active' | 'disabled';
export type PrincipalTransferResult = 'success' | 'failed';
export type ExamType = 'weekly' | 'monthly' | 'topic' | 'mock';
export type MilestoneType = 'entry' | 'upgrade' | 'award' | 'contest' | 'goal';
export type FileType = 'statement' | 'ranklist' | 'editorial' | 'solution' | 'slides';
export type TaskStatus = 'pending' | 'done' | 'review';
export interface JwtPayload {
    userId: string;
    role: UserRole;
    username: string;
    teacherId?: string;
    studentId?: string;
    adminId?: string;
    schoolId?: string;
}
export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    message?: string;
    error?: string;
}
export interface PaginationParams {
    page?: number;
    pageSize?: number;
}
export interface LoginRequest {
    username: string;
    password: string;
    role: UserRole | 'admin' | 'teacher';
}
export interface LoginResponse {
    token: string;
    userId: string;
    role: UserRole;
    username: string;
    teacherId?: string;
    studentId?: string;
    adminId?: string;
    schoolId?: string;
}
export interface CreateSchoolRequest {
    name: string;
    shortName?: string;
    code?: string;
    description?: string;
}
export interface UpdateSchoolRequest {
    name?: string;
    shortName?: string;
    code?: string;
    description?: string;
}
export interface UpdateSchoolStatusRequest {
    status: SchoolStatus;
}
export interface SetPrincipalRequest {
    teacherId: string;
}
export interface TransferPrincipalRequest {
    newPrincipalTeacherId: string;
}
export interface CreateTeacherRequest {
    username: string;
    password: string;
    name: string;
    phone?: string;
    email?: string;
    bio?: string;
    title?: string;
}
export interface UpdateTeacherRequest {
    name?: string;
    phone?: string;
    email?: string;
    bio?: string;
    title?: string;
}
export interface UpdateTeacherStatusRequest {
    status: TeacherStatus;
}
export interface ResetPasswordRequest {
    newPassword: string;
}
export interface PrincipalTransferLog {
    id: string;
    schoolId: string;
    schoolName: string;
    oldPrincipalTeacherId: string | null;
    oldPrincipalTeacherName: string | null;
    newPrincipalTeacherId: string;
    newPrincipalTeacherName: string;
    operatorUserId: string;
    operatorUsername: string;
    result: PrincipalTransferResult;
    message?: string;
    createdAt: string;
}
export interface CreatePlatformAdminRequest {
    username: string;
    password: string;
    name: string;
    phone?: string;
    email?: string;
    bio?: string;
}
export interface ResetUserPasswordRequest {
    userId: string;
    newPassword: string;
    resetMethod: 'temporary_password' | 'manual_set';
}
export interface GetUsersQueryParams {
    role?: UserRole;
    status?: 'active' | 'disabled';
    schoolId?: string;
    keyword?: string;
    page?: number;
    pageSize?: number;
}
export interface UserDetailResponse {
    id: string;
    username: string;
    role: UserRole;
    status: string;
    avatar?: string;
    phone?: string;
    email?: string;
    bio?: string;
    createdAt: string;
    updatedAt: string;
    profile?: {
        id: string;
        name: string;
        schoolId?: string;
        schoolName?: string;
        teamId?: string;
        teamName?: string;
    };
}
export interface GlobalStatsResponse {
    totalSchools: number;
    totalTeachers: number;
    totalStudents: number;
    totalContests: number;
    totalPublicContests: number;
    activeUsers: number;
    disabledUsers: number;
    recentRegistrations: number;
}
export { calculateGrade, calculateGradeSimple, calculateGradeByEducationSystem, getAllGrades, getGradeSortValue, parseEducationSystem, type CalculateGradeParams } from './utils/grade';
