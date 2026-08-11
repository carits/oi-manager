'use client'

import { useEffect, useState, type ReactNode } from 'react'
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
  description: string | null
  region: string | null
  schoolType: string | null
  schoolNature: string | null
  educationSystem: string | null
  educationSystemDetail: { primaryYears?: number; middleYears?: number; highYears?: number } | null
  informaticsEnabled: boolean
  informaticsStages: string[] | null
  informaticsContests: string[] | null
  informaticsTracks: string[] | null
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

const educationOptions = [
  ['6-3-3', '六三三学制', '小学 6 年 / 初中 3 年 / 高中 3 年'],
  ['5-4-3', '五四三学制', '小学 5 年 / 初中 4 年 / 高中 3 年'],
  ['6-3', '六三学制', '小学 6 年 / 初中 3 年'],
  ['5-4', '五四学制', '小学 5 年 / 初中 4 年'],
  ['custom', '自定义', '按学校实际阶段年数配置']
] as const

const cultivationOptions = {
  stages: ['小学高年级', '初中', '高中'],
  contests: ['CSP-J', 'CSP-S', 'NOIP', '省选', 'NOI'],
  tracks: ['入门组', '提高组', '省选组']
}

function normalizeEducationSystem(value: string | null) {
  return ['6-3-3', '5-4-3', '6-3', '5-4', 'custom'].includes(value || '') ? value! : '6-3-3'
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return <section style={{ display: 'grid', gap: '0.85rem', paddingTop: '0.25rem' }}><h3 style={{ margin: 0, fontSize: '1rem' }}>{title}</h3>{children}</section>
}

