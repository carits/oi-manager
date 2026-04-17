'use client'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { Pagination } from '@/components/ui/Pagination'
import apiClient from '@/lib/apiClient'

interface School {
  id: string
  name: string
  region: string | null
  schoolType: string | null
  contactPerson: string | null
  contactPhone: string | null
  contactEmail: string | null
  createdAt: string
  principal: { id: string; name: string; title: string | null; email: string | null; User: { username: string } } | null
  _count: {
    students: number
  }
}

interface Student {
  id: string
  name: string
  enrollmentYear: number | null
  rating: number
  user: { username: string }
  headTeacher: { name: string } | null
}

interface Teacher {
  id: string
  name: string
  title: string | null
  email: string | null
  phone: string | null
  user: {
    id: string
    username: string
    role: string
    status: string
  }
}

export default function AdminSchoolDetailPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [school, setSchool] = useState<School | null>(null)
  const [students, setStudents] = useState<Student[]>([])
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [studentTotal, setStudentTotal] = useState(0)
  const [teacherTotal, setTeacherTotal] = useState(0)
  const [studentPage, setStudentPage] = useState(1)
  const [teacherPage, setTeacherPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(true)
  type TabType = 'info' | 'teachers' | 'students'
  const VALID_TABS: TabType[] = ['info', 'teachers', 'students']
  const [activeTab, setActiveTab] = useState<TabType>(
    VALID_TABS.includes(searchParams.get('tab') as TabType) ? (searchParams.get('tab') as TabType) : 'info'
  )

  const schoolId = params.id as string

  useEffect(() => {
    const tab = searchParams.get('tab') as TabType
    if (VALID_TABS.includes(tab)) setActiveTab(tab)
  }, [searchParams])

  useEffect(() => {
    if (schoolId) {
      fetchSchool()
    }
  }, [schoolId])

  useEffect(() => {
    if (schoolId && activeTab === 'students') {
      fetchStudents()
    }
  }, [schoolId, activeTab, studentPage, pageSize])

  useEffect(() => {
    if (schoolId && activeTab === 'teachers') {
      fetchTeachers()
    }
  }, [schoolId, activeTab, teacherPage, pageSize])

  const fetchSchool = async () => {
    try {
      const result = await apiClient.get<School>(`/api/schools/${schoolId}`)
      if (result.success) {
        setSchool(result.data || null)
      }
    } catch (error) {
      console.error('Failed to fetch school:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchStudents = async () => {
    try {
      const result = await apiClient.get<{ list: Student[]; total: number }>(`/api/students?schoolId=${schoolId}&page=${studentPage}&pageSize=${pageSize}`)
      if (result.success) {
        setStudents(result.data?.list || [])
        setStudentTotal(result.data?.total || 0)
      }
    } catch (error) {
      console.error('Failed to fetch students:', error)
    }
  }

  const fetchTeachers = async () => {
    try {
      const result = await apiClient.get<{ list: Teacher[]; total: number }>(`/api/schools/${schoolId}/teachers?page=${teacherPage}&pageSize=${pageSize}`)
      if (result.success) {
        setTeachers(result.data?.list || [])
        setTeacherTotal(result.data?.total || 0)
      }
    } catch (error) {
      console.error('Failed to fetch teachers:', error)
    }
  }

  if (loading) {
    return (
      <ProtectedRoute requiredRole="super_admin">
        <div style={{ padding: '2rem', textAlign: 'center' }}>加载中...</div>
      </ProtectedRoute>
    )
  }

  if (!school) {
    return (
      <ProtectedRoute requiredRole="super_admin">
        <div style={{ padding: '2rem', textAlign: 'center' }}>学校不存在</div>
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute requiredRole="super_admin">
      <div style={{ minHeight: '100vh', background: 'var(--gray-50)' }}>
        <main style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
          {/* 返回按钮 */}
          <div style={{ marginBottom: '1.5rem' }}>
            <a href="/admin/schools" onClick={(e) => { e.preventDefault(); router.push('/admin/schools') }} style={{ color: 'var(--primary)', textDecoration: 'none', fontSize: '0.875rem', cursor: 'pointer' }}>
              ← 返回学校列表
            </a>
          </div>

          {/* 学校基本信息 */}
          <div style={{
            background: 'white',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            padding: '1.5rem',
            marginBottom: '1.5rem'
          }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>{school.name}</h2>

            {/* 标签页 */}
            <div style={{ borderBottom: '1px solid var(--border)', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', gap: '2rem' }}>
                <button
                  onClick={() => { setActiveTab('info'); router.push(`/admin/schools/${schoolId}?tab=info`, { scroll: false }) }}
                  style={{
                    padding: '0.75rem 0',
                    background: 'none',
                    border: 'none',
                    borderBottom: activeTab === 'info' ? '2px solid var(--primary)' : '2px solid transparent',
                    color: activeTab === 'info' ? 'var(--primary)' : 'var(--gray-600)',
                    fontWeight: activeTab === 'info' ? 600 : 400,
                    cursor: 'pointer',
                    fontSize: '0.875rem'
                  }}
                >
                  主页
                </button>
                <button
                  onClick={() => { setActiveTab('teachers'); router.push(`/admin/schools/${schoolId}?tab=teachers`, { scroll: false }) }}
                  style={{
                    padding: '0.75rem 0',
                    background: 'none',
                    border: 'none',
                    borderBottom: activeTab === 'teachers' ? '2px solid var(--primary)' : '2px solid transparent',
                    color: activeTab === 'teachers' ? 'var(--primary)' : 'var(--gray-600)',
                    fontWeight: activeTab === 'teachers' ? 600 : 400,
                    cursor: 'pointer',
                    fontSize: '0.875rem'
                  }}
                >
                  教师
                </button>
                <button
                  onClick={() => { setActiveTab('students'); router.push(`/admin/schools/${schoolId}?tab=students`, { scroll: false }) }}
                  style={{
                    padding: '0.75rem 0',
                    background: 'none',
                    border: 'none',
                    borderBottom: activeTab === 'students' ? '2px solid var(--primary)' : '2px solid transparent',
                    color: activeTab === 'students' ? 'var(--primary)' : 'var(--gray-600)',
                    fontWeight: activeTab === 'students' ? 600 : 400,
                    cursor: 'pointer',
                    fontSize: '0.875rem'
                  }}
                >
                  学生
                </button>
              </div>
            </div>

            {/* 主页标签 */}
            {activeTab === 'info' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem', marginBottom: '1rem' }}>
                  <div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.25rem' }}>学校类型</p>
                    <p style={{ fontSize: '0.875rem' }}>{school.schoolType || '-'}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.25rem' }}>所属区域</p>
                    <p style={{ fontSize: '0.875rem' }}>{school.region || '-'}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.25rem' }}>联系人</p>
                    <p style={{ fontSize: '0.875rem' }}>{school.contactPerson || '-'}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.25rem' }}>联系电话</p>
                    <p style={{ fontSize: '0.875rem' }}>{school.contactPhone || '-'}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.25rem' }}>联系邮箱</p>
                    <p style={{ fontSize: '0.875rem' }}>{school.contactEmail || '-'}</p>
                  </div>
                </div>

                {/* 负责人信息 */}
                {school.principal && (
                  <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'var(--gray-50)', borderRadius: '6px' }}>
                    <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.25rem' }}>学校负责人</p>
                    <p style={{ fontSize: '0.875rem', fontWeight: 500 }}>{school.principal.name}</p>
                    <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>{school.principal.title || '校长'} · {school.principal.User.username}</p>
                  </div>
                )}

                <div style={{ marginTop: '1rem', display: 'flex', gap: '2rem', fontSize: '0.875rem', color: 'var(--gray-600)' }}>
                  <span>学生总数：{school._count.students}</span>
                </div>
              </>
            )}

            {/* 学生标签 */}
            {activeTab === 'students' && (
              <div>
                {students.length === 0 ? (
                  <p style={{ textAlign: 'center', color: 'var(--gray-500)', padding: '2rem' }}>暂无学生数据</p>
                ) : (
                  <>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>姓名</th>
                          <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>用户名</th>
                          <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>Rating</th>
                          <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>入学年份</th>
                          <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>主教练</th>
                        </tr>
                      </thead>
                      <tbody>
                        {students.map((student) => (
                          <tr key={student.id} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>{student.name}</td>
                            <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>{student.user.username}</td>
                            <td style={{ padding: '0.75rem', fontSize: '0.875rem', fontWeight: 600 }}>{student.rating}</td>
                            <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>{student.enrollmentYear || '-'}</td>
                            <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>{student.headTeacher?.name || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <Pagination
                      currentPage={studentPage}
                      totalPages={Math.ceil(studentTotal / pageSize)}
                      total={studentTotal}
                      pageSize={pageSize}
                      onPageChange={setStudentPage}
                      onPageSizeChange={(size) => {
                        setPageSize(size)
                        setStudentPage(1)
                      }}
                    />
                  </>
                )}
              </div>
            )}

            {/* 教师标签 */}
            {activeTab === 'teachers' && (
              <div>
                {teachers.length === 0 ? (
                  <p style={{ textAlign: 'center', color: 'var(--gray-500)', padding: '2rem' }}>暂无教师数据</p>
                ) : (
                  <>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>姓名</th>
                          <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>用户名</th>
                          <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>职称</th>
                          <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>角色</th>
                          <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>联系方式</th>
                        </tr>
                      </thead>
                      <tbody>
                        {teachers.map((teacher) => (
                          <tr key={teacher.id} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>{teacher.name}</td>
                            <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>{teacher.user.username}</td>
                            <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>{teacher.title || '-'}</td>
                            <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>
                              <span style={{
                                padding: '0.125rem 0.5rem',
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                background: teacher.user.role === 'school_principal' ? '#fef3c7' : '#e0f2fe',
                                color: teacher.user.role === 'school_principal' ? '#92400e' : '#0369a1'
                              }}>
                                {teacher.user.role === 'school_principal' ? '负责人' : '教师'}
                              </span>
                            </td>
                            <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>
                              {teacher.email || teacher.phone || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <Pagination
                      currentPage={teacherPage}
                      totalPages={Math.ceil(teacherTotal / pageSize)}
                      total={teacherTotal}
                      pageSize={pageSize}
                      onPageChange={setTeacherPage}
                      onPageSizeChange={(size) => {
                        setPageSize(size)
                        setTeacherPage(1)
                      }}
                    />
                  </>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </ProtectedRoute>
  )
}
