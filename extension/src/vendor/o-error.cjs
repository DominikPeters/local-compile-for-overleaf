class OError extends Error {
  constructor(message, info, cause) {
    super(message)
    this.name = 'OError'
    this.info = info || {}
    this.cause = cause
  }

  static tag(error, message, info) {
    if (error instanceof Error) {
      error.message = `${message}: ${error.message}`
      error.info = Object.assign({}, error.info || {}, info || {})
      return error
    }
    return new OError(message, info, error)
  }

  static getFullInfo(error) {
    const info = {}
    let current = error
    while (current) {
      Object.assign(info, current.info || {})
      current = current.cause
    }
    return info
  }
}

module.exports = OError
