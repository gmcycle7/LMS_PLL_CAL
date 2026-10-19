import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Layout } from './Layout'
import { SettingsProvider } from './settings'

beforeEach(() => {
  localStorage.setItem('lmspll.mode', 'engineer')
})
afterEach(() => {
  localStorage.clear()
})

describe('Layout：表格的 caption／scope 安全網', () => {
  it('<main> 裡手寫的表格自動補 caption 與 th scope，之後才出現的表格也會補', async () => {
    const table = (
      <table>
        <thead>
          <tr>
            <th>量</th>
            <th>值</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>a</td>
            <td>1</td>
          </tr>
        </tbody>
      </table>
    )
    const { rerender } = render(
      <SettingsProvider>
        <MemoryRouter>
          <Layout>
            <h2>手算結果</h2>
            {table}
          </Layout>
        </MemoryRouter>
      </SettingsProvider>,
    )
    const t = await screen.findByRole('table', { name: '表格：手算結果' })
    expect([...t.querySelectorAll('th')].map((th) => th.getAttribute('scope'))).toEqual(['col', 'col'])
    rerender(
      <SettingsProvider>
        <MemoryRouter>
          <Layout>
            <h2>手算結果</h2>
            {table}
            <h2>第二節</h2>
            {table}
          </Layout>
        </MemoryRouter>
      </SettingsProvider>,
    )
    await waitFor(() => expect(screen.getByRole('table', { name: '表格：第二節' })).toBeTruthy())
  })
})
