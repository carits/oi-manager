'use client'

import { useEffect, useState } from 'react'
import unifiedStyles from './page.unified.module.css'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { Button } from '@/components/ui/Button'
import { useParams, useRouter } from 'next/navigation'
import { RegionSelector } from '@/components/business/RegionSelector'
import { useToast } from '@/components/ui/Toast'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'

import { createPlatformSchoolPrincipal, getPlatformSchool, getPlatformSchoolTeachers, transferPlatformSchoolPrincipal, updatePlatformSchool, type PlatformSchool as School, type PlatformSchoolTeacher as Teacher } from '@/features/platform-organization'

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
      const result = await createPlatformSchoolPrincipal(schoolId, {
        username: principalData.username,
        password: principalData.password || principalData.username,
        teacherName: principalData.teacherName,
        teacherTitle: principalData.teacherTitle,
        email: principalData.email,
        phone: principalData.phone
      })
      if (result.ok) {
        setPrincipal(result.data.teacher)
        setSelectedTeacherId(result.data.teacher.id)
        setShowPrincipalForm(false)
        setPrincipalData({ username: '', password: '', teacherName: '', teacherTitle: '', email: '', phone: '' })
        // 重新获取教师列表
        fetchTeachers()
      } else {
        setPrincipalError(result.error.message || '创建失败')
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
      const result = await getPlatformSchoolTeachers(schoolId, 1, 100)
      setTeachers(result.data)
    } catch (error) {
      console.error('Failed to fetch teachers:', error)
    }
  }

  const fetchSchool = async () => {
    try {
      const schoolData = await getPlatformSchool(schoolId)
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
      const result = await updatePlatformSchool(schoolId, {
        ...formData,
        region
      })
      if (!result.ok) {
        toast.error(result.error.message || '保存失败')
        setSaving(false)
        return
      }

      // 如果选择了负责人且与当前不同，更新负责人
      if (selectedTeacherId && selectedTeacherId !== principal?.id) {
        const principalResult = await transferPlatformSchoolPrincipal(schoolId, selectedTeacherId)
        if (!principalResult.ok) {
          toast.error(principalResult.error.message || '负责人更新失败')
          setSaving(false)
          return
        }

        // 更新本地状态
        if (principalResult.data.principal) {
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
    return <PageLoadingFrame title="编辑学校" />
  }

  return (
    <>
      <div className={unifiedStyles.u1}>
        <main className={unifiedStyles.u2}>
          <div className={unifiedStyles.u3}>
            <Button variant="ghost"
              onClick={() => router.push('/admin/schools')}
              className={unifiedStyles.u4}
            >
              ← 返回学校列表
            </Button>
          </div>

          <div className={unifiedStyles.u5}>
            <h2 className={unifiedStyles.u6}>编辑学校</h2>

            <form onSubmit={handleSubmit}>
              {/* 学校信息 */}
              <div className={unifiedStyles.u3}>
                <h3 className={unifiedStyles.u7}>学校信息</h3>

                <div className={unifiedStyles.u8}>
                  <div>
                    <label className={unifiedStyles.u9}>学校名称 *</label>
                    <Input
                      aria-label="学校名称"
                      type="text"
                      value={formData.name}
                      onChange={(e) => updateField('name', e.target.value)}
                      required
                      className={unifiedStyles.u10}
                    />
                  </div>

                  <div className={unifiedStyles.u11}>
                    <div>
                      <label className={unifiedStyles.u9}>学校类型</label>
                      <Select aria-label="学校类型"
                        value={formData.schoolType}
                        onChange={(e) => updateField('schoolType', e.target.value)}
                        className={unifiedStyles.u10}
                      >
                        <option value="">请选择</option>
                        <option value="小学">小学</option>
                        <option value="初中">初中</option>
                        <option value="高中">高中</option>
                        <option value="小学+初中">小学+初中</option>
                        <option value="初中+高中">初中+高中</option>
                        <option value="小学+初中+高中">小学+初中+高中</option>
                      </Select>
                    </div>

                    <div>
                      <label className={unifiedStyles.u9}>学制</label>
                      <Select aria-label="学制"
                        value={formData.educationSystem}
                        onChange={(e) => updateField('educationSystem', e.target.value)}
                        className={unifiedStyles.u10}
                      >
                        <option value="6-3-3">6-3-3（小6初3高3）</option>
                        <option value="5-4-3">5-4-3（小5初4高3）</option>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <label className={unifiedStyles.u9}>所属区域</label>
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
              <div className={unifiedStyles.u3}>
                <h3 className={unifiedStyles.u7}>联系方式</h3>

                <div className={unifiedStyles.u11}>
                  <div>
                    <label className={unifiedStyles.u9}>联系人</label>
                    <Input
                      aria-label="联系人"
                      type="text"
                      value={formData.contactPerson}
                      onChange={(e) => updateField('contactPerson', e.target.value)}
                      className={unifiedStyles.u10}
                    />
                  </div>

                  <div>
                    <label className={unifiedStyles.u9}>联系电话</label>
                    <Input
                      aria-label="联系电话"
                      type="text"
                      value={formData.contactPhone}
                      onChange={(e) => updateField('contactPhone', e.target.value)}
                      className={unifiedStyles.u10}
                    />
                  </div>

                  <div className={unifiedStyles.u12}>
                    <label className={unifiedStyles.u9}>联系邮箱</label>
                    <Input
                      aria-label="联系邮箱"
                      type="email"
                      value={formData.contactEmail}
                      onChange={(e) => updateField('contactEmail', e.target.value)}
                      className={unifiedStyles.u10}
                    />
                  </div>
                </div>
              </div>

              {/* 负责人信息 */}
              <div className={unifiedStyles.u3}>
                <div className={unifiedStyles.u13}>
                  <h3 className={unifiedStyles.u14}>学校负责人 *</h3>
                  {!showPrincipalForm && (
                    <Button variant="ghost"
                      type="button"
                      onClick={() => setShowPrincipalForm(true)}
                      className={unifiedStyles.u15}
                    >
                      + 创建新负责人账号
                    </Button>
                  )}
                </div>

                {showPrincipalForm ? (
                  <div className={unifiedStyles.u16}>
                    <div className={unifiedStyles.u17}>
                      <div>
                        <label className={unifiedStyles.u18}>负责人姓名 *</label>
                        <Input
                          aria-label="负责人姓名"
                          type="text"
                          value={principalData.teacherName}
                          onChange={(e) => setPrincipalData({ ...principalData, teacherName: e.target.value })}
                          placeholder="例如：张老师"
                          className={unifiedStyles.u19}
                        />
                      </div>
                      <div>
                        <label className={unifiedStyles.u18}>职务/职称</label>
                        <Input
                          aria-label="负责人职务"
                          type="text"
                          value={principalData.teacherTitle}
                          onChange={(e) => setPrincipalData({ ...principalData, teacherTitle: e.target.value })}
                          placeholder="例如：校长"
                          className={unifiedStyles.u19}
                        />
                      </div>
                      <div>
                        <label className={unifiedStyles.u18}>登录账号 *</label>
                        <Input
                          aria-label="负责人登录账号"
                          type="text"
                          value={principalData.username}
                          onChange={(e) => setPrincipalData({ ...principalData, username: e.target.value })}
                          placeholder="字母、数字、下划线"
                          className={unifiedStyles.u19}
                        />
                      </div>
                      <div>
                        <label className={unifiedStyles.u18}>登录密码</label>
                        <Input
                          aria-label="负责人登录密码"
                          type="text"
                          value={principalData.password}
                          onChange={(e) => setPrincipalData({ ...principalData, password: e.target.value })}
                          placeholder="默认等于账号"
                          className={unifiedStyles.u19}
                        />
                      </div>
                      <div>
                        <label className={unifiedStyles.u18}>邮箱</label>
                        <Input
                          aria-label="负责人邮箱"
                          type="email"
                          value={principalData.email}
                          onChange={(e) => setPrincipalData({ ...principalData, email: e.target.value })}
                          placeholder="可选"
                          className={unifiedStyles.u19}
                        />
                      </div>
                      <div>
                        <label className={unifiedStyles.u18}>手机</label>
                        <Input
                          aria-label="负责人手机"
                          type="text"
                          value={principalData.phone}
                          onChange={(e) => setPrincipalData({ ...principalData, phone: e.target.value })}
                          placeholder="可选"
                          className={unifiedStyles.u19}
                        />
                      </div>
                    </div>
                    {principalError && (
                      <p className={unifiedStyles.u20}>{principalError}</p>
                    )}
                    <div className={unifiedStyles.u21}>
                      <Button variant="ghost"
                        type="button"
                        onClick={handleCreatePrincipal}
                        disabled={principalSaving}
                        className={unifiedStyles.u22}
                      >
                        {principalSaving ? '创建中...' : '确认创建'}
                      </Button>
                      <Button variant="ghost"
                        type="button"
                        onClick={() => { setShowPrincipalForm(false); setPrincipalError(''); }}
                        className={unifiedStyles.u23}
                      >
                        取消
                      </Button>
                    </div>
                    <p className={unifiedStyles.u24}>保存后将自动为该老师分配“负责人”角色，并绑定至本校</p>
                  </div>
                ) : (
                  <div className={unifiedStyles.u25}>
                    <label className={unifiedStyles.u26}>
                      {principal ? `校长 (${principal.title || '校长'})` : '选择负责人'}
                    </label>
                    <Select aria-label="选择负责人"
                      value={selectedTeacherId}
                      onChange={(e) => setSelectedTeacherId(e.target.value)}
                      className={unifiedStyles.u27}
                    >
                      <option value="">请选择负责人</option>
                      {teachers.map((teacher) => (
                        <option key={teacher.id} value={teacher.id}>
                          {teacher.user?.username || '-'} - {teacher.name}
                        </option>
                      ))}
                    </Select>
                    {principal && (
                      <p className={unifiedStyles.u28}>
                        账号：{principal.user?.username || '-'}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className={unifiedStyles.u29}>
                <Button variant="ghost"
                  type="submit"
                  disabled={saving}
                  className={unifiedStyles.u30}
                >
                  {saving ? '保存中...' : '保存'}
                </Button>
                <Button variant="ghost"
                  type="button"
                  onClick={() => router.push('/admin/schools')}
                  className={unifiedStyles.u31}
                >
                  取消
                </Button>
              </div>
            </form>
          </div>
        </main>
      </div>
    </>
  )
}
