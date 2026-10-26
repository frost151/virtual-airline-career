import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'

const REPO = 'frost151/virtual-airline-career'
/** Как часто проверять обновления, пока программа открыта. */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

/** Портативную версию electron-updater поставить не умеет: только сообщаем о новой версии и даём ссылку. */
const portable = !!process.env.PORTABLE_EXECUTABLE_FILE

let status: UpdateStatus = { state: 'idle', current: app.getVersion(), portable }

function set(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch }
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update:status', status)
}

/** У electron-updater в ошибке бывает целый HTTP-ответ — показываем только первую строку. */
const firstLine = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split('\n')[0]

export const updateStatus = (): UpdateStatus => status

/** Заметки к релизу приходят строкой (HTML или Markdown) или списком по версиям. */
function notesText(notes: unknown): string | undefined {
  if (typeof notes === 'string') return notes.replace(/<[^>]+>/g, '').trim() || undefined
  if (Array.isArray(notes))
    return (
      notes
        .map((n) => notesText(n?.note))
        .filter(Boolean)
        .join('\n\n') || undefined
    )
  return undefined
}

/** Сравнение версий вида 1.2.3: больше нуля, если a новее b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d
  }
  return 0
}

export function initUpdater(): void {
  if (!app.isPackaged) {
    set({ state: 'disabled', error: 'Обновления работают только в установленной программе, не в режиме разработки.' })
    return
  }
  if (!portable) {
    autoUpdater.autoDownload = true
    // Если пользователь не нажал «Перезапустить», обновление встанет при обычном закрытии программы.
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: undefined }))
    autoUpdater.on('update-not-available', () => set({ state: 'none', checkedAt: Date.now() }))
    autoUpdater.on('update-available', (info) =>
      set({ state: 'downloading', version: info.version, notes: notesText(info.releaseNotes), percent: 0, checkedAt: Date.now() })
    )
    autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version, percent: 100 }))
    autoUpdater.on('error', (e) => set({ state: 'error', error: firstLine(e) }))
  }
  void checkForUpdates()
  setInterval(() => {
    // Скачанное обновление ждёт перезапуска — повторно не проверяем.
    if (status.state !== 'ready' && status.state !== 'downloading') void checkForUpdates()
  }, CHECK_EVERY_MS)
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (status.state === 'disabled' || status.state === 'checking' || status.state === 'downloading' || status.state === 'ready') {
    return status
  }
  if (portable) return checkPortable()
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    set({ state: 'error', error: firstLine(e) })
  }
  return status
}

/** Портативная версия: смотрим последний релиз на GitHub и даём ссылку на новый exe. */
async function checkPortable(): Promise<UpdateStatus> {
  set({ state: 'checking', error: undefined })
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' }
    })
    if (!res.ok) throw new Error(`GitHub ответил ${res.status}`)
    const rel = (await res.json()) as {
      tag_name: string
      body?: string
      html_url: string
      assets: { name: string; browser_download_url: string }[]
    }
    const version = rel.tag_name.replace(/^v/, '')
    if (compareVersions(version, status.current) <= 0) {
      set({ state: 'none', checkedAt: Date.now() })
    } else {
      const exe = rel.assets.find((a) => /portable\.exe$/i.test(a.name))
      set({
        state: 'available',
        version,
        notes: notesText(rel.body),
        url: exe?.browser_download_url ?? rel.html_url,
        checkedAt: Date.now()
      })
    }
  } catch (e) {
    set({ state: 'error', error: firstLine(e) })
  }
  return status
}

/** Закрыть программу и поставить скачанное обновление. `beforeQuit` сохраняет полёт и закрывает профиль. */
export function installUpdate(flying: boolean, beforeQuit: () => void): void {
  if (status.state !== 'ready') throw new Error('Обновление ещё не скачано.')
  if (flying) throw new Error('Сначала завершите полёт: при перезапуске трекер остановится.')
  beforeQuit()
  // Тихая установка в ту же папку и запуск новой версии.
  autoUpdater.quitAndInstall(true, true)
}