export default function EditSchoolModal({ school, onClose, onSuccess }: EditSchoolModalProps) {
  const [submitting, setSubmitting] = useState(false)
  const toast = useToast()
  const [province, setProvince] = useState('')
  const [city, setCity] = useState('')
  const [district, setDistrict] = useState('')
  const [informaticsEnabled, setInformaticsEnabled] = useState(school.informaticsEnabled)
  const [informaticsStages, setInformaticsStages] = useState<string[]>(school.informaticsStages || [])
  const [informaticsContests, setInformaticsContests] = useState<string[]>(school.informaticsContests || [])
  const [informaticsTracks, setInformaticsTracks] = useState<string[]>(school.informaticsTracks || [])
  const [customYears, setCustomYears] = useState({
    primaryYears: school.educationSystemDetail?.primaryYears ?? 6,
    middleYears: school.educationSystemDetail?.middleYears ?? 3,
    highYears: school.educationSystemDetail?.highYears ?? 3
  })

  useEffect(() => {
    const parts = school.region?.split('/') || []
    setProvince(parts[0] || '')
    setCity(parts[1] || '')
    setDistrict(parts[2] || '')
  }, [school.region])

  const toggle = (value: string, values: string[], setValues: (next: string[]) => void) => {
    setValues(values.includes(value) ? values.filter(item => item !== value) : [...values, value])
  }

  const form = useForm(
    {
      name: school.name,
      shortName: school.shortName || '',
      description: school.description || '',
      schoolType: school.schoolType || '',
      schoolNature: school.schoolNature || '',
      educationSystem: normalizeEducationSystem(school.educationSystem),
      contactPerson: school.contactPerson || '',
      contactPhone: school.contactPhone || '',
      contactEmail: school.contactEmail || ''
    },
    async values => {
      setSubmitting(true)
      try {
        const region = [province, city, district].filter(Boolean).join('/')
        const result = await apiClient.put(`/api/schools/${school.id}`, {
          name: values.name,
          shortName: values.shortName || null,
          description: values.description || null,
          region: region || null,
          schoolType: values.schoolType || null,
          schoolNature: values.schoolNature || null,
          educationSystem: values.educationSystem,
          educationSystemDetail: values.educationSystem === 'custom' ? customYears : null,
          informaticsEnabled,
          informaticsStages,
          informaticsContests,
          informaticsTracks,
          contactPerson: values.contactPerson || null,
          contactPhone: values.contactPhone || null,
          contactEmail: values.contactEmail || null
        })
        if (!result.success) throw new Error(result.message || '保存失败')
        onSuccess()
        onClose()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '保存失败')
      } finally {
        setSubmitting(false)
      }
    }
  )

  return (
    <Modal isOpen onClose={onClose} title="编辑校园信息" width="680px">
      <form onSubmit={form.handleSubmit} style={{ display: 'grid', gap: '1.5rem' }}>
        <FormSection title="基本资料">
          <div style={formStyles.field}><label style={formStyles.label}>学校名称 *</label><input value={form.values.name} onChange={event => form.handleChange('name', event.target.value)} required style={formStyles.input} /></div>
          <div style={formStyles.field}><label style={formStyles.label}>学校简称</label><input value={form.values.shortName} onChange={event => form.handleChange('shortName', event.target.value)} style={formStyles.input} /></div>
          <div style={formStyles.field}><label style={formStyles.label}>所在地区</label><RegionSelector province={province} city={city} district={district} onProvinceChange={setProvince} onCityChange={setCity} onDistrictChange={setDistrict} /></div>
          <div style={formStyles.field}><label style={formStyles.label}>学校类型</label><select value={form.values.schoolType} onChange={event => form.handleChange('schoolType', event.target.value)} style={formStyles.select}><option value="">请选择</option><option value="小学">小学</option><option value="初中">初中</option><option value="高中">高中</option><option value="小学+初中">小学+初中（九年一贯制）</option><option value="初中+高中">初中+高中（完全中学）</option><option value="小学+初中+高中">小学+初中+高中（十二年一贯制）</option></select></div>
          <div style={formStyles.field}><label style={formStyles.label}>办学性质</label><select value={form.values.schoolNature} onChange={event => form.handleChange('schoolNature', event.target.value)} style={formStyles.select}><option value="">请选择</option><option value="公办">公办</option><option value="民办">民办</option><option value="其他">其他</option></select></div>
          <div style={formStyles.field}><label style={formStyles.label}>学校简介</label><textarea value={form.values.description} onChange={event => form.handleChange('description', event.target.value)} style={{ ...formStyles.input, minHeight: 120, resize: 'vertical' }} /></div>
        </FormSection>

        <FormSection title="学制">
          <div style={{ display: 'grid', gap: '0.5rem' }}>{educationOptions.map(([value, title, description]) => <label key={value} style={{ display: 'flex', gap: '0.65rem', alignItems: 'flex-start', padding: '0.7rem', border: `1px solid ${form.values.educationSystem === value ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 6, cursor: 'pointer' }}><input type="radio" name="educationSystem" checked={form.values.educationSystem === value} onChange={() => form.handleChange('educationSystem', value)} /><span><strong>{title}</strong><small style={{ display: 'block', color: 'var(--text-muted)', marginTop: 3 }}>{description}</small></span></label>)}</div>
          {form.values.educationSystem === 'custom' && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>{(['primaryYears', 'middleYears', 'highYears'] as const).map((key, index) => <div style={formStyles.field} key={key}><label style={formStyles.label}>{['小学', '初中', '高中'][index]}年数</label><input type="number" min="0" max="9" value={customYears[key]} onChange={event => setCustomYears(current => ({ ...current, [key]: Number(event.target.value) }))} style={formStyles.input} /></div>)}</div>}
        </FormSection>

        <FormSection title="联系信息">
          <div style={formStyles.field}><label style={formStyles.label}>联系人</label><input value={form.values.contactPerson} onChange={event => form.handleChange('contactPerson', event.target.value)} style={formStyles.input} /></div>
          <div style={formStyles.field}><label style={formStyles.label}>联系电话</label><input type="tel" value={form.values.contactPhone} onChange={event => form.handleChange('contactPhone', event.target.value)} style={formStyles.input} /></div>
          <div style={formStyles.field}><label style={formStyles.label}>联系邮箱</label><input type="email" value={form.values.contactEmail} onChange={event => form.handleChange('contactEmail', event.target.value)} style={formStyles.input} /></div>
        </FormSection>

        <FormSection title="信息学培养">
          <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}><input type="checkbox" checked={informaticsEnabled} onChange={event => setInformaticsEnabled(event.target.checked)} />开展信息学竞赛培养</label>
          {informaticsEnabled && <div style={{ display: 'grid', gap: '0.8rem' }}>{Object.entries(cultivationOptions).map(([key, options]) => { const state = key === 'stages' ? informaticsStages : key === 'contests' ? informaticsContests : informaticsTracks; const setter = key === 'stages' ? setInformaticsStages : key === 'contests' ? setInformaticsContests : setInformaticsTracks; const label = key === 'stages' ? '培养阶段' : key === 'contests' ? '主要竞赛' : '培养体系'; return <div key={key}><span style={formStyles.label}>{label}</span><div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>{options.map(option => <label key={option} style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center' }}><input type="checkbox" checked={state.includes(option)} onChange={() => toggle(option, state, setter)} />{option}</label>)}</div></div> })}</div>}
        </FormSection>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', position: 'sticky', bottom: 0, background: 'var(--surface)', paddingTop: '0.75rem' }}><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={submitting}>{submitting ? '保存中...' : '保存修改'}</Button></div>
      </form>
    </Modal>
  )
}
