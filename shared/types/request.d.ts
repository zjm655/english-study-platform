export interface ResPayload<T = null> {
  code: number
  message: string
  // 失败响应（非 200）通常无业务数据，故允许 null；
  // 消费方应先用 `res.code === 200 && res.data` 守卫再访问 data 字段。
  data: T | null
}
