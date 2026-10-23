import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Api } from '@shared/types'

/** Подписка на событие из main-процесса; возвращает функцию отписки. */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: Api = {
  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    create: (input) => ipcRenderer.invoke('profiles:create', input),
    open: (id) => ipcRenderer.invoke('profiles:open', id),
    close: () => ipcRenderer.invoke('profiles:close'),
    current: () => ipcRenderer.invoke('profiles:current')
  },
  world: {
    airlines: () => ipcRenderer.invoke('world:airlines'),
    airline: (icao) => ipcRenderer.invoke('world:airline', icao),
    places: (codes) => ipcRenderer.invoke('world:places', codes),
    logoFallback: (iata) => ipcRenderer.invoke('world:logoFallback', iata),
    report: () => ipcRenderer.invoke('world:report'),
    macro: () => ipcRenderer.invoke('world:macro'),
    onChanged: (cb) => subscribe('world:changed', cb)
  },
  sim: {
    status: () => ipcRenderer.invoke('sim:status'),
    onStatus: (cb) => subscribe('sim:status', cb)
  },
  tracker: {
    state: () => ipcRenderer.invoke('tracker:state'),
    start: (source, bookingId = null) => ipcRenderer.invoke('tracker:start', source, bookingId),
    finish: () => ipcRenderer.invoke('tracker:finish'),
    onUpdate: (cb) => subscribe('tracker:update', cb),
    onFinished: (cb) => subscribe('tracker:finished', cb)
  },
  logbook: {
    list: () => ipcRenderer.invoke('logbook:list'),
    get: (id) => ipcRenderer.invoke('logbook:get', id)
  },
  career: {
    state: () => ipcRenderer.invoke('career:state'),
    hireOptions: () => ipcRenderer.invoke('career:hireOptions'),
    hire: (input) => ipcRenderer.invoke('career:hire', input),
    resign: () => ipcRenderer.invoke('career:resign'),
    allRatings: () => ipcRenderer.invoke('career:allRatings'),
    buyRating: (id) => ipcRenderer.invoke('career:buyRating', id),
    returnToBase: () => ipcRenderer.invoke('career:returnToBase'),
    changeBase: (base) => ipcRenderer.invoke('career:changeBase', base),
    transactions: () => ipcRenderer.invoke('career:transactions'),
    clients: () => ipcRenderer.invoke('career:clients')
  },
  dispatch: {
    schedule: () => ipcRenderer.invoke('dispatch:schedule'),
    book: (flightId) => ipcRenderer.invoke('dispatch:book', flightId),
    bookings: () => ipcRenderer.invoke('dispatch:bookings'),
    open: () => ipcRenderer.invoke('dispatch:open'),
    cancel: (id) => ipcRenderer.invoke('dispatch:cancel', id),
    charterOffers: () => ipcRenderer.invoke('dispatch:charterOffers'),
    acceptCharter: (id) => ipcRenderer.invoke('dispatch:acceptCharter', id),
    delayReason: (bookingId, code) => ipcRenderer.invoke('dispatch:delayReason', bookingId, code),
    simbriefUrl: (bookingId) => ipcRenderer.invoke('dispatch:simbriefUrl', bookingId),
    fetchOfp: () => ipcRenderer.invoke('dispatch:fetchOfp')
  },
  life: {
    state: () => ipcRenderer.invoke('life:state'),
    catalog: () => ipcRenderer.invoke('life:catalog'),
    setFamily: (f) => ipcRenderer.invoke('life:setFamily', f),
    rentHome: (id) => ipcRenderer.invoke('life:rentHome', id),
    buyHome: (id, down, years) => ipcRenderer.invoke('life:buyHome', id, down, years),
    setResidence: (id) => ipcRenderer.invoke('life:setResidence', id),
    setRentedOut: (id, on) => ipcRenderer.invoke('life:setRentedOut', id, on),
    buyCar: (id, down, years) => ipcRenderer.invoke('life:buyCar', id, down, years),
    buyAircraft: (id, down, years) => ipcRenderer.invoke('life:buyAircraft', id, down, years),
    buyCollectible: (id) => ipcRenderer.invoke('life:buyCollectible', id),
    sell: (id) => ipcRenderer.invoke('life:sell', id),
    repayLoan: (id) => ipcRenderer.invoke('life:repayLoan', id),
    rest: (id) => ipcRenderer.invoke('life:rest', id),
    subscribe: (id, on) => ipcRenderer.invoke('life:subscribe', id, on),
    enroll: (id) => ipcRenderer.invoke('life:enroll', id),
    renewMedical: () => ipcRenderer.invoke('life:renewMedical'),
    invest: (kind, amount, icao = null) => ipcRenderer.invoke('life:invest', kind, amount, icao),
    withdraw: (id) => ipcRenderer.invoke('life:withdraw', id),
    carImage: (id) => ipcRenderer.invoke('life:carImage', id)
  },
  cheat: {
    addMoney: (amount) => ipcRenderer.invoke('cheat:addMoney', amount),
    addHours: (hours) => ipcRenderer.invoke('cheat:addHours', hours),
    rest: () => ipcRenderer.invoke('cheat:rest'),
    heal: () => ipcRenderer.invoke('cheat:heal'),
    medical: () => ipcRenderer.invoke('cheat:medical'),
    reputation: () => ipcRenderer.invoke('cheat:reputation'),
    rating: (id) => ipcRenderer.invoke('cheat:rating', id),
    teleport: (icao) => ipcRenderer.invoke('cheat:teleport', icao)
  },
  market: {
    rows: () => ipcRenderer.invoke('market:rows'),
    detail: (icao) => ipcRenderer.invoke('market:detail', icao)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch)
  },
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
}

contextBridge.exposeInMainWorld('api', api)
