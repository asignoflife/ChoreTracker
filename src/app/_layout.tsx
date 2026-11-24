import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

import { AnimatedSplashOverlay } from '@/components/animated-icon';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <>
      <AnimatedSplashOverlay />
      <Stack screenOptions={{ headerShown: false }}>
        {/* The hub is a shared kiosk screen: no swipe-back into the parent app. */}
        <Stack.Screen name="hub" options={{ gestureEnabled: false }} />
      </Stack>
    </>
  );
}
