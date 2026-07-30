import path from 'node:path'
import { loadRuntimeSecrets } from './runtime'

export type AuthRole =
  | 'superAdmin'
  | 'platformAdmin'
  | 'principal'
  | 'teacher'
  | 'campusStudent'
  | 'personalStudent'

export interface AuthAccount {
  username: string
  password: string
  loginRole: 'admin' | 'teacher' | 'student'
  mode?: 'campus' | 'personal'
  storageState: string
}

const authDir = path.resolve(__dirname, '../.auth')
const { accountPassword } = loadRuntimeSecrets()

export const accounts: Record<AuthRole, AuthAccount> = {
  superAdmin: {
    username: 'admin',
    password: accountPassword,
    loginRole: 'admin',
    storageState: path.join(authDir, 'super-admin.json'),
  },
  platformAdmin: {
    username: 'platform_admin',
    password: accountPassword,
    loginRole: 'admin',
    storageState: path.join(authDir, 'platform-admin.json'),
  },
  principal: {
    username: 'teacher1',
    password: accountPassword,
    loginRole: 'teacher',
    storageState: path.join(authDir, 'principal.json'),
  },
  teacher: {
    username: 'teacher2',
    password: accountPassword,
    loginRole: 'teacher',
    storageState: path.join(authDir, 'teacher.json'),
  },
  campusStudent: {
    username: 'student1',
    password: accountPassword,
    loginRole: 'student',
    mode: 'campus',
    storageState: path.join(authDir, 'campus-student.json'),
  },
  personalStudent: {
    username: 'personal_student1',
    password: accountPassword,
    loginRole: 'student',
    mode: 'personal',
    storageState: path.join(authDir, 'personal-student.json'),
  },
}
