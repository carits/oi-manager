'use client'

import { useEffect, useState } from 'react'
import { TableRoot, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/ui/TablePrimitives'
import unifiedStyles from './page.unified.module.css'
import { Button } from '@/components/ui/Button'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { Pagination } from '@/components/ui/Pagination'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'
import { getPlatformSchool, getPlatformSchoolStudents, getPlatformSchoolTeachers, type PlatformSchool as School, type PlatformSchoolStudent as Student, type PlatformSchoolTeacher as Teacher } from '@/features/platform-organization'

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
      setSchool(await getPlatformSchool(schoolId))
    } catch (error) {
      console.error('Failed to fetch school:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchStudents = async () => {
    try {
      const result = await getPlatformSchoolStudents(schoolId, studentPage, pageSize)
      setStudents(result.data)
      setStudentTotal(result.total)
    } catch (error) {
      console.error('Failed to fetch students:', error)
    }
  }

  const fetchTeachers = async () => {
    try {
      const result = await getPlatformSchoolTeachers(schoolId, teacherPage, pageSize)
      setTeachers(result.data)
      setTeacherTotal(result.total)
    } catch (error) {
      console.error('Failed to fetch teachers:', error)
    }
  }

  if (loading) {
    return <PageLoadingFrame title="学校详情" />
  }

  if (!school) {
    return (
      <>
        <div className={unifiedStyles.u1}>学校不存在</div>
      </>
    )
  }

  return (
    <>
      <div className={unifiedStyles.u2}>
        <main className={unifiedStyles.u3}>
          {/* 返回按钮 */}
          <div className={unifiedStyles.u4}>
            <a href="/admin/schools" onClick={(e) => { e.preventDefault(); router.push('/admin/schools') }} className={unifiedStyles.u5}>
              ← 返回学校列表
            </a>
          </div>

          {/* 学校基本信息 */}
          <div className={unifiedStyles.u6}>
            <h2 className={unifiedStyles.u7}>{school.name}</h2>

            {/* 标签页 */}
            <div className={unifiedStyles.u8}>
              <div className={unifiedStyles.u9}>
                <Button variant="text"
                  onClick={() => { setActiveTab('info'); router.push(`/admin/schools/${schoolId}?tab=info`, { scroll: false }) }}
                  className={unifiedStyles.tabButton}
                  aria-selected={activeTab === 'info'}
                >
                  主页
                </Button>
                <Button variant="text"
                  onClick={() => { setActiveTab('teachers'); router.push(`/admin/schools/${schoolId}?tab=teachers`, { scroll: false }) }}
                  className={unifiedStyles.tabButton}
                  aria-selected={activeTab === 'teachers'}
                >
                  教师
                </Button>
                <Button variant="text"
                  onClick={() => { setActiveTab('students'); router.push(`/admin/schools/${schoolId}?tab=students`, { scroll: false }) }}
                  className={unifiedStyles.tabButton}
                  aria-selected={activeTab === 'students'}
                >
                  学生
                </Button>
              </div>
            </div>

            {/* 主页标签 */}
            {activeTab === 'info' && (
              <>
                <div className={unifiedStyles.u10}>
                  <div>
                    <p className={unifiedStyles.u11}>学校类型</p>
                    <p className={unifiedStyles.u12}>{school.schoolType || '-'}</p>
                  </div>
                  <div>
                    <p className={unifiedStyles.u11}>所属区域</p>
                    <p className={unifiedStyles.u12}>{school.region || '-'}</p>
                  </div>
                  <div>
                    <p className={unifiedStyles.u11}>联系人</p>
                    <p className={unifiedStyles.u12}>{school.contactPerson || '-'}</p>
                  </div>
                  <div>
                    <p className={unifiedStyles.u11}>联系电话</p>
                    <p className={unifiedStyles.u12}>{school.contactPhone || '-'}</p>
                  </div>
                  <div>
                    <p className={unifiedStyles.u11}>联系邮箱</p>
                    <p className={unifiedStyles.u12}>{school.contactEmail || '-'}</p>
                  </div>
                </div>

                {/* 负责人信息 */}
                {school.principal && (
                  <div className={unifiedStyles.u13}>
                    <p className={unifiedStyles.u11}>学校负责人</p>
                    <p className={unifiedStyles.u14}>{school.principal.name}</p>
                    <p className={unifiedStyles.u15}>{school.principal.title || '校长'} · {school.principal.user?.username || '-'}</p>
                  </div>
                )}

                <div className={unifiedStyles.u16}>
                  <span>学生总数：{school._count.students}</span>
                </div>
              </>
            )}

            {/* 学生标签 */}
            {activeTab === 'students' && (
              <div>
                {students.length === 0 ? (
                  <p className={unifiedStyles.u17}>暂无学生数据</p>
                ) : (
                  <>
                    <TableRoot className={unifiedStyles.u18}>
                      <TableHead>
                        <TableRow className={unifiedStyles.u19}>
                          <TableHeaderCell className={unifiedStyles.u20}>姓名</TableHeaderCell>
                          <TableHeaderCell className={unifiedStyles.u20}>用户名</TableHeaderCell>
                          <TableHeaderCell className={unifiedStyles.u20}>Rating</TableHeaderCell>
                          <TableHeaderCell className={unifiedStyles.u20}>入学年份</TableHeaderCell>
                          <TableHeaderCell className={unifiedStyles.u20}>主教练</TableHeaderCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {students.map((student) => (
                          <TableRow key={student.id} className={unifiedStyles.u19}>
                            <TableCell className={unifiedStyles.u21}>{student.name}</TableCell>
                            <TableCell className={unifiedStyles.u21}>{student.user.username}</TableCell>
                            <TableCell className={unifiedStyles.u22}>{student.rating}</TableCell>
                            <TableCell className={unifiedStyles.u21}>{student.enrollmentYear || '-'}</TableCell>
                            <TableCell className={unifiedStyles.u21}>{student.headTeacher?.name || '-'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </TableRoot>
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
                  <p className={unifiedStyles.u17}>暂无教师数据</p>
                ) : (
                  <>
                    <TableRoot className={unifiedStyles.u18}>
                      <TableHead>
                        <TableRow className={unifiedStyles.u19}>
                          <TableHeaderCell className={unifiedStyles.u20}>姓名</TableHeaderCell>
                          <TableHeaderCell className={unifiedStyles.u20}>用户名</TableHeaderCell>
                          <TableHeaderCell className={unifiedStyles.u20}>职称</TableHeaderCell>
                          <TableHeaderCell className={unifiedStyles.u20}>角色</TableHeaderCell>
                          <TableHeaderCell className={unifiedStyles.u20}>联系方式</TableHeaderCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {teachers.map((teacher) => (
                          <TableRow key={teacher.id} className={unifiedStyles.u19}>
                            <TableCell className={unifiedStyles.u21}>{teacher.name}</TableCell>
                            <TableCell className={unifiedStyles.u21}>{teacher.user.username}</TableCell>
                            <TableCell className={unifiedStyles.u21}>{teacher.title || '-'}</TableCell>
                            <TableCell className={unifiedStyles.u21}>
                              <span className={`${unifiedStyles.roleBadge} ${teacher.user.role === 'school_principal' ? unifiedStyles.principalBadge : unifiedStyles.teacherBadge}`}>
                                {teacher.user.role === 'school_principal' ? '负责人' : '教师'}
                              </span>
                            </TableCell>
                            <TableCell className={unifiedStyles.u21}>
                              {teacher.email || teacher.phone || '-'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </TableRoot>
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
    </>
  )
}
