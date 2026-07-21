import { unitsPath } from '../paths'
import type { UnitProgressDetail } from '~~/shared/types/unit'

export const getUnitProgress = async (
  unitId: number,
  params?: { page?: number; pageSize?: number },
) => {
  const search = new URLSearchParams()
  if (params?.page) search.set('page', String(params.page))
  if (params?.pageSize) search.set('pageSize', String(params.pageSize))
  const qs = search.toString()
  return request<UnitProgressDetail>(`${unitsPath}/${unitId}/progress${qs ? `?${qs}` : ''}`, {
    method: 'GET',
  })
}
