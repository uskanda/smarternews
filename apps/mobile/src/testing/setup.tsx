// Runs before every test file. The device's own services are replaced here; the server never is.
import "react-native-gesture-handler/jestSetup";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { configure } from "@testing-library/react-native";

// The app answers after a real round trip to the server, not within the library's default of one second.
configure({ asyncUtilTimeout: 8000 });

afterEach(() => {
  jest.useRealTimers();
  // The folded groups are one state for the whole app; every test starts with none folded.
  require("../shell/collapsed").resetCollapsedState();
  // So is the colour scheme; every test starts following the device.
  require("../theme/store").resetThemeState();
  // So is the setting to mark read what the list is scrolled past; every test starts with it off.
  require("../settings/scroll-read").resetScrollReadState();
});

jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));

// Animations run on the native side of a device. Here they take their end values at once.
jest.mock("react-native-worklets", () => require("react-native-worklets/src/mock"));
jest.mock("react-native-reanimated", () => require("react-native-reanimated/mock"));

// The encrypted storage of the device: a map that lives as long as the test, so "closing and opening again" works.
jest.mock("expo-secure-store", () => {
  const items = new Map<string, string>();
  return {
    __items: items,
    getItemAsync: jest.fn(async (key: string) => items.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => void items.set(key, value)),
    deleteItemAsync: jest.fn(async (key: string) => void items.delete(key)),
  };
});

// The camera: a view that a test makes "see" a QR code, and a permission a test grants or refuses.
jest.mock("expo-camera", () => {
  const { View } = require("react-native");
  const state = { granted: true, canAskAgain: true };
  return {
    __permission: state,
    CameraView: (props: object) => <View testID="camera" {...props} />,
    useCameraPermissions: () => {
      const React = require("react");
      // As on a device before the user was ever asked: known, and not granted yet.
      const [permission, setPermission] = React.useState({ granted: false, canAskAgain: true, status: "undetermined" });
      const request = async () => {
        const next = { granted: state.granted, canAskAgain: state.canAskAgain, status: state.granted ? "granted" : "denied" };
        setPermission(next);
        return next;
      };
      return [permission, request, request];
    },
  };
});

jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "opened" })) }));

// Notifications: what the app shows is recorded, and a test grants or refuses the permission and "presses" one.
jest.mock("expo-notifications", () => {
  const state = { granted: true, asked: 0, shown: [] as unknown[], channels: [] as unknown[], listeners: [] as Array<(response: unknown) => void>, last: null as unknown };
  const permission = () => ({ granted: state.granted, status: state.granted ? "granted" : "denied", canAskAgain: true });
  return {
    __state: state,
    AndroidImportance: { DEFAULT: 3 },
    getPermissionsAsync: jest.fn(async () => (state.asked === 0 ? { granted: false, status: "undetermined", canAskAgain: true } : permission())),
    requestPermissionsAsync: jest.fn(async () => {
      state.asked += 1;
      return permission();
    }),
    setNotificationChannelAsync: jest.fn(async (id: string, channel: object) => void state.channels.push({ id, ...channel })),
    setNotificationHandler: jest.fn(),
    scheduleNotificationAsync: jest.fn(async (request: unknown) => {
      state.shown.push(request);
      return "id";
    }),
    addNotificationResponseReceivedListener: jest.fn((listener: (response: unknown) => void) => {
      state.listeners.push(listener);
      return { remove: () => void state.listeners.splice(state.listeners.indexOf(listener), 1) };
    }),
    getLastNotificationResponseAsync: jest.fn(async () => state.last),
    clearLastNotificationResponseAsync: jest.fn(async () => {
      state.last = null;
    }),
  };
});

// The periodic check: which tasks are registered, and the function a test runs as Android would.
jest.mock("expo-task-manager", () => {
  const tasks = new Map<string, () => Promise<unknown>>();
  return { __tasks: tasks, defineTask: jest.fn((name: string, run: () => Promise<unknown>) => void tasks.set(name, run)), isTaskDefined: (name: string) => tasks.has(name) };
});
jest.mock("expo-background-task", () => {
  const registered = new Map<string, object>();
  return {
    __registered: registered,
    BackgroundTaskResult: { Success: 1, Failed: 2 },
    BackgroundTaskStatus: { Restricted: 1, Available: 2 },
    getStatusAsync: jest.fn(async () => 2),
    registerTaskAsync: jest.fn(async (name: string, options: object = {}) => void registered.set(name, options)),
    unregisterTaskAsync: jest.fn(async (name: string) => void registered.delete(name)),
  };
});

beforeEach(async () => {
  await AsyncStorage.clear();
  (jest.requireMock("expo-secure-store") as { __items: Map<string, string> }).__items.clear();
  Object.assign((jest.requireMock("expo-camera") as { __permission: object }).__permission, { granted: true, canAskAgain: true });
  Object.assign((jest.requireMock("expo-notifications") as { __state: object }).__state, { granted: true, asked: 0, shown: [], channels: [], listeners: [], last: null });
  (jest.requireMock("expo-background-task") as { __registered: Map<string, object> }).__registered.clear();
});
