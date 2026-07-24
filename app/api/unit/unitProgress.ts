import { unitsPath } from '../paths'
import type { UnitProgressDetail } from '~~/shared/types/unit'

export const getUnitProgress = async (
  unitId: number,
  params?: { page?: number; pageSize?: number },
) => {
  return request<UnitProgressDetail>(
    `${unitsPath}/${unitId}/progress${buildQuery({ page: params?.page, pageSize: params?.pageSize })}`,
    { method: 'GET' },
  )
}
