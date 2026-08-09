import { unitsPath } from '~/api/paths'
import type { UnitWithProgress } from '#shared/types/unit'

export const getUnits = async (level?: number) => {
  const query = level ? `?level=${level}` : ''
  return request<UnitWithProgress[]>(`${unitsPath}${query}`, { method: 'GET' })
}
