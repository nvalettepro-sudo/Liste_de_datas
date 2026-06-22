// Electron main process
const { app, BrowserWindow, protocol, net, shell } = require('electron')
const path = require('path')
const { pathToFileURL } = require('url')

const isDev = !app.isPackaged

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
    corsEnabled: true,
  }
}])

function getDistDir() {
  if (isDev) return path.join(__dirname, '..', 'dist')
  return path.join(app.getAppPath(), 'dist')
}

function resolveFilePath(distDir, pathname) {
  if (app.isPackaged && (pathname.endsWith('.wasm'))) {
    const unpackedBase = app.getAppPath().replace('app.asar', 'app.asar.unpacked')
    return path.join(unpackedBase, 'dist', pathname)
  }
  return path.join(distDir, pathname)
}

app.whenReady().then(() => {
  const distDir = getDistDir()

  protocol.handle('app', async (request) => {
    const url = new URL(request.url)
    let pathname = url.pathname
    if (pathname === '/' || pathname === '') pathname = '/index.html'

    const filePath = resolveFilePath(distDir, pathname)

    try {
      const response = await net.fetch(pathToFileURL(filePath).toString())
      if (pathname.endsWith('.wasm')) {
        const headers = new Headers(response.headers)
        headers.set('Content-Type', 'application/wasm')
        return new Response(response.body, { status: response.status, headers })
      }
      return response
    } catch {
      const indexPath = path.join(distDir, 'index.html')
      return net.fetch(pathToFileURL(indexPath).toString())
    }
  })

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'IFC Data Explorer',
    backgroundColor: '#030712',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  win.loadURL('app:///index.html')

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) win.webContents.openDevTools()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) app.whenReady().then(() => {})
})
