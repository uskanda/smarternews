// Where the app keeps the server it is connected to. The token goes into the device's encrypted storage and
// nowhere else; the URL is not a secret and sits in ordinary storage.
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Connection } from "@smarternews/client";
import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "smarternews.token";
const URL_KEY = "smarternews.url";

export async function loadConnection(): Promise<Connection | null> {
  const [url, token] = await Promise.all([AsyncStorage.getItem(URL_KEY), SecureStore.getItemAsync(TOKEN_KEY)]);
  return url && token ? { url, token } : null;
}

export async function saveConnection(connection: Connection): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, connection.token);
  await AsyncStorage.setItem(URL_KEY, connection.url);
}

/** Forgets the token. The URL stays, so that connecting again needs only the token. */
export async function forgetToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function clearConnection(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await AsyncStorage.removeItem(URL_KEY);
}

export async function lastUrl(): Promise<string | null> {
  return AsyncStorage.getItem(URL_KEY);
}
