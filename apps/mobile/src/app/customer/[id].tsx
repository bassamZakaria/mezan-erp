import { Stack, useLocalSearchParams } from "expo-router";
import { Customer } from "@/screens/customer";
import { useStrings } from "@/i18n";

export default function CustomerRoute() {
  const strings = useStrings();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen options={{ title: strings.customer.title }} />
      <Customer id={id ?? ""} />
    </>
  );
}
