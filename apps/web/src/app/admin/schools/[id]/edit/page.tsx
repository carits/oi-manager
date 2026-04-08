'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import apiClient from '@/lib/apiClient'
import { RegionSelector } from '@/components/business/RegionSelector'
import { useToast } from '@/components/ui/Toast'

interface School {
  id: string
  name: string
  region: string | null
  schoolType: string | null
  contactPerson: string | null
  contactPhone: string | null
  contactEmail: string | null
  principal: { id: string; name: string; title: string | null; email: string | null; user: { username: string } } | null
}

interface Teacher {
  id: string
  name: string
  title: string | null
  user: { username: string; role: string }
}

export default function EditSchoolPage() {
  const params = useParams()
  const router = useRouter()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [principal, setPrincipal] = useState<School['principal']>(null)
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>('')
  const [selectedProvince, setSelectedProvince] = useState<string>('')
  const [selectedCity, setSelectedCity] = useState<string>('')
  const [selectedDistrict, setSelectedDistrict] = useState<string>('')
  const [showPrincipalForm, setShowPrincipalForm] = useState(false)
  const [principalSaving, setPrincipalSaving] = useState(false)
  const [principalError, setPrincipalError] = useState('')
  const [principalData, setPrincipalData] = useState({
    username: '',
    password: '',
    teacherName: '',
    teacherTitle: '',
    email: '',
    phone: ''
  })

  const validateUsername = (value: string): string => {
    if (!value) return ''
    if (!/^[a-zA-Z0-9_]+$/.test(value)) {
      return '账号只能包含字母、数字和下划线'
    }
    if (value.length < 3) { return '账号至少3个字符' }
    return ''
  }

  const handleCreatePrincipal = async () => {
    setPrincipalError('')

    // 验证
    const usernameError = validateUsername(principalData.username)
    if (usernameError) {
      setPrincipalError(usernameError)
      return
    }
    if (!principalData.teacherName) {
      setPrincipalError('请输入负责人姓名')
      return
    }

    setPrincipalSaving(true)
    try {
      const result = await apiClient.post(`/api/schools/${schoolId}/principal`, {
        username: principalData.username,
        password: principalData.password || principalData.username,
        teacherName: principalData.teacherName,
        teacherTitle: principalData.teacherTitle,
        email: principalData.email,
        phone: principalData.phone
      })
      if (result.success) {
        setPrincipal(result.data?.teacher || null)
        setSelectedTeacherId(result.data?.teacher?.id || '')
        setShowPrincipalForm(false)
        setPrincipalData({ username: '', password: '', teacherName: '', teacherTitle: '', email: '', phone: '' })
        // 重新获取教师列表
        fetchTeachers()
      } else {
        setPrincipalError(result.message || '创建失败')
      }
    } catch {
      setPrincipalError('网络错误')
    } finally {
      setPrincipalSaving(false)
    }
  }


  const [formData, setFormData] = useState({
    name: '',
    region: '',
    schoolType: '',
    educationSystem: '6-3-3',
    contactPerson: '',
    contactPhone: '',
    contactEmail: ''
  })

  const schoolId = params.id as string

  useEffect(() => {
    if (schoolId) {
      fetchSchool()
      fetchTeachers()
    }
  }, [schoolId])

  const fetchTeachers = async () => {
    try {
      const result = await apiClient.get<{ list: Teacher[] }>(`/api/schools/${schoolId}/teachers`)
      if (result.success) {
        setTeachers(result.data?.list || [])
      }
    } catch (error) {
      console.error('Failed to fetch teachers:', error)
    }
  }

  const fetchSchool = async () => {
    try {
      const result = await apiClient.get<School>(`/api/schools/${schoolId}`)
      if (result.success) {
        const schoolData = result.data
        if (schoolData) {
          setFormData({
            name: schoolData.name || '',
            region: schoolData.region || '',
            schoolType: schoolData.schoolType || '',
            educationSystem: schoolData.educationSystem || '6-3-3',
            contactPerson: schoolData.contactPerson || '',
            contactPhone: schoolData.contactPhone || '',
            contactEmail: schoolData.contactEmail || ''
          })
          setPrincipal(schoolData.principal || null)
          setSelectedTeacherId(schoolData.principal?.id || '')

          // 解析区域信息
          if (schoolData.region) {
            const parts = schoolData.region.split('/')
            if (parts.length >= 1) setSelectedProvince(parts[0])
            if (parts.length >= 2) setSelectedCity(parts[1])
            if (parts.length >= 3) setSelectedDistrict(parts[2])
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch school:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    setSaving(true)

    try {
      // 组合省市区
      const region = [selectedProvince, selectedCity, selectedDistrict].filter(Boolean).join('/')

      // 更新学校基本信息
      const result = await apiClient.put(`/api/schools/${schoolId}`, {
        ...formData,
        region
      })
      if (!result.success) {
        toast.error(result.message || '保存失败')
        setSaving(false)
        return
      }

      // 如果选择了负责人且与当前不同，更新负责人
      if (selectedTeacherId && selectedTeacherId !== principal?.id) {
        const principalResult = await apiClient.put(`/api/schools/${schoolId}/principal`, { teacherId: selectedTeacherId })
        if (!principalResult.success) {
          toast.error(principalResult.message || '负责人更新失败')
          setSaving(false)
          return
        }

        // 更新本地状态
        if (principalResult.data?.principal) {
          setPrincipal(principalResult.data.principal)
          setSelectedTeacherId(principalResult.data.principal.id)
        }
      }

      toast.success('保存成功')
      router.push('/admin/schools')
    } catch {
      toast.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const updateField = (field: string, value: string) => {
    setFormData({ ...formData, [field]: value })
  }

  if (loading) {
    return (
      <ProtectedRoute requiredRole="super_admin">
        <div style={{ padding: '2rem', textAlign: 'center' }}>加载中...</div>
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute requiredRole="super_admin">
      <div style={{ minHeight: '100vh', background: 'var(--gray-50)' }}>
        <main style={{ padding: '2rem', maxWidth: '700px', margin: '0 auto' }}>
          <div style={{ marginBottom: '1.5rem' }}>
            <a href="/admin/schools" style={{ color: 'var(--primary)', textDecoration: 'none', fontSize: '0.875rem' }}>
              ← 返回学校列表
            </a>
          </div>

          <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '1.5rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>编辑学校</h2>

            <form onSubmit={handleSubmit}>
              {/* 学校信息 */}
              <div style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--gray-700)' }}>学校信息</h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.375rem', fontSize: '0.875rem' }}>学校名称 *</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => updateField('name', e.target.value)}
                      required
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px' }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.375rem', fontSize: '0.875rem' }}>学校类型</label>
                      <select
                        value={formData.schoolType}
                        onChange={(e) => updateField('schoolType', e.target.value)}
                        style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px' }}
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

                    <div>
                      <label style={{ display: 'block', marginBottom: '0.375rem', fontSize: '0.875rem' }}>学制</label>
                      <select
                        value={formData.educationSystem}
                        onChange={(e) => updateField('educationSystem', e.target.value)}
                        style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px' }}
                      >
                        <option value="6-3-3">6-3-3（小6初3高3）</option>
                        <option value="5-4-3">5-4-3（小5初4高3）</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', marginBottom: '0.375rem', fontSize: '0.875rem' }}>所属区域</label>
                    <RegionSelector
                      province={selectedProvince}
                      city={selectedCity}
                      district={selectedDistrict}
                      onProvinceChange={setSelectedProvince}
                      onCityChange={setSelectedCity}
                      onDistrictChange={setSelectedDistrict}
                    />
                  </div>
                </div>
              </div>

              {/* 联系方式 */}
              <div style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--gray-700)' }}>联系方式</h3>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.375rem', fontSize: '0.875rem' }}>联系人</label>
                    <input
                      type="text"
                      value={formData.contactPerson}
                      onChange={(e) => updateField('contactPerson', e.target.value)}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', marginBottom: '0.375rem', fontSize: '0.875rem' }}>联系电话</label>
                    <input
                      type="text"
                      value={formData.contactPhone}
                      onChange={(e) => updateField('contactPhone', e.target.value)}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px' }}
                    />
                  </div>

                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ display: 'block', marginBottom: '0.375rem', fontSize: '0.875rem' }}>联系邮箱</label>
                    <input
                      type="email"
                      value={formData.contactEmail}
                      onChange={(e) => updateField('contactEmail', e.target.value)}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px' }}
                    />
                  </div>
                </div>
              </div>

              {/* 负责人信息 */}
              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--gray-700)' }}>学校负责人 *</h3>
                  {!showPrincipalForm && (
                    <button
                      type="button"
                      onClick={() => setShowPrincipalForm(true)}
                      style={{ color: 'var(--primary)', fontSize: '0.875rem', background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      + 创建新负责人账号
                    </button>
                  )}
                </div>

                {showPrincipalForm ? (
                  <div style={{ padding: '1rem', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '6px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.75rem', color: '#9a3412' }}>负责人姓名 *</label>
                        <input
                          type="text"
                          value={principalData.teacherName}
                          onChange={(e) => setPrincipalData({ ...principalData, teacherName: e.target.value })}
                          placeholder="例如：张老师"
                          style={{ width: '100%', padding: '0.5rem', border: '1px solid #fdba74', borderRadius: '4px', fontSize: '0.875rem' }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.75rem', color: '#9a3412' }}>职务/职称</label>
                        <input
                          type="text"
                          value={principalData.teacherTitle}
                          onChange={(e) => setPrincipalData({ ...principalData, teacherTitle: e.target.value })}
                          placeholder="例如：校长"
                          style={{ width: '100%', padding: '0.5rem', border: '1px solid #fdba74', borderRadius: '4px', fontSize: '0.875rem' }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.75rem', color: '#9a3412' }}>登录账号 *</label>
                        <input
                          type="text"
                          value={principalData.username}
                          onChange={(e) => setPrincipalData({ ...principalData, username: e.target.value })}
                          placeholder="字母、数字、下划线"
                          style={{ width: '100%', padding: '0.5rem', border: '1px solid #fdba74', borderRadius: '4px', fontSize: '0.875rem' }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.75rem', color: '#9a3412' }}>登录密码</label>
                        <input
                          type="text"
                          value={principalData.password}
                          onChange={(e) => setPrincipalData({ ...principalData, password: e.target.value })}
                          placeholder="默认等于账号"
                          style={{ width: '100%', padding: '0.5rem', border: '1px solid #fdba74', borderRadius: '4px', fontSize: '0.875rem' }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.75rem', color: '#9a3412' }}>邮箱</label>
                        <input
                          type="email"
                          value={principalData.email}
                          onChange={(e) => setPrincipalData({ ...principalData, email: e.target.value })}
                          placeholder="可选"
                          style={{ width: '100%', padding: '0.5rem', border: '1px solid #fdba74', borderRadius: '4px', fontSize: '0.875rem' }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.75rem', color: '#9a3412' }}>手机</label>
                        <input
                          type="text"
                          value={principalData.phone}
                          onChange={(e) => setPrincipalData({ ...principalData, phone: e.target.value })}
                          placeholder="可选"
                          style={{ width: '100%', padding: '0.5rem', border: '1px solid #fdba74', borderRadius: '4px', fontSize: '0.875rem' }}
                        />
                      </div>
                    </div>
                    {principalError && (
                      <p style={{ color: '#dc2626', fontSize: '0.75rem', marginTop: '0.5rem' }}>{principalError}</p>
                    )}
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                      <button
                        type="button"
                        onClick={handleCreatePrincipal}
                        disabled={principalSaving}
                        style={{ padding: '0.5rem 1rem', background: '#ea580c', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}
                      >
                        {principalSaving ? '创建中...' : '确认创建'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowPrincipalForm(false); setPrincipalError(''); }}
                        style={{ padding: '0.5rem 1rem', background: 'white', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}
                      >
                        取消
                      </button>
                    </div>
                    <p style={{ fontSize: '0.7rem', color: '#9a3412', marginTop: '0.5rem' }}>保存后将自动为该老师分配"负责人"角色，并绑定至本校</p>
                  </div>
                ) : (
                  <div style={{ padding: '1rem', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '6px' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                      {principal ? `校长 (${principal.title || '校长'})` : '选择负责人'}
                    </label>
                    <select
                      value={selectedTeacherId}
                      onChange={(e) => setSelectedTeacherId(e.target.value)}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid #a7f3d0', borderRadius: '4px', fontSize: '0.875rem' }}
                    >
                      <option value="">请选择负责人</option>
                      {teachers.map((teacher) => (
                        <option key={teacher.id} value={teacher.id}>
                          {teacher.user.username} - {teacher.name}
                        </option>
                      ))}
                    </select>
                    {principal && (
                      <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginTop: '0.5rem' }}>
                        账号：{principal.user.username}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    flex: 1,
                    padding: '0.625rem',
                    background: 'var(--primary)',
                    color: 'white',
                    borderRadius: '6px',
                    fontWeight: 500
                  }}
                >
                  {saving ? '保存中...' : '保存'}
                </button>
                <button
                  type="button"
                  onClick={() => router.push('/admin/schools')}
                  style={{
                    flex: 1,
                    padding: '0.625rem',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    background: 'white'
                  }}
                >
                  取消
                </button>
              </div>
            </form>
          </div>
        </main>
      </div>
    </ProtectedRoute>
  )
}
