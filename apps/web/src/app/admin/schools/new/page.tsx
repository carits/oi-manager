'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import apiClient from '@/lib/apiClient'
import { RegionSelector } from '@/components/business/RegionSelector'
import { useToast } from '@/components/ui/Toast'

export default function NewSchoolPage() {
  const router = useRouter()
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // 区域选择
  const [selectedProvince, setSelectedProvince] = useState('')
  const [selectedCity, setSelectedCity] = useState('')
  const [selectedDistrict, setSelectedDistrict] = useState('')

  const [formData, setFormData] = useState({
    name: '',
    schoolType: '',
    educationSystem: '6-3-3',
    contactPerson: '',
    contactPhone: '',
    contactEmail: '',
    username: '',
    password: '',
    teacherName: '',
    teacherTitle: ''
  })

  // 验证账号格式（字母、数字、下划线）
  const validateUsername = (value: string): string => {
    if (!value) return ''
    if (!/^[a-zA-Z0-9_]+$/.test(value)) {
      return '账号只能包含字母、数字和下划线'
    }
    if (value.length < 3) {
      return '账号至少3个字符'
    }
    return ''
  }

  // 验证手机号格式
  const validatePhone = (value: string): string => {
    if (!value) return ''
    if (!/^1[3-9]\d{9}$/.test(value)) {
      return '请输入正确的手机号格式'
    }
    return ''
  }

  // 验证邮箱格式
  const validateEmail = (value: string): string => {
    if (!value) return ''
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return '请输入正确的邮箱格式'
    }
    return ''
  }

  // 实时验证
  const handleBlur = (field: string, value: string) => {
    let error = ''
    switch (field) {
      case 'username':
        error = validateUsername(value)
        break
      case 'contactPhone':
        error = validatePhone(value)
        break
      case 'contactEmail':
        error = validateEmail(value)
        break
    }
    setErrors(prev => ({ ...prev, [field]: error }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // 验证所有字段
    const newErrors: Record<string, string> = {}

    if (!selectedProvince || !selectedCity) {
      newErrors.region = '请选择省市区'
    }

    const usernameError = validateUsername(formData.username)
    if (usernameError) newErrors.username = usernameError

    if (formData.contactPhone) {
      const phoneError = validatePhone(formData.contactPhone)
      if (phoneError) newErrors.contactPhone = phoneError
    }

    if (formData.contactEmail) {
      const emailError = validateEmail(formData.contactEmail)
      if (emailError) newErrors.contactEmail = emailError
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    setLoading(true)

    try {
      // 组合省市区
      const region = [selectedProvince, selectedCity, selectedDistrict].filter(Boolean).join('/')

      const result = await apiClient.post('/api/schools', {
        ...formData,
        region: region || null,
        password: formData.password || formData.username
      })
      if (result.success) {
        router.push('/admin/schools')
      } else {
        toast.error(result.message || '创建失败')
      }
    } catch {
      toast.error('创建失败')
    } finally {
      setLoading(false)
    }
  }

  const updateField = (field: string, value: string) => {
    setFormData({ ...formData, [field]: value })
    // 清除对应字段的错误
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }))
    }
  }

  // 当省份改变时，清空城市和区县
  const handleProvinceChange = (value: string) => {
    setSelectedProvince(value)
    setSelectedCity('')
    setSelectedDistrict('')
  }

  // 当城市改变时，清空区县
  const handleCityChange = (value: string) => {
    setSelectedCity(value)
    setSelectedDistrict('')
  }

  return (
    <>
      <div style={{ minHeight: '100vh', background: 'var(--gray-50)' }}>
        <main style={{ padding: '2rem', maxWidth: '700px', margin: '0 auto' }}>
          <div style={{ marginBottom: '1.5rem' }}>
            <button
              onClick={() => router.push('/admin/schools')}
              style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.875rem', padding: 0, textDecoration: 'none' }}
            >
              ← 返回学校列表
            </button>
          </div>

          <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '1.5rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>创建学校</h2>

            <form onSubmit={handleSubmit}>
              {/* 学校基本信息 */}
              <div style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--gray-700)' }}>学校信息</h3>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ display: 'block', marginBottom: '0.375rem', fontSize: '0.875rem' }}>学校名称 *</label>
                    <input
                      aria-label="学校名称"
                      type="text"
                      value={formData.name}
                      onChange={(e) => updateField('name', e.target.value)}
                      required
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', marginBottom: '0.375rem', fontSize: '0.875rem' }}>学校类型</label>
                    <select aria-label="选择"
                      value={formData.schoolType}
                      onChange={(e) => updateField('schoolType', e.target.value)}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px' }}
                    >
                      <option value="">请选择</option>
                      <option value="小学">小学</option>
                      <option value="初中">初中</option>
                      <option value="高中">高中</option>
                      <option value="小学+初中">小学+初中（九年一贯制）</option>
                      <option value="初中+高中">初中+高中（完全中学）</option>
                      <option value="小学+初中+高中">小学+初中+高中（十二年一贯制）</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', marginBottom: '0.375rem', fontSize: '0.875rem' }}>学制</label>
                    <select aria-label="选择"
                      value={formData.educationSystem}
                      onChange={(e) => updateField('educationSystem', e.target.value)}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px' }}
                    >
                      <option value="6-3-3">6-3-3（小学6年+初中3年+高中3年）</option>
                      <option value="5-4-3">5-4-3（小学5年+初中4年+高中3年）</option>
                    </select>
                  </div>

                  {/* 省市区三级联动 */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ display: 'block', marginBottom: '0.375rem', fontSize: '0.875rem' }}>所属区域 *</label>
                    <RegionSelector
                      province={selectedProvince}
                      city={selectedCity}
                      district={selectedDistrict}
                      onProvinceChange={handleProvinceChange}
                      onCityChange={handleCityChange}
                      onDistrictChange={setSelectedDistrict}
                    />
                    {errors.region && <p style={{ color: 'red', fontSize: '0.75rem', marginTop: '0.25rem' }}>{errors.region}</p>}
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
                      aria-label="联系人"
                      type="text"
                      value={formData.contactPerson}
                      onChange={(e) => updateField('contactPerson', e.target.value)}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', marginBottom: '0.375rem', fontSize: '0.875rem' }}>联系电话</label>
                    <input
                      aria-label="联系电话"
                      type="text"
                      value={formData.contactPhone}
                      onChange={(e) => updateField('contactPhone', e.target.value)}
                      onBlur={(e) => handleBlur('contactPhone', e.target.value)}
                      placeholder="11位手机号"
                      style={{ width: '100%', padding: '0.5rem', border: `1px solid ${errors.contactPhone ? 'red' : 'var(--border)'}`, borderRadius: '6px' }}
                    />
                    {errors.contactPhone && <p style={{ color: 'red', fontSize: '0.75rem', marginTop: '0.25rem' }}>{errors.contactPhone}</p>}
                  </div>

                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ display: 'block', marginBottom: '0.375rem', fontSize: '0.875rem' }}>联系邮箱</label>
                    <input
                      aria-label="联系邮箱"
                      type="text"
                      value={formData.contactEmail}
                      onChange={(e) => updateField('contactEmail', e.target.value)}
                      onBlur={(e) => handleBlur('contactEmail', e.target.value)}
                      placeholder="example@domain.com"
                      style={{ width: '100%', padding: '0.5rem', border: `1px solid ${errors.contactEmail ? 'red' : 'var(--border)'}`, borderRadius: '6px' }}
                    />
                    {errors.contactEmail && <p style={{ color: 'red', fontSize: '0.75rem', marginTop: '0.25rem' }}>{errors.contactEmail}</p>}
                  </div>
                </div>
              </div>

              {/* 创建人信息 */}
              <div style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--gray-700)' }}>学校负责人（创建管理员账号）</h3>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.375rem', fontSize: '0.875rem' }}>账号 *</label>
                    <input
                      aria-label="负责人账号"
                      type="text"
                      value={formData.username}
                      onChange={(e) => updateField('username', e.target.value)}
                      onBlur={(e) => handleBlur('username', e.target.value)}
                      placeholder="字母、数字、下划线"
                      required
                      style={{ width: '100%', padding: '0.5rem', border: `1px solid ${errors.username ? 'red' : 'var(--border)'}`, borderRadius: '6px' }}
                    />
                    {errors.username && <p style={{ color: 'red', fontSize: '0.75rem', marginTop: '0.25rem' }}>{errors.username}</p>}
                  </div>

                  <div>
                    <label style={{ display: 'block', marginBottom: '0.375rem', fontSize: '0.875rem' }}>密码</label>
                    <input
                      aria-label="负责人密码"
                      type="text"
                      value={formData.password}
                      onChange={(e) => updateField('password', e.target.value)}
                      placeholder="默认与账号相同"
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', marginBottom: '0.375rem', fontSize: '0.875rem' }}>姓名 *</label>
                    <input
                      aria-label="负责人姓名"
                      type="text"
                      value={formData.teacherName}
                      onChange={(e) => updateField('teacherName', e.target.value)}
                      placeholder="校长/负责人姓名"
                      required
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', marginBottom: '0.375rem', fontSize: '0.875rem' }}>职务</label>
                    <input
                      aria-label="负责人职务"
                      type="text"
                      value={formData.teacherTitle}
                      onChange={(e) => updateField('teacherTitle', e.target.value)}
                      placeholder="例如：校长，信息学主教练"
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px' }}
                    />
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    flex: 1,
                    padding: '0.625rem',
                    background: 'var(--primary)',
                    color: 'white',
                    borderRadius: '6px',
                    fontWeight: 500
                  }}
                >
                  {loading ? '创建中...' : '创建学校'}
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
    </>
  )
}
