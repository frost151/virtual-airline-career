import '@mantine/core/styles.css'
import './styles.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { MantineProvider, createTheme } from '@mantine/core'
import { HashRouter } from 'react-router-dom'
import { App } from './App'

const theme = createTheme({
  primaryColor: 'blue',
  fontFamily: 'Segoe UI, system-ui, sans-serif',
  defaultRadius: 'md'
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <HashRouter>
        <App />
      </HashRouter>
    </MantineProvider>
  </React.StrictMode>
)
