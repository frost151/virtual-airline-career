import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import type { FlightSource } from '@shared/sim'
import {
  activeDb,
  closeProfile,
  createProfile,
  currentProfile,
  deleteProfile,
  getPhoto,
  listProfiles,
  openProfile,
  setPhoto
} from './profiles'
import { getAirline, listAirlines, places } from './world'
import {
  catchUpOnOpen,
  finishFlight,
  initSession,
  setSimProbes,
  shutdownSession,
  simDiagnostics,
  simStatus,
  skipTime,
  startFlight,
  takeReport,
  trackerState,
  worldClockOffset
} from './session'
import { worldNow } from './worldTime'
import type { SkipPreset } from '@shared/economy'
import { macroOverview } from './economy/clock'
import { getFlight, listFlights } from './logbook'
import type { HireInput, Settings } from '@shared/types'
import type { FoundAirlineInput } from '@shared/airlines'
import type { AirlineArchetype } from '@shared/world'
import * as career from './career/career'
import { listClients } from './career/charter'
import { fetchLatestOfp, simbriefDispatchUrl } from './career/simbrief'
import { getSettings, saveSettings } from './settings'
import * as life from './lifestyle/life'
import { CARS } from './lifestyle/catalog'
import { wikiImage } from './wikiImages'
import { airlineLogoFallback } from './logos'
import { airlineEconomy, marketRows } from './airlines/economy'
import * as stakes from './airlines/stakes'
import * as player from './airlines/player'
import * as manage from './airlines/manage'
import * as cheats from './cheats'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#1a1b1e',
    autoHideMenuBar: true,
    title: 'Virtual Airline Career',
    // В собранной программе иконку окна даёт сам exe; при разработке берём её из build/.
    ...(app.isPackaged ? {} : { icon: join(app.getAppPath(), 'build/icon.png') }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  win.once('ready-to-show', () => win.show())

  // Внешние ссылки (SimBrief и т.п.) открываем в браузере, а не в окне приложения.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('profiles:list', () => listProfiles())
  ipcMain.handle('profiles:create', (_e, input) => {
    finishFlight()
    const p = createProfile(input)
    catchUpOnOpen()
    return p
  })
  ipcMain.handle('profiles:open', (_e, id: string) => {
    finishFlight()
    const p = openProfile(id)
    // Досчитываем всё, что произошло в мире, пока программа была закрыта.
    catchUpOnOpen()
    return p
  })
  ipcMain.handle('world:report', () => takeReport())
  ipcMain.handle('world:clock', () => worldClockOffset())
  ipcMain.handle('world:skip', (_e, preset: SkipPreset) => skipTime(preset))
  ipcMain.handle('world:macro', () => macroOverview(activeDb()))
  ipcMain.handle('profiles:close', () => {
    // Идущий полёт сохраняем в бортжурнал профиля, из которого выходим.
    finishFlight()
    closeProfile()
  })
  ipcMain.handle('profiles:current', () => currentProfile())
  ipcMain.handle('profiles:photo', () => getPhoto())
  ipcMain.handle('profiles:setPhoto', (_e, photo: string | null) => setPhoto(photo))
  ipcMain.handle('profiles:delete', (_e, id: string) => {
    if (currentProfile()?.id === id) finishFlight()
    deleteProfile(id)
  })
  ipcMain.handle('world:airlines', () => listAirlines())
  ipcMain.handle('world:airline', (_e, icao: string) => getAirline(icao))
  ipcMain.handle('world:places', (_e, codes: string[]) => places(codes))
  ipcMain.handle('world:logoFallback', (_e, iata: string) => airlineLogoFallback(iata))
  ipcMain.handle('sim:status', () => simStatus())
  ipcMain.handle('sim:diagnostics', () => simDiagnostics())
  ipcMain.handle('sim:setProbes', (_e, names: string[]) => setSimProbes(names))
  ipcMain.handle('tracker:state', () => trackerState())
  ipcMain.handle('tracker:start', (_e, source: FlightSource, bookingId: number | null, prepMin?: number) =>
    startFlight(source, bookingId, prepMin)
  )
  ipcMain.handle('tracker:finish', () => finishFlight())
  ipcMain.handle('logbook:list', () => listFlights(activeDb()))
  ipcMain.handle('logbook:get', (_e, id: number) => getFlight(activeDb(), id))

  ipcMain.handle('career:state', () => career.pilotState(activeDb()))
  ipcMain.handle('career:hireOptions', () => career.hireOptions(activeDb()))
  ipcMain.handle('career:hire', (_e, input: HireInput) => career.hire(activeDb(), input))
  ipcMain.handle('career:resign', () => career.resign(activeDb()))
  ipcMain.handle('career:allRatings', () => career.allRatings(activeDb()))
  ipcMain.handle('career:buyRating', (_e, id: string) => career.buyRating(activeDb(), id))
  ipcMain.handle('career:returnToBase', () => career.returnToBase(activeDb()))
  ipcMain.handle('career:changeBase', (_e, base: string) => career.changeBase(activeDb(), base))
  ipcMain.handle('career:transactions', () => career.listTransactions(activeDb()))
  ipcMain.handle('career:clients', () => listClients(activeDb()))

  ipcMain.handle('dispatch:schedule', () => career.dispatchSchedule(activeDb(), worldNow(activeDb())))
  ipcMain.handle('dispatch:book', (_e, flightId: string) => career.bookScheduled(activeDb(), flightId, worldNow(activeDb())))
  ipcMain.handle('dispatch:bookings', () => career.listBookings(activeDb()))
  ipcMain.handle('dispatch:open', () => career.openBooking(activeDb()))
  ipcMain.handle('dispatch:cancel', (_e, id: number) => career.cancelBooking(activeDb(), id, worldNow(activeDb())))
  ipcMain.handle('dispatch:charterOffers', () => career.listCharterOffers(activeDb(), worldNow(activeDb())))
  ipcMain.handle('dispatch:acceptCharter', (_e, id: string) => career.acceptCharter(activeDb(), id, worldNow(activeDb())))
  ipcMain.handle('dispatch:delayReason', (_e, id: number, code: string) => career.setDelayReason(activeDb(), id, code))
  ipcMain.handle('dispatch:simbriefUrl', (_e, id: number) => simbriefDispatchUrl(career.getBooking(activeDb(), id)))
  ipcMain.handle('dispatch:fetchOfp', () => fetchLatestOfp(getSettings(activeDb()).simbriefUsername))

  // Личная жизнь: каждое действие возвращает обновлённое состояние.
  const lifeAction =
    <A extends unknown[]>(fn: (db: ReturnType<typeof activeDb>, ...args: A) => unknown) =>
    (_e: unknown, ...args: A) => {
      const db = activeDb()
      fn(db, ...args)
      return life.lifeState(db)
    }
  ipcMain.handle('life:state', () => life.lifeState(activeDb()))
  ipcMain.handle('life:catalog', () => life.catalogFor(activeDb()))
  ipcMain.handle('life:setFamily', lifeAction(life.setFamily))
  ipcMain.handle('life:rentHome', lifeAction(life.rentHome))
  ipcMain.handle('life:buyHome', lifeAction(life.buyHome))
  ipcMain.handle('life:setResidence', lifeAction(life.setResidence))
  ipcMain.handle('life:setRentedOut', lifeAction(life.setRentedOut))
  ipcMain.handle('life:buyCar', lifeAction(life.buyCar))
  ipcMain.handle('life:buyAircraft', lifeAction(life.buyAircraft))
  ipcMain.handle('life:buyCollectible', lifeAction(life.buyCollectible))
  ipcMain.handle('life:sell', lifeAction(life.sellAsset))
  ipcMain.handle('life:repayLoan', lifeAction(life.repayLoan))
  ipcMain.handle('life:rest', lifeAction(life.takeRest))
  ipcMain.handle('life:subscribe', lifeAction(life.subscribe))
  ipcMain.handle('life:enroll', lifeAction(life.enroll))
  ipcMain.handle('life:renewMedical', lifeAction((db) => life.renewMedical(db)))
  ipcMain.handle('life:invest', lifeAction(life.invest))
  ipcMain.handle('life:withdraw', lifeAction(life.withdraw))
  ipcMain.handle('cheat:addMoney', (_e, amount: number) => cheats.cheatMoney(activeDb(), amount))
  ipcMain.handle('cheat:addHours', (_e, hours: number) => cheats.cheatHours(activeDb(), hours))
  ipcMain.handle('cheat:rest', () => cheats.cheatRest(activeDb()))
  ipcMain.handle('cheat:heal', () => cheats.cheatHeal(activeDb()))
  ipcMain.handle('cheat:medical', () => cheats.cheatMedical(activeDb()))
  ipcMain.handle('cheat:reputation', () => cheats.cheatReputation(activeDb()))
  ipcMain.handle('cheat:rating', (_e, id: string) => cheats.cheatRating(activeDb(), id))
  ipcMain.handle('cheat:teleport', (_e, icao: string) => cheats.cheatTeleport(activeDb(), icao))
  ipcMain.handle('market:rows', () => marketRows(activeDb()))
  ipcMain.handle('market:detail', (_e, icao: string) => airlineEconomy(activeDb(), icao))
  ipcMain.handle('market:stakes', () => stakes.listStakes(activeDb()))
  ipcMain.handle('market:stakeOffer', (_e, icao: string) => stakes.stakeOffer(activeDb(), icao))
  ipcMain.handle('market:buyStake', (_e, icao: string, pct: number) => stakes.buyStake(activeDb(), icao, pct))
  ipcMain.handle('market:sellStake', (_e, icao: string) => stakes.sellStake(activeDb(), icao))
  ipcMain.handle('owner:companies', () => player.playerAirlines(activeDb()))
  ipcMain.handle('owner:hubOptions', () => player.hubOptions())
  ipcMain.handle('owner:typeOptions', (_e, archetype: AirlineArchetype) => player.foundTypeOptions(activeDb(), archetype))
  ipcMain.handle('owner:destinations', (_e, hub: string, typeId: string) => player.destinationOptions(activeDb(), hub, typeId))
  ipcMain.handle('owner:quote', (_e, input: FoundAirlineInput) => player.foundQuote(activeDb(), input))
  ipcMain.handle('owner:found', (_e, input: FoundAirlineInput) => player.foundAirline(activeDb(), input))
  // Управление компанией: каждое действие возвращает обновлённую сводку.
  const manageAction =
    <A extends unknown[]>(fn: (db: ReturnType<typeof activeDb>, icao: string, ...args: A) => unknown) =>
    (_e: unknown, icao: string, ...args: A) => {
      const db = activeDb()
      fn(db, icao, ...args)
      return manage.manageState(db, icao)
    }
  ipcMain.handle('manage:state', (_e, icao: string) => manage.manageState(activeDb(), icao))
  ipcMain.handle('manage:routeQuote', (_e, icao: string, origin: string, dest: string) => manage.routeQuote(activeDb(), icao, origin, dest))
  ipcMain.handle('manage:setAutopilot', manageAction(manage.setAutopilot))
  ipcMain.handle('manage:setFareMult', manageAction(manage.setFareMult))
  ipcMain.handle('manage:setFrequency', manageAction(manage.setFrequency))
  ipcMain.handle('manage:openRoute', manageAction(manage.openRoute))
  ipcMain.handle('manage:setRouteType', manageAction(manage.setRouteType))
  ipcMain.handle('manage:lease', manageAction(manage.leaseAircraft))
  ipcMain.handle('manage:buy', manageAction(manage.buyAircraft))
  ipcMain.handle('manage:returnLease', manageAction(manage.returnLease))
  ipcMain.handle('manage:sell', manageAction(manage.sellAircraft))
  ipcMain.handle('manage:borrow', manageAction(manage.borrow))
  ipcMain.handle('manage:repay', manageAction(manage.repay))
  ipcMain.handle('manage:setCeoSalary', manageAction(manage.setCeoSalary))
  ipcMain.handle('manage:setPayout', manageAction(manage.setPayout))
  ipcMain.handle('manage:hire', manageAction(manage.hireStaff))
  ipcMain.handle('manage:fire', manageAction(manage.fireStaff))
  ipcMain.handle('manage:setPayLevel', manageAction(manage.setPayLevel))
  ipcMain.handle('manage:setService', manageAction(manage.setService))
  ipcMain.handle('manage:inject', manageAction(manage.injectCapital))
  ipcMain.handle('manage:ipo', manageAction(manage.goPublic))
  ipcMain.handle('life:carImage', (_e, id: string) => {
    const car = CARS.find((c) => c.id === id)
    return car?.wiki ? wikiImage(car.wiki) : null
  })

  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    // Наружу открываем только https — ссылка приходит из интерфейса.
    if (/^https:\/\//.test(url)) return shell.openExternal(url)
  })
  ipcMain.handle('settings:get', () => getSettings(activeDb()))
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => saveSettings(activeDb(), patch))
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  initSession()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  shutdownSession()
  closeProfile()
  app.quit()
})
