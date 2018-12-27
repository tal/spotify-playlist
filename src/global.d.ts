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
  }
}
declare const dev: DevSettings
