import { unitsPath } from '../paths'
import type { UnitWithProgress } from '~~/shared/types/unit'

export const getUnits = async (level?: number) => {
  const query = level ? `?level=${level}` : ''
  return request<UnitWithProgress[]>(`${unitsPath}${query}`, { method: 'GET' })
}
