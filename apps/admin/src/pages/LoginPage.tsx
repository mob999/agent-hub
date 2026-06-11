import GitHubIcon from '@mui/icons-material/GitHub'
import { Box, Button, Paper, Stack, Typography } from '@mui/material'
import { useLogin, useNotify } from 'react-admin'

export function LoginPage() {
  const login = useLogin()
  const notify = useNotify()

  return (
    <Box className="login-page">
      <Paper className="login-panel" elevation={0}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="h4">Tavro Admin</Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              Administrator access
            </Typography>
          </Box>
          <Button
            size="large"
            startIcon={<GitHubIcon />}
            variant="contained"
            onClick={() => {
              login({}).catch((error: unknown) => {
                notify(error instanceof Error ? error.message : 'Login failed.', { type: 'error' })
              })
            }}
          >
            Continue with GitHub
          </Button>
        </Stack>
      </Paper>
    </Box>
  )
}
