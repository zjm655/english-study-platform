import { unitsPath } from '../paths'
import type { UnitProgressDetail } from '~~/shared/types/unit'

export const getUnitProgress = async (unitId: number) => {
  return request<UnitProgressDetail>(`${unitsPath}/${unitId}/progress`, { method: 'GET' })
}
