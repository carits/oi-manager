'use client'

import { getProvinces, getCities, getDistricts } from '@/lib/regionData'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { formStyles } from '@/lib/styles'

interface RegionSelectorProps {
  province: string
  city: string
  district: string
  onProvinceChange: (province: string) => void
  onCityChange: (city: string) => void
  onDistrictChange: (district: string) => void
}

export function RegionSelector({
  province,
  city,
  district,
  onProvinceChange,
  onCityChange,
  onDistrictChange
}: RegionSelectorProps) {
  const provinces = getProvinces()
  const cities = getCities(province)
  const districts = getDistricts(province, city)

  const handleProvinceChange = (newProvince: string) => {
    onProvinceChange(newProvince)
    onCityChange('')
    onDistrictChange('')
  }

  const handleCityChange = (newCity: string) => {
    onCityChange(newCity)
    onDistrictChange('')
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
      <Select aria-label="省份"
        value={province}
        onChange={(e) => handleProvinceChange(e.target.value)}
        style={formStyles.select}
      >
        <option value="">请选择省</option>
        {provinces.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </Select>

      <Select aria-label="城市"
        value={city}
        onChange={(e) => handleCityChange(e.target.value)}
        style={formStyles.select}
        disabled={!province}
      >
        <option value="">请选择市</option>
        {cities.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>

      <Select aria-label="区县"
        value={district}
        onChange={(e) => onDistrictChange(e.target.value)}
        style={formStyles.select}
        disabled={!city}
      >
        <option value="">请选择区</option>
        {districts.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </Select>
    </div>
  )
}
