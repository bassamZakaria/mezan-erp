import { Stack } from "expo-router";
import { Approvals } from "@/screens/approvals";
import { useStrings } from "@/i18n";

export default function ApprovalsRoute() {
  const strings = useStrings();
  return (
    <>
      <Stack.Screen options={{ title: strings.approvals.title }} />
      <Approvals />
    </>
  );
}
