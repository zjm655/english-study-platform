import { query } from '#server/utils/db'

/**
 * 根据 object_key 查找 media 表中是否存在的有效音频资源
 * 用于 IDOR 防护：校验请求的音频 key 是否合法
 */
export async function findMediaByObjectKey(
  objectKey: string,
): Promise<{ object_key: string } | null> {
  const rows = await query<{ object_key: string }>(
    'SELECT object_key FROM media WHERE object_key = ? AND status = 1',
    [objectKey],
  )
  return rows[0] ?? null
}
