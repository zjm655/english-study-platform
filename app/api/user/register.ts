import type { RegisterPayload } from "~~/shared/types/user"
import { userRegisterPath } from "../paths"

export const register = async (payload:RegisterPayload) => {
    const res = await request<null>(userRegisterPath, {
        method:"POST",
        body:payload
    })

    return res
}