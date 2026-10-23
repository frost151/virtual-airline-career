import { useEffect, useState } from 'react'
import { Center, Loader } from '@mantine/core'
import type { ProfileSummary } from '@shared/types'
import { ProfileSelect } from './screens/ProfileSelect'
import { Shell } from './screens/Shell'

export function App() {
  const [profile, setProfile] = useState<ProfileSummary | null | undefined>(undefined)

  useEffect(() => {
    window.api.profiles.current().then(setProfile)
  }, [])

  if (profile === undefined) {
    return (
      <Center h="100%">
        <Loader />
      </Center>
    )
  }

  if (!profile) return <ProfileSelect onOpened={setProfile} />

  return (
    <Shell
      profile={profile}
      onExit={async () => {
        await window.api.profiles.close()
        setProfile(null)
      }}
    />
  )
}
