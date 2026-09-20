import { useLocalSearchParams } from "expo-router";
import { Customer } from "@/screens/customer";

export default function CustomerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Customer id={id ?? ""} />;
}
