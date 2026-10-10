const { raiseBuildMemory } = require("./with-build-memory") as { raiseBuildMemory: (properties: Property[]) => Property[] };

type Property = { type: "property"; key: string; value: string } | { type: "comment"; value: string };

const value = (properties: Property[], key: string) => properties.find((entry) => entry.type === "property" && entry.key === key);

describe("raiseBuildMemory", () => {
  it("replaces the template's memory limits for the build, which this app's build outgrows", () => {
    const result = raiseBuildMemory([
      { type: "comment", value: "Project-wide Gradle settings." },
      { type: "property", key: "org.gradle.jvmargs", value: "-Xmx2048m -XX:MaxMetaspaceSize=512m" },
      { type: "property", key: "org.gradle.parallel", value: "true" },
    ]);
    expect(value(result, "org.gradle.jvmargs")).toEqual({ type: "property", key: "org.gradle.jvmargs", value: "-Xmx4g -XX:MaxMetaspaceSize=1g" });
    expect(result.filter((entry) => entry.type === "property" && entry.key === "org.gradle.jvmargs")).toHaveLength(1);
    expect(value(result, "org.gradle.parallel")).toEqual({ type: "property", key: "org.gradle.parallel", value: "true" });
  });

  it("adds the limits when the file has none", () => {
    expect(value(raiseBuildMemory([]), "org.gradle.jvmargs")).toMatchObject({ value: "-Xmx4g -XX:MaxMetaspaceSize=1g" });
  });
});
