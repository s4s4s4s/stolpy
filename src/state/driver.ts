/* Носители данных. Три драйвера отдают одну форму StorageDriver: значение -
   строка JSON, ключи короткие ('state', 'active' и их копии). Логики здесь
   нет намеренно: загрузка, копии битого и очередь записей живут в store.ts
   поверх StorageDriver и тестируются без браузера.

   Ошибки драйверов не глотаются: get, set и remove отклоняют промис, а
   store.ts превращает это в SaveResult или в блокировку записи. */

import type { StorageDriver } from '../core/types'

export type { StorageDriver }

export const IDB_NAME = 'stolpy'
export const IDB_STORE = 'kv'
/** Версия базы IndexedDB. Адресует схему хранилища (одно хранилище kv),
    а не формат данных: формат версионируется CURRENT_VERSION внутри значения. */
export const IDB_VERSION = 1
export const LOCAL_PREFIX = 'stolpy:'
const LOCAL_PROBE_KEY = '__probe__'

function asError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value
  // DOMException в части окружений не наследует Error
  if (typeof value === 'object' && value !== null && 'message' in value) {
    const e = new Error(String((value as { message: unknown }).message))
    e.name = String((value as { name?: unknown }).name ?? 'Error')
    return e
  }
  return new Error(fallback)
}

/** Открывает базу stolpy и создаёт хранилище kv при первом открытии.
    onblocked: базу держит другая вкладка со старой версией схемы; ждать её
    бесконечно нельзя (экран загрузки не уйдёт), поэтому открытие отклоняется. */
export function openIdb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest
    try {
      request = factory.open(IDB_NAME, IDB_VERSION)
    } catch (err) {
      reject(asError(err, 'IndexedDB: open бросил исключение'))
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
    }
    request.onsuccess = () => {
      const db = request.result
      // другая вкладка открывает новую версию схемы: уступаем, иначе она заблокирована
      db.onversionchange = () => db.close()
      resolve(db)
    }
    request.onerror = () => reject(asError(request.error, 'IndexedDB: база не открылась'))
    request.onblocked = () => reject(new Error('IndexedDB: открытие заблокировано другой вкладкой'))
  })
}

/** Одна операция в своей транзакции. Промис разрешается по oncomplete, а не
    по onsuccess запроса: запись считается сделанной, когда транзакция
    зафиксирована. */
function run<T>(db: IDBDatabase, mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction
    let request: IDBRequest<T>
    try {
      tx = db.transaction(IDB_STORE, mode)
      request = op(tx.objectStore(IDB_STORE))
    } catch (err) {
      reject(asError(err, 'IndexedDB: транзакция не открылась'))
      return
    }
    tx.oncomplete = () => resolve(request.result)
    tx.onerror = () => reject(asError(tx.error ?? request.error, 'IndexedDB: ошибка транзакции'))
    tx.onabort = () => reject(asError(tx.error, 'IndexedDB: транзакция прервана'))
  })
}

export function idbDriver(db: IDBDatabase): StorageDriver {
  return {
    name: 'idb',
    async get(key) {
      const value: unknown = await run(db, 'readonly', store => store.get(key))
      if (value === undefined) return null
      if (typeof value !== 'string') throw new Error(`IndexedDB: под ключом ${key} лежит не строка`)
      return value
    },
    async set(key, value) {
      await run(db, 'readwrite', store => store.put(value, key))
    },
    async remove(key) {
      await run(db, 'readwrite', store => store.delete(key))
    },
  }
}

/** localStorage с префиксом ключей: соседние приложения на том же origin не
    пересекаются. Исключения Storage (квота, приватный режим) уходят отказом промиса. */
export function localDriver(storage: Storage, prefix: string = LOCAL_PREFIX): StorageDriver {
  return {
    name: 'local',
    async get(key) {
      return storage.getItem(prefix + key)
    },
    async set(key, value) {
      storage.setItem(prefix + key, value)
    },
    async remove(key) {
      storage.removeItem(prefix + key)
    },
  }
}

/** Память вкладки: данные живут до закрытия. Последний запасной вариант,
    экран обязан сказать человеку, что записи не сохраняются (driver.name). */
export function memoryDriver(initial: Record<string, string> = {}): StorageDriver {
  const data = new Map(Object.entries(initial))
  return {
    name: 'memory',
    async get(key) {
      return data.has(key) ? data.get(key)! : null
    },
    async set(key, value) {
      data.set(key, value)
    },
    async remove(key) {
      data.delete(key)
    },
  }
}

export interface DriverEnv {
  indexedDB: IDBFactory | null
  localStorage: Storage | null
}

/** Окружение браузера. Доступ к localStorage сам бросает SecurityError при
    отключённых данных сайта, поэтому чтение обёрнуто: отказ значит «нет носителя». */
export function browserEnv(): DriverEnv {
  let localStorage: Storage | null = null
  try {
    localStorage = globalThis.localStorage ?? null
  } catch {
    localStorage = null
  }
  let indexedDB: IDBFactory | null = null
  try {
    indexedDB = globalThis.indexedDB ?? null
  } catch {
    indexedDB = null
  }
  return { indexedDB, localStorage }
}

export interface PickedDriver {
  driver: StorageDriver
  /** Почему не взяты более предпочтительные носители, по порядку попыток. */
  fallbacks: string[]
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Выбор носителя: IndexedDB, при ошибке открытия localStorage (проверяется
    пробной записью: в приватном режиме Safari он есть, но не пишет), затем
    память. Асинхронно, потому что открытие IndexedDB асинхронно. */
export async function pickDriverVerbose(env: DriverEnv = browserEnv()): Promise<PickedDriver> {
  const fallbacks: string[] = []
  if (env.indexedDB) {
    try {
      return { driver: idbDriver(await openIdb(env.indexedDB)), fallbacks }
    } catch (err) {
      fallbacks.push(`IndexedDB: ${errorText(err)}`)
    }
  } else {
    fallbacks.push('IndexedDB: нет в этом браузере')
  }
  if (env.localStorage) {
    try {
      const probe = LOCAL_PREFIX + LOCAL_PROBE_KEY
      env.localStorage.setItem(probe, '1')
      env.localStorage.removeItem(probe)
      return { driver: localDriver(env.localStorage), fallbacks }
    } catch (err) {
      fallbacks.push(`localStorage: ${errorText(err)}`)
    }
  } else {
    fallbacks.push('localStorage: нет в этом браузере')
  }
  return { driver: memoryDriver(), fallbacks }
}

export async function pickDriver(env: DriverEnv = browserEnv()): Promise<StorageDriver> {
  return (await pickDriverVerbose(env)).driver
}
