import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { fetchAuthMe, queryKeys } from './query'

export function useAuthenticatedRedirect(navigate: (path: '/welcome') => void) {
  const authQuery = useQuery({
    queryFn: fetchAuthMe,
    queryKey: queryKeys.authMe(),
    retry: false,
  })

  useEffect(() => {
    if (authQuery.data?.user) {
      navigate('/welcome')
    }
  }, [authQuery.data?.user, navigate])
}
