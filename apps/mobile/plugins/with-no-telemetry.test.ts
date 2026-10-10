const { dropTelemetryBackend } = require("./with-no-telemetry") as { dropTelemetryBackend: (manifest: Manifest) => Manifest };

interface Node {
  $: Record<string, string>;
  "meta-data"?: Node[];
}
interface Manifest {
  manifest: { $: Record<string, string>; application: Array<{ $: Record<string, string>; service?: Node[] }> };
}

const DISCOVERY = "com.google.android.datatransport.runtime.backends.TransportBackendDiscovery";
const BACKEND = "backend:com.google.android.datatransport.cct.CctBackendFactory";

const manifest = (services?: Node[]): Manifest => ({
  manifest: {
    $: { "xmlns:android": "http://schemas.android.com/apk/res/android" },
    application: [{ $: { "android:name": ".MainApplication" }, ...(services ? { service: services } : {}) }],
  },
});

describe("dropTelemetryBackend", () => {
  it("tells the manifest merger to remove the backend that uploads usage records to Google", () => {
    const result = dropTelemetryBackend(manifest());
    const service = result.manifest.application[0]!.service!.find((entry) => entry.$["android:name"] === DISCOVERY)!;
    expect(service.$["tools:node"]).toBe("merge");
    expect(service["meta-data"]).toEqual([{ $: { "android:name": BACKEND, "tools:node": "remove" } }]);
  });

  it("declares the tools namespace that the instruction needs", () => {
    expect(dropTelemetryBackend(manifest()).manifest.$["xmlns:tools"]).toBe("http://schemas.android.com/tools");
  });

  it("keeps the services that are already declared", () => {
    const other = { $: { "android:name": ".SomeService" } };
    const result = dropTelemetryBackend(manifest([other]));
    expect(result.manifest.application[0]!.service).toContainEqual(other);
    expect(result.manifest.application[0]!.service).toHaveLength(2);
  });

  it("changes nothing the second time it runs", () => {
    const once = dropTelemetryBackend(manifest());
    const twice = dropTelemetryBackend(JSON.parse(JSON.stringify(once)) as Manifest);
    expect(twice).toEqual(once);
  });
});
