import '@mantine/core/styles.css'
import './styles.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { MantineProvider, createTheme } from '@mantine/core'
import { HashRouter } from 'react-router-dom'
import { App } from './App'
import sky from './assets/sky.svg?raw'

const theme = createTheme({
  primaryColor: 'blue',
  fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
  headings: { fontFamily: "'Bahnschrift', 'Segoe UI', sans-serif" },
  defaultRadius: 'md'
})

// Фон-небо вшит в сборку: CSP разрешает картинки из data:, а styles.css берёт его из переменной.
document.documentElement.style.setProperty('--ui-sky', `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(sky)}")`)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <HashRouter>
        <App />
      </HashRouter>
    </MantineProvider>
  </React.StrictMode>
)
