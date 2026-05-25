import {
  Button,
  Form,
  InlineLoading,
  InlineNotification,
  Link,
  PasswordInput,
  Stack,
  Tag,
  TextInput,
  Theme,
} from '@carbon/react'
import { ChatBot } from '@carbon/react/icons'
import { useState, type FormEvent, type MouseEvent } from 'react'
import { ApiRequestError, apiRequest, type AuthResponse } from '../lib/api'

export type RoutePath = '/' | '/login' | '/register'

interface AuthPageProps {
  mode: 'login' | 'register'
  navigate: (path: RoutePath) => void
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function AuthPage({ mode, navigate }: AuthPageProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const isRegister = mode === 'register'
  const emailError = submitted
    ? email.trim().length === 0
      ? 'Email address is required.'
      : !isEmail(email)
        ? 'Enter a valid email address.'
        : ''
    : ''
  const passwordError = submitted
    ? password.length === 0
      ? 'Password is required.'
      : isRegister && password.length < 8
        ? 'Use at least 8 characters.'
        : ''
    : ''
  const confirmPasswordError =
    submitted && isRegister && confirmPassword !== password ? 'Passwords must match.' : ''

  const validate = () => {
    if (!isEmail(email)) {
      return false
    }

    if (password.length === 0) {
      return false
    }

    if (isRegister && (password.length < 8 || confirmPassword !== password)) {
      return false
    }

    return true
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitted(true)
    setServerError(null)

    if (!validate()) {
      return
    }

    setSubmitting(true)

    try {
      await apiRequest<AuthResponse>(isRegister ? '/auth/register' : '/auth/login', {
        method: 'POST',
        body: JSON.stringify(
          isRegister
            ? { email: email.trim(), password, name: name.trim() || undefined }
            : { email: email.trim(), password },
        ),
      })
      navigate('/')
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setServerError(error.message)
      } else {
        setServerError('We could not reach AgentHub. Try again in a moment.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const goTo = (path: RoutePath) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    navigate(path)
  }

  return (
    <main
      className="grid min-h-screen grid-cols-[minmax(24rem,0.95fr)_minmax(28rem,1.05fr)] bg-[var(--cds-background)] max-[1055px]:grid-cols-1"
      aria-label={isRegister ? 'Create account' : 'Log in'}
    >
      <Theme
        theme="g100"
        as="section"
        className="flex min-h-screen flex-col justify-between gap-16 p-12 text-[var(--cds-text-primary)] max-[1055px]:min-h-0 max-[1055px]:p-8 max-[671px]:p-4"
        aria-label="AgentHub preview"
      >
        <div className="inline-flex items-center gap-3">
          <ChatBot size={32} />
          <span className="font-semibold">AgentHub</span>
        </div>
        <div className="grid max-w-[38rem] gap-4">
          <p className="cds--type-label-01">Human + agent workspace</p>
          <h1 className="cds--type-heading-06 max-w-[12ch] max-[671px]:max-w-full">
            Work with agents like teammates.
          </h1>
          <p className="cds--type-body-02 max-w-[34rem] text-[var(--cds-text-secondary)]">
            Keep chats, local daemon runs, task events, and runtime state in one quiet product
            surface.
          </p>
        </div>
        <div
          className="grid max-w-[34rem] gap-4 rounded-lg border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] p-4"
          aria-hidden="true"
        >
          <div className="grid gap-3">
            <div className="justify-self-end rounded-lg bg-[var(--cds-background-inverse)] p-3 text-sm leading-snug text-[var(--cds-text-inverse)]">
              Review this API route and open a fix.
            </div>
            <div className="justify-self-start rounded-lg border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-02)] p-3 text-sm leading-snug">
              A configured agent accepted the run. Streaming tool calls now.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Tag type="green">Daemon online</Tag>
            <Tag type="blue">Run active</Tag>
          </div>
        </div>
      </Theme>

      <section className="grid min-h-screen items-center bg-[var(--cds-background)] p-12 max-[1055px]:min-h-0 max-[1055px]:p-8 max-[671px]:p-4">
        <div className="w-full max-w-[28rem]">
          <Form aria-label={isRegister ? 'Create account' : 'Log in'} onSubmit={submit}>
            <Stack gap={7}>
              <div>
                <h2 className="cds--type-heading-05">
                  {isRegister ? 'Create an account' : 'Log in'}
                </h2>
                <p className="cds--type-body-01 mt-3 text-[var(--cds-text-secondary)]">
                  {isRegister
                    ? 'Start a workspace for local and cloud agents.'
                    : 'Continue to your AgentHub workspace.'}
                </p>
              </div>

              {serverError && (
                <InlineNotification
                  kind="error"
                  title={isRegister ? 'Registration failed' : 'Login failed'}
                  subtitle={serverError}
                  lowContrast
                  aria-label="Close notification"
                />
              )}

              {isRegister && (
                <TextInput
                  id="register-name"
                  labelText="Name (optional)"
                  value={name}
                  autoComplete="name"
                  onChange={(event) => setName(event.target.value)}
                />
              )}

              <TextInput
                id={`${mode}-email`}
                labelText="Email address"
                type="email"
                value={email}
                autoComplete="email"
                invalid={Boolean(emailError)}
                invalidText={emailError}
                onChange={(event) => setEmail(event.target.value)}
              />

              <PasswordInput
                id={`${mode}-password`}
                labelText="Password"
                value={password}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                invalid={Boolean(passwordError)}
                invalidText={passwordError}
                onChange={(event) => setPassword(event.target.value)}
              />

              {isRegister && (
                <PasswordInput
                  id="register-confirm-password"
                  labelText="Confirm password"
                  value={confirmPassword}
                  autoComplete="new-password"
                  invalid={Boolean(confirmPasswordError)}
                  invalidText={confirmPasswordError}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              )}

              {submitting ? (
                <InlineLoading
                  description={isRegister ? 'Creating account...' : 'Logging in...'}
                  status="active"
                />
              ) : (
                <Button type="submit" size="lg">
                  {isRegister ? 'Create account' : 'Log in'}
                </Button>
              )}

              <p className="cds--type-body-01">
                {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
                <Link
                  href={isRegister ? '/login' : '/register'}
                  onClick={goTo(isRegister ? '/login' : '/register')}
                >
                  {isRegister ? 'Log in' : 'Create an account'}
                </Link>
              </p>
            </Stack>
          </Form>
        </div>
      </section>
    </main>
  )
}
