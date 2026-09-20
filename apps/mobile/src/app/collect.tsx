import { Stack } from "expo-router";
import { Collect } from "@/screens/collect";
import { useStrings } from "@/i18n";

export default function CollectRoute() {
  const strings = useStrings();
  return (
    <>
      <Stack.Screen options={{ title: strings.collect.title }} />
      <Collect />
    </>
  );
}
