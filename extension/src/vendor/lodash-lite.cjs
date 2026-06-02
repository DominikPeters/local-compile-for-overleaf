'use strict'

const lodash = {
  assign(target, ...sources) {
    return Object.assign(target, ...sources)
  },

  clone(value) {
    if (Array.isArray(value)) return value.slice()
    if (value && typeof value === 'object') return Object.assign({}, value)
    return value
  },

  cloneDeep(value) {
    if (value == null || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map(item => lodash.cloneDeep(item))
    const cloned = {}
    for (const [key, item] of Object.entries(value)) {
      cloned[key] = lodash.cloneDeep(item)
    }
    return cloned
  },

  each(collection, iteratee) {
    if (Array.isArray(collection)) {
      collection.forEach(iteratee)
      return collection
    }
    for (const [key, value] of Object.entries(collection || {})) {
      iteratee(value, key)
    }
    return collection
  },

  find(collection, key, value) {
    return (collection || []).find(item => item && item[key] === value)
  },

  isEmpty(value) {
    if (value == null) return true
    if (Array.isArray(value) || typeof value === 'string') return value.length === 0
    return Object.keys(value).length === 0
  },

  keys(value) {
    return Object.keys(value || {})
  },

  map(collection, iteratee) {
    return Array.from(collection || [], iteratee)
  },

  mapValues(object, iteratee) {
    const mapped = {}
    for (const [key, value] of Object.entries(object || {})) {
      mapped[key] = iteratee(value, key)
    }
    return mapped
  },

  partial(fn, ...partials) {
    return function partiallyApplied(...args) {
      let index = 0
      const resolved = partials.map(partial =>
        partial === lodash ? args[index++] : partial
      )
      return fn(...resolved, ...args.slice(index))
    }
  },

  remove(array, predicate) {
    const removed = []
    for (let index = array.length - 1; index >= 0; index -= 1) {
      if (predicate(array[index], index, array)) {
        removed.unshift(array[index])
        array.splice(index, 1)
      }
    }
    return removed
  },

  size(value) {
    if (value == null) return 0
    if (Array.isArray(value) || typeof value === 'string') return value.length
    return Object.keys(value).length
  },

  uniq(array) {
    return Array.from(new Set(array))
  },

  uniqWith(array, comparator) {
    const result = []
    for (const item of array || []) {
      if (!result.some(existing => comparator(item, existing))) {
        result.push(item)
      }
    }
    return result
  },

  zipObject(keys, values) {
    const object = {}
    keys.forEach((key, index) => {
      object[key] = values[index]
    })
    return object
  },
}

module.exports = lodash
