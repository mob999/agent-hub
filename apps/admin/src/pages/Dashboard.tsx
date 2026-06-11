import PeopleIcon from '@mui/icons-material/People'
import QueryStatsIcon from '@mui/icons-material/QueryStats'
import { Box, Card, CardActionArea, CardContent, Stack, Typography } from '@mui/material'
import { useGetIdentity, useGetList } from 'react-admin'
import { Link } from 'react-router-dom'
import type { AdminUser } from '../lib/api'

export function Dashboard() {
  const { identity } = useGetIdentity()
  const { total, isPending } = useGetList<AdminUser>('users', {
    pagination: { page: 1, perPage: 1 },
    sort: { field: 'createdAt', order: 'DESC' },
    filter: {},
  })

  return (
    <Box className="admin-page">
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <Card className="metric-card">
          <CardActionArea component={Link} to="/users">
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1.5}>
                <PeopleIcon color="primary" />
                <Typography variant="overline">Users</Typography>
              </Stack>
              <Typography variant="h3" sx={{ mt: 1 }}>
                {isPending ? '...' : total ?? 0}
              </Typography>
            </CardContent>
          </CardActionArea>
        </Card>
        <Card className="metric-card">
          <CardActionArea component={Link} to="/logs">
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1.5}>
                <QueryStatsIcon color="primary" />
                <Typography variant="overline">Logs</Typography>
              </Stack>
              <Typography variant="h5" sx={{ mt: 1 }}>
                Grafana
              </Typography>
            </CardContent>
          </CardActionArea>
        </Card>
      </Stack>
      <Typography color="text.secondary" sx={{ mt: 3 }}>
        Signed in as {identity?.fullName ?? 'administrator'}.
      </Typography>
    </Box>
  )
}
