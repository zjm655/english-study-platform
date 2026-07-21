import type { JWTPayload } from 'jose'
export interface JwtPayload extends JWTPayload {
  id: number
  nickname?: string
  account?: string
  role: number
  email?: string
}
