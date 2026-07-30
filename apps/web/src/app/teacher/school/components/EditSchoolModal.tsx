'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useForm } from '@/hooks/form/useForm'
import { useToast } from '@/components/ui/Toast'
import apiClient from '@/lib/apiClient'
import { formStyles } from '@/lib/styles'
import { RegionSelector } from '@/components/business/RegionSelector'

interface School {
  id: string
  name: string
  shortName: string | null
  region: string | null
  schoolType: string | null
  educationSystem: string | null
  contactPerson: string | null
  contactPhone: string | null
  contactEmail: string | null
  announcement: string | null
}

interface EditSchoolModalProps {
  school: School
  onClose: () => void
  onSuccess: () => void
}

export default function EditSchoolModal({ school, onClose, onSuccess }: EditSchoolModalProps) {
  const [submitting, setSubmitting] = useState(false)
  const toast = useToast()
  const [province, setProvince] = useState('')
  const [city, setCity] = useState('')
  const [district, setDistrict] = useState('')

  useEffect(() => {
    // 解析 region 字段
    if (school.region) {
      const parts = school.region.split('/')
      setProvince(parts[0] || '')
      setCity(parts[1] || '')
      setDistrict(parts[2] || '')
    }
  }, [school.region])

  // 规范化学制值
  const normalizeEducationSystem = (value: string | null): string => {
    if (!value) return '6-3-3'
    const normalized = value.replace(/\s+/g, '')
    if (normalized === '3+3+3' || normalized === '3-3-3') return '6-3-3'
    if (normalized === '4+4+3' || normalized === '4-4-3') return '5-4-3'
    if (normalized === '6-3-3' || normalized === '5-4-3') return normalized
    return '6-3-3'
  }

  const form = useForm(
    {
      name: school.name,
      schoolType: school.schoolType || '',
      educationSystem: normalizeEducationSystem(school.educationSystem),
      contactPerson: school.contactPerson || '',
      contactPhone: school.contactPhone || '',
      contactEmail: school.contactEmail || ''
    },
    async (values) => {
      setSubmitting(true)
      try {
        const region = [province, city, district].filter(Boolean).join('/')

        const result = await apiClient.put(`/api/schools/${school.id}`, {
          name: values.name,
          region: region || null,
          schoolType: values.schoolType || null,
          educationSystem: values.educationSystem || '6-3-3',
          contactPerson: values.contactPerson || null,
          contactPhone: values.contactPhone || null,
          contactEmail: values.contactEmail || null
        })

        if (result.success) {
          onSuccess()
          onClose()
        } else {
          toast.error(result.message || '保存失败')
        }
      } catch {
        toast.error('保存失败')
      } finally {
        setSubmitting(false)
      }
    }
  )

  return (
    <Modal isOpen={true} onClose={onClose} title="编辑学校信息" width="600px">
      <form onSubmit={form.handleSubmit} style={{ display: 'grid', gap: '1rem' }}>
        <div style={formStyles.field}>
          <label style={formStyles.label}>学校名称 *</label>
          <input
            type="text"
            value={form.values.name}
            onChange={(e) => form.handleChange('name', e.target.value)}
            required
            style={formStyles.input}
          />
        </div>

        <div style={formStyles.field}>
          <label style={formStyles.label}>所属区域</label>
          <RegionSelector
            province={province}
            city={city}
            district={district}
            onProvinceChange={setProvince}
            onCityChange={setCity}
            onDistrictChange={setDistrict}
          />
        </div>

        <div style={formStyles.field}>
          <label style={formStyles.label}>学校类型</label>
          <select aria-label="选择"
            value={form.values.schoolType}
            onChange={(e) => form.handleChange('schoolType', e.target.value)}
            style={formStyles.select}
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

        <div style={formStyles.field}>
          <label style={formStyles.label}>学制</label>
          <select aria-label="选择"
            value={form.values.educationSystem}
            onChange={(e) => form.handleChange('educationSystem', e.target.value)}
            style={formStyles.select}
          >
            <option value="6-3-3">6-3-3（小学6年+初中3年+高中3年）</option>
            <option value="5-4-3">5-4-3（小学5年+初中4年+高中3年）</option>
          </select>
        </div>

        <div style={formStyles.field}>
          <label style={formStyles.label}>联系人</label>
          <input
            type="text"
            value={form.values.contactPerson}
            onChange={(e) => form.handleChange('contactPerson', e.target.value)}
            style={formStyles.input}
          />
        </div>

        <div style={formStyles.field}>
          <label style={formStyles.label}>联系电话</label>
          <input
            type="tel"
            value={form.values.contactPhone}
            onChange={(e) => form.handleChange('contactPhone', e.target.value)}
            style={formStyles.input}
          />
        </div>

        <div style={formStyles.field}>
          <label style={formStyles.label}>联系邮箱</label>
          <input
            type="email"
            value={form.values.contactEmail}
            onChange={(e) => form.handleChange('contactEmail', e.target.value)}
            style={formStyles.input}
          />
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
          <Button type="submit" disabled={submitting} style={{ flex: 1 }}>
            {submitting ? '保存中...' : '保存'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} style={{ flex: 1 }}>
            取消
          </Button>
        </div>
      </form>
    </Modal>
  )
}
