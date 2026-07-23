export interface ResPayload<T = null> {
  code: number
  message: string
  data: T
}
