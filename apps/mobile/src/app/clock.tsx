import { Stack } from "expo-router";
import { Clock } from "@/screens/clock";
import { useStrings } from "@/i18n";

export default function ClockRoute() {
  const strings = useStrings();
  return (
    <>
      <Stack.Screen options={{ title: strings.clock.title }} />
      <Clock />
    </>
  );
}
