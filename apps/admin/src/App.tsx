import PeopleIcon from '@mui/icons-material/People'
import QueryStatsIcon from '@mui/icons-material/QueryStats'
import { Admin, CustomRoutes, Layout, Menu, Resource } from 'react-admin'
import type { LayoutProps } from 'react-admin'
import { Route } from 'react-router-dom'
import { Dashboard } from './pages/Dashboard'
import { LogsPage } from './pages/Logs'
import { LoginPage } from './pages/LoginPage'
import { UserList, UserShow } from './pages/Users'
import { authProvider } from './providers/authProvider'
import { dataProvider } from './providers/dataProvider'

function AdminMenu() {
  return (
    <Menu>
      <Menu.DashboardItem />
      <Menu.ResourceItem name="users" />
      <Menu.Item to="/logs" primaryText="Logs" leftIcon={<QueryStatsIcon />} />
    </Menu>
  )
}

function AdminLayout(props: LayoutProps) {
  return <Layout {...props} menu={AdminMenu} />
}

export default function App() {
  return (
    <Admin
      authProvider={authProvider}
      basename="/"
      dashboard={Dashboard}
      dataProvider={dataProvider}
      layout={AdminLayout}
      loginPage={LoginPage}
      requireAuth
      title="Tavro Admin"
    >
      <Resource name="users" list={UserList} show={UserShow} icon={PeopleIcon} recordRepresentation="email" />
      <CustomRoutes>
        <Route path="/logs" element={<LogsPage />} />
      </CustomRoutes>
    </Admin>
  )
}
