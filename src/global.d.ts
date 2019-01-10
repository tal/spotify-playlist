interface DevSettings {
  drySpotify: boolean
  dryAWS: boolean
  isDev: boolean
}

declare interface Result<S, R> {
  value?: S
  reason?: R
  error?: Error
}

declare module NodeJS {
  interface Global {
    dev: DevSettings
    seconds: number
    minutes: number
    hours: number
    days: number
  }
}
declare const dev: DevSettings

/** number of ms in a second */
declare const seconds: number
/** number of ms in a minute */
declare const minutes: number
/** number of ms in an hour */
declare const hours: number
/** number of ms in a day */
declare const days: number
