import GitHubIcon from '@mui/icons-material/GitHub'
import PersonIcon from '@mui/icons-material/Person'
import { Box, Button, Paper, Stack, Typography } from '@mui/material'
import { useState } from 'react'
import { useLogin, useNotify, useRedirect } from 'react-admin'
import { apiRequest } from '../lib/api'

const showDevelopmentLogin = import.meta.env.DEV

export function LoginPage() {
  const login = useLogin()
  const notify = useNotify()
  const redirect = useRedirect()
  const [devSubmitting, setDevSubmitting] = useState(false)

  const startDevelopmentLogin = async () => {
    setDevSubmitting(true)

    try {
      await apiRequest('/auth/dev/login', { method: 'POST' })
      redirect('/')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Development login failed.', {
        type: 'error',
      })
    } finally {
      setDevSubmitting(false)
    }
  }

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
            disabled={devSubmitting}
            onClick={() => {
              login({}).catch((error: unknown) => {
                notify(error instanceof Error ? error.message : 'Login failed.', { type: 'error' })
              })
            }}
          >
            Continue with GitHub
          </Button>
          {showDevelopmentLogin && (
            <Button
              size="large"
              startIcon={<PersonIcon />}
              variant="outlined"
              disabled={devSubmitting}
              onClick={startDevelopmentLogin}
            >
              {devSubmitting ? 'Opening developer session...' : 'Continue as developer'}
            </Button>
          )}
        </Stack>
      </Paper>
    </Box>
  )
}
