/** Report asynchronous fixture activity without polling or changing adapter results. */
export function observeAdapter<T extends object>(
  adapter: T,
  changed: () => void,
): T {
  return new Proxy(adapter, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver)
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        try {
          const result: unknown = Reflect.apply(value, target, args)
          changed()
          if (result instanceof Promise) return result.finally(changed)
          return result
        } catch (error) {
          changed()
          throw error
        }
      }
    },
  })
}
