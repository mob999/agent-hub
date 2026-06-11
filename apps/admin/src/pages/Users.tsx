import {
  Datagrid,
  DateField,
  FunctionField,
  List,
  NumberField,
  SearchInput,
  Show,
  SimpleShowLayout,
  TextField,
} from 'react-admin'
import type { AdminUserDetail } from '../lib/api'

const userFilters = [
  <SearchInput key="q" source="q" alwaysOn />,
]

export function UserList() {
  return (
    <List
      filters={userFilters}
      perPage={25}
      sort={{ field: 'createdAt', order: 'DESC' }}
      title="Users"
    >
      <Datagrid bulkActionButtons={false} rowClick="show">
        <TextField source="email" />
        <TextField source="name" emptyText="-" />
        <NumberField source="sessionCount" />
        <NumberField source="oauthProviderCount" label="OAuth" />
        <DateField source="createdAt" showTime />
        <DateField source="updatedAt" showTime />
      </Datagrid>
    </List>
  )
}

export function UserShow() {
  return (
    <Show title="User">
      <SimpleShowLayout>
        <TextField source="id" />
        <TextField source="email" />
        <TextField source="name" emptyText="-" />
        <TextField source="avatar" emptyText="-" />
        <NumberField source="sessionCount" />
        <NumberField source="oauthProviderCount" label="OAuth account count" />
        <FunctionField<AdminUserDetail>
          label="OAuth providers"
          render={(record) => record.oauthProviders.length ? record.oauthProviders.join(', ') : '-'}
        />
        <DateField source="lastSessionCreatedAt" showTime emptyText="-" />
        <DateField source="welcomeOnboardingCompletedAt" showTime emptyText="-" />
        <DateField source="createdAt" showTime />
        <DateField source="updatedAt" showTime />
      </SimpleShowLayout>
    </Show>
  )
}
