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
  workspaceMode?: 'work' | 'personal'
  storageState: string
}

const authDir = path.resolve(__dirname, '../.auth')
const { accountPassword } = loadRuntimeSecrets()

export const accounts: Record<AuthRole, AuthAccount> = {
  superAdmin: {
    username: 'admin',
    password: accountPassword,
    storageState: path.join(authDir, 'super-admin.json'),
  },
  platformAdmin: {
    username: 'platform_admin',
    password: accountPassword,
    storageState: path.join(authDir, 'platform-admin.json'),
  },
  principal: {
    username: 'teacher1',
    password: accountPassword,
    storageState: path.join(authDir, 'principal.json'),
  },
  teacher: {
    username: 'teacher2',
    password: accountPassword,
    storageState: path.join(authDir, 'teacher.json'),
  },
  campusStudent: {
    username: 'student1',
    password: accountPassword,
    workspaceMode: 'work',
    storageState: path.join(authDir, 'campus-student.json'),
  },
  personalStudent: {
    username: 'personal_student1',
    password: accountPassword,
    workspaceMode: 'personal',
    storageState: path.join(authDir, 'personal-student.json'),
  },
}

export const chatAccounts = {
  sender: { username: 'chat_sender', password: accountPassword, workspaceMode: 'personal' as const },
  receiver: { username: 'chat_receiver', password: accountPassword, workspaceMode: 'personal' as const },
  outsider: { username: 'chat_outsider', password: accountPassword, workspaceMode: 'personal' as const },
}
