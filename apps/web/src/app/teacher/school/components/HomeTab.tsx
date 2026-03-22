'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import { formStyles } from '@/lib/styles'
import { calculateStudentGrade, getAllGrades } from '@/lib/grade'
import { RegionSelector } from '@/components/business/RegionSelector'
import apiClient from '@/lib/apiClient'

interface School {
  id: string
  name: string
  shortName: string | null
  announcement: string | null
  region: string | null
  schoolType: string | null
  educationSystem: string | null
  contactPerson: string | null
  contactPhone: string | null
  contactEmail: string | null
  currentPrincipalTeacherId: string | null
  _count: {
    teams: number
    teachers: number
    students: number
  }
}

interface HomeTabProps {
  school: School
  isPrincipal: boolean
  onAnnouncementUpdate: () => void
}

export default function HomeTab({ school, isPrincipal, onAnnouncementUpdate }: HomeTabProps) {
  const [stats, setStats] = useState<any>(null)
  const [topStudents, setTopStudents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [isEditingAnnouncement, setIsEditingAnnouncement] = useState(false)
  const [announcementText, setAnnouncementText] = useState(school.announcement || '')
  const [saving, setSaving] = useState(false)
  const [isEditingSchool, setIsEditingSchool] = useState(false)
  const [includeGraduated, setIncludeGraduated] = useState(false)

  // 规范化学制值
  const normalizeEducationSystem = (value: string | null): string => {
    if (!value) return '6-3-3'
    const normalized = value.replace(/\s+/g, '')
    if (normalized === '3+3+3' || normalized === '3-3-3') return '6-3-3'
    if (normalized === '4+4+3' || normalized === '4-4-3') return '5-4-3'
    if (normalized === '6-3-3' || normalized === '5-4-3') return normalized
    return '6-3-3'
  }

  const [schoolForm, setSchoolForm] = useState({
    name: school.name || '',
    province: '',
    city: '',
    district: '',
    schoolType: school.schoolType || '',
    educationSystem: normalizeEducationSystem(school.educationSystem),
    contactPerson: school.contactPerson || '',
    contactPhone: school.contactPhone || '',
    contactEmail: school.contactEmail || ''
  })

  useEffect(() => {
    // 解析 region 字段
    if (school.region) {
      const parts = school.region.split('/')
      setSchoolForm(prev => ({
        ...prev,
        province: parts[0] || '',
        city: parts[1] || '',
        district: parts[2] || ''
      }))
    }
  }, [school.region])

  useEffect(() => {
    fetchStats()
    fetchTopStudents()
  }, [school.id, school.educationSystem, school.schoolType])

  const fetchStats = async () => {
    try {
      const result = await apiClient.get<any>(`/api/schools/${school.id}/stats`)
      if (result.success) {
        setStats(result.data)
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error)
    }
  }

  const fetchTopStudents = async () => {
    try {
      const result = await apiClient.get<any[]>(`/api/schools/${school.id}/student-rankings`)
      if (result.success) {
        setTopStudents(result.data || [])
      }
    } catch (error) {
      console.error('Failed to fetch top students:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSaveSchool = async () => {
    setSaving(true)
    try {
      const region = [schoolForm.province, schoolForm.city, schoolForm.district]
        .filter(Boolean)
        .join('/')

      const result = await apiClient.put(`/api/schools/${school.id}`, {
        name: schoolForm.name,
        region: region || null,
        schoolType: schoolForm.schoolType || null,
        educationSystem: schoolForm.educationSystem,
        contactPerson: schoolForm.contactPerson || null,
        contactPhone: schoolForm.contactPhone || null,
        contactEmail: schoolForm.contactEmail || null
      })
      if (result.success) {
        setIsEditingSchool(false)
        onAnnouncementUpdate() // 刷新学校数据
        alert('学校信息保存成功')
      } else {
        alert(result.message || '保存失败')
      }
    } catch (error) {
      console.error('Failed to save school:', error)
      alert('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAnnouncement = async () => {
    setSaving(true)
    try {
      const result = await apiClient.put(`/api/schools/${school.id}/announcement`, {
        announcement: announcementText
      })
      if (result.success) {
        setIsEditingAnnouncement(false)
        onAnnouncementUpdate()
        alert('公告保存成功')
      } else {
        alert(result.message || '保存失败')
      }
    } catch (error) {
      console.error('Failed to save announcement:', error)
      alert('保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>加载中...</div>
  }

  // 根据"包含已毕业"复选框过滤学生，然后取前10个
  const filteredTopStudents = (includeGraduated
    ? topStudents
    : topStudents.filter(student => {
        if (!student.enrollmentYear) return true
        const grade = calculateStudentGrade(student)
        return !grade.startsWith('已毕业')
      })
  ).slice(0, 10)

  return (
    <div>
      {/* 统计卡片 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        <Card>
          <div style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '0.5rem' }}>团队数量</div>
          <div style={{ fontSize: '2rem', fontWeight: 600 }}>{school._count?.teams || 0}</div>
        </Card>
        <Card>
          <div style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '0.5rem' }}>教师数量</div>
          <div style={{ fontSize: '2rem', fontWeight: 600 }}>{school._count?.teachers || 0}</div>
        </Card>
        <Card>
          <div style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '0.5rem' }}>学生数量</div>
          <div style={{ fontSize: '2rem', fontWeight: 600 }}>{school._count?.students || 0}</div>
        </Card>
        <Card>
          <div style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '0.5rem' }}>平均 Rating</div>
          <div style={{ fontSize: '2rem', fontWeight: 600 }}>{stats?.avgRating || 0}</div>
        </Card>
      </div>

      {/* 中间两栏布局 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        {/* Rating 排名 Top 10 */}
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Rating 排名 Top10</h3>
            <label style={{ fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={includeGraduated}
                onChange={(e) => setIncludeGraduated(e.target.checked)}
              />
              包含已毕业
            </label>
          </div>
          {filteredTopStudents.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--gray-500)', padding: '2rem' }}>暂无数据</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', backgroundColor: 'var(--gray-50)' }}>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>排名</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>姓名</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>年级</th>
                  <th style={{ padding: '0.75rem', textAlign: 'right', fontSize: '0.875rem', fontWeight: 500 }}>Rating</th>
                </tr>
              </thead>
              <tbody>
                {filteredTopStudents.map((student, index) => (
                  <tr key={student.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.75rem', fontSize: '0.875rem', color: index < 3 ? 'var(--warning)' : 'inherit' }}>
                      {index + 1}
                    </td>
                    <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>{student.name}</td>
                    <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>
                      {student.enrollmentYear ? calculateStudentGrade(student) : '-'}
                    </td>
                    <td style={{ padding: '0.75rem', fontSize: '0.875rem', textAlign: 'right', fontWeight: 600 }}>
                      {student.rating}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* 年级分布 */}
        <Card>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 1rem 0' }}>年级分布</h3>
          {stats?.gradeDistribution ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <GradeDistribution
                gradeDistribution={stats.gradeDistribution}
                schoolType={stats.schoolType}
                educationSystem={stats.educationSystem}
              />
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--gray-500)', padding: '2rem' }}>暂无数据</div>
          )}
        </Card>
      </div>

      {/* 学校公告 */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>学校公告</h3>
          {isPrincipal && (
            <Button
              variant="primary"
              onClick={() => setIsEditingAnnouncement(!isEditingAnnouncement)}
            >
              {isEditingAnnouncement ? '取消编辑' : '编辑公告'}
            </Button>
          )}
        </div>
        {isEditingAnnouncement ? (
          <div>
            <textarea
              value={announcementText}
              onChange={(e) => setAnnouncementText(e.target.value)}
              placeholder="请输入学校公告（支持 Markdown 格式）..."
              style={{
                width: '100%',
                minHeight: '200px',
                padding: '0.75rem',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                fontSize: '0.875rem',
                resize: 'vertical',
                boxSizing: 'border-box',
                fontFamily: 'inherit'
              }}
            />
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={() => {
                setAnnouncementText(school.announcement || '')
                setIsEditingAnnouncement(false)
              }}>
                取消
              </Button>
              <Button onClick={handleSaveAnnouncement} disabled={saving}>
                {saving ? '保存中...' : '保存'}
              </Button>
            </div>
          </div>
        ) : (
          <div style={{
            color: school.announcement ? 'var(--gray-800)' : 'var(--gray-400)',
            fontSize: '0.9375rem',
            lineHeight: '1.6'
          }}>
            {school.announcement ? (
              <MarkdownRenderer content={school.announcement} />
            ) : (
              <div style={{ textAlign: 'center', padding: '2rem' }}>暂无公告</div>
            )}
          </div>
        )}
      </Card>

      {/* 编辑学校模态框 */}
      {isEditingSchool && (
        <Modal isOpen={true} onClose={() => setIsEditingSchool(false)} title="编辑学校信息" width="600px">
          <form onSubmit={(e) => { e.preventDefault(); handleSaveSchool(); }} style={{ display: 'grid', gap: '1rem' }}>
            <div style={formStyles.field}>
              <label style={formStyles.label}>学校名称 *</label>
              <input
                type="text"
                value={schoolForm.name}
                onChange={(e) => setSchoolForm({ ...schoolForm, name: e.target.value })}
                required
                style={formStyles.input}
              />
            </div>

            <div style={formStyles.field}>
              <label style={formStyles.label}>所属区域</label>
              <RegionSelector
                province={schoolForm.province}
                city={schoolForm.city}
                district={schoolForm.district}
                onProvinceChange={(province) => setSchoolForm({ ...schoolForm, province, city: '', district: '' })}
                onCityChange={(city) => setSchoolForm({ ...schoolForm, city, district: '' })}
                onDistrictChange={(district) => setSchoolForm({ ...schoolForm, district })}
              />
            </div>

            <div style={formStyles.field}>
              <label style={formStyles.label}>学校类型</label>
              <select
                value={schoolForm.schoolType}
                onChange={(e) => setSchoolForm({ ...schoolForm, schoolType: e.target.value })}
                style={formStyles.select}
              >
                <option value="">请选择</option>
                <option value="小学">小学</option>
                <option value="初中">初中</option>
                <option value="高中">高中</option>
                <option value="小学+初中">小学+初中</option>
                <option value="初中+高中">初中+高中</option>
                <option value="小学+初中+高中">小学+初中+高中</option>
              </select>
            </div>

            <div style={formStyles.field}>
              <label style={formStyles.label}>学制</label>
              <select
                value={schoolForm.educationSystem}
                onChange={(e) => setSchoolForm({ ...schoolForm, educationSystem: e.target.value })}
                style={formStyles.select}
              >
                <option value="6-3-3">6-3-3 学制（小学6年 + 初中3年 + 高中3年）</option>
                <option value="5-4-3">5-4-3 学制（小学5年 + 初中4年 + 高中3年）</option>
              </select>
            </div>

            <div style={formStyles.field}>
              <label style={formStyles.label}>联系人</label>
              <input
                type="text"
                value={schoolForm.contactPerson}
                onChange={(e) => setSchoolForm({ ...schoolForm, contactPerson: e.target.value })}
                style={formStyles.input}
              />
            </div>

            <div style={formStyles.field}>
              <label style={formStyles.label}>联系电话</label>
              <input
                type="tel"
                value={schoolForm.contactPhone}
                onChange={(e) => setSchoolForm({ ...schoolForm, contactPhone: e.target.value })}
                placeholder="11位手机号"
                style={formStyles.input}
              />
            </div>

            <div style={formStyles.field}>
              <label style={formStyles.label}>联系邮箱</label>
              <input
                type="email"
                value={schoolForm.contactEmail}
                onChange={(e) => setSchoolForm({ ...schoolForm, contactEmail: e.target.value })}
                style={formStyles.input}
              />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
              <Button type="submit" disabled={saving} style={{ flex: 1 }}>
                {saving ? '保存中...' : '保存'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setIsEditingSchool(false)} style={{ flex: 1 }}>
                取消
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

// 年级颜色映射（统一配色，彩虹色谱）
function getGradeColor(grade: string): string {
  const colors: Record<string, string> = {
    '高三': '#ef4444',  // 红
    '高二': '#f97316',  // 橙
    '高一': '#eab308',  // 黄
    '初四': '#84cc16',  // 黄绿
    '初三': '#22c55e',  // 绿
    '初二': '#14b8a6',  // 青绿
    '初一': '#06b6d4',  // 青
    '小六': '#0ea5e9',  // 天蓝
    '小五': '#3b82f6',  // 蓝
    '小四': '#6366f1',  // 靛蓝
    '小三': '#8b5cf6',  // 紫
    '小二': '#a855f7',  // 亮紫
    '小一': '#ec4899',  // 粉
    '幼三': '#f472b6',  // 浅粉
    '幼二': '#fb7185',  // 玫瑰粉
    '幼一': '#fda4af',  // 淡粉
    '其他': '#9ca3af'   // 灰
  }
  return colors[grade] || '#9ca3af'
}

// 年级分布组件
function GradeDistribution({
  gradeDistribution,
  schoolType,
  educationSystem
}: {
  gradeDistribution: Record<string, number>
  schoolType: string | null
  educationSystem: string | null
}) {
  const allGrades = getAllGrades(schoolType, educationSystem)
  const total = Object.values(gradeDistribution).reduce((sum, c) => sum + c, 0)

  if (total === 0) {
    return <div style={{ textAlign: 'center', color: 'var(--gray-500)', padding: '2rem' }}>暂无数据</div>
  }

  return (
    <>
      {allGrades.map(grade => {
        const count = gradeDistribution[grade] || 0
        const percentage = ((count / total) * 100).toFixed(1)
        return (
          <div key={grade} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '2px',
                  backgroundColor: getGradeColor(grade),
                  flexShrink: 0
                }} />
                <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{grade}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--gray-600)' }}>{percentage}%</span>
                <span style={{ fontSize: '1rem', fontWeight: 600 }}>{count}</span>
              </div>
            </div>
            <div style={{
              width: '100%',
              height: '6px',
              backgroundColor: 'var(--gray-100)',
              borderRadius: '3px',
              overflow: 'hidden'
            }}>
              <div style={{
                width: `${percentage}%`,
                height: '100%',
                backgroundColor: getGradeColor(grade),
                transition: 'width 0.3s ease'
              }} />
            </div>
          </div>
        )
      })}
    </>
  )
}
