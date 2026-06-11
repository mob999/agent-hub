import RefreshIcon from '@mui/icons-material/Refresh'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import {
  Alert,
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { Loading, useNotify } from 'react-admin'
import { apiRequest, type ObservabilityConfig } from '../lib/api'

type TimeRange = '1h' | '6h' | '24h' | '7d'

const serviceOptions = [
  { label: 'All', value: '.+' },
  { label: 'API', value: 'api' },
  { label: 'Worker', value: 'worker' },
  { label: 'Daemon', value: 'daemon' },
]

const levelOptions = [
  { label: 'All', value: '.+' },
  { label: 'Info', value: 'info' },
  { label: 'Warn', value: 'warning' },
  { label: 'Error', value: 'error' },
  { label: 'Debug', value: 'debug' },
]

function fromForRange(range: TimeRange): string {
  return `now-${range}`
}

function safeRegexQuery(value: string): string {
  const trimmed = value.trim()
  return trimmed.length === 0 ? '.*' : trimmed
}

function buildGrafanaUrl(
  config: ObservabilityConfig,
  input: {
    level: string
    query: string
    refreshKey: number
    service: string
    timeRange: TimeRange
  },
): string {
  const url = new URL(config.defaultDashboardPath, config.grafanaUrl)
  url.searchParams.set('orgId', '1')
  url.searchParams.set('kiosk', '1')
  url.searchParams.set('from', fromForRange(input.timeRange))
  url.searchParams.set('to', 'now')
  url.searchParams.set('var-service', input.service)
  url.searchParams.set('var-level', input.level)
  url.searchParams.set('var-query', safeRegexQuery(input.query))
  url.searchParams.set('refresh', '10s')
  url.searchParams.set('_adminRefresh', String(input.refreshKey))
  return url.toString()
}

export function LogsPage() {
  const notify = useNotify()
  const [config, setConfig] = useState<ObservabilityConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [service, setService] = useState('.+')
  const [level, setLevel] = useState('.+')
  const [query, setQuery] = useState('')
  const [timeRange, setTimeRange] = useState<TimeRange>('6h')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    apiRequest<ObservabilityConfig>('/admin/observability/config')
      .then((response) => {
        setConfig(response)
        setError(null)
      })
      .catch((requestError: unknown) => {
        const message = requestError instanceof Error
          ? requestError.message
          : 'Grafana config could not be loaded.'
        setError(message)
        notify(message, { type: 'error' })
      })
  }, [notify])

  const grafanaUrl = useMemo(
    () =>
      config === null
        ? null
        : buildGrafanaUrl(config, {
            level,
            query,
            refreshKey,
            service,
            timeRange,
          }),
    [config, level, query, refreshKey, service, timeRange],
  )

  if (error !== null) {
    return (
      <Box className="admin-page">
        <Alert severity="error">{error}</Alert>
      </Box>
    )
  }

  if (grafanaUrl === null) {
    return <Loading />
  }

  return (
    <Box className="admin-page logs-page">
      <Paper className="logs-toolbar" elevation={0}>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} alignItems={{ xs: 'stretch', lg: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel id="service-filter-label">Service</InputLabel>
            <Select
              labelId="service-filter-label"
              label="Service"
              value={service}
              onChange={(event) => setService(event.target.value)}
            >
              {serviceOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel id="level-filter-label">Level</InputLabel>
            <Select
              labelId="level-filter-label"
              label="Level"
              value={level}
              onChange={(event) => setLevel(event.target.value)}
            >
              {levelOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            size="small"
            label="Search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            sx={{ minWidth: { xs: '100%', lg: 280 } }}
          />
          <ToggleButtonGroup
            exclusive
            size="small"
            value={timeRange}
            onChange={(_, nextRange: TimeRange | null) => {
              if (nextRange !== null) {
                setTimeRange(nextRange)
              }
            }}
          >
            <ToggleButton value="1h">1h</ToggleButton>
            <ToggleButton value="6h">6h</ToggleButton>
            <ToggleButton value="24h">24h</ToggleButton>
            <ToggleButton value="7d">7d</ToggleButton>
          </ToggleButtonGroup>
          <Stack direction="row" spacing={1}>
            <Button
              startIcon={<RefreshIcon />}
              variant="outlined"
              onClick={() => setRefreshKey((value) => value + 1)}
            >
              Refresh
            </Button>
            <Button
              component="a"
              href={grafanaUrl}
              target="_blank"
              rel="noreferrer"
              startIcon={<OpenInNewIcon />}
              variant="outlined"
            >
              Open
            </Button>
          </Stack>
        </Stack>
      </Paper>
      <Box className="grafana-frame-shell">
        <iframe className="grafana-frame" title="Tavro AI Admin Logs" src={grafanaUrl} />
      </Box>
    </Box>
  )
}
