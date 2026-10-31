import { useNetworkState } from "expo-network";

/** The device's own report of its connection — not a guess from a request that failed for some other reason. */
export function useOffline(): boolean {
  const state = useNetworkState();
  return state.isConnected === false || state.isInternetReachable === false;
}
